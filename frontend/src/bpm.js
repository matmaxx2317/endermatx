// ── Tier 1: DB cache ──────────────────────────────────────────

async function batchLookupDb(spotifyIds) {
  try {
    const res = await fetch('/api/bpm/batch-lookup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ spotify_ids: spotifyIds }),
    })
    if (!res.ok) return []
    return await res.json()
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

// ── Tier 3: Deezer (free, no auth) ───────────────────────────

async function lookupDeezer(title, artist) {
  try {
    const params = new URLSearchParams({ title, artist })
    const res = await fetch(`/api/bpm/deezer?${params}`, {
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json()
    if (!res.ok) return { bpm: null, err: data?.detail ?? `HTTP ${res.status}` }
    if (data.err) return { bpm: null, err: data.err }
    return { bpm: typeof data.bpm === 'number' ? data.bpm : null }
  } catch (e) {
    return { bpm: null, err: e.message }
  }
}

// ── Main resolution entry point ───────────────────────────────

const GETSONG_DELAY = 400  // ms between getsong.co calls
const DEEZER_DELAY  = 400  // ms between Deezer calls

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

  const toResolve = tracks.filter(t => !realCache.has(t.id))
  if (!toResolve.length) return

  let done = 0
  let needDelay = false  // only delay before getsong.co/Deezer calls

  for (const track of toResolve) {
    const artist = track.artists[0]?.name ?? ''

    // Tier 0: Spotify Audio Features (already fetched by loadPlaylistTracks, no API call needed)
    if (track.spotifyBpm) {
      onLog?.({ name: track.name, artist, bpm: track.spotifyBpm, spotify: 'pass', getsongbpm: '—', deezer: '—', spotifyRaw: track.spotifyRaw })
      onUpdate(track.id, track.spotifyBpm, 'spotify', false)
      storeBpm({ spotify_id: track.id, title: track.name, artist, album: track.album, bpm: track.spotifyBpm, source: 'spotify' })
      onProgress(++done, toResolve.length)
      continue
    }

    // Tier 2: getsong.co (rate-limited)
    if (needDelay) await new Promise(r => setTimeout(r, GETSONG_DELAY))
    needDelay = true

    const gResult = await lookupGetSongBpm(track.name, artist)

    if (gResult.bpm) {
      onLog?.({ name: track.name, artist, bpm: gResult.bpm, spotify: 'fail', getsongbpm: 'pass', deezer: '—', spotifyRaw: track.spotifyRaw ?? null })
      onUpdate(track.id, gResult.bpm, 'getsongbpm', false)
      storeBpm({ spotify_id: track.id, title: track.name, artist, album: track.album, bpm: gResult.bpm, source: 'getsongbpm' })
    } else {
      // Tier 3: Deezer
      await new Promise(r => setTimeout(r, DEEZER_DELAY))
      const dResult = await lookupDeezer(track.name, artist)

      if (dResult.bpm) {
        onLog?.({ name: track.name, artist, bpm: dResult.bpm, spotify: 'fail', getsongbpm: 'fail', deezer: 'pass', spotifyRaw: track.spotifyRaw ?? null })
        onUpdate(track.id, dResult.bpm, 'deezer', false)
        storeBpm({ spotify_id: track.id, title: track.name, artist, album: track.album, bpm: dResult.bpm, source: 'deezer' })
      } else {
        onLog?.({ name: track.name, artist, bpm: null, spotify: 'fail', getsongbpm: 'fail', deezer: 'fail', spotifyRaw: track.spotifyRaw ?? null })
        onUpdate(track.id, null, 'failed', false)
        storeBpm({ spotify_id: track.id, title: track.name, artist, album: track.album, bpm: 0, source: 'not_found' })
      }
    }

    onProgress(++done, toResolve.length)
  }
}
