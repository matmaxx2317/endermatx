import { useState, useEffect, useCallback, useRef } from 'react'
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

// Group stage uses matchday numbers; knockout rounds are keyed by stage name
// (football-data.org sends matchday=null for knockout games, which our backend
//  coerces to 0, so we must not rely on matchday for those).
const STAGE_ORDER = ['GROUP_STAGE','LAST_32','ROUND_OF_32','LAST_16','ROUND_OF_16','QUARTER_FINALS','SEMI_FINALS','THIRD_PLACE','FINAL']

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

export default function Wmt() {
  const [matches, setMatches]           = useState([])
  const [summaries, setSummaries]       = useState([])
  const [bonus, setBonus]               = useState(null)
  const [view, setView]                 = useState('spieltage')
  const [selectedKey, setSelectedKey]   = useState(null)
  const [expandedId, setExpandedId]     = useState(null)
  const [predHistory, setPredHistory]   = useState({})
  const [loading, setLoading]           = useState(true)
  const [refreshing, setRefreshing]     = useState(false)
  const [generatingBonus, setGeneratingBonus] = useState(false)
  const [logs, setLogs]                 = useState([])
  const logRef                          = useRef(null)

  const addLog = useCallback((text, level = 'info') => {
    setLogs(prev => [...prev, { ts: Date.now(), text, level }])
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const ms = await wmt.getMatches()
      setMatches(ms)
      if (!silent) {
        for (let i = 0; i < ms.length; i++) {
          const m    = ms[i]
          const home = m.home_team?.tla ?? m.home_team?.short_name ?? '?'
          const away = m.away_team?.tla ?? m.away_team?.short_name ?? '?'
          const ctx  = m.group_name ? `Gr.${m.group_name}` : stageLabel(m.stage)
          addLog(`${ctx} · ${home} vs ${away}`)
          await new Promise(r => setTimeout(r, 20))
        }
        addLog(`${ms.length} Spiele geladen`, 'done')
      }

      const ss = await wmt.getSummaries()
      setSummaries(ss)
      if (!silent) addLog(`${ss.length} Morgenberichte geladen`, 'done')

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
      addLog('Fehler beim Laden', 'error')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [addLog])

  useEffect(() => { loadAll() }, [loadAll])

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
      }
    } catch (e) {
      addLog('Fehler bei Bonus-Prognose', 'error')
    } finally {
      setGeneratingBonus(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    addLog('football-data.org wird abgefragt…')
    const t0 = Date.now()
    try {
      const res = await wmt.refresh()
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      addLog(`${res.message} (${elapsed}s)`, 'done')
      await loadAll(true)
      addLog('Ansicht aktualisiert', 'done')
    } catch (e) {
      addLog('Fehler beim Refresh', 'error')
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

  const grouped       = groupMatches(matches)
  const groupKeys     = sortGroupKeys(Object.keys(grouped))
  const currentMatches = selectedKey !== null ? (grouped[selectedKey] ?? []) : []

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
          <span className="topbar-version">v1.7</span>
        </div>
      </div>

      <div className="page">
        {/* view tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          {[['spieltage', 'Spieltage'], ['bonus', 'Bonus-Tipps'], ['zusammenfassung', 'Morgenberichte'], ['log', 'Log']].map(([key, label]) => (
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
              {label}{key === 'log' && logs.length > 0 && <span style={{ color: '#374d66', marginLeft: 4 }}>{logs.length}</span>}
            </button>
          ))}
        </div>

        {loading && (
          <div style={{ color: '#374d66', fontSize: 12 }}>…</div>
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
                          background: isSelected ? '#1a2840' : 'none',
                          border: `1px solid ${hasLive ? '#4d8a4d' : isSelected ? '#2a3d5c' : '#1a2840'}`,
                          color: isSelected ? '#eef2ff' : allDone ? '#374d66' : '#9ab0d0',
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

        {/* ── Log view ──────────────────────────────────────────────────── */}
        {view === 'log' && (
          <div
            ref={logRef}
            style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 160px)', display: 'flex', flexDirection: 'column' }}
          >
            {logs.length === 0 ? (
              <div style={{ color: '#374d66', fontSize: 12 }}>Noch keine Einträge.</div>
            ) : (
              logs.map((e, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10, padding: '2px 0',
                  fontSize: 11, fontVariantNumeric: 'tabular-nums',
                }}>
                  <span style={{ color: '#1a2840', flexShrink: 0 }}>
                    {new Date(e.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span style={{ color: e.level === 'done' ? '#4d8a4d' : e.level === 'error' ? '#8a4d4d' : '#374d66' }}>
                    {e.text}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Bonus-Tipps view ──────────────────────────────────────────── */}
        {!loading && view === 'bonus' && (
          <BonusView
            bonus={bonus}
            generating={generatingBonus}
            onGenerate={handleGenerateBonus}
          />
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
          background: '#0d1221', border: '1px solid #2a3d5c',
          borderRadius: 12, padding: '20px 24px', width: 320,
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: '#374d66', letterSpacing: '0.1em' }}>GRUPPE {group}</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#374d66', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>
            ✕
          </button>
        </div>
        {teams.map((t, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 0', borderTop: i > 0 ? '1px solid #1a2840' : 'none',
          }}>
            <span style={{ fontSize: 11, color: '#374d66', width: 16, flexShrink: 0 }}>{i + 1}.</span>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: i === 0 ? 600 : 400, color: i === 0 ? '#eef2ff' : '#9ab0d0', marginRight: 7 }}>
                {t.tla}
              </span>
              <span style={{ fontSize: 11, color: '#374d66' }}>{t.team}</span>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 12, color: '#4d6fa0', fontVariantNumeric: 'tabular-nums' }}>
                {(t.prob_1st * 100).toFixed(0)}% 1.
              </div>
              <div style={{ fontSize: 10, color: '#374d66', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                {(t.prob_top2 * 100).toFixed(0)}% Top 2 · {(t.prob_top3 * 100).toFixed(0)}% Top 3
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BonusView({ bonus, generating, onGenerate }) {
  const [modalGroup, setModalGroup] = useState(null)

  const cardStyle = {
    background: '#0d1221', border: '1px solid #1a2840',
    borderRadius: 10, padding: '16px', marginBottom: 12,
  }
  const labelStyle = { fontSize: 10, color: '#374d66', letterSpacing: '0.1em', marginBottom: 8 }
  const teamChip = (item, rank) => (
    <div key={rank} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '7px 0', borderTop: rank > 0 ? '1px solid #1a2840' : 'none',
    }}>
      <div>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#eef2ff', marginRight: 8 }}>{item.tla}</span>
        <span style={{ fontSize: 12, color: '#9ab0d0' }}>{item.team}</span>
      </div>
      <span style={{ fontSize: 12, color: '#4d6fa0', fontVariantNumeric: 'tabular-nums' }}>
        {(item.prob * 100).toFixed(0)}%
      </span>
    </div>
  )

  const generateBtn = (
    <button
      onClick={onGenerate}
      disabled={generating}
      style={{
        background: 'none', border: '1px solid #1a2840', color: '#4d6fa0',
        borderRadius: 6, padding: '6px 14px', fontSize: 12,
        cursor: generating ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', opacity: generating ? 0.5 : 1,
        marginBottom: 20,
      }}>
      {generating ? '… wird berechnet' : bonus ? '↻ Prognose neu berechnen' : '▶ Prognose berechnen'}
    </button>
  )

  if (!bonus) {
    return (
      <div>
        {generateBtn}
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#9ab0d0', marginBottom: 8 }}>
            Noch keine Bonus-Prognose vorhanden.
          </div>
          <div style={{ fontSize: 12, color: '#374d66', lineHeight: 1.6 }}>
            Bitte zuerst ↻ klicken um den Spielplan zu laden, dann Prognose berechnen.
          </div>
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

      {generateBtn}

      {/* Turniersieger */}
      {bonus.winner && (
        <div style={{ ...cardStyle, borderColor: '#2a3d5c' }}>
          <div style={labelStyle}>TURNIERSIEGER</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#eef2ff', marginRight: 10 }}>
                {bonus.winner.tla}
              </span>
              <span style={{ fontSize: 14, color: '#9ab0d0' }}>{bonus.winner.team}</span>
            </div>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#4d6fa0' }}>
              {(bonus.winner.prob * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      )}

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
              <div style={{ fontSize: 14, fontWeight: 600, color: '#eef2ff', marginBottom: 3 }}>
                {bonus.top_scorer.player}
              </div>
              <div style={{ fontSize: 12, color: '#9ab0d0' }}>
                {bonus.top_scorer.tla} · {bonus.top_scorer.team}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#4d6fa0' }}>
                ~{bonus.top_scorer.goals} Tore
              </div>
              <div style={{ fontSize: 10, color: '#374d66', marginTop: 3 }}>
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
                    background: '#07091a', border: '1px solid #1a2840', borderRadius: 6,
                    padding: '8px 10px', cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#2a3d5c'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = '#1a2840'}>
                  <div style={{ fontSize: 9, color: '#374d66', letterSpacing: '0.1em', marginBottom: 6 }}>
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
                        color: i === 0 ? '#eef2ff' : i === 1 ? '#9ab0d0' : '#374d66',
                      }}>
                        {i + 1}. {t.tla}
                      </span>
                      <span style={{
                        fontSize: i === 0 ? 11 : 10,
                        color: i === 0 ? '#4d6fa0' : '#374d66',
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

      <div style={{ fontSize: 10, color: '#374d66', textAlign: 'right', marginTop: 4, marginBottom: 24 }}>
        {bonus.n_simulations.toLocaleString('de-DE')} Simulationen · {generatedDate}
      </div>

      {/* Simulation explanation */}
      <div style={{ borderTop: '1px solid #1a2840', paddingTop: 20 }}>
        <div style={{ fontSize: 10, color: '#374d66', letterSpacing: '0.1em', marginBottom: 14 }}>
          WIE FUNKTIONIERT DIE SIMULATION?
        </div>

        <div style={{ fontSize: 12, color: '#374d66', lineHeight: 1.8 }}>
          <p style={{ marginBottom: 12 }}>
            Die Prognose basiert auf einer{' '}
            <span style={{ color: '#9ab0d0' }}>Monte-Carlo-Simulation</span>{' '}
            mit {bonus.n_simulations.toLocaleString('de-DE')} Turnierdurchläufen.
            Jeder Durchlauf simuliert das gesamte WM-Turnier von der Gruppenphase bis zum Finale.
            Die angezeigten Prozentwerte geben an, wie häufig ein Ergebnis in diesen Durchläufen eingetreten ist.
          </p>

          <div style={{ marginBottom: 10 }}>
            <span style={{ color: '#9ab0d0' }}>ELO-Rating</span>
            <span style={{ color: '#374d66' }}>
              {' '}— Jedes Team erhält ein ELO-Rating, das auf Ergebnissen der letzten WM und anderen internationalen Spielen basiert.
              Stärkere Teams haben höhere Ratings; ein Unterschied von 400 Punkten entspricht grob einer Gewinnwahrscheinlichkeit von ca. 85:15.
            </span>
          </div>

          <div style={{ marginBottom: 10 }}>
            <span style={{ color: '#9ab0d0' }}>Gruppenphase</span>
            <span style={{ color: '#374d66' }}>
              {' '}— In jedem Durchlauf wird jedes Gruppenspiel einzeln simuliert.
              Aus den ELO-Ratings wird eine erwartete Toranzahl (xG) pro Team abgeleitet;
              die tatsächlichen Tore werden per Poisson-Verteilung zufällig gezogen.
              Bereits gespielte Partien fließen mit ihrem echten Ergebnis ein.
            </span>
          </div>

          <div style={{ marginBottom: 10 }}>
            <span style={{ color: '#9ab0d0' }}>K.O.-Runde</span>
            <span style={{ color: '#374d66' }}>
              {' '}— Die besten zwei jeder Gruppe sowie die acht besten Gruppendritter (nach Punkten, Tordifferenz, Toren) qualifizieren sich für die Runde der 32.
              Der K.O.-Baum wird in jedem Durchlauf zufällig neu gelost, damit keine bestimmte Hälfte bevorzugt wird.
              Bei Unentschieden nach 90 Minuten entscheidet ein ELO-gewichteter Münzwurf (analog Elfmeterschießen).
            </span>
          </div>

          <div style={{ marginBottom: 10 }}>
            <span style={{ color: '#9ab0d0' }}>Torschützenkönig</span>
            <span style={{ color: '#374d66' }}>
              {' '}— Die Prognose nutzt Torschützendaten aus WC 2026 (sofern verfügbar), WC 2022 und EC 2024 von football-data.org.
              Aus der Torrate pro Spiel und der erwarteten Turnierlänge (abhängig vom ELO-Rating des Teams) wird eine prognostizierte Gesamttoranzahl berechnet.
              Für Teams ohne aktuelle Daten wird auf eine kuratierte Rückfallliste bekannter Torjäger zurückgegriffen.
            </span>
          </div>

          <div>
            <span style={{ color: '#9ab0d0' }}>Hinweis</span>
            <span style={{ color: '#374d66' }}>
              {' '}— Die Simulation spiegelt den Wissensstand zum Zeitpunkt der letzten Datenaktualisierung wider.
              Nach jedem Spieltag ELO-Ratings neu berechnen (↻) und anschließend die Bonus-Prognose neu generieren, um aktuelle Ergebnisse einzubeziehen.
            </span>
          </div>
        </div>
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
