import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import * as spotify from '../spotify'

function fmtDuration(ms) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function SpotifyExplorer() {
  const [clientId, setClientIdState] = useState(() => spotify.getClientId())
  const [clientIdInput, setClientIdInput] = useState(() => spotify.getClientId())
  const [connected, setConnected]   = useState(false)
  const [playlists, setPlaylists]   = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [tracks, setTracks]         = useState(null)   // enriched track array or null
  const [status, setStatus]         = useState('')     // progress message
  const [error, setError]           = useState('')

  // On mount: handle OAuth callback or restore existing session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code   = params.get('code')

    async function init() {
      if (code) {
        // Clear the code from the URL immediately so refresh doesn't re-trigger it
        window.history.replaceState({}, '', '/spt')
        try {
          await spotify.handleCallback(code)
          setConnected(true)
          setPlaylists(await spotify.getPlaylists())
        } catch (e) {
          setError(e.message)
        }
      } else if (spotify.isConnected()) {
        setConnected(true)
        try {
          setPlaylists(await spotify.getPlaylists())
        } catch (e) {
          setError(e.message)
        }
      }
    }

    init()
  }, [])

  async function connect() {
    const id = clientIdInput.trim()
    if (!id) return
    spotify.setClientId(id)
    setClientIdState(id)
    await spotify.authorize()  // redirects away
  }

  function disconnect() {
    spotify.logout()
    setConnected(false)
    setPlaylists([])
    setTracks(null)
    setSelectedId('')
    setError('')
  }

  async function loadTracks() {
    if (!selectedId) return
    setTracks(null)
    setError('')
    setStatus('starting…')
    try {
      const enriched = await spotify.loadPlaylistTracks(selectedId, (phase, n) => {
        setStatus(phase === 'tracks'
          ? `fetching tracks… ${n}`
          : `fetching audio features… ${n}`)
      })
      setTracks(enriched)
    } catch (e) {
      setError(e.message)
    } finally {
      setStatus('')
    }
  }

  // displayedTracks is separate from tracks so future filter controls
  // can operate on this without re-fetching from Spotify
  const displayedTracks = useMemo(() => tracks ?? [], [tracks])

  const selectedPlaylist = playlists.find(p => p.id === selectedId)

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
            {/* Playlist picker */}
            <div className="section-header">playlists</div>
            {playlists.length === 0 ? (
              <div style={{ fontSize: 13, color: '#555' }}>loading…</div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  className="input"
                  style={{ flex: 1 }}
                  value={selectedId}
                  onChange={e => { setSelectedId(e.target.value); setTracks(null); setError('') }}
                >
                  <option value="">— pick a playlist —</option>
                  {playlists.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.tracks.total})
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={loadTracks}
                  disabled={!selectedId || !!status}
                >
                  load
                </button>
              </div>
            )}

            {status && (
              <div style={{ fontSize: 12, color: '#9ab0d0', marginTop: 10 }}>{status}</div>
            )}
            {error && (
              <div style={{ fontSize: 12, color: '#f44336', marginTop: 10 }}>{error}</div>
            )}

            {/* Track list */}
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
                      {/* BPM */}
                      <div style={{ textAlign: 'right', flexShrink: 0, width: 36 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#eef2ff' }}>{t.bpm}</span>
                        <div style={{ fontSize: 10, color: '#374d66' }}>bpm</div>
                      </div>

                      {/* Separator */}
                      <div style={{ width: 1, height: 28, background: '#1a2840', flexShrink: 0 }} />

                      {/* Track info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#eef2ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#9ab0d0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.artists.map(a => a.name).join(', ')}
                        </div>
                      </div>

                      {/* Duration */}
                      <span style={{ fontSize: 11, color: '#374d66', flexShrink: 0 }}>
                        {fmtDuration(t.duration_ms)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 24, borderTop: '1px solid #1a2840', paddingTop: 16 }}>
              <button className="btn btn-sm" onClick={disconnect}>disconnect spotify</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
