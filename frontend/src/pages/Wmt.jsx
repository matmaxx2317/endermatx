import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { wmt } from '../api'

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
  PAUSED:  '#9ab0d0',
  FINISHED:'#374d66',
  default: '#9ab0d0',
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

function groupMatchesByMatchday(matches) {
  const map = {}
  for (const m of matches) {
    const key = m.matchday
    if (!map[key]) map[key] = []
    map[key].push(m)
  }
  return map
}

function matchdayLabel(matchday, matches) {
  if (!matches?.length) return `MD ${matchday}`
  const stage = matches[0].stage
  if (stage !== 'GROUP_STAGE') return stageLabel(stage)
  return `MD ${matchday}`
}

function renderMarkdown(text) {
  if (!text) return null
  return text.split('\n').map((line, i) => {
    // bold
    const parts = line.split(/\*\*(.*?)\*\*/g).map((p, j) =>
      j % 2 === 1 ? <strong key={j}>{p}</strong> : p
    )
    if (line.startsWith('## '))
      return <div key={i} style={{ fontSize: 13, fontWeight: 600, color: '#eef2ff', marginBottom: 6 }}>{line.slice(3)}</div>
    if (line.startsWith('- '))
      return <div key={i} style={{ paddingLeft: 12, marginBottom: 3 }}>• {parts.slice(1)}</div>
    if (line === '')
      return <div key={i} style={{ height: 8 }} />
    return <div key={i}>{parts}</div>
  })
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
        <div style={{ width: `${dw}%`, background: '#2a3d5c', transition: 'width 0.4s' }} />
        <div style={{ width: `${aw}%`, background: '#1a2840', transition: 'width 0.4s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9ab0d0', marginTop: 4 }}>
        <span>{homeTla} {hw}%</span>
        <span>Rem {dw}%</span>
        <span>{aw}% {awayTla}</span>
      </div>
    </div>
  )
}

