import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { wmt } from '../api'
import { isWmtOnlyDomain, isUpdateLogDomain } from '../domain'
import UpdateLogList from '../components/UpdateLogList'

// ── constants & helpers ───────────────────────────────────────────────────────

// football-data.org v4 uses LAST_16 / LAST_32; keep ROUND_OF_* as fallbacks
const STAGE_LABELS = {
  GROUP_STAGE:    'Gruppenphase',
  LAST_32:        'Rd. 32',
  ROUND_OF_32:    'Rd. 32',
  LAST_16:        'Achtelfinale',
  ROUND_OF_16:    'Achtelfinale',
  QUARTER_FINALS: 'Viertelfinale',
  SEMI_FINALS:    'Halbfinale',
  THIRD_PLACE:    'Spiel um Platz 3',
  FINAL:          'Finale',
}

const STATUS_LABELS = {
  SCHEDULED: 'Ausstehend',
  TIMED:     'Ausstehend',
  IN_PLAY:   'Läuft',
  PAUSED:    'Halbzeit',
  FINISHED:  'Abgeschlossen',
  POSTPONED: 'Verschoben',
  CANCELLED: 'Abgesagt',
  SUSPENDED: 'Unterbrochen',
}

const STATUS_COLORS = {
  IN_PLAY: '#4d8a4d',
  PAUSED:  'var(--text-secondary)',
  FINISHED:'var(--text-dim)',
  default: 'var(--text-secondary)',
}

function statusColor(s) { return STATUS_COLORS[s] ?? STATUS_COLORS.default }

function stageLabel(s) { return STAGE_LABELS[s] ?? s.replace(/_/g, ' ') }

function formatDate(utcStr) {
  if (!utcStr) return ''
  const d = new Date(utcStr)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) +
    ' · ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

function formatDateLong(utcStr) {
  if (!utcStr) return ''
  const d = new Date(utcStr)
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Group stage uses matchday numbers; knockout rounds are keyed by stage name
// (football-data.org sends matchday=null for knockout games, which our backend
//  coerces to 0, so we must not rely on matchday for those).
const STAGE_ORDER = ['GROUP_STAGE','LAST_32','ROUND_OF_32','LAST_16','ROUND_OF_16','QUARTER_FINALS','SEMI_FINALS','THIRD_PLACE','FINAL']

// ── Kicktipp-optimaler Tipp ───────────────────────────────────────────────────
// Kicktipp-Standardwertung: Ergebnis 4 · Tordifferenz 3 · Tendenz 2
function kicktippPoints(tipH, tipA, h, a) {
  if (tipH === h && tipA === a) return 4
  if (tipH - tipA === h - a) return 3
  if (Math.sign(tipH - tipA) === Math.sign(h - a)) return 2
  return 0
}

function poissonPmf(k, lambda) {
  let p = Math.exp(-lambda)
  for (let i = 1; i <= k; i++) p *= lambda / i
  return p
}

// Tipp mit maximaler Kicktipp-Punkterwartung: Poisson-Torgitter aus den xG,
// reskaliert auf die Sieg/Remis/Niederlage-Wahrscheinlichkeiten des Modells.
// In K.o.-Runden wird (wie bisher) nie ein Remis getippt.
function bestTip(p, isKnockout) {
  const lh = Math.max(0.05, p.pred_home_goals)
  const la = Math.max(0.05, p.pred_away_goals)
  const MAX_G = 6
  const grid = []
  let sumHome = 0, sumDraw = 0, sumAway = 0
  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) {
      const pr = poissonPmf(h, lh) * poissonPmf(a, la)
      grid.push([h, a, pr])
      if (h > a) sumHome += pr
      else if (h === a) sumDraw += pr
      else sumAway += pr
    }
  }
  const scaleHome = sumHome > 0 ? (p.home_win_prob ?? sumHome) / sumHome : 1
  const scaleDraw = sumDraw > 0 ? (p.draw_prob ?? sumDraw) / sumDraw : 1
  const scaleAway = sumAway > 0 ? (p.away_win_prob ?? sumAway) / sumAway : 1
  for (const cell of grid) {
    cell[2] *= cell[0] > cell[1] ? scaleHome : cell[0] === cell[1] ? scaleDraw : scaleAway
  }
  const homeLean = (p.home_win_prob ?? 0) >= (p.away_win_prob ?? 0)
  const cands = []
  for (let th = 0; th <= 5; th++) {
    for (let ta = 0; ta <= 5; ta++) {
      if (isKnockout && th === ta) continue
      let ev = 0, cellPr = 0
      for (const [h, a, pr] of grid) {
        ev += pr * kicktippPoints(th, ta, h, a)
        if (h === th && a === ta) cellPr = pr
      }
      cands.push({ th, ta, ev, cellPr })
    }
  }
  // Bei EV-Gleichstand: wahrscheinlicheres Ergebnis, dann Richtung des Favoriten
  cands.sort((x, y) =>
    y.ev - x.ev ||
    y.cellPr - x.cellPr ||
    (homeLean ? (y.th - y.ta) - (x.th - x.ta) : (y.ta - y.th) - (x.ta - x.th))
  )
  return [cands[0].th, cands[0].ta]
}

function groupMatches(matches) {
  const map = {}
  for (const m of matches) {
    const key = m.stage === 'GROUP_STAGE' ? `md_${m.matchday}` : `stage_${m.stage}`
    if (!map[key]) map[key] = []
    map[key].push(m)
  }
  return map
}

