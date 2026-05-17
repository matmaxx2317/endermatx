import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import * as spotify from '../spotify'
import { resolveBpms } from '../bpm'

function fmtDuration(ms) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
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
  const [error, setError]           = useState('')

  // Handle OAuth callback — only token exchange, no API calls
  useEffect(() => {
    const params     = new URLSearchParams(window.location.search)
    const code       = params.get('code')
    const oauthError = params.get('error')

    if (oauthError) {
      setError(`Spotify auth error: ${oauthError}`)
      return
    }
    if (code) {
      spotify.handleCallback(code)
        .then(() => setConnected(true))
        .catch(e => setError(e.message))
    }
  }, [])

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
  }

  // Auto-load playlists whenever the connected state becomes true
  useEffect(() => {
    if (!connected) return
    setStatus('loading playlists…')
    spotify.getPlaylists()
      .then(setPlaylists)
      .catch(e => setError(e.message))
      .finally(() => setStatus(''))
  }, [connected])

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

      // BPM resolution — updates tracks incrementally as each one resolves
      setBpmStatus(`resolving BPMs… 0/${raw.length}`)
      await resolveBpms(
        raw,
        (id, bpm, src, cached) => setTracks(prev => prev?.map(t => t.id === id ? { ...t, bpm, bpmSource: src, bpmCached: cached } : t) ?? prev),
        (done, total) => setBpmStatus(done < total ? `resolving BPMs… ${done}/${total}` : ''),
        entry => setBpmLog(prev => [...prev, entry]),
      )
    } catch (e) {
      setError(e.message)
    } finally {
      setStatus('')
    }
  }

  // Sort by BPM ascending; unresolved tracks sink to the bottom
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

  function trackCount(p) {
    return (p.tracks ?? p.items)?.total ?? '?'
  }

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">spt</span>
        </div>
      </div>
      <div className="page">

        {!connected ? (
          <>
            <div className="section-header">connect spotify</div>
            <div className="card">
              <p style={{ fontSize: 12, color: '#9ab0d0', margin: '0 0 12px' }}>
                Create an app at{' '}
                <a
                  href="https://developer.spotify.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#4a9eff' }}
                >
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
                <button
                  className="btn btn-sm btn-primary"
                  onClick={connect}
                  disabled={!clientIdInput.trim()}
                >
                  connect with spotify
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="section-header">playlists</div>

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
                <option key={p.id} value={p.id}>
                  {p.name} ({trackCount(p)})
                </option>
              ))}
            </select>

            {status && (
              <div style={{ fontSize: 12, color: '#9ab0d0', marginTop: 10 }}>{status}</div>
            )}
            {bpmStatus && (
              <div style={{ fontSize: 12, color: '#9ab0d0', marginTop: 10 }}>{bpmStatus}</div>
            )}
            {bpmLog.length > 0 && (
              <div style={{ marginTop: 10, maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {bpmLog.map((e, i) => {
                  const srcColor = e.source === 'getsongbpm' ? '#4ade80' : '#fb923c'
                  const srcLabel = e.source === 'getsongbpm' ? 'getsong.co ' : 'musicbrainz'
                  return (
                    <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, fontFamily: 'monospace' }}>
                      <span style={{ color: srcColor, flexShrink: 0 }}>{srcLabel}</span>
                      <span style={{ color: '#374d66', flexShrink: 0 }}>{e.bpm ? `${e.bpm} bpm` : '—'}</span>
                      <span style={{ color: '#9ab0d0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                    </div>
                  )
                })}
              </div>
            )}
            {error && (
              <div style={{ fontSize: 12, color: '#f44336', marginTop: 10 }}>{error}</div>
            )}

            {tracks && (
              <div style={{ marginTop: 20 }}>
                <div className="section-header">
                  {selectedPlaylist?.name} — {displayedTracks.length} tracks
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {displayedTracks.map(t => (
                    <div
                      key={t.id}
                      className="card"
                      style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}
                    >
                      <div style={{ textAlign: 'right', flexShrink: 0, width: 40 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}>
                          {t.bpmCached && (
                            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#e879f9', flexShrink: 0 }} />
                          )}
                          <span style={{ fontSize: 14, fontWeight: 600, color:
                            t.bpmSource === 'getsongbpm'   ? '#4ade80'
                            : t.bpmSource === 'musicbrainz' ? '#fb923c'
                            : t.bpmSource === 'failed'      ? '#f44336'
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
                      <span style={{ fontSize: 11, color: '#374d66', flexShrink: 0 }}>
                        {fmtDuration(t.duration_ms)}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                  {[
                    { color: '#4ade80', label: 'getsong.co' },
                    { color: '#fb923c', label: 'musicbrainz' },
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

            <div style={{ marginTop: 24, borderTop: '1px solid #1a2840', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button className="btn btn-sm" onClick={disconnect}>disconnect spotify</button>
              <a
                href="https://getsong.co"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 10, color: '#374d66', textDecoration: 'none' }}
              >
                BPM data: GetSong.co
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
