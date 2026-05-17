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

const BATCH        = 2
const BATCH_DELAY  = 600   // ms between getsong.co batches
const MB_DELAY     = 1100  // ms between MusicBrainz requests (1 req/sec limit)

export async function resolveBpms(tracks, onUpdate, onProgress, onLog) {
  // Tier 1: DB batch lookup
  const cached = await batchLookupDb(tracks.map(t => t.id))
  const cachedMap = new Map(cached.map(c => [c.spotify_id, { bpm: c.bpm, source: c.source }]))

  for (const t of tracks) {
    if (cachedMap.has(t.id)) {
      const { bpm, source } = cachedMap.get(t.id)
      onUpdate(t.id, bpm, source, true)
    }
  }

  const uncached = tracks.filter(t => !cachedMap.has(t.id))
  if (!uncached.length) return

  // Tier 2: getsong.co (batched, concurrent)
  const failed = []
  let done = 0

  for (let i = 0; i < uncached.length; i += BATCH) {
    if (i > 0) await new Promise(r => setTimeout(r, BATCH_DELAY))
    await Promise.all(uncached.slice(i, i + BATCH).map(async track => {
      const artist = track.artists[0]?.name ?? ''
      const gResult = await lookupGetSongBpm(track.name, artist)

      if (gResult.bpm) {
        onLog?.({ source: 'getsongbpm', name: track.name, bpm: gResult.bpm })
        onUpdate(track.id, gResult.bpm, 'getsongbpm', false)
        storeBpm({ spotify_id: track.id, title: track.name, artist, album: track.album, bpm: gResult.bpm, source: 'getsongbpm' })
      } else {
        onLog?.({ source: 'getsongbpm', name: track.name, bpm: null })
        onUpdate(track.id, null, 'failed', false)
        failed.push(track)
      }

      onProgress(++done, uncached.length)
    }))
  }

  // Tier 3: MusicBrainz sequential fallback for getsong.co misses
  for (let i = 0; i < failed.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, MB_DELAY))
    const track  = failed[i]
    const artist = track.artists[0]?.name ?? ''
    const mbResult = await lookupMusicBrainz(track.name, artist)

    onLog?.({ source: 'musicbrainz', name: track.name, bpm: mbResult.bpm })
    if (mbResult.bpm) {
      onUpdate(track.id, mbResult.bpm, 'musicbrainz', false)
      storeBpm({ spotify_id: track.id, title: track.name, artist, album: track.album, bpm: mbResult.bpm, source: 'musicbrainz' })
    }
  }
}
