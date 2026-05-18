import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import * as spotify from '../spotify'
import { resolveBpms } from '../bpm'

function fmtDuration(ms) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const BAR_SEGMENTS = [
  { key: 'getsongbpm', color: '#4ade80', label: 'getsong.co' },
  { key: 'deezer',     color: '#a78bfa', label: 'deezer'     },
  { key: 'notFound',   color: '#f44336', label: 'not found'  },
  { key: 'pending',    color: '#1a2840', label: 'pending'    },
]

function BpmBar({ stats }) {
  const { total, getsongbpm, deezer, notFound, pending } = stats
  if (!total) return null
  const counts = { getsongbpm, deezer, notFound, pending }
  const [hovered, setHovered] = useState(null)

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: '#1a2840' }}>
        {BAR_SEGMENTS.map(seg => {
          const pct = (counts[seg.key] / total) * 100
          if (!pct) return null
          return (
            <div
              key={seg.key}
              style={{ width: `${pct}%`, background: seg.color, transition: 'width 0.4s', cursor: 'default' }}
              onMouseEnter={() => setHovered(seg.key)}
              onMouseLeave={() => setHovered(null)}
              title={`${seg.label}: ${counts[seg.key]}`}
            />
          )
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 8 }}>
        {BAR_SEGMENTS.map(seg => {
          const n = counts[seg.key]
          if (!n && seg.key !== 'getsongbpm' && seg.key !== 'deezer' && seg.key !== 'notFound') return null
          const pct = Math.round((n / total) * 100)
          const isHovered = hovered === seg.key
          return (
            <div
              key={seg.key}
              style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'default' }}
              onMouseEnter={() => setHovered(seg.key)}
              onMouseLeave={() => setHovered(null)}
            >
              <div style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: isHovered ? '#eef2ff' : '#9ab0d0' }}>
                {seg.label}
              </span>
              <span style={{ fontSize: 11, color: isHovered ? seg.color : '#374d66', minWidth: 18, textAlign: 'right' }}>
                {n}
              </span>
              {isHovered && (
                <span style={{ fontSize: 10, color: '#374d66' }}>({pct}%)</span>
              )}
            </div>
          )
        })}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
          <span style={{ fontSize: 11, color: '#374d66' }}>total</span>
          <span style={{ fontSize: 11, color: '#9ab0d0' }}>{total}</span>
        </div>
      </div>
    </div>
  )
}

