const BASE     = 'https://api.spotify.com/v1'
const ACCOUNTS = 'https://accounts.spotify.com'
const SCOPES   = 'playlist-read-private playlist-read-collaborative'

// ── Persistent storage ────────────────────────────────────────
export const getClientId = () => localStorage.getItem('spt_client_id') || ''
export const setClientId = id => localStorage.setItem('spt_client_id', id)
export const isConnected = () => !!localStorage.getItem('spt_access_token')

function storeTokens({ access_token, refresh_token, expires_in }) {
  localStorage.setItem('spt_access_token', access_token)
  if (refresh_token) localStorage.setItem('spt_refresh_token', refresh_token)
  localStorage.setItem('spt_expires_at', String(Date.now() + expires_in * 1000))
}

export function logout() {
  ['spt_access_token', 'spt_refresh_token', 'spt_expires_at'].forEach(k =>
    localStorage.removeItem(k)
  )
}

// ── PKCE helpers ──────────────────────────────────────────────
function generateVerifier() {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function sha256b64url(str) {
  const data = new TextEncoder().encode(str)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function redirectUri() {
  return window.location.origin + '/spt'
}

// ── Auth ──────────────────────────────────────────────────────
export async function authorize() {
  const verifier  = generateVerifier()
  const challenge = await sha256b64url(verifier)
  sessionStorage.setItem('spt_verifier', verifier)

  const params = new URLSearchParams({
    client_id:             getClientId(),
    response_type:         'code',
    redirect_uri:          redirectUri(),
    scope:                 SCOPES,
    code_challenge_method: 'S256',
    code_challenge:        challenge,
  })
  window.location.href = `${ACCOUNTS}/authorize?${params}`
}

export async function handleCallback(code) {
  const verifier = sessionStorage.getItem('spt_verifier')
  sessionStorage.removeItem('spt_verifier')

  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     getClientId(),
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri(),
      code_verifier: verifier,
    }),
  })
  if (!res.ok) throw new Error(`Auth failed (${res.status}) — check your Client ID and redirect URI`)
  storeTokens(await res.json())
}

async function getValidToken() {
  const expiresAt = Number(localStorage.getItem('spt_expires_at') || 0)
  if (Date.now() < expiresAt - 60_000) {
    return localStorage.getItem('spt_access_token')
  }

  const refresh = localStorage.getItem('spt_refresh_token')
  if (!refresh) { logout(); return null }

  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     getClientId(),
      grant_type:    'refresh_token',
      refresh_token: refresh,
    }),
  })
  if (!res.ok) { logout(); throw new Error('Session expired — please reconnect') }
  const data = await res.json()
  storeTokens(data)
  return data.access_token
}

// ── Core fetch ────────────────────────────────────────────────
async function apiGet(url) {
  const token = await getValidToken()
  if (!token) throw new Error('Not authenticated')

  const fullUrl = url.startsWith('http') ? url : BASE + url
  const res = await fetch(fullUrl, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 401) { logout(); throw new Error('Session expired — please reconnect') }
  if (res.status === 403) throw new Error(`Spotify access denied (${res.status})`)
  if (!res.ok) throw new Error(`Spotify error ${res.status}`)
  return res.json()
}

// ── Public API ────────────────────────────────────────────────

export async function getMe() {
  return apiGet('/me')
}

export async function getAudioFeatures(ids) {
  const features = []
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const data = await apiGet(`/audio-features?ids=${ids.slice(i, i + 100).join(',')}`)
      features.push(...(data.audio_features ?? []))
    } catch { /* skip failed batch */ }
  }
  return features
}

export async function getPlaylists(max = Infinity) {
  const items = []
  let url = `/me/playlists?limit=${Math.min(max, 50)}`
  while (url && items.length < max) {
    const data = await apiGet(url)
    items.push(...data.items.filter(Boolean))
    url = data.next
  }
  return items.slice(0, max)
}

export async function getPlaylistTracks(playlistId, onProgress) {
  const tracks = []
  let url = `/playlists/${encodeURIComponent(playlistId)}/items?limit=100`
  while (url) {
    const data = await apiGet(url)
    const valid = data.items.map(i => i?.item).filter(t => t?.id && !t.is_local)
    tracks.push(...valid)
    onProgress?.('tracks', tracks.length)
    url = data.next
  }
  return tracks
}

// ── High-level helpers ────────────────────────────────────────

// Returns track metadata including Spotify tempo as spotifyBpm.
export async function loadPlaylistTracks(playlistId, onProgress) {
  const tracks = await getPlaylistTracks(playlistId, onProgress)
  const features = await getAudioFeatures(tracks.map(t => t.id))
  const tempoMap = new Map(
    features.filter(f => f?.tempo > 0).map(f => [f.id, Math.round(f.tempo)])
  )
  return tracks.map(t => ({
    id:          t.id,
    name:        t.name,
    artists:     t.artists,
    album:       t.album?.name ?? '',
    duration_ms: t.duration_ms,
    bpm:         null,
    bpmSource:   null,
    bpmCached:   false,
    spotifyBpm:  tempoMap.get(t.id) ?? null,
  }))
}
