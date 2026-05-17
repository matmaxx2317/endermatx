// ── Tier 1: DB cache ──────────────────────────────────────────

async function batchLookupDb(spotifyIds) {
  try {
    const res = await fetch('/api/bpm/batch-lookup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ spotify_ids: spotifyIds }),
    })
    if (!res.ok) return []
    return await res.json()  // [{ spotify_id, bpm, ... }]
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

// ── Tier 3: Audio analysis of Spotify 30-second preview ──────

async function detectBpmFromAudio(previewUrl) {
  let arrayBuffer
  try {
    const res = await fetch(previewUrl)
    if (!res.ok) return null
    arrayBuffer = await res.arrayBuffer()
  } catch {
    return null
  }

  let audioBuffer
  try {
    const ctx = new AudioContext()
    audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    ctx.close()
  } catch {
    return null
  }

  const data    = audioBuffer.getChannelData(0)
  const sr      = audioBuffer.sampleRate
  const winSize = Math.floor(sr * 0.01)      // 10 ms windows → ~100 frames/sec
  const nFrames = Math.floor(data.length / winSize)

  // Energy per window
  const energy = new Float32Array(nFrames)
  for (let i = 0; i < nFrames; i++) {
    let e = 0
    const off = i * winSize
    for (let j = 0; j < winSize; j++) e += data[off + j] ** 2
    energy[i] = e / winSize
  }

  // Onset strength = positive first difference of energy
  const onset = new Float32Array(nFrames)
  for (let i = 1; i < nFrames; i++) {
    const diff = energy[i] - energy[i - 1]
    if (diff > 0) onset[i] = diff
  }

  // Autocorrelation over onset signal to find dominant beat period
  const fps    = sr / winSize
  const minLag = Math.max(1, Math.round(fps * 60 / 200))  // 200 BPM ceiling
  const maxLag = Math.round(fps * 60 / 60)                // 60 BPM floor

  let bestLag = minLag, bestCorr = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0
    const n = nFrames - lag
    for (let i = 0; i < n; i++) corr += onset[i] * onset[i + lag]
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag }
  }

  const bpm = Math.round(fps * 60 / bestLag)
  return bpm >= 50 && bpm <= 220 ? bpm : null
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
      let bpm    = gResult.bpm
      let source = bpm ? 'getsongbpm' : null

      if (!bpm && track.preview_url) {
        bpm    = await detectBpmFromAudio(track.preview_url)
        source = bpm ? 'audio' : null
      }

      if (bpm) {
        onUpdate(track.id, bpm, source, false)
        storeBpm({ spotify_id: track.id, title: track.name, artist, album: track.album, bpm, source })
      } else {
        onUpdate(track.id, null, 'failed', false)
      }

      onProgress(++done, uncached.length)
    }))
  }
}