function LogEntry({ e }) {
  const srcColor = e.source === 'getsongbpm' ? '#4ade80' : '#a78bfa'
  const srcLabel = e.source === 'getsongbpm' ? 'getsong.co' : 'deezer    '
  const detail   = !e.bpm && e.source === 'deezer' && e.err ? e.err : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{ display: 'flex', gap: 8, fontSize: 11, fontFamily: 'monospace' }}>
        <span style={{ color: srcColor, flexShrink: 0 }}>{srcLabel}</span>
        <span style={{ color: '#374d66', flexShrink: 0 }}>{e.bpm ? `${e.bpm} bpm` : '—'}</span>
        <span style={{ color: '#9ab0d0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
      </div>
      {detail && (
        <div style={{ fontSize: 10, color: '#4d6fa0', fontFamily: 'monospace', paddingLeft: 84, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {detail}
        </div>
      )}
    </div>
  )
}

export default function SpotifyExplorer() {
  const [clientIdInput, setClientIdInput] = useState(() => spotify.getClientId())
  const [connected, setConnected]   = useState(() => spotify.isConnected())
  const [playlists, setPlaylists]   = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [tracks, setTracks]         = useState(null)
  const [status, setStatus]         = useState('')
  const [bpmStatus, setBpmStatus]   = useState('')
  const [bpmLog, setBpmLog]         = useState([])
  const [globalStats, setGlobalStats] = useState(null)
  const [wipeMsg, setWipeMsg]       = useState('')
  const [error, setError]           = useState('')
  // null | 'fetching' | 'running' | 'done'
  const [scanMode, setScanMode]     = useState(null)
  const [scanProgress, setScanProgress] = useState({ playlistsDone: 0, playlistsTotal: 0, tracksDone: 0, tracksTotal: 0 })
  const [logOffset, setLogOffset]   = useState(0)

  // Handle Spotify OAuth callback
  useEffect(() => {
    const params     = new URLSearchParams(window.location.search)
    const code       = params.get('code')
    const oauthError = params.get('error')
    if (oauthError) { setError(`Spotify auth error: ${oauthError}`); return }
    if (code) {
      spotify.handleCallback(code)
        .then(() => setConnected(true))
        .catch(e => setError(e.message))
    }
  }, [])

  // On mount: check if a background scan is already running on the server
  useEffect(() => {
    fetch('/api/bpm/scan/status?last=200')
      .then(r => r.json())
      .then(data => {
        if (data.status === 'running' || data.status === 'done') {
          setBpmLog([...data.log].reverse())
          setLogOffset(data.log_count)
          setScanProgress({
            playlistsDone: data.playlists_done,
            playlistsTotal: data.playlists_total,
            tracksDone: data.tracks_done,
            tracksTotal: data.tracks_total,
          })
          setScanMode(data.status)
        }
      })
      .catch(() => {})
  }, [])

  // Poll the backend while a scan is running
  useEffect(() => {
    if (scanMode !== 'running') return

    let offset = logOffset
    let cancelled = false

    async function poll() {
      if (cancelled) return
      try {
        const res = await fetch(`/api/bpm/scan/status?since=${offset}`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return

        if (data.status === 'idle') {
          // Server restarted mid-scan — scan is gone
          setScanMode(null)
          return
        }

        setScanProgress({
          playlistsDone: data.playlists_done,
          playlistsTotal: data.playlists_total,
          tracksDone: data.tracks_done,
          tracksTotal: data.tracks_total,
        })

        if (data.log?.length) {
          setBpmLog(prev => [...data.log.slice().reverse(), ...prev])
          offset = data.log_count
        }

        if (data.status === 'done') {
          setScanMode('done')
          refreshGlobalStats()
        }
      } catch { /* ignore transient network errors */ }
    }

    poll()
    const id = setInterval(poll, 2000)
    return () => { cancelled = true; clearInterval(id) }
  }, [scanMode]) // eslint-disable-line react-hooks/exhaustive-deps

  async function connect() {
    const id = clientIdInput.trim()
    if (!id) return
    spotify.setClientId(id)
    await spotify.authorize()
  }

  function disconnect() {
    spotify.logout()
    setConnected(false)
    setPlaylists([])
    setTracks(null)
    setSelectedId('')
    setError('')
    setBpmStatus('')
    setBpmLog([])
    setScanMode(null)
  }

  useEffect(() => {
    if (!connected) return
    setStatus('loading playlists…')
    spotify.getPlaylists()
      .then(setPlaylists)
      .catch(e => setError(e.message))
      .finally(() => setStatus(''))
    fetch('/api/bpm/stats').then(r => r.json()).then(setGlobalStats).catch(() => {})
  }, [connected])

  function refreshGlobalStats() {
    fetch('/api/bpm/stats').then(r => r.json()).then(setGlobalStats).catch(() => {})
  }

  async function wipeDb() {
    if (!window.confirm('Delete all BPM data from the database?')) return
    try {
      const res  = await fetch('/api/bpm/all', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.detail ?? `HTTP ${res.status}`)
      setWipeMsg(`deleted ${data.deleted} rows`)
      setTracks(null)
      setBpmLog([])
      refreshGlobalStats()
    } catch (e) {
      setWipeMsg(`error: ${e.message}`)
    }
    setTimeout(() => setWipeMsg(''), 4000)
  }

  async function startScanAll() {
    setBpmLog([])
    setLogOffset(0)
    setScanProgress({ playlistsDone: 0, playlistsTotal: playlists.length, tracksDone: 0, tracksTotal: 0 })
    setScanMode('fetching')

    // Phase 1: fetch all Spotify tracks in the browser (needs OAuth token)
    const seen = new Map()
    for (let i = 0; i < playlists.length; i++) {
      try {
        const raw = await spotify.loadPlaylistTracks(playlists[i].id)
        for (const t of raw) { if (!seen.has(t.id)) seen.set(t.id, t) }
      } catch { /* skip failed playlist */ }
      setScanProgress(prev => ({ ...prev, playlistsDone: i + 1, tracksTotal: seen.size }))
    }

    const allTracks = Array.from(seen.values())
    setScanProgress(prev => ({ ...prev, tracksTotal: allTracks.length }))

    // Phase 2: hand off to backend for persistent BPM resolution
    const scanTracks = allTracks.map(t => ({
      spotify_id: t.id,
      name:       t.name,
      artist:     t.artists[0]?.name ?? '',
      album:      t.album ?? '',
    }))

    try {
      const res = await fetch('/api/bpm/scan/start', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tracks:          scanTracks,
          playlists_total: playlists.length,
          playlists_done:  playlists.length,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.detail ?? `HTTP ${res.status}`)
      }
      setScanMode('running')
    } catch (e) {
      setError(`Scan failed to start: ${e.message}`)
      setScanMode(null)
    }
  }

  async function loadTracks(playlistId) {
    if (!playlistId) return
    setTracks(null)
    setError('')
    setBpmStatus('')
    setBpmLog([])
    setStatus('loading tracks…')
    try {
      const raw = await spotify.loadPlaylistTracks(playlistId, (_, n) => {
        setStatus(`fetching tracks… ${n}`)
      })
      setTracks(raw)
      setStatus('')
      setBpmStatus(`resolving BPMs… 0/${raw.length}`)
      await resolveBpms(
        raw,
        (id, bpm, src, cached) => setTracks(prev => prev?.map(t => t.id === id ? { ...t, bpm, bpmSource: src, bpmCached: cached } : t) ?? prev),
        (done, total) => { setBpmStatus(done < total ? `resolving BPMs… ${done}/${total}` : ''); refreshGlobalStats() },
        entry => setBpmLog(prev => [entry, ...prev]),
      )
      refreshGlobalStats()
    } catch (e) {
      setError(e.message)
    } finally {
      setStatus('')
    }
  }

  const bpmStats = useMemo(() => {
    if (!tracks || !tracks.length) return null
    const getsongbpm = tracks.filter(t => t.bpmSource === 'getsongbpm').length
    const deezer     = tracks.filter(t => t.bpmSource === 'deezer').length
    const notFound   = tracks.filter(t => t.bpmSource === 'failed').length
    const pending    = tracks.filter(t => !t.bpmSource).length
    return { total: tracks.length, getsongbpm, deezer, notFound, pending }
  }, [tracks])

  const displayedTracks = useMemo(() => {
    if (!tracks) return []
    return [...tracks].sort((a, b) => {
      if (a.bpm === null && b.bpm === null) return 0
      if (a.bpm === null) return 1
      if (b.bpm === null) return -1
      return a.bpm - b.bpm
    })
  }, [tracks])

  const selectedPlaylist = playlists.find(p => p.id === selectedId)
  const trackCount = p => (p.tracks ?? p.items)?.total ?? '?'

  const globalBarStats = globalStats?.total > 0 ? {
    total:      globalStats.total,
    getsongbpm: globalStats.getsongbpm,
    deezer:     globalStats.deezer,
    notFound:   globalStats.not_found,
    pending:    0,
  } : null

  const scanActive = scanMode !== null

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">spt</span>
        </div>
        <div className="topbar-right">
          <span className="topbar-version">v4.3</span>
        </div>
      </div>
      <div className="page">

        {scanActive ? (

          /* ── Scan-all view ─────────────────────────────── */
          <>
            {/* Progress — sticky below topbar */}
            <div style={{ position: 'sticky', top: 32, background: '#07091a', zIndex: 10, paddingBottom: 12, borderBottom: '1px solid #1a2840', marginBottom: 4 }}>
              <div style={{ display: 'flex', gap: 32, paddingTop: 12 }}>
                {[
                  { label: 'playlists done', value: scanProgress.playlistsDone },
                  { label: 'playlists open', value: Math.max(0, scanProgress.playlistsTotal - scanProgress.playlistsDone) },
                  { label: 'tracks done',    value: scanProgress.tracksDone },
                  { label: 'tracks open',    value: Math.max(0, scanProgress.tracksTotal - scanProgress.tracksDone) },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, color: '#374d66', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 24, fontWeight: 600, color: '#eef2ff', lineHeight: 1 }}>{value}</div>
                  </div>
                ))}
              </div>
              {scanMode === 'fetching' && (
                <div style={{ fontSize: 11, color: '#9ab0d0', marginTop: 8 }}>fetching playlists from spotify…</div>
              )}
              {scanMode === 'running' && (
                <div style={{ fontSize: 11, color: '#9ab0d0', marginTop: 8 }}>scanning in background — you can close this page</div>
              )}
              {scanMode === 'done' && (
                <div style={{ fontSize: 11, color: '#4ade80', marginTop: 8 }}>scan complete</div>
              )}
            </div>

            {/* Global bar */}
            {globalBarStats && <BpmBar stats={globalBarStats} />}

            {/* Full-height log */}
            {bpmLog.length > 0 && (
              <div style={{ marginTop: 12, maxHeight: 'calc(100vh - 280px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {bpmLog.map((e, i) => <LogEntry key={i} e={e} />)}
              </div>
            )}
          </>

        ) : !connected ? (

          /* ── Connect form ──────────────────────────────── */
          <>
            <div className="section-header">connect spotify</div>
            <div className="card">
              <p style={{ fontSize: 12, color: '#9ab0d0', margin: '0 0 12px' }}>
                Create an app at{' '}
                <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" style={{ color: '#4a9eff' }}>
                  developer.spotify.com/dashboard
                </a>
                , add{' '}
                <code style={{ fontSize: 11, background: '#111827', padding: '1px 4px', borderRadius: 3 }}>
                  {window.location.origin}/spt
                </code>{' '}
                as a redirect URI, then paste your Client ID below.
              </p>
              <input
                className="input"
                placeholder="client id"
                value={clientIdInput}
                onChange={e => setClientIdInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') connect() }}
              />
              {error && <div style={{ fontSize: 12, color: '#f44336', marginTop: 8 }}>{error}</div>}
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-sm btn-primary" onClick={connect} disabled={!clientIdInput.trim()}>
                  connect with spotify
                </button>
              </div>
            </div>
          </>

        ) : (

          /* ── Normal view ───────────────────────────────── */
          <>
            <div className="section-header">playlists</div>

            {globalBarStats && (
              <div style={{ marginBottom: 14 }}>
                <BpmBar stats={globalBarStats} />
              </div>
            )}

            <select
              className="input"
              value={selectedId}
              onChange={e => {
                const id = e.target.value
                setSelectedId(id)
                setTracks(null)
                setError('')
                setBpmStatus('')
                setBpmLog([])
                if (id) loadTracks(id)
              }}
              disabled={playlists.length === 0 || !!status}
            >
              <option value="">— pick a playlist —</option>
              {playlists.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({trackCount(p)})</option>
              ))}
            </select>

            {status   && <div style={{ fontSize: 12, color: '#9ab0d0', marginTop: 10 }}>{status}</div>}
            {bpmStatus && <div style={{ fontSize: 12, color: '#9ab0d0', marginTop: 10 }}>{bpmStatus}</div>}

            {bpmLog.length > 0 && (
              <div style={{ marginTop: 10, maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {bpmLog.map((e, i) => <LogEntry key={i} e={e} />)}
              </div>
            )}

            {error && <div style={{ fontSize: 12, color: '#f44336', marginTop: 10 }}>{error}</div>}

            {bpmStats && <BpmBar stats={bpmStats} />}

            {tracks && (
              <div style={{ marginTop: 20 }}>
                <div className="section-header">
                  {selectedPlaylist?.name} — {displayedTracks.length} tracks
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {displayedTracks.map(t => (
                    <div key={t.id} className="card" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ textAlign: 'right', flexShrink: 0, width: 40 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}>
                          {t.bpmCached && (
                            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#e879f9', flexShrink: 0 }} />
                          )}
                          <span style={{ fontSize: 14, fontWeight: 600, color:
                            t.bpmSource === 'getsongbpm' ? '#4ade80'
                            : t.bpmSource === 'deezer'   ? '#a78bfa'
                            : t.bpmSource === 'failed'   ? '#f44336'
                            : '#eef2ff'
                          }}>
                            {t.bpm ?? '—'}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: '#374d66' }}>bpm</div>
                      </div>
                      <div style={{ width: 1, height: 28, background: '#1a2840', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#eef2ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#9ab0d0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.artists.map(a => a.name).join(', ')}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: '#374d66', flexShrink: 0 }}>{fmtDuration(t.duration_ms)}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                  {[
                    { color: '#4ade80', label: 'getsong.co' },
                    { color: '#a78bfa', label: 'deezer' },
                    { color: '#f44336', label: 'not found' },
                    { color: '#eef2ff', label: 'pending' },
                  ].map(({ color, label }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: '#374d66' }}>{label}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#e879f9', flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: '#374d66' }}>db cache</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Bottom bar — always visible when connected */}
        {connected && (
          <div style={{ marginTop: 24, borderTop: '1px solid #1a2840', paddingTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" onClick={disconnect}>disconnect spotify</button>
                <button className="btn btn-sm" onClick={wipeDb} style={{ color: '#f44336' }} disabled={scanMode === 'running' || scanMode === 'fetching'}>wipe database</button>
                <button
                  className="btn btn-sm"
                  onClick={scanActive && scanMode !== 'fetching' ? () => { setScanMode(null); setBpmLog([]) } : startScanAll}
                  disabled={scanMode === 'fetching' || scanMode === 'running' || (!scanActive && playlists.length === 0)}
                >
                  {scanMode === 'fetching' || scanMode === 'running' ? 'scanning…' : scanMode === 'done' ? 'close scan' : 'scan all'}
                </button>
              </div>
              <a href="https://getsong.co" target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#374d66', textDecoration: 'none' }}>
                BPM data: GetSong.co
              </a>
            </div>
            {wipeMsg && (
              <div style={{ fontSize: 12, marginTop: 8, color: wipeMsg.startsWith('error') ? '#f44336' : '#4ade80' }}>
                {wipeMsg}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
