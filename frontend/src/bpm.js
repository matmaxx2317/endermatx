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

// ── Main resolution entry point ───────────────────────────────

const BATCH        = 2
const BATCH_DELAY  = 600  // ms between batches to avoid rate limiting

export async function resolveBpms(tracks, onUpdate, onProgress) {
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

  let done = 0

  for (let i = 0; i < uncached.length; i += BATCH) {
    if (i > 0) await new Promise(r => setTimeout(r, BATCH_DELAY))
    await Promise.all(uncached.slice(i, i + BATCH).map(async track => {
      const artist = track.artists[0]?.name ?? ''

      const gResult = await lookupGetSongBpm(track.name, artist)
      const bpm    = gResult.bpm

      if (bpm) {
        onUpdate(track.id, bpm, 'getsongbpm', false)
        storeBpm({ spotify_id: track.id, title: track.name, artist, album: track.album, bpm, source: 'getsongbpm' })
      } else {
        onUpdate(track.id, null, 'failed', false)
      }

      onProgress(++done, uncached.length)
    }))
  }
}