function MatchCard({ match, predHistory, onTogglePred, isExpanded }) {
  const p = match.prediction
  const isFinished = match.status === 'FINISHED'
  const isLive = match.status === 'IN_PLAY' || match.status === 'PAUSED'
  const homeName = match.home_team?.name ?? 'TBD'
  const awayName = match.away_team?.name ?? 'TBD'
  const homeTla  = match.home_team?.tla ?? '?'
  const awayTla  = match.away_team?.tla ?? '?'
  const tipHome  = p ? Math.max(0, Math.round(p.pred_home_goals)) : null
  const tipAway  = p ? Math.max(0, Math.round(p.pred_away_goals)) : null

  const tipBgColor = isFinished ? '#0d1221' : 'rgba(77,111,160,0.06)'

  return (
    <div style={{
      background: '#0d1221',
      border: '1px solid #1a2840',
      borderRadius: 10,
      padding: '14px 16px',
      marginBottom: 10,
    }}>
      {/* header row */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 10, color: '#374d66', marginBottom: 12, letterSpacing: '0.05em',
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
          <div style={{ fontSize: 15, fontWeight: 600, color: '#eef2ff' }}>{homeName}</div>
          <div style={{ fontSize: 10, color: '#9ab0d0', marginTop: 2 }}>{homeTla}</div>
        </div>

        <div style={{ minWidth: 56, textAlign: 'center' }}>
          {isFinished || isLive ? (
            <div style={{ fontSize: 22, fontWeight: 600, color: '#eef2ff', fontVariantNumeric: 'tabular-nums' }}>
              {match.score_home ?? 0}&nbsp;:&nbsp;{match.score_away ?? 0}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#374d66' }}>vs</div>
          )}
        </div>

        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#eef2ff' }}>{awayName}</div>
          <div style={{ fontSize: 10, color: '#9ab0d0', marginTop: 2 }}>{awayTla}</div>
        </div>
      </div>

      {/* prediction block */}
      {p ? (
        <div style={{
          background: tipBgColor,
          border: '1px solid #1a2840',
          borderRadius: 6,
          padding: '10px 12px',
        }}>
          <div style={{ fontSize: 11, color: '#9ab0d0', marginBottom: 8 }}>
            {isFinished ? 'Prognose war' : 'Tipp-Empfehlung'}:{' '}
            <span style={{ fontWeight: 600, color: '#eef2ff' }}>{tipHome}:{tipAway}</span>
            <span style={{ color: '#374d66', marginLeft: 6 }}>
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

          <button
            onClick={() => onTogglePred(match.id)}
            style={{
              marginTop: 10, background: 'none', border: 'none',
              color: '#4d6fa0', fontSize: 11, cursor: 'pointer',
              padding: 0, fontFamily: 'inherit',
            }}>
            {isExpanded ? 'Begründung ▲' : 'Begründung ▼'}
            {predHistory && predHistory.length > 1 && ` · ${predHistory.length} Versionen`}
          </button>

          {isExpanded && (
            <div style={{ marginTop: 10, borderTop: '1px solid #1a2840', paddingTop: 10 }}>
              <div style={{ fontSize: 12, color: '#9ab0d0', lineHeight: 1.65, marginBottom: p.home_elo ? 10 : 0 }}>
                {p.reasoning}
              </div>
              {p.home_elo && (
                <div style={{ fontSize: 11, color: '#374d66', marginTop: 6 }}>
                  ELO: {homeTla} {p.home_elo.toFixed(0)} · {awayTla} {p.away_elo?.toFixed(0)}
                  {match.home_team && ` · Spiele: ${match.home_team.matches_played}`}
                </div>
              )}

              {predHistory && predHistory.length > 1 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10, color: '#374d66', letterSpacing: '0.1em', marginBottom: 6 }}>
                    VERLAUF ({predHistory.length} VERSIONEN)
                  </div>
                  {predHistory.map((ph, i) => (
                    <div key={ph.id} style={{
                      padding: '6px 0',
                      borderTop: '1px solid #1a2840',
                      fontSize: 11,
                      color: i === 0 ? '#9ab0d0' : '#374d66',
                    }}>
                      <span style={{ marginRight: 8 }}>{formatDateLong(ph.created_at)}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {Math.round(ph.pred_home_goals)}:{Math.round(ph.pred_away_goals)}
                        {' '}<span style={{ color: '#374d66' }}>
                          (xG {ph.pred_home_goals.toFixed(1)}:{ph.pred_away_goals.toFixed(1)})
                        </span>
                        {' '}({(ph.home_win_prob * 100).toFixed(0)}%/
                        {(ph.draw_prob * 100).toFixed(0)}%/
                        {(ph.away_win_prob * 100).toFixed(0)}%)
                      </span>
                      {i === 0 && <span style={{ color: '#4d6fa0', marginLeft: 6 }}>aktuell</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#374d66' }}>Noch keine Prognose verfügbar.</div>
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

// ── main page ─────────────────────────────────────────────────────────────────

// step: { label, status: 'pending'|'loading'|'done'|'error', detail }
function LoadProgress({ steps }) {
  return (
    <div style={{ fontFamily: 'inherit' }}>
      {steps.map((step, i) => {
        const icon  = step.status === 'done'    ? '✓'
                    : step.status === 'error'   ? '✗'
                    : step.status === 'loading' ? '…'
                    : '·'
        const color = step.status === 'done'    ? '#4d8a4d'
                    : step.status === 'error'   ? '#8a4d4d'
                    : step.status === 'loading' ? '#9ab0d0'
                    : '#374d66'
        return (
          <div key={i} style={{ display: 'flex', gap: 10, padding: '3px 0', alignItems: 'baseline' }}>
            <span style={{ width: 10, fontSize: 11, color, flexShrink: 0 }}>{icon}</span>
            <span style={{ fontSize: 12, color }}>
              {step.detail ?? step.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function Wmt() {
  const [matches, setMatches]         = useState([])
  const [summaries, setSummaries]     = useState([])
  const [view, setView]               = useState('spieltage')
  const [selectedMd, setSelectedMd]   = useState(null)
  const [expandedId, setExpandedId]   = useState(null)
  const [predHistory, setPredHistory] = useState({})
  const [loading, setLoading]         = useState(true)
  const [loadSteps, setLoadSteps]     = useState([])
  const [refreshing, setRefreshing]   = useState(false)
  const [refreshSteps, setRefreshSteps] = useState([])
  const [statusMsg, setStatusMsg]     = useState('')

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setLoadSteps([
        { label: 'Spiele laden',        status: 'loading', detail: null },
        { label: 'Morgenberichte laden', status: 'pending', detail: null },
      ])
    }
    try {
      const ms = await wmt.getMatches()
      setMatches(ms)
      if (!silent) {
        for (let i = 0; i < ms.length; i++) {
          const m    = ms[i]
          const home = m.home_team?.tla ?? m.home_team?.short_name ?? '?'
          const away = m.away_team?.tla ?? m.away_team?.short_name ?? '?'
          const ctx  = m.group_name ? `Gr.${m.group_name}` : stageLabel(m.stage)
          setLoadSteps(prev => [
            { ...prev[0], status: 'loading', detail: `${ctx} · ${home} vs ${away}` },
            prev[1],
          ])
          await new Promise(r => setTimeout(r, 20))
        }
        setLoadSteps(prev => [
          { status: 'done', detail: `${ms.length} Spiel${ms.length !== 1 ? 'e' : ''} geladen` },
          { ...prev[1], status: 'loading' },
        ])
      }

      const ss = await wmt.getSummaries()
      setSummaries(ss)
      if (!silent) setLoadSteps(prev => [
        prev[0],
        { label: 'Morgenberichte', status: 'done', detail: `${ss.length} Bericht${ss.length !== 1 ? 'e' : ''} geladen` },
      ])

      const byMd = groupMatchesByMatchday(ms)
      const mdKeys = Object.keys(byMd).map(Number).sort((a, b) => a - b)
      const activeMd = mdKeys.find(md => byMd[md].some(m =>
        m.status === 'IN_PLAY' || m.status === 'PAUSED' ||
        m.status === 'SCHEDULED' || m.status === 'TIMED'
      )) ?? mdKeys[mdKeys.length - 1] ?? mdKeys[0]
      setSelectedMd(prev => prev ?? activeMd ?? null)
    } catch (e) {
      console.error(e)
      if (!silent) setLoadSteps(prev => prev.map(s =>
        s.status === 'loading' ? { ...s, status: 'error', detail: 'Fehler beim Laden' } : s
      ))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  async function handleRefresh() {
    setRefreshing(true)
    setStatusMsg('')
    const t0 = Date.now()
    const ticker = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000)
      setRefreshSteps([{ label: 'football-data.org abfragen', status: 'loading', detail: `${s}s` }])
    }, 500)
    setRefreshSteps([{ label: 'football-data.org abfragen', status: 'loading', detail: '0s' }])
    try {
      const res = await wmt.refresh()
      clearInterval(ticker)
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      setRefreshSteps([
        { label: 'football-data.org', status: 'done', detail: `${res.message} (${elapsed}s)` },
        { label: 'Ansicht aktualisieren', status: 'loading', detail: null },
      ])
      await loadAll(true)
      setRefreshSteps(prev => [
        prev[0],
        { label: 'Ansicht aktualisieren', status: 'done', detail: 'Fertig' },
      ])
      setTimeout(() => setRefreshSteps([]), 3000)
    } catch (e) {
      clearInterval(ticker)
      setRefreshSteps(prev => prev.map(s =>
        s.status === 'loading' ? { ...s, status: 'error', detail: 'Fehler' } : s
      ))
      setStatusMsg('Fehler beim Aktualisieren.')
      setTimeout(() => { setStatusMsg(''); setRefreshSteps([]) }, 5000)
    } finally {
      setRefreshing(false)
    }
  }

  async function handleTogglePred(matchId) {
    if (expandedId === matchId) {
      setExpandedId(null)
      return
    }
    setExpandedId(matchId)
    if (!predHistory[matchId]) {
      try {
        const hist = await wmt.getMatchPredictions(matchId)
        setPredHistory(prev => ({ ...prev, [matchId]: hist }))
      } catch (e) {
        console.error(e)
      }
    }
  }

  const byMatchday = groupMatchesByMatchday(matches)
  const mdKeys = Object.keys(byMatchday).map(Number).sort((a, b) => a - b)
  const currentMatches = selectedMd !== null ? (byMatchday[selectedMd] ?? []) : []

  const hasData = matches.length > 0

  return (
    <div>
      {/* topbar */}
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/personal"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">wmt</span>
        </div>
        <div className="topbar-right">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              background: 'none', border: 'none', color: '#4d6fa0',
              fontSize: 14, cursor: 'pointer', marginRight: 10, fontFamily: 'inherit',
              opacity: refreshing ? 0.5 : 1,
            }}>
            {refreshing ? '…' : '↻'}
          </button>
          <span className="topbar-version">v1.3</span>
        </div>
      </div>

      <div className="page">
        {/* initial load progress */}
        {loading && loadSteps.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <LoadProgress steps={loadSteps} />
          </div>
        )}

        {/* refresh progress */}
        {refreshSteps.length > 0 && (
          <div style={{ marginBottom: 14, padding: '10px 12px',
            background: '#0d1221', border: '1px solid #1a2840', borderRadius: 6 }}>
            <LoadProgress steps={refreshSteps} />
          </div>
        )}

        {/* status message (errors only) */}
        {statusMsg && (
          <div style={{ fontSize: 12, color: '#9ab0d0', marginBottom: 14, padding: '8px 12px',
            background: '#0d1221', border: '1px solid #1a2840', borderRadius: 6 }}>
            {statusMsg}
          </div>
        )}

        {/* view tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {[['spieltage', 'Spieltage'], ['zusammenfassung', 'Morgenberichte']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              style={{
                background: view === key ? '#1a2840' : 'none',
                border: `1px solid ${view === key ? '#2a3d5c' : '#1a2840'}`,
                color: view === key ? '#eef2ff' : '#374d66',
                borderRadius: 6, padding: '5px 12px', fontSize: 12,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {label}
            </button>
          ))}
        </div>

        {loading && loadSteps.length === 0 && (
          <div style={{ color: '#374d66', fontSize: 12 }}>…</div>
        )}

        {/* ── Spieltage view ─────────────────────────────────────────────── */}
        {!loading && view === 'spieltage' && (
          <>
            {!hasData ? (
              <NoDataPlaceholder />
            ) : (
              <>
                {/* matchday selector */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
                  {mdKeys.map(md => {
                    const mdMatches = byMatchday[md] ?? []
                    const hasLive = mdMatches.some(m => m.status === 'IN_PLAY' || m.status === 'PAUSED')
                    const allDone = mdMatches.every(m => m.status === 'FINISHED')
                    const isSelected = selectedMd === md
                    return (
                      <button
                        key={md}
                        onClick={() => setSelectedMd(md)}
                        style={{
                          background: isSelected ? '#1a2840' : 'none',
                          border: `1px solid ${hasLive ? '#4d8a4d' : isSelected ? '#2a3d5c' : '#1a2840'}`,
                          color: isSelected ? '#eef2ff' : allDone ? '#374d66' : '#9ab0d0',
                          borderRadius: 6, padding: '4px 10px', fontSize: 11,
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}>
                        {matchdayLabel(md, mdMatches)}
                      </button>
                    )
                  })}
                </div>

                {/* match cards */}
                {currentMatches.length === 0 ? (
                  <div style={{ color: '#374d66', fontSize: 13 }}>Keine Spiele.</div>
                ) : (
                  currentMatches.map(m => (
                    <MatchCard
                      key={m.id}
                      match={m}
                      predHistory={predHistory[m.id]}
                      onTogglePred={handleTogglePred}
                      isExpanded={expandedId === m.id}
                    />
                  ))
                )}
              </>
            )}
          </>
        )}

        {/* ── Morgenberichte view ────────────────────────────────────────── */}
        {!loading && view === 'zusammenfassung' && (
          <>
            {summaries.length === 0 ? (
              <div style={{ color: '#374d66', fontSize: 13 }}>
                Noch keine Zusammenfassungen vorhanden. Die erste erscheint am Morgen nach dem ersten Spieltag.
              </div>
            ) : (
              summaries.map(s => (
                <div key={s.id} style={{
                  background: '#0d1221', border: '1px solid #1a2840',
                  borderRadius: 10, padding: '16px', marginBottom: 12,
                }}>
                  <div style={{ fontSize: 10, color: '#374d66', letterSpacing: '0.1em', marginBottom: 10 }}>
                    {new Date(s.date).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).toUpperCase()}
                    {' · '}{s.matches_count} SPIEL{s.matches_count !== 1 ? 'E' : ''}
                  </div>
                  <div style={{ fontSize: 12, color: '#9ab0d0', lineHeight: 1.7 }}>
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

function NoDataPlaceholder() {
  return (
    <div style={{
      background: '#0d1221', border: '1px solid #1a2840', borderRadius: 10,
      padding: '24px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 13, color: '#9ab0d0', marginBottom: 12 }}>
        Noch keine Spieldaten vorhanden.
      </div>
      <div style={{ fontSize: 12, color: '#374d66', lineHeight: 1.6 }}>
        Bitte <code style={{ color: '#4d6fa0' }}>FOOTBALL_DATA_API_KEY</code> als Railway-Umgebungsvariable setzen
        (kostenlose Registrierung auf{' '}
        <span style={{ color: '#4d6fa0' }}>football-data.org</span>), dann{' '}
        ↻ drücken.
      </div>
    </div>
  )
}