function sortGroupKeys(keys) {
  return [...keys].sort((a, b) => {
    const aIsMd = a.startsWith('md_')
    const bIsMd = b.startsWith('md_')
    if (aIsMd && bIsMd) return parseInt(a.slice(3)) - parseInt(b.slice(3))
    if (aIsMd) return -1
    if (bIsMd) return 1
    const ai = STAGE_ORDER.indexOf(a.slice(6))
    const bi = STAGE_ORDER.indexOf(b.slice(6))
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
}

function groupLabel(key) {
  if (key.startsWith('md_')) return `MD ${key.slice(3)}`
  return stageLabel(key.slice(6))
}

// Returns ISO date string yyyy-mm-dd in local timezone for a match
function matchLocalDateKey(m) {
  const d = new Date(m.utc_date)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${dy}`
}

function calDayLabel(isoDate) {
  const [y, mo, d] = isoDate.split('-').map(Number)
  return new Date(y, mo - 1, d).toLocaleDateString('de-DE', {
    weekday: 'short', day: '2-digit', month: '2-digit',
  })
}

// Groups matches by calendar day (local time), returns sorted [[isoDate, matches]] pairs
function groupByCalDay(matches) {
  const byDay = {}
  for (const m of matches) {
    const key = matchLocalDateKey(m)
    if (!byDay[key]) byDay[key] = []
    byDay[key].push(m)
  }
  return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b))
}

function renderMarkdown(text) {
  if (!text) return null
  return text.split('\n').map((line, i) => {
    const parts = line.split(/\*\*(.*?)\*\*/g).map((p, j) =>
      j % 2 === 1 ? <strong key={j}>{p}</strong> : p
    )
    if (line.startsWith('## '))
      return <div key={i} style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{line.slice(3)}</div>
    if (line.startsWith('- '))
      return <div key={i} style={{ paddingLeft: 12, marginBottom: 3 }}>• {parts.slice(1)}</div>
    if (line === '')
      return <div key={i} style={{ height: 8 }} />
    return <div key={i}>{parts}</div>
  })
}

// ── team qualification status ─────────────────────────────────────────────────

function computeTeamStatuses(matches) {
  const statuses = {} // teamId → 'qualified' | 'eliminated'

  // Knockout: FINISHED → winner qualified, loser eliminated
  // Exception: SEMI_FINALS losers still play THIRD_PLACE — don't colour them yet
  for (const m of matches) {
    if (m.stage === 'GROUP_STAGE' || m.status !== 'FINISHED') continue
    if (!m.home_team || !m.away_team || m.score_home == null) continue
    const homeWon = m.score_home > m.score_away
    const winner = homeWon ? m.home_team.id : m.away_team.id
    const loser  = homeWon ? m.away_team.id : m.home_team.id
    statuses[winner] = 'qualified'
    if (m.stage !== 'SEMI_FINALS') statuses[loser] = 'eliminated'
  }
  // SEMI_FINALS losers: colour once THIRD_PLACE is settled
  const tp = matches.find(m => m.stage === 'THIRD_PLACE' && m.status === 'FINISHED')
  if (tp?.home_team && tp?.away_team && tp.score_home != null) {
    const tpWon = tp.score_home > tp.score_away
    statuses[tpWon ? tp.home_team.id : tp.away_team.id] = 'qualified'
    statuses[tpWon ? tp.away_team.id : tp.home_team.id] = 'eliminated'
  }

  // Group stage: compute per-group standings, derive sure-qualified / sure-out
  const groups = {}
  for (const m of matches) {
    if (m.stage !== 'GROUP_STAGE' || !m.group_name) continue
    const g = m.group_name
    if (!groups[g]) groups[g] = { pts: {}, rem: {} }
    const h = m.home_team?.id, a = m.away_team?.id
    if (!h || !a) continue
    for (const id of [h, a]) {
      if (!(id in groups[g].pts)) { groups[g].pts[id] = 0; groups[g].rem[id] = 0 }
    }
    if (m.status === 'FINISHED' && m.score_home != null) {
      if (m.score_home > m.score_away)      groups[g].pts[h] += 3
      else if (m.score_away > m.score_home) groups[g].pts[a] += 3
      else { groups[g].pts[h]++; groups[g].pts[a]++ }
    } else {
      groups[g].rem[h]++; groups[g].rem[a]++
    }
  }

  for (const { pts, rem } of Object.values(groups)) {
    const ids = Object.keys(pts).map(Number)
    for (const id of ids) {
      if (statuses[id]) continue  // knockout result already set
      const myMin = pts[id]
      const myMax = pts[id] + 3 * (rem[id] || 0)
      // Sure top-2: at most 1 other team can possibly outscore my minimum
      const canBeat = ids.filter(o => o !== id && pts[o] + 3 * (rem[o] || 0) > myMin).length
      if (canBeat < 2) { statuses[id] = 'qualified'; continue }
      // Sure out: 2+ teams already have more points than my absolute best
      const ahead = ids.filter(o => o !== id && pts[o] > myMax).length
      if (ahead >= 2) statuses[id] = 'eliminated'
    }
  }

  return statuses
}

// ── sub-components ────────────────────────────────────────────────────────────

function ProbBar({ home, draw, away, homeTla, awayTla }) {
  const hw = (home * 100).toFixed(0)
  const dw = (draw * 100).toFixed(0)
  const aw = (away * 100).toFixed(0)
  return (
    <div>
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', gap: 2 }}>
        <div style={{ width: `${hw}%`, background: '#4d6fa0', transition: 'width 0.4s' }} />
        <div style={{ width: `${dw}%`, background: 'var(--border-hover)', transition: 'width 0.4s' }} />
        <div style={{ width: `${aw}%`, background: 'var(--border)', transition: 'width 0.4s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
        <span>{homeTla} {hw}%</span>
        <span>Rem {dw}%</span>
        <span>{aw}% {awayTla}</span>
      </div>
    </div>
  )
}

function teamStatusColor(status) {
  if (status === 'qualified')  return '#4d8a4d'
  if (status === 'eliminated') return '#8a4d4d'
  return 'var(--text-primary)'
}

function MatchCard({ match, teamStatuses = {} }) {
  const p = match.prediction
  const isFinished = match.status === 'FINISHED'
  const isLive = match.status === 'IN_PLAY' || match.status === 'PAUSED'
  const homeName = match.home_team?.name ?? 'TBD'
  const awayName = match.away_team?.name ?? 'TBD'
  const homeTla  = match.home_team?.tla ?? '?'
  const awayTla  = match.away_team?.tla ?? '?'
  const homeStatus = match.home_team ? teamStatuses[match.home_team.id] ?? null : null
  const awayStatus = match.away_team ? teamStatuses[match.away_team.id] ?? null : null
  const [tipHome, tipAway] = p ? bestTip(p, match.stage !== 'GROUP_STAGE') : [null, null]

  const tipBgColor = isFinished ? 'var(--surface)' : 'rgba(77,111,160,0.06)'

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '14px 16px',
      marginBottom: 10,
    }}>
      {/* header row */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 10, color: 'var(--text-dim)', marginBottom: 12, letterSpacing: '0.05em',
      }}>
        <span>
          {match.group_name ? `GR. ${match.group_name}` : stageLabel(match.stage)}
          {' · '}{formatDate(match.utc_date)}
        </span>
        <span style={{ color: isLive ? STATUS_COLORS.IN_PLAY : statusColor(match.status) }}>
          {STATUS_LABELS[match.status] ?? match.status}
        </span>
      </div>

      {/* teams + score row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: teamStatusColor(homeStatus) }}>{homeName}</div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{homeTla}</div>
        </div>

        <div style={{ minWidth: 56, textAlign: 'center' }}>
          {isFinished || isLive ? (
            <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {match.score_home ?? 0}&nbsp;:&nbsp;{match.score_away ?? 0}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>vs</div>
          )}
        </div>

        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: teamStatusColor(awayStatus) }}>{awayName}</div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{awayTla}</div>
        </div>
      </div>

      {/* prediction block */}
      {p ? (
        <div style={{
          background: tipBgColor,
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '10px 12px',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
            {isFinished ? 'Prognose war' : 'Tipp-Empfehlung'}:{' '}
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{tipHome}:{tipAway}</span>
            <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>
              (xG {p.pred_home_goals.toFixed(1)} : {p.pred_away_goals.toFixed(1)})
            </span>
            {isFinished && match.score_home !== null && (
              <span style={{ marginLeft: 8, color: resultColor(tipHome, tipAway, match.score_home, match.score_away) }}>
                {resultMark(tipHome, tipAway, match.score_home, match.score_away)}
              </span>
            )}
          </div>
          <ProbBar
            home={p.home_win_prob} draw={p.draw_prob} away={p.away_win_prob}
            homeTla={homeTla} awayTla={awayTla}
          />

          <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65, marginBottom: p.home_elo ? 10 : 0, whiteSpace: 'pre-line' }}>
                {p.reasoning}
              </div>
              {p.home_elo && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
                  ELO: {homeTla} {p.home_elo.toFixed(0)} · {awayTla} {p.away_elo?.toFixed(0)}
                  {match.home_team && ` · Spiele: ${match.home_team.matches_played}`}
                </div>
              )}

              {match.predictions?.length >= 1 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 6 }}>
                    VERLAUF ({match.predictions.length} {match.predictions.length === 1 ? 'VERSION' : 'VERSIONEN'})
                  </div>
                  {match.predictions.map((ph, i) => {
                    const prev = match.predictions[i + 1]
                    const isKo = match.stage !== 'GROUP_STAGE'
                    const [tipH, tipA] = bestTip(ph, isKo)
                    const prevTip = prev ? bestTip(prev, isKo) : null
                    const tipChanged = prevTip && (tipH !== prevTip[0] || tipA !== prevTip[1])

                    let changeNote = null
                    if (tipChanged) {
                      const [prevTipH, prevTipA] = prevTip
                      const dHome = (ph.home_elo != null && prev.home_elo != null) ? Math.round(ph.home_elo - prev.home_elo) : null
                      const dAway = (ph.away_elo != null && prev.away_elo != null) ? Math.round(ph.away_elo - prev.away_elo) : null
                      const nachMatch = ph.reasoning?.match(/nach: ([^.]+)/)
                      const trigger = nachMatch ? nachMatch[1].trim() : null

                      let note = `Tipp: ${prevTipH}:${prevTipA} → ${tipH}:${tipA}`
                      const triggerItems = trigger ? trigger.split(', ') : []
                      if (triggerItems.length > 0) {
                        note += `\nAuslöser:\n${triggerItems.join('\n')}`
                      }
                      const eloParts = []
                      if (dHome != null) eloParts.push(`${homeTla} ${dHome > 0 ? '+' : ''}${dHome}`)
                      if (dAway != null) eloParts.push(`${awayTla} ${dAway > 0 ? '+' : ''}${dAway}`)
                      if (eloParts.length) note += `\nELO: ${eloParts.join(' · ')}.`
                      changeNote = note
                    }

                    return (
                      <div key={ph.id} style={{
                        padding: '6px 0',
                        borderTop: '1px solid var(--border)',
                        fontSize: 11,
                        color: i === 0 ? 'var(--text-secondary)' : 'var(--text-dim)',
                      }}>
                        <span style={{ marginRight: 8 }}>{formatDateLong(ph.created_at)}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {tipH}:{tipA}
                          {' '}<span style={{ color: 'var(--text-dim)' }}>
                            (xG {ph.pred_home_goals.toFixed(1)}:{ph.pred_away_goals.toFixed(1)})
                          </span>
                          {' '}({(ph.home_win_prob * 100).toFixed(0)}%/
                          {(ph.draw_prob * 100).toFixed(0)}%/
                          {(ph.away_win_prob * 100).toFixed(0)}%)
                        </span>
                        {i === 0 && <span style={{ color: '#4d6fa0', marginLeft: 6 }}>aktuell</span>}
                        {changeNote && (
                          <div style={{ color: '#c8a84d', marginTop: 3, fontSize: 10, lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                            {changeNote}
                          </div>
                        )}
                        {!changeNote && i > 0 && ph.reasoning && (
                          <div style={{ color: 'var(--text-dim)', marginTop: 2, fontSize: 10, lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                            {ph.reasoning}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Noch keine Prognose verfügbar.</div>
      )}
    </div>
  )
}

function resultMark(tipH, tipA, actH, actA) {
  const tipWinner = tipH > tipA ? 'home' : tipH < tipA ? 'away' : 'draw'
  const actWinner = actH > actA ? 'home' : actH < actA ? 'away' : 'draw'
  return tipWinner === actWinner ? '✓ Tendenz richtig' : '✗ Tendenz falsch'
}
function resultColor(tipH, tipA, actH, actA) {
  const tipWinner = tipH > tipA ? 'home' : tipH < tipA ? 'away' : 'draw'
  const actWinner = actH > actA ? 'home' : actH < actA ? 'away' : 'draw'
  return tipWinner === actWinner ? '#4d8a4d' : '#8a4d4d'
}

function MenuButton({ icon, label, loading, danger, disabled, onClick }) {
  const busy = loading || disabled
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', background: 'none', border: 'none',
        color: busy ? 'var(--text-dim)' : danger ? '#8a4d4d' : 'var(--text-secondary)',
        padding: '10px 16px', fontSize: 12,
        cursor: busy ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', textAlign: 'left',
        opacity: busy ? 0.6 : 1,
      }}>
      <span style={{ width: 14, textAlign: 'center', flexShrink: 0 }}>
        {loading ? '…' : icon}
      </span>
      {label}
    </button>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function Wmt() {
  const [matches, setMatches]           = useState([])
  const [opponentTips, setOpponentTips] = useState([])
  const [rankingSnapshots, setRankingSnapshots] = useState([])
  const [summaries, setSummaries]       = useState([])
  const [bonus, setBonus]               = useState(null)
  const [view, setView]                 = useState(isWmtOnlyDomain() ? 'konkurrenz' : 'spieltage')
  const [selectedKey, setSelectedKey]   = useState(null)
  const [loading, setLoading]           = useState(true)
  const [refreshing, setRefreshing]     = useState(false)
  const [clearing, setClearing]         = useState(false)
  const [warming, setWarming]           = useState(false)
  const [adjustingNews, setAdjustingNews] = useState(false)
  const [generatingBonus, setGeneratingBonus] = useState(false)
  const [fakingMd1, setFakingMd1]         = useState(false)
  const [fakingMd2, setFakingMd2]         = useState(false)
  const [fakingMd3, setFakingMd3]         = useState(false)
  const [fakingRd32, setFakingRd32]       = useState(false)
  const [fakingLast16, setFakingLast16]   = useState(false)
  const [fakingQf, setFakingQf]           = useState(false)
  const [fakingSf, setFakingSf]           = useState(false)
  const [fakingTp, setFakingTp]           = useState(false)
  const [fakingFinal, setFakingFinal]     = useState(false)
  const [fakingAll, setFakingAll]         = useState(false)
  const [summaryCalOpen, setSummaryCalOpen]           = useState(false)
  const [generatingSummaryFor, setGeneratingSummaryFor] = useState(null)
  const [logs, setLogs]                   = useState([])
  const [menuOpen, setMenuOpen]         = useState(false)
  const logRef                          = useRef(null)

  // matthiasweigel.com is a stripped-down mirror for Tipprunde opponents:
  // it shows only the Konkurrenz view (rank chart + everyone's tips), no
  // burger menu, no tabs, no import/log noise.
  const wmtOnly = isWmtOnlyDomain()

  const addLog = useCallback((text, level = 'info') => {
    setLogs(prev => [...prev, { ts: Date.now(), text, level }])
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  const loadAll = useCallback(async () => {
    try {
      const ms = await wmt.getMatches()
      setMatches(ms)

      try {
        const ot = await wmt.getOpponentTips()
        setOpponentTips(ot)
      } catch { /* ignore */ }

      try {
        const rs = await wmt.getRankingSnapshots()
        setRankingSnapshots(rs)
      } catch { /* ignore */ }

      const ss = await wmt.getSummaries()
      setSummaries(ss)

      try {
        const b = await wmt.getBonus()
        setBonus(b)
      } catch { /* 404 = not generated yet */ }

      const grouped   = groupMatches(ms)
      const gKeys     = sortGroupKeys(Object.keys(grouped))
      const activeKey = gKeys.find(k => grouped[k].some(m =>
        m.status === 'IN_PLAY' || m.status === 'PAUSED' ||
        m.status === 'SCHEDULED' || m.status === 'TIMED'
      )) ?? gKeys[gKeys.length - 1] ?? gKeys[0]
      setSelectedKey(prev => prev ?? activeKey ?? null)
    } catch (e) {
      console.error(e)
      throw e
    }
  }, [])

  useEffect(() => {
    async function startup() {
      setLoading(true)

      // Opponents-only mirror: just load the data the Konkurrenz view needs,
      // skip the status check and all import logging.
      if (wmtOnly) {
        try {
          await loadAll()
        } catch (e) {
          console.error(e)
        } finally {
          setLoading(false)
        }
        return
      }

      setView('import')
      try {
        const status = await wmt.getStatus()

        if (status.match_count === 0) {
          addLog('Kein Spielplan in der Datenbank', 'error')
          addLog('→ Spielplan aktualisieren (☰) um Daten zu laden')
          return
        }

        addLog(`${status.match_count} Spiele im Spielplan`, 'done')

        if (status.calibrated) {
          addLog('ELO: kalibriert — historische Kalibrierung aktiv', 'done')
        } else {
          addLog('ELO: Standard-Schätzungen aktiv (keine historische Kalibrierung)')
          addLog('→ Historische Kalibrierung (☰) für genauere Prognosen empfohlen')
        }

        if (status.prediction_count > 0) {
          addLog(`${status.prediction_count} Prognosen vorhanden`, 'done')
        } else {
          addLog('Keine Prognosen — Spielplan aktualisieren (☰) um Prognosen zu berechnen')
        }

        try {
          const factors = await wmt.getFactors()
          if (factors.length > 0) {
            addLog(`${factors.length} Team-Faktor${factors.length === 1 ? '' : 'en'} aktiv (effektives ELO)`, 'done')
          }
        } catch { /* ignore */ }

        addLog('Spieldaten werden geladen…')
        const t0 = Date.now()
        await loadAll()
        addLog(`Bereit (${((Date.now() - t0) / 1000).toFixed(1)}s)`, 'done')
        setView('spieltage')
      } catch (e) {
        addLog('Fehler beim Starten', 'error')
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    startup()
  }, [addLog, loadAll, wmtOnly])

  async function handleClear() {
    if (!window.confirm('Alle WMT-Daten löschen? (Teams, Spiele, Prognosen, Faktoren, Konkurrenz-Tipps, Morgenberichte, Bonus)')) return
    setClearing(true)
    addLog('Datenbank wird geleert…')
    try {
      await wmt.clearData()
      setMatches([])
      setSummaries([])
      setBonus(null)
      setSelectedKey(null)
      addLog('Alle WMT-Daten gelöscht', 'done')
    } catch (e) {
      addLog('Fehler beim Löschen', 'error')
    } finally {
      setClearing(false)
    }
  }

  async function handleGenerateBonus() {
    setGeneratingBonus(true)
    addLog('Bonus-Prognose wird berechnet (Monte-Carlo-Simulation)…')
    const t0 = Date.now()
    try {
      const res = await wmt.generateBonus()
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      addLog(`${res.message} (${elapsed}s)`, res.updated ? 'done' : 'error')
      if (res.updated) {
        const b = await wmt.getBonus()
        setBonus(b)
        setView('bonus')
      }
    } catch (e) {
      addLog('Fehler bei Bonus-Prognose', 'error')
    } finally {
      setGeneratingBonus(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    addLog('Spielplandaten werden abgerufen…')
    const t0 = Date.now()
    try {
      const res = await wmt.refresh()
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      const isErr = !res.updated && !res.message?.startsWith('Aktualisierung')
      addLog(`${res.message} (${elapsed}s)`, isErr ? 'error' : 'done')
      if (!isErr) await loadAll()
      addLog('Ansicht aktualisiert', 'done')
    } catch (e) {
      addLog(`Fehler beim Refresh${e?.message ? ` — ${e.message}` : ''}`, 'error')
    } finally {
      setRefreshing(false)
    }
  }

  async function handleWarmup() {
    setWarming(true)
    setView('import')
    addLog('Historische ELO-Kalibrierung wird gestartet…')
    try {
      const res = await wmt.warmup()
      const serverLogs = (res.logs || []).map(l => ({
        ts: new Date(l.ts).getTime() || Date.now(),
        text: l.text,
        level: l.level || 'info',
      }))
      setLogs(prev => [...prev, ...serverLogs])
      addLog(`Kalibrierung abgeschlossen (${res.elapsed_seconds?.toFixed(1)}s)`, 'done')
      await loadAll()
      addLog('ELO-Ratings aktualisiert — bitte Spielplan aktualisieren (☰) für neue Prognosen', 'done')
    } catch (e) {
      addLog('Fehler bei der Kalibrierung', 'error')
    } finally {
      setWarming(false)
    }
  }

  async function handleNewsAdjust() {
    setAdjustingNews(true)
    setView('import')
    addLog('News-Faktoren werden aktualisiert (NewsAPI + Claude)…')
    const t0 = Date.now()
    try {
      const res = await wmt.newsAdjust()
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      addLog(`${res.message} (${elapsed}s)`, res.message.includes('nicht gesetzt') ? 'error' : 'done')
      await loadAll()
    } catch (e) {
      addLog('Fehler beim Aktualisieren der News-Faktoren', 'error')
    } finally {
      setAdjustingNews(false)
    }
  }

  async function handleFakeMd1() {
    setFakingMd1(true)
    setView('import')
    addLog('Fake MD1-Ergebnisse werden gesetzt…')
    const t0 = Date.now()
    try {
      const res = await wmt.fakeMd1()
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      addLog(`${res.message} (${elapsed}s)`, res.updated ? 'done' : 'error')
      if (res.updated) {
        await loadAll()
        setView('spieltage')
        setSelectedKey('md_1')
      }
    } catch (e) {
      addLog('Fehler beim Setzen der Fake-Ergebnisse', 'error')
    } finally {
      setFakingMd1(false)
    }
  }

  async function handleFakeMd2() {
    setFakingMd2(true)
    setView('import')
    addLog('Fake MD2-Ergebnisse werden gesetzt…')
    const t0 = Date.now()
    try {
      const res = await wmt.fakeMd2()
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      addLog(`${res.message} (${elapsed}s)`, res.updated ? 'done' : 'error')
      if (res.updated) {
        await loadAll()
        setView('spieltage')
        setSelectedKey('md_2')
      }
    } catch (e) {
      addLog('Fehler beim Setzen der Fake-Ergebnisse', 'error')
    } finally {
      setFakingMd2(false)
    }
  }

  async function handleFakeMd3() {
    setFakingMd3(true)
    setView('import')
    addLog('Fake MD3-Ergebnisse werden gesetzt…')
    const t0 = Date.now()
    try {
      const res = await wmt.fakeMd3()
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      addLog(`${res.message} (${elapsed}s)`, res.updated ? 'done' : 'error')
      if (res.updated) {
        await loadAll()
        setView('spieltage')
        setSelectedKey('md_3')
      }
    } catch (e) {
      addLog('Fehler beim Setzen der Fake-Ergebnisse', 'error')
    } finally {
      setFakingMd3(false)
    }
  }

  async function handleFakeRd32() {
    setFakingRd32(true)
    setView('import')
    addLog('Fake Rd.32-Ergebnisse werden gesetzt…')
    const t0 = Date.now()
    try {
      const res = await wmt.fakeRd32()
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      addLog(`${res.message} (${elapsed}s)`, res.updated ? 'done' : 'error')
      if (res.updated) {
        await loadAll()
        setView('spieltage')
        setSelectedKey('stage_LAST_32')
      }
    } catch (e) {
      addLog('Fehler beim Setzen der Fake-Ergebnisse', 'error')
    } finally {
      setFakingRd32(false)
    }
  }

  async function handleFakeLast16() {
    setFakingLast16(true); setView('import')
    addLog('Fake Achtelfinale-Ergebnisse werden gesetzt…')
    const t0 = Date.now()
    try {
      const res = await wmt.fakeLast16()
      addLog(`${res.message} (${((Date.now()-t0)/1000).toFixed(1)}s)`, res.updated ? 'done' : 'error')
      if (res.updated) { await loadAll(); setView('spieltage'); setSelectedKey('stage_LAST_16') }
    } catch { addLog('Fehler beim Setzen der Fake-Ergebnisse', 'error') }
    finally { setFakingLast16(false) }
  }

  async function handleFakeQf() {
    setFakingQf(true); setView('import')
    addLog('Fake Viertelfinale-Ergebnisse werden gesetzt…')
    const t0 = Date.now()
    try {
      const res = await wmt.fakeQf()
      addLog(`${res.message} (${((Date.now()-t0)/1000).toFixed(1)}s)`, res.updated ? 'done' : 'error')
      if (res.updated) { await loadAll(); setView('spieltage'); setSelectedKey('stage_QUARTER_FINALS') }
    } catch { addLog('Fehler beim Setzen der Fake-Ergebnisse', 'error') }
    finally { setFakingQf(false) }
  }

  async function handleFakeSf() {
    setFakingSf(true); setView('import')
    addLog('Fake Halbfinale-Ergebnisse werden gesetzt…')
    const t0 = Date.now()
    try {
      const res = await wmt.fakeSf()
      addLog(`${res.message} (${((Date.now()-t0)/1000).toFixed(1)}s)`, res.updated ? 'done' : 'error')
      if (res.updated) { await loadAll(); setView('spieltage'); setSelectedKey('stage_SEMI_FINALS') }
    } catch { addLog('Fehler beim Setzen der Fake-Ergebnisse', 'error') }
    finally { setFakingSf(false) }
  }

  async function handleFakeTp() {
    setFakingTp(true); setView('import')
    addLog('Fake Spiel-um-Platz-3-Ergebnis wird gesetzt…')
    const t0 = Date.now()
    try {
      const res = await wmt.fakeTp()
      addLog(`${res.message} (${((Date.now()-t0)/1000).toFixed(1)}s)`, res.updated ? 'done' : 'error')
      if (res.updated) { await loadAll(); setView('spieltage'); setSelectedKey('stage_THIRD_PLACE') }
    } catch { addLog('Fehler beim Setzen der Fake-Ergebnisse', 'error') }
    finally { setFakingTp(false) }
  }

  async function handleFakeFinal() {
    setFakingFinal(true); setView('import')
    addLog('Fake Finale-Ergebnis wird gesetzt…')
    const t0 = Date.now()
    try {
      const res = await wmt.fakeFinal()
      addLog(`${res.message} (${((Date.now()-t0)/1000).toFixed(1)}s)`, res.updated ? 'done' : 'error')
      if (res.updated) { await loadAll(); setView('spieltage'); setSelectedKey('stage_FINAL') }
    } catch { addLog('Fehler beim Setzen der Fake-Ergebnisse', 'error') }
    finally { setFakingFinal(false) }
  }

  async function handleGenerateSummaryFor(dateStr) {
    setGeneratingSummaryFor(dateStr)
    addLog(`Morgenbericht für ${dateStr} wird erstellt…`)
    try {
      const res = await wmt.generateSummaryFor(dateStr)
      addLog(res.message, res.updated ? 'done' : 'error')
      if (res.updated) {
        const ss = await wmt.getSummaries()
        setSummaries(ss)
        setSummaryCalOpen(false)
        setView('zusammenfassung')
      }
    } catch {
      addLog('Fehler beim Erstellen des Morgenberichts', 'error')
    } finally {
      setGeneratingSummaryFor(null)
    }
  }

  async function handleFakeAll() {
    setFakingAll(true); setView('import')
    addLog('Alle Turnierphasen (MD1–Finale) werden gefakt…')
    const t0 = Date.now()
    try {
      const res = await wmt.fakeAll()
      addLog(`${res.message} (${((Date.now()-t0)/1000).toFixed(1)}s)`, res.updated ? 'done' : 'error')
      if (res.updated) { await loadAll(); setView('spieltage'); setSelectedKey('stage_FINAL') }
    } catch { addLog('Fehler beim Setzen der Fake-Ergebnisse', 'error') }
    finally { setFakingAll(false) }
  }

  const anyBusy = refreshing || clearing || warming || generatingBonus || adjustingNews ||
    fakingMd1 || fakingMd2 || fakingMd3 || fakingRd32 ||
    fakingLast16 || fakingQf || fakingSf || fakingTp || fakingFinal || fakingAll

  const md1Done = matches.some(m => m.stage === 'GROUP_STAGE' && m.matchday === 1) &&
    matches.filter(m => m.stage === 'GROUP_STAGE' && m.matchday === 1).every(m => m.status === 'FINISHED')
  const md2Done = matches.some(m => m.stage === 'GROUP_STAGE' && m.matchday === 2) &&
    matches.filter(m => m.stage === 'GROUP_STAGE' && m.matchday === 2).every(m => m.status === 'FINISHED')
  const md3Done = matches.some(m => m.stage === 'GROUP_STAGE' && m.matchday === 3) &&
    matches.filter(m => m.stage === 'GROUP_STAGE' && m.matchday === 3).every(m => m.status === 'FINISHED')
  const rd32Done = matches.some(m => m.stage === 'LAST_32' && m.status === 'FINISHED') &&
    matches.filter(m => m.stage === 'LAST_32').every(m => m.status === 'FINISHED')
  const last16Done = matches.some(m => m.stage === 'LAST_16') &&
    matches.filter(m => m.stage === 'LAST_16').every(m => m.status === 'FINISHED')
  const qfDone = matches.some(m => m.stage === 'QUARTER_FINALS') &&
    matches.filter(m => m.stage === 'QUARTER_FINALS').every(m => m.status === 'FINISHED')
  const sfDone = matches.some(m => m.stage === 'SEMI_FINALS') &&
    matches.filter(m => m.stage === 'SEMI_FINALS').every(m => m.status === 'FINISHED')
  const tpDone = matches.some(m => m.stage === 'THIRD_PLACE' && m.status === 'FINISHED')
  const finalDone = matches.some(m => m.stage === 'FINAL' && m.status === 'FINISHED')

  const teamStatuses = useMemo(() => computeTeamStatuses(matches), [matches])

  const isBonusFrozen = useMemo(() => {
    return false // TEMPORARY: bonus generation unlocked again — re-enable after use
    // eslint-disable-next-line no-unreachable
    if (!matches.length) return false
    const firstMs = Math.min(...matches.map(m => new Date(m.utc_date).getTime()))
    const freeze = new Date(firstMs)
    freeze.setUTCDate(freeze.getUTCDate() - 1)
    freeze.setUTCHours(0, 0, 0, 0)
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    return today >= freeze
  }, [matches])

  const actualResults = useMemo(() => {
    if (!finalDone) return null
    const finalMatch = matches.find(m => m.stage === 'FINAL' && m.status === 'FINISHED')
    if (!finalMatch) return null
    const winner = finalMatch.score_home > finalMatch.score_away ? finalMatch.home_team : finalMatch.away_team
    const finalists = [finalMatch.home_team, finalMatch.away_team].filter(Boolean)
    const sfMatches = matches.filter(m => m.stage === 'SEMI_FINALS' && m.status === 'FINISHED')
    const semifinalists = sfMatches.flatMap(m => [m.home_team, m.away_team]).filter(Boolean)
    const standings = {}
    for (const m of matches) {
      if (m.stage !== 'GROUP_STAGE' || !m.group_name || !m.home_team || !m.away_team) continue
      const g = m.group_name
      if (!standings[g]) standings[g] = {}
      for (const [t, gs, gc] of [[m.home_team, m.score_home, m.score_away], [m.away_team, m.score_away, m.score_home]]) {
        if (!standings[g][t.id]) standings[g][t.id] = { team: t, pts: 0, gd: 0, gf: 0 }
        if (m.status === 'FINISHED' && gs != null) {
          if (gs > gc) standings[g][t.id].pts += 3
          else if (gs === gc) standings[g][t.id].pts += 1
          standings[g][t.id].gd += gs - gc
          standings[g][t.id].gf += gs
        }
      }
    }
    const groupWinners = {}
    for (const [g, teams] of Object.entries(standings)) {
      const sorted = Object.values(teams).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
      if (sorted[0]) groupWinners[g] = sorted[0].team
    }
    return { winner, finalists, semifinalists, groupWinners }
  }, [matches, finalDone])

  const grouped       = groupMatches(matches)
  const groupKeys     = sortGroupKeys(Object.keys(grouped))
  const currentMatches = selectedKey !== null ? (grouped[selectedKey] ?? []) : []

  const hasData = matches.length > 0

  return (
    <div>
      {/* topbar */}
      <div className="topbar">
        <div className="topbar-left">
          {!wmtOnly && (
            <Link to="/personal"><button className="topbar-back btn btn-sm">←</button></Link>
          )}
          <span className="topbar-title">wmt</span>
        </div>
        <div className="topbar-right">
          {!wmtOnly && (
            <button
              onClick={() => setMenuOpen(o => !o)}
              style={{
                background: menuOpen ? 'var(--border)' : 'none',
                border: menuOpen ? '1px solid var(--border-hover)' : '1px solid transparent',
                color: anyBusy ? '#4d6fa0' : 'var(--text-secondary)',
                fontSize: 14, cursor: 'pointer', marginRight: 10,
                fontFamily: 'inherit', borderRadius: 4,
                padding: '2px 6px', lineHeight: 1,
              }}>
              {anyBusy ? '…' : '☰'}
            </button>
          )}
          <span className="topbar-version">v3.47</span>
        </div>
      </div>

      {/* burger menu overlay */}
      {!wmtOnly && menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', right: 0,
              top: 'calc(32px + env(safe-area-inset-top, 0px))',
              maxHeight: 'calc(100vh - 40px - env(safe-area-inset-top, 0px))',
              overflowY: 'auto',
              width: 220, background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRight: 'none', borderTop: 'none',
              borderRadius: '0 0 0 10px',
              paddingTop: 4, paddingBottom: 8,
            }}>
            <MenuButton
              icon="↻" label="Spielplan aktualisieren"
              loading={refreshing} disabled={anyBusy && !refreshing}
              onClick={() => { setMenuOpen(false); setView('import'); handleRefresh() }}
            />
            <MenuButton
              icon="📋" label="Morgenbericht erstellen"
              loading={!!generatingSummaryFor} disabled={anyBusy && !generatingSummaryFor}
              onClick={() => { setMenuOpen(false); setSummaryCalOpen(true) }}
            />
            <MenuButton
              icon="⊕" label="Historische Kalibrierung"
              loading={warming} disabled={anyBusy && !warming}
              onClick={() => { setMenuOpen(false); handleWarmup() }}
            />
            {!wmtOnly && (
              <>
                <MenuButton
                  icon="📰" label="News-Faktoren aktualisieren"
                  loading={adjustingNews} disabled={anyBusy && !adjustingNews}
                  onClick={() => { setMenuOpen(false); handleNewsAdjust() }}
                />
                <MenuButton
                  icon="▶" label={isBonusFrozen ? 'Bonus-Prognose gesperrt' : 'Bonus-Prognose berechnen'}
                  loading={generatingBonus} disabled={(anyBusy && !generatingBonus) || isBonusFrozen}
                  onClick={() => { setMenuOpen(false); handleGenerateBonus() }}
                />
                <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
                <MenuButton
                  icon="✕" label="Daten löschen"
                  danger loading={clearing} disabled={anyBusy && !clearing}
                  onClick={() => { setMenuOpen(false); handleClear() }}
                />
                <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
                <MenuButton
                  icon="⚗" label="Fake alles (MD1–Finale)"
                  loading={fakingAll} disabled={(anyBusy && !fakingAll) || finalDone}
                  onClick={() => { setMenuOpen(false); handleFakeAll() }}
                />
                <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
                <MenuButton
                  icon="⚗" label="Fake MD1-Ergebnisse"
                  loading={fakingMd1} disabled={(anyBusy && !fakingMd1) || md1Done}
                  onClick={() => { setMenuOpen(false); handleFakeMd1() }}
                />
                <MenuButton
                  icon="⚗" label="Fake MD2-Ergebnisse"
                  loading={fakingMd2} disabled={(anyBusy && !fakingMd2) || !md1Done || md2Done}
                  onClick={() => { setMenuOpen(false); handleFakeMd2() }}
                />
                <MenuButton
                  icon="⚗" label="Fake MD3-Ergebnisse"
                  loading={fakingMd3} disabled={(anyBusy && !fakingMd3) || !md2Done || md3Done}
                  onClick={() => { setMenuOpen(false); handleFakeMd3() }}
                />
                <MenuButton
                  icon="⚗" label="Fake Rd.32-Ergebnisse"
                  loading={fakingRd32} disabled={(anyBusy && !fakingRd32) || !md3Done || rd32Done}
                  onClick={() => { setMenuOpen(false); handleFakeRd32() }}
                />
                <MenuButton
                  icon="⚗" label="Fake Achtelfinale"
                  loading={fakingLast16} disabled={(anyBusy && !fakingLast16) || !rd32Done || last16Done}
                  onClick={() => { setMenuOpen(false); handleFakeLast16() }}
                />
                <MenuButton
                  icon="⚗" label="Fake Viertelfinale"
                  loading={fakingQf} disabled={(anyBusy && !fakingQf) || !last16Done || qfDone}
                  onClick={() => { setMenuOpen(false); handleFakeQf() }}
                />
                <MenuButton
                  icon="⚗" label="Fake Halbfinale"
                  loading={fakingSf} disabled={(anyBusy && !fakingSf) || !qfDone || sfDone}
                  onClick={() => { setMenuOpen(false); handleFakeSf() }}
                />
                <MenuButton
                  icon="⚗" label="Fake Spiel um Platz 3"
                  loading={fakingTp} disabled={(anyBusy && !fakingTp) || !sfDone || tpDone}
                  onClick={() => { setMenuOpen(false); handleFakeTp() }}
                />
                <MenuButton
                  icon="⚗" label="Fake Finale"
                  loading={fakingFinal} disabled={(anyBusy && !fakingFinal) || !sfDone || finalDone}
                  onClick={() => { setMenuOpen(false); handleFakeFinal() }}
                />
              </>
            )}
          </div>
        </div>
      )}

      {summaryCalOpen && (
        <SummaryCalModal
          matches={matches}
          summaries={summaries}
          generating={generatingSummaryFor}
          onClose={() => setSummaryCalOpen(false)}
          onGenerate={handleGenerateSummaryFor}
        />
      )}

      <div className="page">
        {/* view tabs (hidden on the opponents-only mirror) */}
        {!wmtOnly && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            ['import', 'Import'],
            ['spieltage', 'Spieltage'],
            ['gruppen', 'Gruppen-Tabellen'],
            ['konkurrenz', 'Konkurrenz'],
            ['bonus', 'Bonus-Tipps'],
            ['zusammenfassung', 'Morgenberichte'],
            ...(isUpdateLogDomain() ? [['updatelog', 'Update-Log']] : []),
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              style={{
                background: view === key ? 'var(--border)' : 'none',
                border: `1px solid ${view === key ? 'var(--border-hover)' : 'var(--border)'}`,
                color: view === key ? 'var(--text-primary)' : 'var(--text-dim)',
                borderRadius: 6, padding: '5px 12px', fontSize: 12,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {label}{key === 'import' && logs.length > 0 && <span style={{ color: 'var(--text-dim)', marginLeft: 4 }}>{logs.length}</span>}
            </button>
          ))}
        </div>
        )}

        {loading && view !== 'import' && view !== 'updatelog' && (
          wmtOnly ? (
            <div className="wmt-loading-overlay" role="status" aria-label="Daten werden geladen">
              <svg className="wmt-spinner" width="72" height="72" viewBox="-50 -50 100 100">
                {Array.from({ length: 8 }).map((_, i) => {
                  const a = (i * 45) * Math.PI / 180
                  return (
                    <line
                      key={i}
                      x1={Math.cos(a) * 22} y1={Math.sin(a) * 22}
                      x2={Math.cos(a) * 40} y2={Math.sin(a) * 40}
                      stroke="var(--text-secondary)" strokeWidth="8" strokeLinecap="round"
                      opacity={(i + 1) / 8}
                    />
                  )
                })}
              </svg>
            </div>
          ) : (
            <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>…</div>
          )
        )}

        {/* ── Update-Log view (matmaxx.org only) ─────────────────────────── */}
        {view === 'updatelog' && <UpdateLogList />}

        {/* ── Import view ────────────────────────────────────────────────── */}
        {view === 'import' && (
          <div
            ref={logRef}
            style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 160px)', display: 'flex', flexDirection: 'column' }}
          >
            {logs.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Noch keine Einträge.</div>
            ) : (
              logs.map((e, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10, padding: '2px 0',
                  fontSize: 11, fontVariantNumeric: 'tabular-nums',
                }}>
                  <span style={{ color: 'var(--border)', flexShrink: 0 }}>
                    {new Date(e.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span style={{ color: e.level === 'done' ? '#4d8a4d' : e.level === 'error' ? '#8a4d4d' : 'var(--text-dim)' }}>
                    {e.text}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Spieltage view ─────────────────────────────────────────────── */}
        {!loading && view === 'spieltage' && (
          <>
            {!hasData ? (
              <NoDataPlaceholder />
            ) : (
              <>
                {/* matchday / stage selector */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
                  {groupKeys.map(k => {
                    const kMatches  = grouped[k] ?? []
                    const hasLive   = kMatches.some(m => m.status === 'IN_PLAY' || m.status === 'PAUSED')
                    const allDone   = kMatches.every(m => m.status === 'FINISHED')
                    const isSelected = selectedKey === k
                    return (
                      <button
                        key={k}
                        onClick={() => setSelectedKey(k)}
                        style={{
                          background: isSelected ? 'var(--border)' : 'none',
                          border: `1px solid ${hasLive ? '#4d8a4d' : isSelected ? 'var(--border-hover)' : 'var(--border)'}`,
                          color: isSelected ? 'var(--text-primary)' : allDone ? 'var(--text-dim)' : 'var(--text-secondary)',
                          borderRadius: 6, padding: '4px 10px', fontSize: 11,
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}>
                        {groupLabel(k)}
                      </button>
                    )
                  })}
                </div>

                {/* match cards */}
                {currentMatches.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Keine Spiele.</div>
                ) : selectedKey?.startsWith('md_') ? (
                  // Group stage matchdays: sub-group by calendar day
                  groupByCalDay(currentMatches).map(([isoDay, dayMatches]) => (
                    <div key={isoDay}>
                      <div style={{
                        fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em',
                        marginBottom: 10, marginTop: 16,
                        paddingBottom: 6, borderBottom: '1px solid var(--border)',
                      }}>
                        {calDayLabel(isoDay).toUpperCase()}
                      </div>
                      {dayMatches.map(m => (
                        <MatchCard key={m.id} match={m} teamStatuses={selectedKey === 'md_3' ? teamStatuses : {}} />
                      ))}
                    </div>
                  ))
                ) : (
                  // Knockout rounds: flat list
                  currentMatches.map(m => (
                    <MatchCard key={m.id} match={m} />
                  ))
                )}
              </>
            )}
          </>
        )}

        {/* ── Gruppen-Tabellen view ─────────────────────────────────────── */}
        {!loading && view === 'gruppen' && (
          <GruppenTabellen matches={matches} />
        )}

        {/* ── Konkurrenz view ───────────────────────────────────────────── */}
        {!loading && view === 'konkurrenz' && (
          <KonkurrenzView matches={matches} opponentTips={opponentTips} rankingSnapshots={rankingSnapshots} />
        )}

        {/* ── Bonus-Tipps view ──────────────────────────────────────────── */}
        {!loading && view === 'bonus' && (
          <BonusView bonus={bonus} generating={generatingBonus} actualResults={actualResults} />
        )}

        {/* ── Morgenberichte view ────────────────────────────────────────── */}
        {!loading && view === 'zusammenfassung' && (
          <>
            {summaries.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                Noch keine Zusammenfassungen vorhanden. Die erste erscheint am Morgen nach dem ersten Spieltag.
              </div>
            ) : (
              summaries.map(s => (
                <div key={s.id} style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 10, padding: '16px', marginBottom: 12,
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 10 }}>
                    {new Date(s.date).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).toUpperCase()}
                    {' · '}{s.matches_count} SPIEL{s.matches_count !== 1 ? 'E' : ''}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    {renderMarkdown(s.content)}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  )
}

function GroupModal({ group, teams, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(7,9,26,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200,
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border-hover)',
          borderRadius: 12, padding: '20px 24px', width: 320,
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>GRUPPE {group}</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>
            ✕
          </button>
        </div>
        {teams.map((t, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 0', borderTop: i > 0 ? '1px solid var(--border)' : 'none',
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 16, flexShrink: 0 }}>{i + 1}.</span>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: i === 0 ? 600 : 400, color: i === 0 ? 'var(--text-primary)' : 'var(--text-secondary)', marginRight: 7 }}>
                {t.tla}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{t.team}</span>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 12, color: '#4d6fa0', fontVariantNumeric: 'tabular-nums' }}>
                {(t.prob_1st * 100).toFixed(0)}% 1.
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                {(t.prob_top2 * 100).toFixed(0)}% Top 2 · {(t.prob_top3 * 100).toFixed(0)}% Top 3
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BonusView({ bonus, generating, actualResults }) {
  const [modalGroup, setModalGroup] = useState(null)

  const cardStyle = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '16px', marginBottom: 12,
  }
  const labelStyle = { fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 8 }
  const teamChip = (item, rank) => (
    <div key={rank} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '7px 0', borderTop: rank > 0 ? '1px solid var(--border)' : 'none',
    }}>
      <div>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginRight: 8 }}>{item.tla}</span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.team}</span>
      </div>
      <span style={{ fontSize: 12, color: '#4d6fa0', fontVariantNumeric: 'tabular-nums' }}>
        {(item.prob * 100).toFixed(0)}%
      </span>
    </div>
  )

  if (generating) {
    return (
      <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
        … Monte-Carlo-Simulation läuft
      </div>
    )
  }

  if (!bonus) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
          Noch keine Bonus-Prognose vorhanden.
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
          Über das Menü (☰) Prognose berechnen.
        </div>
      </div>
    )
  }

  const groups = Object.entries(bonus.group_winners || {}).sort(([a], [b]) => a.localeCompare(b))
  const generatedDate = new Date(bonus.generated_at).toLocaleDateString('de-DE',
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  // Normalise group entry: new format is array, old format is plain object (legacy)
  const groupTeams = (data) => Array.isArray(data) ? data : [{ tla: data.tla, team: data.team, prob_1st: data.prob, prob_top2: data.prob, prob_top3: 1 }]

  return (
    <div>
      {modalGroup && (
        <GroupModal
          group={modalGroup}
          teams={groupTeams(bonus.group_winners[modalGroup])}
          onClose={() => setModalGroup(null)}
        />
      )}

      {/* Prognose vs. Realität – appears once the Final is finished */}
      {actualResults && (
        <div style={{ ...cardStyle, borderColor: 'var(--border-hover)', marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 16 }}>
            PROGNOSE vs. REALITÄT
          </div>

          {/* Turniersieger */}
          {bonus.winner && actualResults.winner && (() => {
            const hit = bonus.winner.tla === actualResults.winner.tla
            return (
              <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 8 }}>TURNIERSIEGER</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{bonus.winner.tla}</span>
                  <span style={{ fontSize: 11, color: '#4d6fa0' }}>{(bonus.winner.prob * 100).toFixed(0)}%</span>
                  <span style={{ fontSize: 13, color: hit ? '#4d8a4d' : '#8a4d4d' }}>
                    {hit ? '✓' : `✗ → ${actualResults.winner.tla}`}
                  </span>
                </div>
              </div>
            )
          })()}

          {/* Finalisten */}
          {bonus.finalists?.length > 0 && (() => {
            const actualTlas = new Set(actualResults.finalists.map(t => t?.tla))
            const hits = bonus.finalists.filter(f => actualTlas.has(f.tla)).length
            return (
              <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 8 }}>
                  FINALISTEN — {hits} von {bonus.finalists.length}
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {bonus.finalists.map((f, i) => {
                    const hit = actualTlas.has(f.tla)
                    return (
                      <span key={i} style={{ fontSize: 12, color: hit ? '#4d8a4d' : '#8a4d4d' }}>
                        {f.tla} {hit ? '✓' : '✗'}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Halbfinalisten */}
          {bonus.semifinalists?.length > 0 && (() => {
            const actualTlas = new Set(actualResults.semifinalists.map(t => t?.tla))
            const hits = bonus.semifinalists.filter(f => actualTlas.has(f.tla)).length
            return (
              <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 8 }}>
                  HALBFINALISTEN — {hits} von {bonus.semifinalists.length}
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {bonus.semifinalists.map((f, i) => {
                    const hit = actualTlas.has(f.tla)
                    return (
                      <span key={i} style={{ fontSize: 12, color: hit ? '#4d8a4d' : '#8a4d4d' }}>
                        {f.tla} {hit ? '✓' : '✗'}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Gruppensieger */}
          {(() => {
            const compGroups = Object.entries(bonus.group_winners || {}).sort(([a], [b]) => a.localeCompare(b))
            if (!compGroups.length) return null
            const hits = compGroups.filter(([g, data]) => {
              const predicted = groupTeams(data)[0]
              return predicted && actualResults.groupWinners[g]?.tla === predicted.tla
            }).length
            return (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 8 }}>
                  GRUPPENSIEGER — {hits} von {compGroups.length}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {compGroups.map(([g, data]) => {
                    const predicted = groupTeams(data)[0]
                    const actual = actualResults.groupWinners[g]
                    const hit = predicted && actual && predicted.tla === actual.tla
                    return (
                      <div key={g} style={{
                        background: 'var(--bg)',
                        border: `1px solid ${hit ? '#1a3d1a' : '#3d1a1a'}`,
                        borderRadius: 6, padding: '6px 8px',
                      }}>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 4 }}>GR. {g}</div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: hit ? '#4d8a4d' : '#8a4d4d' }}>
                          {predicted?.tla ?? '?'} {hit ? '✓' : '✗'}
                        </div>
                        {!hit && actual && (
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>→ {actual.tla}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Turniersieger */}
      {bonus.winner && (() => {
        const candidates = bonus.winner_candidates?.length > 0 ? bonus.winner_candidates : [bonus.winner]
        return (
          <div style={{ ...cardStyle, borderColor: 'var(--border-hover)' }}>
            <div style={labelStyle}>{candidates.length > 1 ? 'TURNIERSIEGER — TOP 3' : 'TURNIERSIEGER'}</div>
            {candidates.map((item, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: i === 0 ? '0 0 7px' : '7px 0 0', borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              }}>
                <div>
                  <span style={{
                    fontSize: i === 0 ? 18 : 13, fontWeight: i === 0 ? 700 : 600,
                    color: 'var(--text-primary)', marginRight: 10,
                  }}>
                    {item.tla}
                  </span>
                  <span style={{ fontSize: i === 0 ? 14 : 12, color: 'var(--text-secondary)' }}>{item.team}</span>
                </div>
                <span style={{ fontSize: i === 0 ? 16 : 12, fontWeight: 600, color: '#4d6fa0' }}>
                  {(item.prob * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Finalisten */}
      {bonus.finalists?.length > 0 && (
        <div style={cardStyle}>
          <div style={labelStyle}>FINALISTEN</div>
          {bonus.finalists.map((item, i) => teamChip(item, i))}
        </div>
      )}

      {/* Halbfinalisten */}
      {bonus.semifinalists?.length > 0 && (
        <div style={cardStyle}>
          <div style={labelStyle}>HALBFINALISTEN</div>
          {bonus.semifinalists.map((item, i) => teamChip(item, i))}
        </div>
      )}

      {/* Torschützenkönig */}
      {bonus.top_scorer && (
        <div style={cardStyle}>
          <div style={labelStyle}>TORSCHÜTZENKÖNIG</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
                {bonus.top_scorer.player}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {bonus.top_scorer.tla} · {bonus.top_scorer.team}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#4d6fa0' }}>
                ~{bonus.top_scorer.goals} Tore
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>
                {bonus.top_scorer.source}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Gruppensieger – click for full ranking modal */}
      {groups.length > 0 && (
        <div style={cardStyle}>
          <div style={labelStyle}>GRUPPENRANKING</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {groups.map(([group, data]) => {
              const teams = groupTeams(data)
              return (
                <div
                  key={group}
                  onClick={() => setModalGroup(group)}
                  style={{
                    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                    padding: '8px 10px', cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-hover)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 6 }}>
                    GRUPPE {group}
                  </div>
                  {teams.slice(0, 4).map((t, i) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between',
                      marginBottom: i < 3 ? 3 : 0,
                    }}>
                      <span style={{
                        fontSize: i === 0 ? 12 : 11,
                        fontWeight: i === 0 ? 600 : 400,
                        color: i === 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                      }}>
                        {i + 1}. {t.tla}
                      </span>
                      <span style={{
                        fontSize: i === 0 ? 11 : 10,
                        color: i === 0 ? '#4d6fa0' : 'var(--text-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {(t.prob_1st * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'right', marginTop: 4, marginBottom: 24 }}>
        {bonus.n_simulations.toLocaleString('de-DE')} Simulationen · {generatedDate}
      </div>

      {/* Simulation explanation */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 14 }}>
          WIE FUNKTIONIERT DIE SIMULATION?
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
          <p style={{ marginBottom: 12 }}>
            Die Prognose basiert auf einer{' '}
            <span style={{ color: 'var(--text-primary)' }}>Monte-Carlo-Simulation</span>{' '}
            mit {bonus.n_simulations.toLocaleString('de-DE')} Turnierdurchläufen.
            Jeder Durchlauf simuliert das gesamte WM-Turnier von der Gruppenphase bis zum Finale.
            Die angezeigten Prozentwerte geben an, wie häufig ein Ergebnis in diesen Durchläufen eingetreten ist.
          </p>

          <div style={{ marginBottom: 10 }}>
            <span style={{ color: 'var(--text-primary)' }}>ELO-Rating</span>
            {' '}— Jedes Team erhält ein ELO-Rating, das auf Ergebnissen der letzten WM und anderen internationalen Spielen basiert.
            Stärkere Teams haben höhere Ratings; ein Unterschied von 400 Punkten entspricht grob einer Gewinnwahrscheinlichkeit von ca. 85:15.
          </div>

          <div style={{ marginBottom: 10 }}>
            <span style={{ color: 'var(--text-primary)' }}>Gruppenphase</span>
            {' '}— In jedem Durchlauf wird jedes Gruppenspiel einzeln simuliert.
            Aus den ELO-Ratings wird eine erwartete Toranzahl (xG) pro Team abgeleitet;
            die tatsächlichen Tore werden per Poisson-Verteilung zufällig gezogen.
            Bereits gespielte Partien fließen mit ihrem echten Ergebnis ein.
          </div>

          <div style={{ marginBottom: 10 }}>
            <span style={{ color: 'var(--text-primary)' }}>K.O.-Runde</span>
            {' '}— Die besten zwei jeder Gruppe sowie die acht besten Gruppendritter (nach Punkten, Tordifferenz, Toren) qualifizieren sich für die Runde der 32.
            Der K.O.-Baum wird in jedem Durchlauf zufällig neu gelost, damit keine bestimmte Hälfte bevorzugt wird.
            Bei Unentschieden nach 90 Minuten entscheidet ein ELO-gewichteter Münzwurf (analog Elfmeterschießen).
          </div>

          <div style={{ marginBottom: 10 }}>
            <span style={{ color: 'var(--text-primary)' }}>Torschützenkönig</span>
            {' '}— Die Prognose basiert auf einer kuratierten Liste bekannter Torjäger mit historischer Torrate.
            Aus der Torrate pro Spiel und der erwarteten Turnierlänge (abhängig vom ELO-Rating des Teams) wird eine prognostizierte Gesamttoranzahl berechnet.
          </div>

          <div>
            <span style={{ color: 'var(--text-primary)' }}>Hinweis</span>
            {' '}— Die Simulation spiegelt den Wissensstand zum Zeitpunkt der letzten Datenaktualisierung wider.
            Nach jedem Spieltag ELO-Ratings neu berechnen (↻) und anschließend die Bonus-Prognose neu generieren, um aktuelle Ergebnisse einzubeziehen.
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryCalModal({ matches, summaries, generating, onClose, onGenerate }) {
  const matchDates = new Set(matches.map(m => matchLocalDateKey(m)))
  const summaryDates = new Set(summaries.map(s => (s.date || '').slice(0, 10)))

  // Derive months to show from match date range
  const sortedDates = [...matchDates].sort()
  const months = []
  if (sortedDates.length > 0) {
    const first = new Date(sortedDates[0] + 'T12:00:00')
    const last  = new Date(sortedDates[sortedDates.length - 1] + 'T12:00:00')
    let cur = new Date(first.getFullYear(), first.getMonth(), 1)
    while (cur <= last) {
      months.push({ year: cur.getFullYear(), month: cur.getMonth() })
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    }
  } else {
    months.push({ year: 2026, month: 5 })
    months.push({ year: 2026, month: 6 })
  }

  const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
  const DAY_NAMES   = ['Mo','Di','Mi','Do','Fr','Sa','So']

  function renderMonth({ year, month }) {
    const firstDow = new Date(year, month, 1).getDay() // 0=Sun
    const offset   = firstDow === 0 ? 6 : firstDow - 1 // Mon=0
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    const cells = Array(offset).fill(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)

    return (
      <div key={`${year}-${month}`}>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 8, fontWeight: 600 }}>
          {MONTH_NAMES[month]} {year}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 4 }}>
          {DAY_NAMES.map(d => (
            <div key={d} style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'center' }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={`e${i}`} />
            const iso       = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            const hasMatch  = matchDates.has(iso)
            const hasSummary = summaryDates.has(iso)
            const busy      = generating === iso
            return (
              <button
                key={iso}
                onClick={() => hasMatch && !generating && onGenerate(iso)}
                disabled={!hasMatch || !!generating}
                style={{
                  position: 'relative',
                  background: hasMatch ? 'var(--border)' : 'none',
                  border: `1px solid ${hasMatch ? 'var(--border-hover)' : 'transparent'}`,
                  borderRadius: 4, padding: '6px 2px 8px',
                  fontSize: 11, textAlign: 'center',
                  color: hasMatch ? 'var(--text-primary)' : 'var(--border)',
                  cursor: hasMatch && !generating ? 'pointer' : 'default',
                  fontFamily: 'inherit',
                  opacity: !!generating && !busy ? 0.5 : 1,
                }}>
                {busy ? '…' : d}
                {hasSummary && !busy && (
                  <div style={{
                    position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)',
                    width: 3, height: 3, borderRadius: '50%', background: '#4d6fa0',
                  }} />
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(7,9,26,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border-hover)',
          borderRadius: 12, padding: '20px 24px',
          width: 320, maxHeight: '80vh', overflowY: 'auto',
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>MORGENBERICHT ERSTELLEN</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.5 }}>
          Spieltag auswählen · blauer Punkt = Bericht vorhanden
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {months.map(m => renderMonth(m))}
        </div>
      </div>
    </div>
  )
}

const RANK_CHART_COLORS = [
  '#7effa0','#ff6b6b','#6bb5ff','#ffd56b','#d06bff',
  '#ff9f6b','#6bfff0','#ff6bd6','#b5ff6b','#6b7fff',
  '#c8c8c8','#4a9eff','#e74c3c','#2ecc71','#f1c40f',
  '#9b59b6','#e67e22','#1abc9c','#e91e63',
]

function RankingChart({ snapshots, matches }) {
  const players = [...new Set(snapshots.map(s => s.player_name))].sort()

  const [selected, setSelected] = useState(null)
  const [zoom, setZoom] = useState(5)

  // The chart stretches to fill the remaining viewport height (handy on mobile,
  // where vertical space is the constraint). We measure where the plot area
  // starts and how tall the legend/controls below it are, then give the rest of
  // the screen to the SVG — clamped so it never collapses on tiny screens.
  const scrollRef = useRef(null)
  const belowRef = useRef(null)
  const [svgH, setSvgH] = useState(440)

  useEffect(() => {
    const recompute = () => {
      const sc = scrollRef.current
      if (!sc) return
      const vv = window.visualViewport
      // When the page is pinch-zoomed (scale > 1) the visual viewport height and
      // the layout-based getBoundingClientRect().top live in different reference
      // frames, so the math below produces a garbage height that collapsed the
      // chart. Skip re-fitting while zoomed and keep the last good height.
      if (vv && vv.scale > 1.01) return
      const top = sc.getBoundingClientRect().top
      const below = belowRef.current ? belowRef.current.offsetHeight : 0
      // Size against the *visual* viewport (window.visualViewport), which
      // excludes mobile browser chrome like the URL bar and bottom toolbar —
      // window.innerHeight includes that area, which pushed the legend behind
      // the back button / address bar. 16 = card's bottom padding; 36 =
      // clearance so the clickable legend stays clear of browser chrome and
      // the iOS home indicator.
      const vh = vv ? vv.height : window.innerHeight
      const avail = vh - top - below - 16 - 36
      setSvgH(Math.max(320, Math.min(1000, avail)))
    }
    recompute()
    // Only re-fit when the viewport *width* changes (real resize / rotation).
    // We deliberately ignore height-only changes: on mobile the URL bar
    // collapses/expands while scrolling, and recomputing then made the chart
    // stretch on every scroll frame and wrecked the scroll feel.
    let lastWidth = window.innerWidth
    const onResize = () => {
      if (window.innerWidth === lastWidth) return
      lastWidth = window.innerWidth
      recompute()
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', recompute)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', recompute)
    }
  }, [players.join(',')])

  useEffect(() => {
    setSelected(prev => {
      if (prev === null) return new Set(players)
      const next = new Set([...prev].filter(p => players.includes(p)))
      for (const p of players) if (!prev.has(p)) next.add(p)
      return next
    })
  }, [players.join(',')])

  // Each snapshot represents a moment in time — an exact `snapshot_time` if set,
  // otherwise the earlier of "when it was imported" (captured_at) and "end of its
  // date". This way a same-day import that happens before that day's later matches
  // finish is positioned before those matches automatically, without the importer
  // needing to know about per-match positioning.
  const effectiveTime = s => {
    if (s.snapshot_time) return s.snapshot_time
    const dayEnd = `${s.date}T23:59:59Z`
    return s.captured_at < dayEnd ? s.captured_at : dayEnd
  }
  const dateCount = new Set(snapshots.map(s => s.date)).size

  if (dateCount < 2 || players.length === 0 || selected === null) return null

  const totalMatches = matches.length
  // A few empty slots after the final match so the line for the day after the
  // final (positioned at game count = totalMatches) doesn't sit at the very
  // right edge — that trailing room is where the final player-name labels land.
  const EXTRA_SLOTS = 8
  const axisMax = totalMatches + EXTRA_SLOTS
  // Number of finished matches whose kickoff is on/before a given moment —
  // this turns the x-axis into "games played so far" instead of calendar days,
  // so rest days don't stretch the timeline.
  const finishedTimes = matches
    .filter(m => m.status === 'FINISHED')
    .map(m => m.utc_date)
    .sort()
  const gameCountAt = time => finishedTimes.filter(t => t <= time).length

  const maxRank = Math.max(...snapshots.map(s => s.rank))
  const H = svgH
  // padR leaves room for the player-name labels to the right of each line's
  // last point; padB leaves room for the vertical match labels below the chart.
  const padL = 28, padR = 76, padT = 12, padB = 46
  const plotW = (680 - padL - padR) * zoom
  const plotH = H - padT - padB
  const W = padL + plotW + padR
  // Small breathing room between the lowest rank and the x-axis so the bottom
  // line/labels don't sit flush against the match labels below.
  const bottomGap = 14

  const xPos = games => padL + (axisMax === 0 ? 0 : (games / axisMax) * plotW)
  const yPos = rank => padT + ((rank - 1) / Math.max(1, maxRank - 1)) * (plotH - bottomGap)

  const byPlayer = {}
  for (const p of players) {
    byPlayer[p] = snapshots
      .filter(s => s.player_name === p)
      .sort((a, b) => effectiveTime(a) < effectiveTime(b) ? -1 : 1)
  }

  // One vertical helper line + "HOME-AWAY" label per match, evenly spaced in
  // chronological order so every match gets the same x-distance from its neighbours.
  const sortedMatches = [...matches].sort((a, b) => new Date(a.utc_date) - new Date(b.utc_date))
  const matchMarkers = sortedMatches.map((m, i) => ({
    x: xPos(i + 1),
    lineX: xPos(i + 1),
    showLine: true,
    label: `${m.home_team?.tla || '???'}-${m.away_team?.tla || '???'}`,
  }))

  const togglePlayer = p => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(p)) next.delete(p); else next.add(p)
    return next
  })

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
          Rangverlauf
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Zoom</span>
          <input
            type="range" min={1} max={5} step={0.5} value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            style={{ width: 80 }}
          />
        </div>
      </div>
      <div ref={scrollRef} style={{ overflowX: 'auto' }}>
        <svg width={W} height={H} style={{ display: 'block' }}>
          {Array.from({ length: maxRank }, (_, i) => i + 1).map(r => (
            <g key={r}>
              <line x1={padL} y1={yPos(r)} x2={W - padR} y2={yPos(r)} stroke="var(--border)" strokeWidth={0.5} />
              <text x={padL - 6} y={yPos(r) + 3} textAnchor="end" fontSize={9} fill="var(--text-muted)">{r}</text>
            </g>
          ))}
          {matchMarkers.map((mk, i) => (
            <g key={i}>
              {mk.showLine && (
                <line x1={mk.lineX} y1={padT} x2={mk.lineX} y2={padT + plotH} stroke="var(--border)" strokeWidth={0.5} opacity={0.4} />
              )}
              <text x={mk.x} y={padT + plotH + 4} textAnchor="end" fontSize={7} fill="var(--text-faint)" transform={`rotate(-90 ${mk.x} ${padT + plotH + 4})`}>
                {mk.label}
              </text>
            </g>
          ))}
          {(() => {
            const rawPoints = {}
            for (const p of players) {
              if (!selected.has(p)) continue
              rawPoints[p] = byPlayer[p]
                .map(s => ({ x: xPos(gameCountAt(effectiveTime(s))), y: yPos(s.rank) }))
            }

            // Players whose line passes through the exact same point at the
            // same moment are nudged into a small parallel band, Mario-Party
            // style, instead of drawing one indistinguishable stacked line.
            const tieGroups = {}
            for (const p of players) {
              const pts = rawPoints[p]
              if (!pts) continue
              for (const pt of pts) {
                const key = `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`
                if (!tieGroups[key]) tieGroups[key] = []
                tieGroups[key].push(p)
              }
            }

            const rowHeight = plotH / Math.max(1, maxRank - 1)
            const offsetUnit = 2.5

            const lines = players.map((p, pi) => {
              if (!selected.has(p)) return null
              const color = RANK_CHART_COLORS[pi % RANK_CHART_COLORS.length]
              const points = rawPoints[p].map(pt => {
                const group = tieGroups[`${pt.x.toFixed(1)},${pt.y.toFixed(1)}`]
                const size = group.length
                const idx = group.indexOf(p)
                const spread = Math.min((size - 1) * offsetUnit, rowHeight * 0.8)
                const step = size > 1 ? spread / (size - 1) : 0
                return { x: pt.x, y: pt.y + (idx - (size - 1) / 2) * step }
              })
              const pts = points.map(({ x, y }) => `${x},${y}`).join(' ')
              return (
                <g key={p}>
                  <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} opacity={0.85} />
                  {points.map((pt, i) => (
                    <circle key={i} cx={pt.x} cy={pt.y} r={2.5} fill={color} />
                  ))}
                </g>
              )
            })

            // Name label to the right of each line's last point. Players who
            // share the same final rank are merged into one comma-separated
            // label so the names sit side by side on one line instead of
            // stacking on top of each other. Rendered in neutral text colour
            // (not the player's line colour) so it stays legible in both themes.
            const endGroups = {}
            for (const p of players) {
              if (!selected.has(p)) continue
              const pts = rawPoints[p]
              if (!pts || pts.length === 0) continue
              const last = pts[pts.length - 1]
              const key = `${last.x.toFixed(1)},${last.y.toFixed(1)}`
              if (!endGroups[key]) endGroups[key] = { x: last.x, y: last.y, names: [] }
              endGroups[key].names.push(p)
            }
            const labels = Object.values(endGroups).map((g, i) => (
              <text
                key={`label-${i}`}
                x={g.x + 8}
                y={g.y + 3}
                textAnchor="start"
                fontSize={9}
                fontWeight={500}
                fill="var(--text-primary)"
              >
                {g.names.join(', ')}
              </text>
            ))

            return [...lines, ...labels]
          })()}
        </svg>
      </div>
      <div ref={belowRef}>
      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <button
          onClick={() => setSelected(new Set(players))}
          style={{ flex: 1, fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          Alle einblenden
        </button>
        <button
          onClick={() => setSelected(new Set())}
          style={{ flex: 1, fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          Alle ausblenden
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 10 }}>
        {players.map((p, pi) => (
          <div
            key={p}
            onClick={() => togglePlayer(p)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: selected.has(p) ? 'var(--text-secondary)' : 'var(--text-faint)', cursor: 'pointer', userSelect: 'none' }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: RANK_CHART_COLORS[pi % RANK_CHART_COLORS.length], display: 'inline-block', opacity: selected.has(p) ? 1 : 0.3 }} />
            <span style={{ textDecoration: selected.has(p) ? 'none' : 'line-through' }}>{p}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
        Auf einen Namen tippen blendet seine Linie im Diagramm ein oder aus.
      </div>
      </div>
    </div>
  )
}

// Kicktipp-Treffergüte eines Tipps gegen das Endergebnis — als dezente,
// halbtransparente Overlays, damit der Text in beiden Themes lesbar bleibt.
const TIP_OVERLAYS = {
  exact:    'rgba(255, 64, 255, 0.24)',  // Magenta — exaktes Ergebnis
  diff:     'rgba(0, 200, 255, 0.24)',   // Cyan — richtige Tordifferenz
  tendency: 'rgba(241, 196, 15, 0.24)',  // Gelb — nur Tendenz (Sieger) richtig
  wrong:    'rgba(128, 128, 128, 0.25)', // Grau — komplett daneben
}

// Treffergüte-Kategorien in absteigender Wertigkeit: key, Label, Kicktipp-Punkte.
const TIP_CATEGORIES = [
  ['exact',    'Exakt',     4],
  ['diff',     'Differenz', 3],
  ['tendency', 'Tendenz',   2],
  ['wrong',    'Falsch',    0],
]

// Kicktipp-Treffergüte eines Tipps gegen das Endergebnis.
function classifyTip(m, t) {
  if (m.status !== 'FINISHED' || m.score_home == null || m.score_away == null) return null
  const sh = m.score_home, sa = m.score_away
  const ph = t.pred_home_goals, pa = t.pred_away_goals
  if (ph === sh && pa === sa) return 'exact'
  if (ph - pa === sh - sa) return 'diff'
  if (Math.sign(ph - pa) === Math.sign(sh - sa)) return 'tendency'
  return 'wrong'
}

function tipOverlay(m, t) {
  const cat = classifyTip(m, t)
  return cat ? TIP_OVERLAYS[cat] : null
}

// Kompakte einzeilige Farb-Legende, die in jeder Spielkarte steht.
function TipLegendInline() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
      {TIP_CATEGORIES.map(([key, label]) => (
        <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: TIP_OVERLAYS[key], border: '1px solid var(--border)', flexShrink: 0 }} />
          {label}
        </span>
      ))}
    </div>
  )
}

// Trefferbilanz aller Mitspieler — eine Zeile pro Spieler, sortiert nach Punkten.
function TipSummaryTable({ matches, opponentTips }) {
  const matchById = {}
  for (const m of matches) matchById[m.id] = m

  const stats = {}
  for (const t of opponentTips) {
    const m = matchById[t.match_id]
    if (!m) continue
    const cat = classifyTip(m, t)
    if (!cat) continue
    if (!stats[t.player_name]) stats[t.player_name] = { exact: 0, diff: 0, tendency: 0, wrong: 0 }
    stats[t.player_name][cat]++
  }

  const rows = Object.entries(stats).map(([player, s]) => ({
    player,
    ...s,
    points: TIP_CATEGORIES.reduce((sum, [key, , pts]) => sum + s[key] * pts, 0),
  }))
  if (rows.length === 0) return null
  rows.sort((a, b) => b.points - a.points || b.exact - a.exact || a.player.localeCompare(b.player))

  const th = { fontSize: 10, color: 'var(--text-dim)', fontWeight: 400, padding: '0 8px 6px 0', whiteSpace: 'nowrap', textAlign: 'left' }
  const td = { fontSize: 12, padding: '5px 8px 5px 0', textAlign: 'left', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, marginBottom: 10 }}>Trefferbilanz</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Spieler</th>
              {TIP_CATEGORIES.map(([key, label]) => (
                <th key={key} style={th}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: TIP_OVERLAYS[key], border: '1px solid var(--border)', flexShrink: 0 }} />
                    {label}
                  </span>
                </th>
              ))}
              <th style={th}>Pkt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.player} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ ...td, textAlign: 'left' }}>{r.player}</td>
                <td style={td}>{r.exact}</td>
                <td style={td}>{r.diff}</td>
                <td style={td}>{r.tendency}</td>
                <td style={td}>{r.wrong}</td>
                <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 500 }}>{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Calendar-day key (YYYY-MM-DD) in US local time. The 2026 WC is hosted in
// the US/Mexico/Canada; we anchor "day" to US Pacific. With Pacific the whole
// German 18:00→06:00 broadcast window maps onto one calendar day (≈09:00–21:00
// PT, no midnight crossing) — including the latest west-coast kickoffs, which
// at 21:00 PT are 06:00 German the next morning but still the same PT day.
const US_TIME_ZONE = 'America/Los_Angeles'
const usDayKey = d => new Intl.DateTimeFormat('en-CA', { timeZone: US_TIME_ZONE }).format(d)

const CATEGORY_BY_KEY = Object.fromEntries(TIP_CATEGORIES.map(([key, label, pts]) => [key, { label, pts }]))

// Tagessieger / Tagesverlierer — best and worst scorer among the imported
// opponent tips on the most recent match day (the latest US-Pacific calendar
// day that has any finished match), with the tips that got them there. So the
// day's winner keeps showing until the next match day produces results. Hidden
// only when no match has finished yet at all.
function DayWinnerLoserCard({ matches, opponentTips }) {
  const finished = matches.filter(m => m.status === 'FINISHED')
  if (finished.length === 0) return null

  // Most recent match day = the largest (latest) Pacific day key among finished
  // matches; string compare works because keys are zero-padded YYYY-MM-DD.
  const dayKeys = finished.map(m => usDayKey(new Date(m.utc_date))).sort()
  const targetKey = dayKeys[dayKeys.length - 1]

  const dayMatches = finished.filter(m => usDayKey(new Date(m.utc_date)) === targetKey)
  const dayMatchIds = new Set(dayMatches.map(m => m.id))
  const matchById = {}
  for (const m of dayMatches) matchById[m.id] = m

  const byPlayer = {}
  for (const t of opponentTips) {
    if (!dayMatchIds.has(t.match_id)) continue
    const m = matchById[t.match_id]
    const cat = classifyTip(m, t)
    if (!cat) continue
    if (!byPlayer[t.player_name]) byPlayer[t.player_name] = { points: 0, tips: [] }
    byPlayer[t.player_name].points += CATEGORY_BY_KEY[cat].pts
    byPlayer[t.player_name].tips.push({ match: m, tip: t, cat })
  }

  const rows = Object.entries(byPlayer).map(([player, d]) => ({ player, ...d }))
  if (rows.length === 0) return null
  rows.sort((a, b) => b.points - a.points || a.player.localeCompare(b.player))

  const winner = rows[0]
  const loser = rows.length > 1 ? rows[rows.length - 1] : null

  // targetKey is YYYY-MM-DD (Pacific) — format it directly, no timezone reparse.
  const [yy, mm, dd] = targetKey.split('-')
  const dateLabel = `${dd}.${mm}.${yy}`

  const renderTips = entry => {
    const tips = [...entry.tips].sort((a, b) => new Date(a.match.utc_date) - new Date(b.match.utc_date))
    return (
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {tips.map(({ match, tip, cat }) => (
          <div key={match.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: TIP_OVERLAYS[cat], border: '1px solid var(--border)', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-secondary)', minWidth: 64 }}>
              {match.home_team?.tla || '???'}–{match.away_team?.tla || '???'}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>Tipp {tip.pred_home_goals}:{tip.pred_away_goals}</span>
            <span style={{ color: 'var(--text-dim)' }}>Ergebnis {match.score_home}:{match.score_away}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontWeight: 500 }}>+{CATEGORY_BY_KEY[cat].pts}</span>
          </div>
        ))}
      </div>
    )
  }

  const section = (entry, label, accent) => (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, color: accent, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
        <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{entry.player}</span>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{entry.points} Pkt</span>
      </div>
      {renderTips(entry)}
    </div>
  )

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>Tageswertung</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{dateLabel} · US-Zeit</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {section(winner, 'Tagessieger', '#4d8a4d')}
        {loser && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            {section(loser, 'Tagesverlierer', '#8a4d4d')}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shared helpers for the Konkurrenz stat cards ──────────────────────────
const dayKeyOf = m => usDayKey(new Date(m.utc_date))
const finishedScored = matches =>
  matches.filter(m => m.status === 'FINISHED' && m.score_home != null && m.score_away != null)
// Stable per-player colour (alphabetical index) so a player keeps the same
// colour across every stat card.
const playerColor = (players, p) => {
  const i = players.indexOf(p)
  return RANK_CHART_COLORS[(i < 0 ? 0 : i) % RANK_CHART_COLORS.length]
}
const ddmm = key => { const [, m, d] = key.split('-'); return `${d}.${m}.` }

// Points each player scored on each finished match day.
function dailyPointsMatrix(matches, opponentTips) {
  const fin = finishedScored(matches)
  const byId = {}
  for (const m of fin) byId[m.id] = m
  const days = [...new Set(fin.map(dayKeyOf))].sort()
  const players = [...new Set(opponentTips.filter(t => byId[t.match_id]).map(t => t.player_name))].sort()
  const pts = {}
  for (const p of players) { pts[p] = {}; for (const d of days) pts[p][d] = 0 }
  for (const t of opponentTips) {
    const m = byId[t.match_id]
    if (!m) continue
    const cat = classifyTip(m, t)
    if (!cat) continue
    pts[t.player_name][dayKeyOf(m)] += CATEGORY_BY_KEY[cat].pts
  }
  return { days, players, pts }
}

// Card shell matching the other Konkurrenz cards.
function StatCard({ title, hint, children }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, marginBottom: hint ? 4 : 12 }}>{title}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 12 }}>{hint}</div>}
      {children}
    </div>
  )
}

// ── 1. Punkte-Rückstand zum Spitzenreiter ─────────────────────────────────
// Overlaid lines, y = points behind the leader, x = games played. The leader
// rides along the top (gap 0); the spread shows whether it's a runaway or a
// dogfight. Driven by the imported ranking snapshots.
function PointsGapChart({ snapshots, matches }) {
  const players = [...new Set(snapshots.map(s => s.player_name))].sort()
  const dateCount = new Set(snapshots.map(s => s.date)).size
  if (dateCount < 2 || players.length === 0) return null

  const effectiveTime = s => {
    if (s.snapshot_time) return s.snapshot_time
    const end = `${s.date}T23:59:59Z`
    return s.captured_at < end ? s.captured_at : end
  }
  const totalMatches = matches.length
  const finishedTimes = matches.filter(m => m.status === 'FINISHED').map(m => m.utc_date).sort()
  const gameCountAt = t => finishedTimes.filter(x => x <= t).length

  const byPlayer = {}
  for (const p of players) {
    byPlayer[p] = snapshots.filter(s => s.player_name === p)
      .sort((a, b) => effectiveTime(a) < effectiveTime(b) ? -1 : 1)
  }
  const latestPointsAt = (p, time) => {
    let pts = null
    for (const s of byPlayer[p]) { if (effectiveTime(s) <= time) pts = s.points; else break }
    return pts
  }

  const series = {}
  let maxGap = 1
  for (const p of players) {
    series[p] = byPlayer[p].map(s => {
      const time = effectiveTime(s)
      const leader = Math.max(...players.map(q => latestPointsAt(q, time)).filter(v => v != null))
      const gap = leader - s.points
      if (gap > maxGap) maxGap = gap
      return { games: gameCountAt(time), gap }
    })
  }

  const H = 320, padL = 34, padR = 84, padT = 12, padB = 22
  const W = 700
  const plotW = W - padL - padR, plotH = H - padT - padB
  const axisMax = totalMatches + 8
  const xPos = g => padL + (axisMax === 0 ? 0 : (g / axisMax) * plotW)
  const yPos = gap => padT + (gap / maxGap) * plotH

  const gridStep = Math.max(1, Math.ceil(maxGap / 5))
  const gridLines = []
  for (let g = 0; g <= maxGap; g += gridStep) gridLines.push(g)

  const ends = {}
  for (const p of players) {
    const pts = series[p]
    if (!pts.length) continue
    const last = pts[pts.length - 1]
    const key = `${xPos(last.games).toFixed(1)},${yPos(last.gap).toFixed(1)}`
    if (!ends[key]) ends[key] = { x: xPos(last.games), y: yPos(last.gap), names: [] }
    ends[key].names.push(p)
  }

  return (
    <StatCard title="Punkte-Rückstand zum Spitzenreiter" hint="Abstand in Punkten zur Tabellenspitze über den Turnierverlauf — die Linie ganz oben führt.">
      <div style={{ overflowX: 'auto' }}>
        <svg width={W} height={H} style={{ display: 'block' }}>
          {gridLines.map(g => (
            <g key={g}>
              <line x1={padL} y1={yPos(g)} x2={W - padR} y2={yPos(g)} stroke="var(--border)" strokeWidth={0.5} />
              <text x={padL - 6} y={yPos(g) + 3} textAnchor="end" fontSize={9} fill="var(--text-muted)">{g}</text>
            </g>
          ))}
          {players.map(p => {
            const color = playerColor(players, p)
            const pts = series[p].map(d => `${xPos(d.games)},${yPos(d.gap)}`).join(' ')
            return (
              <g key={p}>
                <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} opacity={0.85} />
                {series[p].map((d, i) => (
                  <circle key={i} cx={xPos(d.games)} cy={yPos(d.gap)} r={2.5} fill={color} />
                ))}
              </g>
            )
          })}
          {Object.values(ends).map((e, i) => (
            <text key={i} x={e.x + 8} y={e.y + 3} textAnchor="start" fontSize={9} fontWeight={500} fill="var(--text-primary)">
              {e.names.join(', ')}
            </text>
          ))}
        </svg>
      </div>
    </StatCard>
  )
}

// ── 2. Treffergüte (stacked bars) ─────────────────────────────────────────
function HitQualityBars({ matches, opponentTips }) {
  const byId = {}
  for (const m of matches) byId[m.id] = m
  const stat = {}
  for (const t of opponentTips) {
    const m = byId[t.match_id]
    if (!m) continue
    const cat = classifyTip(m, t)
    if (!cat) continue
    if (!stat[t.player_name]) stat[t.player_name] = { exact: 0, diff: 0, tendency: 0, wrong: 0 }
    stat[t.player_name][cat]++
  }
  let rows = Object.entries(stat).map(([player, s]) => ({
    player, ...s,
    total: s.exact + s.diff + s.tendency + s.wrong,
    points: TIP_CATEGORIES.reduce((a, [k, , p]) => a + s[k] * p, 0),
  })).filter(r => r.total > 0)
  if (!rows.length) return null
  rows.sort((a, b) => b.points - a.points || a.player.localeCompare(b.player))

  return (
    <StatCard title="Treffergüte" hint="Anteil exakter Treffer, Tordifferenz, Tendenz und Fehltipps je Spieler.">
      <TipLegendInline />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => (
          <div key={r.player} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 96, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.player}</span>
            <div style={{ flex: 1, display: 'flex', height: 16, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-alt)' }}>
              {TIP_CATEGORIES.map(([key]) => (
                r[key] > 0 ? (
                  <div key={key} title={`${CATEGORY_BY_KEY[key].label}: ${r[key]}`}
                    style={{ width: `${(r[key] / r.total) * 100}%`, background: TIP_OVERLAYS[key] }} />
                ) : null
              ))}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, width: 34, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{r.points}</span>
          </div>
        ))}
      </div>
    </StatCard>
  )
}

// ── 4. Punkte pro Spieltag (heatmap) ──────────────────────────────────────
function PointsPerDayHeatmap({ matches, opponentTips }) {
  const { days, players, pts } = dailyPointsMatrix(matches, opponentTips)
  if (days.length === 0 || players.length === 0) return null

  const order = players.map(p => ({ p, total: days.reduce((a, d) => a + pts[p][d], 0) }))
    .sort((a, b) => b.total - a.total || a.p.localeCompare(b.p))
  const maxDay = Math.max(1, ...players.flatMap(p => days.map(d => pts[p][d])))

  const cell = { width: 30, height: 22, fontSize: 11, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }

  return (
    <StatCard title="Punkte pro Spieltag" hint="Punkteausbeute je Spieler und Spieltag — kräftigeres Grün = mehr Punkte.">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: 'var(--surface)', textAlign: 'left', fontSize: 10, color: 'var(--text-dim)', fontWeight: 400, padding: '0 8px 6px 0', whiteSpace: 'nowrap' }}>Spieler</th>
              {days.map(d => (
                <th key={d} style={{ ...cell, fontSize: 9, color: 'var(--text-dim)', fontWeight: 400, paddingBottom: 6 }}>{ddmm(d)}</th>
              ))}
              <th style={{ ...cell, fontSize: 9, color: 'var(--text-dim)', fontWeight: 400, paddingBottom: 6 }}>Σ</th>
            </tr>
          </thead>
          <tbody>
            {order.map(({ p, total }) => (
              <tr key={p}>
                <td style={{ position: 'sticky', left: 0, background: 'var(--surface)', fontSize: 12, color: 'var(--text-secondary)', padding: '2px 8px 2px 0', whiteSpace: 'nowrap' }}>{p}</td>
                {days.map(d => {
                  const v = pts[p][d]
                  return (
                    <td key={d} style={{ ...cell, color: v > 0 ? 'var(--text-primary)' : 'var(--text-dim)', background: v > 0 ? `rgba(77, 138, 77, ${0.15 + 0.6 * (v / maxDay)})` : 'transparent', borderRadius: 4 }}>{v}</td>
                  )
                })}
                <td style={{ ...cell, color: 'var(--text-primary)', fontWeight: 500 }}>{total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </StatCard>
  )
}

// ── 5. Tipp-Zwillinge (similarity heatmap) ────────────────────────────────
// For every pair, the share of commonly-tipped matches where they picked the
// exact same scoreline. Reveals who thinks alike and who's the contrarian.
function TwinsHeatmap({ opponentTips }) {
  const players = [...new Set(opponentTips.map(t => t.player_name))].sort()
  if (players.length < 2) return null

  const byPlayer = {}
  for (const p of players) byPlayer[p] = {}
  for (const t of opponentTips) byPlayer[t.player_name][t.match_id] = `${t.pred_home_goals}:${t.pred_away_goals}`

  const sim = (a, b) => {
    let common = 0, same = 0
    for (const mid in byPlayer[a]) {
      if (byPlayer[b][mid] == null) continue
      common++
      if (byPlayer[a][mid] === byPlayer[b][mid]) same++
    }
    return common === 0 ? null : { rate: same / common, common }
  }

  // Green → yellow → red heat scale; red marks the highest similarity. The
  // input is biased upward (pow < 1) so the green band stays small and most
  // cells read yellow → red.
  const heat = t => {
    const b = Math.pow(t, 0.55)
    const stops = [[46, 204, 113], [241, 196, 15], [231, 76, 60]] // grün, gelb, rot
    const seg = b < 0.5 ? 0 : 1
    const f = b < 0.5 ? b / 0.5 : (b - 0.5) / 0.5
    const c0 = stops[seg], c1 = stops[seg + 1]
    const ch = i => Math.round(c0[i] + (c1[i] - c0[i]) * f)
    return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`
  }

  // The matrix fills 100% of the card width (table-layout: fixed) and every
  // cell is forced square via aspect-ratio, so the whole grid fits the viewport
  // horizontally and stays square regardless of player count.
  const cellDiv = extra => ({ width: '100%', aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontVariantNumeric: 'tabular-nums', ...extra })

  return (
    <StatCard title="Tipp-Zwillinge" hint="Anteil gemeinsam getippter Spiele mit identischem Ergebnis-Tipp. Grün → Gelb → Rot: Rot = tippt am ähnlichsten.">
      <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
        <colgroup>
          <col style={{ width: 84 }} />
          {players.map(p => <col key={p} />)}
        </colgroup>
        <thead>
          <tr>
            <th />
            {players.map(p => (
              <th key={p} title={p} style={{ verticalAlign: 'bottom', padding: '0 0 6px', fontWeight: 400 }}>
                <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', margin: '0 auto' }}>{p}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map(a => (
            <tr key={a}>
              <td style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '0 6px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a}</td>
              {players.map(b => {
                if (a === b) return <td key={b} style={{ padding: 0 }}><div style={cellDiv({ background: 'var(--surface-alt)' })} /></td>
                const s = sim(a, b)
                return (
                  <td key={b} style={{ padding: 0 }} title={s ? `${a} ↔ ${b}: ${Math.round(s.rate * 100)}% von ${s.common} Spielen` : 'keine gemeinsamen Spiele'}>
                    <div style={cellDiv({ color: s ? '#15202b' : 'var(--text-dim)', background: s ? heat(s.rate) : 'transparent' })}>
                      {s ? Math.round(s.rate * 100) : '–'}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </StatCard>
  )
}

// ── 6. Risikoprofil ───────────────────────────────────────────────────────
function RiskProfile({ opponentTips }) {
  const stat = {}
  for (const t of opponentTips) {
    const s = stat[t.player_name] || (stat[t.player_name] = { n: 0, goals: 0, draws: 0, scores: {} })
    s.n++
    s.goals += t.pred_home_goals + t.pred_away_goals
    if (t.pred_home_goals === t.pred_away_goals) s.draws++
    const key = `${t.pred_home_goals}:${t.pred_away_goals}`
    s.scores[key] = (s.scores[key] || 0) + 1
  }
  const rows = Object.entries(stat).filter(([, s]) => s.n > 0).map(([player, s]) => {
    const fav = Object.entries(s.scores).sort((a, b) => b[1] - a[1])[0]
    return { player, avg: s.goals / s.n, drawRate: s.draws / s.n, fav: fav[0], favCount: fav[1] }
  })
  if (!rows.length) return null
  rows.sort((a, b) => b.avg - a.avg || a.player.localeCompare(b.player))

  const th = { fontSize: 10, color: 'var(--text-dim)', fontWeight: 400, padding: '0 8px 6px 0', whiteSpace: 'nowrap', textAlign: 'left' }
  const td = { fontSize: 12, padding: '5px 8px 5px 0', textAlign: 'left', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

  return (
    <StatCard title="Risikoprofil" hint="Ø getippte Tore (offensiv vs. vorsichtig), Remis-Quote und Lieblingstipp je Spieler.">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Spieler</th>
              <th style={th}>Ø Tore</th>
              <th style={th}>Remis</th>
              <th style={th}>Lieblingstipp</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.player} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ ...td, color: 'var(--text-primary)' }}>{r.player}</td>
                <td style={td}>{r.avg.toFixed(1)}</td>
                <td style={td}>{Math.round(r.drawRate * 100)}%</td>
                <td style={td}>{r.fav} <span style={{ color: 'var(--text-dim)' }}>×{r.favCount}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </StatCard>
  )
}

// ── 7. Mut zum Risiko (Konsens-Abweichung) ────────────────────────────────
// Per match the crowd has a majority tendency (Heim/Remis/Auswärts); a player
// is "bold" when they tip against it. We report how often each player goes
// against the grain — and, on finished matches, how often that boldness paid off.
function BoldnessCard({ matches, opponentTips }) {
  const byId = {}
  for (const m of matches) byId[m.id] = m
  const tendency = (h, a) => h > a ? 'H' : h < a ? 'A' : 'D'

  const tipsByMatch = {}
  for (const t of opponentTips) {
    if (!tipsByMatch[t.match_id]) tipsByMatch[t.match_id] = []
    tipsByMatch[t.match_id].push(t)
  }

  const majorityByMatch = {}
  for (const mid in tipsByMatch) {
    const counts = { H: 0, D: 0, A: 0 }
    for (const t of tipsByMatch[mid]) counts[tendency(t.pred_home_goals, t.pred_away_goals)]++
    majorityByMatch[mid] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
  }

  const stat = {}
  for (const t of opponentTips) {
    const list = tipsByMatch[t.match_id]
    if (!list || list.length < 2) continue // need a crowd to deviate from
    const s = stat[t.player_name] || (stat[t.player_name] = { n: 0, bold: 0, boldFin: 0, boldHit: 0 })
    s.n++
    const mine = tendency(t.pred_home_goals, t.pred_away_goals)
    const isBold = mine !== majorityByMatch[t.match_id]
    if (isBold) {
      s.bold++
      const m = byId[t.match_id]
      if (m && m.status === 'FINISHED' && m.score_home != null) {
        s.boldFin++
        if (tendency(m.score_home, m.score_away) === mine) s.boldHit++
      }
    }
  }

  const rows = Object.entries(stat).filter(([, s]) => s.n > 0).map(([player, s]) => ({
    player, boldRate: s.bold / s.n, bold: s.bold,
    payoff: s.boldFin > 0 ? s.boldHit / s.boldFin : null, boldFin: s.boldFin,
  }))
  if (!rows.length) return null
  rows.sort((a, b) => b.boldRate - a.boldRate || a.player.localeCompare(b.player))

  const th = { fontSize: 10, color: 'var(--text-dim)', fontWeight: 400, padding: '0 8px 6px 0', whiteSpace: 'nowrap', textAlign: 'left' }
  const td = { fontSize: 12, padding: '5px 8px 5px 0', textAlign: 'left', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

  return (
    <StatCard title="Mut zum Risiko" hint="Anteil der Spiele, in denen ein Spieler gegen die Mehrheitstendenz tippt — und wie oft dieser Mut belohnt wurde.">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Spieler</th>
              <th style={th}>Mut</th>
              <th style={th}>davon korrekt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.player} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ ...td, color: 'var(--text-primary)' }}>{r.player}</td>
                <td style={td}>{Math.round(r.boldRate * 100)}% <span style={{ color: 'var(--text-dim)' }}>({r.bold})</span></td>
                <td style={td}>{r.payoff == null ? '–' : <>{Math.round(r.payoff * 100)}% <span style={{ color: 'var(--text-dim)' }}>von {r.boldFin}</span></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </StatCard>
  )
}

function KonkurrenzView({ matches, opponentTips, rankingSnapshots }) {
  // On the opponents-only mirror the ELO tip is hidden so fellow players
  // don't see the model's prediction for past games.
  const wmtOnly = isWmtOnlyDomain()
  const matchById = {}
  for (const m of matches) matchById[m.id] = m

  const tipsByMatch = {}
  for (const t of opponentTips) {
    if (!tipsByMatch[t.match_id]) tipsByMatch[t.match_id] = []
    tipsByMatch[t.match_id].push(t)
  }

  // Neueste Spiele zuerst — das jüngste steht direkt unter dem Ranking-Chart
  const matchIds = Object.keys(tipsByMatch)
    .map(Number)
    .filter(id => matchById[id])
    .sort((a, b) => new Date(matchById[b].utc_date) - new Date(matchById[a].utc_date))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <RankingChart snapshots={rankingSnapshots} matches={matches} />

      <TipSummaryTable matches={matches} opponentTips={opponentTips} />

      <DayWinnerLoserCard matches={matches} opponentTips={opponentTips} />

      <PointsGapChart snapshots={rankingSnapshots} matches={matches} />
      <HitQualityBars matches={matches} opponentTips={opponentTips} />
      <PointsPerDayHeatmap matches={matches} opponentTips={opponentTips} />
      <TwinsHeatmap opponentTips={opponentTips} />
      <RiskProfile opponentTips={opponentTips} />
      <BoldnessCard matches={matches} opponentTips={opponentTips} />

      {matchIds.length === 0 ? (
        // Opponents-only mirror: don't leak the screenshot-import workflow —
        // just show nothing until tips exist (e.g. during a Railway deploy).
        wmtOnly ? null : (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Noch keine Tipps der Mitspieler importiert.</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              Sobald die Tipps in der Tipprunde sichtbar sind, können Screenshots zum Import übergeben werden.
            </div>
          </div>
        )
      ) : matchIds.map(mid => {
        const m = matchById[mid]
        const tips = tipsByMatch[mid]
        const home = m.home_team?.short_name ?? m.home_team?.tla ?? '?'
        const away = m.away_team?.short_name ?? m.away_team?.tla ?? '?'
        const p = m.prediction

        const tally = { home: 0, draw: 0, away: 0 }
        for (const t of tips) {
          if (t.pred_home_goals > t.pred_away_goals) tally.home++
          else if (t.pred_home_goals < t.pred_away_goals) tally.away++
          else tally.draw++
        }

        return (
          <div key={mid} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                {home} – {away}
                {m.score_home != null && m.score_away != null && (
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> ({m.score_home}:{m.score_away})</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {new Date(m.utc_date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} · {stageLabel(m.stage)}
              </div>
            </div>

            {!wmtOnly && p && (
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>
                ELO-Tipp: {bestTip(p, m.stage !== 'GROUP_STAGE').join(':')}
                {' '}({Math.round(p.home_win_prob * 100)}% / {Math.round(p.draw_prob * 100)}% / {Math.round(p.away_win_prob * 100)}%)
              </div>
            )}

            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              Tipp-Verteilung: {tally.home}× Heimsieg · {tally.draw}× Unentschieden · {tally.away}× Auswärtssieg
            </div>

            {m.status === 'FINISHED' && <TipLegendInline />}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {tips.map(t => (
                <div key={t.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12,
                  background: tipOverlay(m, t) ?? 'transparent',
                  borderRadius: 4, padding: '1px 6px', margin: '0 -6px',
                }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{t.player_name}</span>
                  <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{t.pred_home_goals}:{t.pred_away_goals}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function GruppenTabellen({ matches }) {
  const [tooltip, setTooltip] = useState(null)

  useEffect(() => {
    if (!tooltip) return
    function dismiss() { setTooltip(null) }
    document.addEventListener('click', dismiss)
    return () => document.removeEventListener('click', dismiss)
  }, [tooltip])

  // Pre-compute finished group match history per team for tooltip
  const teamMatchHistory = {}
  for (const m of matches) {
    if (m.stage !== 'GROUP_STAGE' || m.status !== 'FINISHED' || m.score_home == null) continue
    for (const team of [m.home_team, m.away_team]) {
      if (!team) continue
      if (!teamMatchHistory[team.id]) teamMatchHistory[team.id] = []
      teamMatchHistory[team.id].push(m)
    }
  }
  for (const id in teamMatchHistory) {
    teamMatchHistory[id].sort((a, b) => a.matchday - b.matchday)
  }

  const groups = {}
  for (const m of matches) {
    if (m.stage !== 'GROUP_STAGE' || !m.group_name) continue
    const g = m.group_name
    if (!groups[g]) groups[g] = {}
    for (const [team, gs, gc] of [
      [m.home_team, m.score_home, m.score_away],
      [m.away_team, m.score_away, m.score_home],
    ]) {
      if (!team) continue
      if (!groups[g][team.id]) groups[g][team.id] = { team, gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 }
      const row = groups[g][team.id]
      if (m.status === 'FINISHED' && gs != null && gc != null) {
        row.gp++; row.gf += gs; row.ga += gc
        if (gs > gc) row.w++; else if (gs === gc) row.d++; else row.l++
      }
    }
  }

  const sortedGroups = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))

  if (sortedGroups.length === 0) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Noch keine Gruppenspiele vorhanden.</div>
      </div>
    )
  }

  function handleTlaClick(e, team) {
    e.stopPropagation()
    if (tooltip?.teamId === team.id) { setTooltip(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    const results = (teamMatchHistory[team.id] || []).map(m => {
      const htla = m.home_team?.tla ?? '?'
      const atal = m.away_team?.tla ?? '?'
      return `MD${m.matchday}: ${htla} - ${atal}: ${m.score_home}:${m.score_away}`
    })
    setTooltip({
      teamId: team.id,
      x: Math.min(rect.left, window.innerWidth - 210),
      y: rect.bottom + 5,
      name: team.name,
      results,
    })
  }

  const th = { fontSize: 10, color: 'var(--text-dim)', fontWeight: 400, letterSpacing: '0.06em', textAlign: 'right', paddingBottom: 6 }

  return (
    <div>
      {tooltip && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: tooltip.x, top: tooltip.y, zIndex: 300,
            background: 'var(--surface)', border: '1px solid var(--border-hover)',
            borderRadius: 6, padding: '8px 12px',
            fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.7,
            minWidth: 160, maxWidth: 220,
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 5 }}>{tooltip.name}</div>
          {tooltip.results.length > 0
            ? tooltip.results.map((r, i) => (
                <div key={i} style={{ fontVariantNumeric: 'tabular-nums' }}>{r}</div>
              ))
            : <div style={{ color: 'var(--text-dim)' }}>Noch keine Spiele</div>
          }
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
        {sortedGroups.map(([group, teamMap]) => {
          const rows = Object.values(teamMap)
            .map(r => ({ ...r, pts: r.w * 3 + r.d, gd: r.gf - r.ga }))
            .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || (b.team.elo ?? 0) - (a.team.elo ?? 0))

          return (
            <div key={group} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 8 }}>GRUPPE {group}</div>

              <div style={{ display: 'flex', gap: 4, paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 14, ...th }}>#</div>
                <div style={{ flex: 1, textAlign: 'left', ...th }}>TEAM</div>
                <div style={{ width: 20, ...th }}>Sp</div>
                <div style={{ width: 16, ...th }}>W</div>
                <div style={{ width: 16, ...th }}>U</div>
                <div style={{ width: 16, ...th }}>N</div>
                <div style={{ width: 38, ...th }}>Tore</div>
                <div style={{ width: 26, ...th }}>TD</div>
                <div style={{ width: 22, ...th, color: 'var(--text-secondary)' }}>Pkt</div>
              </div>

              {rows.map((r, i) => (
                <div key={r.team.id} style={{
                  display: 'flex', gap: 4, alignItems: 'center',
                  padding: '5px 0', borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{ width: 14, fontSize: 10, color: 'var(--text-dim)', textAlign: 'right', flexShrink: 0 }}>{i + 1}</div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <span
                      onClick={e => handleTlaClick(e, r.team)}
                      style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer', userSelect: 'none' }}>
                      {r.team.tla ?? r.team.short_name}
                    </span>
                  </div>
                  <div style={{ width: 20, fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.gp}</div>
                  <div style={{ width: 16, fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.w}</div>
                  <div style={{ width: 16, fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.d}</div>
                  <div style={{ width: 16, fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.l}</div>
                  <div style={{ width: 38, fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.gf}:{r.ga}</div>
                  <div style={{ width: 26, fontSize: 11, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.gd > 0 ? '#4d8a4d' : r.gd < 0 ? '#8a4d4d' : 'var(--text-secondary)' }}>
                    {r.gd > 0 ? '+' : ''}{r.gd}
                  </div>
                  <div style={{ width: 22, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.pts}</div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NoDataPlaceholder() {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '24px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Noch keine Spieldaten vorhanden.
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Über das Menü (☰) Spielplandaten laden.
      </div>
    </div>
  )
}
