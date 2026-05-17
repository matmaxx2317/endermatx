// ── Tier 1: DB cache ──────────────────────────────────────────

async function batchLookupDb(spotifyIds) {
  try {
    const res = await fetch('/api/bpm/batch-lookup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ spotify_ids: spotifyIds }),
    })
    if (!res.ok) return []
    return await res.json()  // [{ spotify_id, bpm, source, ... }]
  } catch {
    return []
  }
}

async function storeBpm(entry) {
  try {
    await fetch('/api/bpm/store', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(entry),
    })
  } catch { /* non-fatal */ }
}

// ── Tier 2: GetSongBPM via backend proxy ─────────────────────

async function lookupGetSongBpm(title, artist) {
  try {
    const params = new URLSearchParams({ title, artist })
    const res = await fetch(`/api/bpm/getsongbpm?${params}`, {
      signal: AbortSignal.timeout(12000),
    })
    const data = await res.json()
    if (!res.ok) return { bpm: null, err: data?.detail ?? `HTTP ${res.status}` }
    if (data.err) return { bpm: null, err: data.err, raw: data }
    return { bpm: typeof data.bpm === 'number' ? data.bpm : null, raw: data }
  } catch (e) {
    return { bpm: null, err: e.message }
  }
}

// ── Tier 3: MusicBrainz fallback ─────────────────────────────

async function lookupMusicBrainz(title, artist) {
  try {
    const params = new URLSearchParams({ title, artist })
    const res = await fetch(`/api/bpm/musicbrainz?${params}`, {
      signal: AbortSignal.timeout(12000),
    })
    const data = await res.json()
    if (!res.ok) return { bpm: null }
    return { bpm: typeof data.bpm === 'number' ? data.bpm : null }
  } catch {
    return { bpm: null }
  }
}

// ── Main resolution entry point ───────────────────────────────

const GETSONG_DELAY = 400   // ms between getsong.co calls
const MB_DELAY      = 1100  // ms between MusicBrainz requests (1 req/sec limit)

export async function resolveBpms(tracks, onUpdate, onProgress, onLog) {
  // Tier 1: DB batch lookup — real BPM entries used as cache; not_found entries retried
  const cached = await batchLookupDb(tracks.map(t => t.id))
  const realCache = new Map(
    cached.filter(c => c.source !== 'not_found').map(c => [c.spotify_id, { bpm: c.bpm, source: c.source }])
  )

  for (const t of tracks) {
    if (realCache.has(t.id)) {
      const { bpm, source } = realCache.get(t.id)
      onUpdate(t.id, bpm, source, true)
    }
  }

  // Tracks to resolve: not cached OR previously marked not_found (retry every time)
  const toResolve = tracks.filter(t => !realCache.has(t.id))
  if (!toResolve.length) return

  let lastMbCall = 0
  let done = 0

  for (let i = 0; i < toResolve.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, GETSONG_DELAY))
    const track  = toResolve[i]
    const artist = track.artists[0]?.name ?? ''

    // Tier 2: getsong.co
    const gResult = await lookupGetSongBpm(track.name, artist)
    onLog?.({ source: 'getsongbpm', name: track.name, bpm: gResult.bpm })

    if (gResult.bpm) {
      onUpdate(track.id, gResult.bpm, 'getsongbpm', false)
      storeBpm({ spotify_id: track.id, title: track.name, artist, album: track.album, bpm: gResult.bpm, source: 'getsongbpm' })
    } else {
      // Tier 3: MusicBrainz fallback immediately for this track
      const wait = MB_DELAY - (Date.now() - lastMbCall)
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      const mbResult = await lookupMusicBrainz(track.name, artist)
      lastMbCall = Date.now()
      onLog?.({ source: 'musicbrainz', name: track.name, bpm: mbResult.bpm })

      if (mbResult.bpm) {
        onUpdate(track.id, mbResult.bpm, 'musicbrainz', false)
        storeBpm({ spotify_id: track.id, title: track.name, artist, album: track.album, bpm: mbResult.bpm, source: 'musicbrainz' })
      } else {
        onUpdate(track.id, null, 'failed', false)
        storeBpm({ spotify_id: track.id, title: track.name, artist, album: track.album, bpm: 0, source: 'not_found' })
      }
    }

    onProgress(++done, toResolve.length)
  }
}

