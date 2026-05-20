import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

// ─── Constants ────────────────────────────────────────────────────────────────
const LOOK_AHEAD_S   = 2.1
const HIT_PERFECT_S  = 0.065
const HIT_GOOD_S     = 0.130
const SCORE_PERFECT  = 300
const SCORE_GOOD     = 100
const MISS_LIMITS    = { easy: 20, medium: 12, hard: 8 }
const LANE_KEYS      = ['d', 'f', 'j', 'k']

// Minecraft block colours: grass, dirt, stone, diamond
const LANE_MID  = ['#4a7c2f', '#7a4a1e', '#6a6a6a', '#1a6a9a']
const LANE_LITE = ['#78c840', '#c87a30', '#b8b8b8', '#3ab8f0']
const LANE_DARK = ['#2a4818', '#4a2a0e', '#404040', '#0a4060']
const LANE_LABEL = ['D', 'F', 'J', 'K']

// ─── Seeded RNG (mulberry32) ─────────────────────────────────────────────────
function mkRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
  }
}

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12) }

// ─── 100 track definitions ───────────────────────────────────────────────────
const ALL_TRACKS = [
  // ── Easy (0-32) ──
  { id:  0, name: 'Grasslands',         d: 'easy',   bpm:  82, seed: 1001, beats: 64 },
  { id:  1, name: 'Flower Forest',      d: 'easy',   bpm:  88, seed: 1002, beats: 64 },
  { id:  2, name: 'Sunflower Plains',   d: 'easy',   bpm:  90, seed: 1003, beats: 72 },
  { id:  3, name: 'Birch Forest',       d: 'easy',   bpm:  84, seed: 1004, beats: 64 },
  { id:  4, name: 'Cherry Grove',       d: 'easy',   bpm:  92, seed: 1005, beats: 64 },
  { id:  5, name: 'Meadow Morning',     d: 'easy',   bpm:  86, seed: 1006, beats: 72 },
  { id:  6, name: 'Oak Woods',          d: 'easy',   bpm:  80, seed: 1007, beats: 64 },
  { id:  7, name: 'Bamboo Jungle',      d: 'easy',   bpm:  94, seed: 1008, beats: 72 },
  { id:  8, name: 'River Run',          d: 'easy',   bpm:  88, seed: 1009, beats: 64 },
  { id:  9, name: 'Beach Sunrise',      d: 'easy',   bpm:  82, seed: 1010, beats: 64 },
  { id: 10, name: 'Savanna Plains',     d: 'easy',   bpm:  90, seed: 1011, beats: 72 },
  { id: 11, name: 'Desert Winds',       d: 'easy',   bpm:  86, seed: 1012, beats: 64 },
  { id: 12, name: 'Frozen Peaks',       d: 'easy',   bpm:  80, seed: 1013, beats: 64 },
  { id: 13, name: 'Snowy Slopes',       d: 'easy',   bpm:  84, seed: 1014, beats: 72 },
  { id: 14, name: 'Grove',              d: 'easy',   bpm:  88, seed: 1015, beats: 64 },
  { id: 15, name: 'Stony Peaks',        d: 'easy',   bpm:  90, seed: 1016, beats: 64 },
  { id: 16, name: 'Lush Caves',         d: 'easy',   bpm:  84, seed: 1017, beats: 72 },
  { id: 17, name: 'Dripstone Cave',     d: 'easy',   bpm:  82, seed: 1018, beats: 64 },
  { id: 18, name: 'Froglight Fen',      d: 'easy',   bpm:  88, seed: 1019, beats: 64 },
  { id: 19, name: 'Mangrove Marsh',     d: 'easy',   bpm:  86, seed: 1020, beats: 72 },
  { id: 20, name: 'Pale Garden',        d: 'easy',   bpm:  80, seed: 1021, beats: 64 },
  { id: 21, name: 'Dark Forest Edge',   d: 'easy',   bpm:  84, seed: 1022, beats: 64 },
  { id: 22, name: 'Taiga Trail',        d: 'easy',   bpm:  92, seed: 1023, beats: 72 },
  { id: 23, name: 'Jungle Temple',      d: 'easy',   bpm:  88, seed: 1024, beats: 64 },
  { id: 24, name: 'Village Bell',       d: 'easy',   bpm:  84, seed: 1025, beats: 64 },
  { id: 25, name: 'Farm Life',          d: 'easy',   bpm:  86, seed: 1026, beats: 72 },
  { id: 26, name: 'Windmill Dance',     d: 'easy',   bpm:  90, seed: 1027, beats: 64 },
  { id: 27, name: 'Sheep Graze',        d: 'easy',   bpm:  82, seed: 1028, beats: 64 },
  { id: 28, name: 'Chicken Cluck',      d: 'easy',   bpm:  88, seed: 1029, beats: 72 },
  { id: 29, name: 'Creeper Walk',       d: 'easy',   bpm:  80, seed: 1030, beats: 64 },
  { id: 30, name: 'Zombie Shuffle',     d: 'easy',   bpm:  84, seed: 1031, beats: 64 },
  { id: 31, name: 'Skeleton Stroll',    d: 'easy',   bpm:  86, seed: 1032, beats: 72 },
  { id: 32, name: 'Endermite Hop',      d: 'easy',   bpm:  90, seed: 1033, beats: 64 },
  // ── Medium (33-65) ──
  { id: 33, name: 'Nether Portal',      d: 'medium', bpm: 105, seed: 2001, beats: 80 },
  { id: 34, name: 'Basalt Deltas',      d: 'medium', bpm: 110, seed: 2002, beats: 80 },
  { id: 35, name: 'Crimson Forest',     d: 'medium', bpm: 108, seed: 2003, beats: 96 },
  { id: 36, name: 'Warped Forest',      d: 'medium', bpm: 112, seed: 2004, beats: 80 },
  { id: 37, name: 'Soul Sand Valley',   d: 'medium', bpm: 105, seed: 2005, beats: 80 },
  { id: 38, name: 'Bastion March',      d: 'medium', bpm: 115, seed: 2006, beats: 96 },
  { id: 39, name: 'Fortress Run',       d: 'medium', bpm: 110, seed: 2007, beats: 80 },
  { id: 40, name: 'Ghast Cry',          d: 'medium', bpm: 108, seed: 2008, beats: 80 },
  { id: 41, name: 'Blaze Rush',         d: 'medium', bpm: 115, seed: 2009, beats: 96 },
  { id: 42, name: 'Magma Shuffle',      d: 'medium', bpm: 110, seed: 2010, beats: 80 },
  { id: 43, name: 'Piglin Barter',      d: 'medium', bpm: 105, seed: 2011, beats: 80 },
  { id: 44, name: 'Hoglin Chase',       d: 'medium', bpm: 112, seed: 2012, beats: 96 },
  { id: 45, name: 'Strider Ride',       d: 'medium', bpm: 108, seed: 2013, beats: 80 },
  { id: 46, name: 'Gold Rush',          d: 'medium', bpm: 115, seed: 2014, beats: 80 },
  { id: 47, name: 'Ancient Debris',     d: 'medium', bpm: 110, seed: 2015, beats: 96 },
  { id: 48, name: 'Obsidian Craft',     d: 'medium', bpm: 105, seed: 2016, beats: 80 },
  { id: 49, name: 'End Gateway',        d: 'medium', bpm: 112, seed: 2017, beats: 80 },
  { id: 50, name: 'Shulker Box',        d: 'medium', bpm: 108, seed: 2018, beats: 96 },
  { id: 51, name: 'Phantom Night',      d: 'medium', bpm: 115, seed: 2019, beats: 80 },
  { id: 52, name: 'Pillager Raid',      d: 'medium', bpm: 110, seed: 2020, beats: 80 },
  { id: 53, name: 'Ravager Charge',     d: 'medium', bpm: 112, seed: 2021, beats: 96 },
  { id: 54, name: 'Evoker Spell',       d: 'medium', bpm: 105, seed: 2022, beats: 80 },
  { id: 55, name: 'Vex Dance',          d: 'medium', bpm: 108, seed: 2023, beats: 80 },
  { id: 56, name: 'Iron Golem',         d: 'medium', bpm: 115, seed: 2024, beats: 96 },
  { id: 57, name: 'Witch Brew',         d: 'medium', bpm: 110, seed: 2025, beats: 80 },
  { id: 58, name: 'Guardian Eye',       d: 'medium', bpm: 105, seed: 2026, beats: 80 },
  { id: 59, name: 'Elder Daze',         d: 'medium', bpm: 112, seed: 2027, beats: 96 },
  { id: 60, name: 'Ocean Monument',     d: 'medium', bpm: 108, seed: 2028, beats: 80 },
  { id: 61, name: 'Coral Reef',         d: 'medium', bpm: 115, seed: 2029, beats: 80 },
  { id: 62, name: 'Shipwreck',          d: 'medium', bpm: 110, seed: 2030, beats: 96 },
  { id: 63, name: 'Drowned March',      d: 'medium', bpm: 105, seed: 2031, beats: 80 },
  { id: 64, name: 'Charged Creeper',    d: 'medium', bpm: 112, seed: 2032, beats: 80 },
  { id: 65, name: 'Wither Skull',       d: 'medium', bpm: 108, seed: 2033, beats: 96 },
  // ── Hard (66-99) ──
  { id: 66, name: "Warden's Domain",    d: 'hard',   bpm: 135, seed: 3001, beats: 96  },
  { id: 67, name: 'Ancient City',       d: 'hard',   bpm: 140, seed: 3002, beats: 96  },
  { id: 68, name: 'Sculk Resonance',    d: 'hard',   bpm: 138, seed: 3003, beats: 112 },
  { id: 69, name: 'Deep Dark',          d: 'hard',   bpm: 142, seed: 3004, beats: 96  },
  { id: 70, name: 'Wither Storm',       d: 'hard',   bpm: 145, seed: 3005, beats: 96  },
  { id: 71, name: 'Ender Dragon',       d: 'hard',   bpm: 138, seed: 3006, beats: 112 },
  { id: 72, name: 'End City Sprint',    d: 'hard',   bpm: 140, seed: 3007, beats: 96  },
  { id: 73, name: 'Chorus Dance',       d: 'hard',   bpm: 135, seed: 3008, beats: 96  },
  { id: 74, name: 'Shulker Bullet',     d: 'hard',   bpm: 142, seed: 3009, beats: 112 },
  { id: 75, name: 'Dragon Breath',      d: 'hard',   bpm: 145, seed: 3010, beats: 96  },
  { id: 76, name: 'End Crystal',        d: 'hard',   bpm: 138, seed: 3011, beats: 96  },
  { id: 77, name: 'Gateway Jump',       d: 'hard',   bpm: 140, seed: 3012, beats: 112 },
  { id: 78, name: 'Enderman Rage',      d: 'hard',   bpm: 142, seed: 3013, beats: 96  },
  { id: 79, name: 'Warden Heartbeat',   d: 'hard',   bpm: 135, seed: 3014, beats: 96  },
  { id: 80, name: 'Sculk Shrieker',     d: 'hard',   bpm: 145, seed: 3015, beats: 112 },
  { id: 81, name: 'Sculk Catalyst',     d: 'hard',   bpm: 138, seed: 3016, beats: 96  },
  { id: 82, name: 'Allay Dance',        d: 'hard',   bpm: 140, seed: 3017, beats: 96  },
  { id: 83, name: 'Vex Swarm',          d: 'hard',   bpm: 142, seed: 3018, beats: 112 },
  { id: 84, name: 'Ravager Stomp',      d: 'hard',   bpm: 145, seed: 3019, beats: 96  },
  { id: 85, name: 'Evoker Fangs',       d: 'hard',   bpm: 138, seed: 3020, beats: 96  },
  { id: 86, name: "Illusioner's Curse", d: 'hard',   bpm: 140, seed: 3021, beats: 112 },
  { id: 87, name: 'Elder Guardian',     d: 'hard',   bpm: 135, seed: 3022, beats: 96  },
  { id: 88, name: 'Wither Head',        d: 'hard',   bpm: 142, seed: 3023, beats: 96  },
  { id: 89, name: 'Beacon Pulse',       d: 'hard',   bpm: 145, seed: 3024, beats: 112 },
  { id: 90, name: 'Conduit Power',      d: 'hard',   bpm: 138, seed: 3025, beats: 96  },
  { id: 91, name: 'Trident Thunder',    d: 'hard',   bpm: 140, seed: 3026, beats: 96  },
  { id: 92, name: 'Riptide',            d: 'hard',   bpm: 145, seed: 3027, beats: 112 },
  { id: 93, name: 'Loyalty Return',     d: 'hard',   bpm: 138, seed: 3028, beats: 96  },
  { id: 94, name: 'Impaling Strike',    d: 'hard',   bpm: 142, seed: 3029, beats: 96  },
  { id: 95, name: 'Dragon Fireball',    d: 'hard',   bpm: 145, seed: 3030, beats: 112 },
  { id: 96, name: 'Chaos Realm',        d: 'hard',   bpm: 140, seed: 3031, beats: 96  },
  { id: 97, name: 'Dark Dimension',     d: 'hard',   bpm: 138, seed: 3032, beats: 96  },
  { id: 98, name: 'Infinite End',       d: 'hard',   bpm: 142, seed: 3033, beats: 112 },
  { id: 99, name: 'The Final Boss',     d: 'hard',   bpm: 150, seed: 3034, beats: 96  },
]

// ─── Note chart generator ────────────────────────────────────────────────────
function generateChart(track) {
  const rng = mkRng(track.seed)
  const { beats, d } = track
  const cfg = {
    easy:   { step: 1.00, onProb: 0.58, dualProb: 0.05, minLaneGap: 2.0 },
    medium: { step: 0.50, onProb: 0.62, dualProb: 0.22, minLaneGap: 1.0 },
    hard:   { step: 0.25, onProb: 0.72, dualProb: 0.38, minLaneGap: 0.5 },
  }[d]

  const notes = []
  const lastInLane = [0, 0, 0, 0]
  let id = 0

  for (let t = 2; t <= beats - 1.5; t += cfg.step) {
    if (rng() >= cfg.onProb) continue
    const avail = [0, 1, 2, 3].filter(l => t - lastInLane[l] >= cfg.minLaneGap)
    if (avail.length === 0) continue
    const l1 = avail[Math.floor(rng() * avail.length)]
    notes.push({ id: id++, beat: t, lane: l1, hit: false, missed: false, hitPerfect: false })
    lastInLane[l1] = t

    if (rng() < cfg.dualProb) {
      const avail2 = [0, 1, 2, 3].filter(l => l !== l1 && t - lastInLane[l] >= cfg.minLaneGap)
      if (avail2.length > 0) {
        const l2 = avail2[Math.floor(rng() * avail2.length)]
        notes.push({ id: id++, beat: t, lane: l2, hit: false, missed: false, hitPerfect: false })
        lastInLane[l2] = t
      }
    }
  }
  return notes
}

// ─── Music engine ────────────────────────────────────────────────────────────
class MusicEngine {
  constructor(track) {
    this.track = track
    this.ctx = null
    this.startTime = 0
    this.nextBeat = 0
    this.timerId = null

    // Build melodic material from seed
    const rng = mkRng(track.seed ^ 0xBEEF)
    const roots = [60, 62, 64, 65, 67, 69, 71]
    const rootMidi = roots[track.seed % roots.length] + (track.d === 'easy' ? 60 : track.d === 'medium' ? 62 : 65)
    // Pentatonic major intervals
    const pent = [0, 2, 4, 7, 9, 12, 14, 16, 19].map(s => rootMidi + s)
    const phraseLen = 8
    this.melody = Array.from({ length: phraseLen }, () =>
      rng() < 0.25 ? null : pent[Math.floor(rng() * pent.length)]
    )
    this.bass = [rootMidi - 12, null, rootMidi - 5, null]
    if (track.d !== 'easy') {
      this.arp = Array.from({ length: 16 }, () =>
        rng() < 0.35 ? null : pent[Math.floor(rng() * 5)]
      )
    }
  }

  async start() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.startTime = this.ctx.currentTime + 0.08
    this.nextBeat = 0
    this._schedule()
  }

  stop() {
    clearTimeout(this.timerId)
    try { if (this.ctx) this.ctx.close() } catch (_) {}
    this.ctx = null
  }

  getElapsed() {
    if (!this.ctx) return 0
    return Math.max(0, this.ctx.currentTime - this.startTime)
  }

  _schedule() {
    if (!this.ctx) return
    const ahead = 0.4
    const bps = this.track.bpm / 60
    while (this.nextBeat <= this.track.beats + 4) {
      const t = this.startTime + this.nextBeat / bps
      if (t > this.ctx.currentTime + ahead) break
      this._beat(this.nextBeat, t)
      this.nextBeat++
    }
    this.timerId = setTimeout(() => this._schedule(), 90)
  }

  _beat(beat, t) {
    const bps = this.track.bpm / 60
    const bar = beat % 4
    if (bar === 0 || bar === 2) this._kick(t)
    if (bar === 1 || bar === 3) this._snare(t)
    this._hihat(t, 0.06)
    this._hihat(t + 0.5 / bps, 0.035)

    const melMidi = this.melody[beat % this.melody.length]
    if (melMidi != null) this._osc(t, midiToFreq(melMidi), 0.14, 'square', 0.38 / bps)

    const bassMidi = this.bass[beat % this.bass.length]
    if (bassMidi != null) this._osc(t, midiToFreq(bassMidi), 0.11, 'triangle', 0.78 / bps)

    if (this.arp) {
      for (let i = 0; i < 2; i++) {
        const idx = ((beat * 2) + i) % this.arp.length
        const m = this.arp[idx]
        if (m != null) this._osc(t + i * 0.5 / bps, midiToFreq(m + 12), 0.055, 'square', 0.22 / bps)
      }
    }
  }

  _osc(t, freq, gain, type, dur) {
    if (!this.ctx) return
    try {
      const osc = this.ctx.createOscillator()
      const env = this.ctx.createGain()
      osc.type = type; osc.frequency.value = freq
      osc.connect(env); env.connect(this.ctx.destination)
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(gain, t + 0.01)
      env.gain.setValueAtTime(gain, t + dur * 0.65)
      env.gain.exponentialRampToValueAtTime(0.001, t + dur)
      osc.start(t); osc.stop(t + dur + 0.01)
    } catch (_) {}
  }

  _kick(t) {
    if (!this.ctx) return
    try {
      const osc = this.ctx.createOscillator()
      const env = this.ctx.createGain()
      osc.connect(env); env.connect(this.ctx.destination)
      osc.frequency.setValueAtTime(110, t)
      osc.frequency.exponentialRampToValueAtTime(28, t + 0.18)
      env.gain.setValueAtTime(0.42, t)
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
      osc.start(t); osc.stop(t + 0.25)
    } catch (_) {}
  }

  _snare(t) {
    if (!this.ctx) return
    try {
      const len = Math.floor(this.ctx.sampleRate * 0.09)
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      const env = this.ctx.createGain()
      src.connect(env); env.connect(this.ctx.destination)
      env.gain.setValueAtTime(0.18, t)
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
      src.start(t)
    } catch (_) {}
  }

  _hihat(t, gain) {
    if (!this.ctx) return
    try {
      const len = Math.floor(this.ctx.sampleRate * 0.035)
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      const hp = this.ctx.createBiquadFilter()
      hp.type = 'highpass'; hp.frequency.value = 7500
      const env = this.ctx.createGain()
      src.connect(hp); hp.connect(env); env.connect(this.ctx.destination)
      env.gain.setValueAtTime(gain, t)
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.04)
      src.start(t)
    } catch (_) {}
  }
}

// ─── Stars ───────────────────────────────────────────────────────────────────
function makeStars(n, seed) {
  const rng = mkRng(seed ^ 0xCAFE)
  return Array.from({ length: n }, () => ({
    x: rng(), y: rng() * 0.55,
    size: rng() < 0.15 ? 2 : 1,
    bright: 0.4 + rng() * 0.6,
  }))
}

// ─── Canvas renderer ─────────────────────────────────────────────────────────
function drawFrame(canvas, game) {
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth
  const H = canvas.clientHeight
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width  = W * dpr
    canvas.height = H * dpr
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const { track, notes, pressedLanes, hitFx, score, combo, misses, currentTime, feedbackLabel, feedbackAt, stars } = game
  const bps  = track.bpm / 60
  const VPX  = W * 0.5
  const VPY  = H * 0.14
  const HIT_Y = H * 0.80
  const BTN_Y = H * 0.82
  const BTN_H = H * 0.18
  const LX    = [W * 0.185, W * 0.395, W * 0.605, W * 0.815]
  const HW    = W * 0.092   // half-width of lane at hit zone

  function lanePos(lane, t) {
    const tc = Math.max(0, t)
    return {
      x: VPX + (LX[lane] - VPX) * tc,
      y: VPY + (HIT_Y - VPY) * tc,
      hw: HW * tc,
    }
  }

  // Background sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0,    '#04060f')
  sky.addColorStop(0.45, '#07091a')
  sky.addColorStop(1,    '#0d1221')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)

  // Stars
  for (const s of stars) {
    ctx.globalAlpha = s.bright
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(s.x * W, s.y * H, s.size, s.size)
  }
  ctx.globalAlpha = 1

  // Lane fills (trapezoids from VP to hit zone)
  for (let i = 0; i < 4; i++) {
    const lEdge = VPX + (LX[i] - HW - VPX)
    const rEdge = VPX + (LX[i] + HW - VPX)
    ctx.beginPath()
    ctx.moveTo(VPX, VPY)
    ctx.lineTo(lEdge, HIT_Y)
    ctx.lineTo(rEdge, HIT_Y)
    ctx.closePath()
    const [r, g, b] = i === 0 ? [40,80,20] : i === 1 ? [60,35,15] : i === 2 ? [50,50,50] : [10,40,70]
    ctx.fillStyle = `rgba(${r},${g},${b},0.35)`
    ctx.fill()
  }

  // Depth grid lines (horizontal perspective lines across all lanes)
  for (let t = 0.08; t < 1; t += 0.12) {
    const alpha = 0.03 + t * 0.06
    ctx.beginPath()
    let first = true
    for (let i = 0; i < 4; i++) {
      const lx = VPX + (LX[i] - HW - VPX) * t
      const rx = VPX + (LX[i] + HW - VPX) * t
      const gy = VPY + (HIT_Y - VPY) * t
      if (first) { ctx.moveTo(lx, gy); first = false } else ctx.lineTo(lx, gy)
      ctx.lineTo(rx, gy)
    }
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // Lane edge rails
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  for (let i = 0; i < 4; i++) {
    const lEdge = VPX + (LX[i] - HW - VPX)
    const rEdge = VPX + (LX[i] + HW - VPX)
    ctx.beginPath(); ctx.moveTo(VPX, VPY); ctx.lineTo(lEdge, HIT_Y); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(VPX, VPY); ctx.lineTo(rEdge, HIT_Y); ctx.stroke()
  }

  // Draw notes
  for (const note of notes) {
    const noteTime = note.beat / bps
    const t = (currentTime - noteTime + LOOK_AHEAD_S) / LOOK_AHEAD_S
    if (t < 0.01 || t > 1.14) continue
    if (note.hit) continue

    const pos = lanePos(note.lane, Math.min(t, 1))
    const bw = pos.hw * 2
    const bh = bw * 0.52
    const bx = pos.x - pos.hw
    const by = pos.y - bh / 2

    if (note.missed) {
      // Fading miss block
      const age = currentTime - noteTime - HIT_GOOD_S
      const alpha = Math.max(0, 1 - age * 5)
      if (alpha <= 0) continue
      ctx.globalAlpha = alpha * 0.4
    }

    const col  = LANE_MID[note.lane]
    const lite = LANE_LITE[note.lane]
    const dark = LANE_DARK[note.lane]

    // Block face
    ctx.fillStyle = col
    ctx.fillRect(bx, by, bw, bh)
    // Top strip
    ctx.fillStyle = lite
    ctx.fillRect(bx, by, bw, bh * 0.22)
    // Left shadow strip
    ctx.fillStyle = dark
    ctx.fillRect(bx, by, bw * 0.1, bh)
    // Minecraft pixel grid overlay
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'
    ctx.lineWidth = Math.max(1, bw * 0.04)
    for (let gx = 1; gx < 4; gx++) {
      const px = bx + bw / 4 * gx
      ctx.beginPath(); ctx.moveTo(px, by); ctx.lineTo(px, by + bh); ctx.stroke()
    }
    const py = by + bh * 0.5
    ctx.beginPath(); ctx.moveTo(bx, py); ctx.lineTo(bx + bw, py); ctx.stroke()
    // Border glow
    ctx.strokeStyle = lite
    ctx.lineWidth = Math.max(1, bw * 0.045)
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1)

    ctx.globalAlpha = 1
  }

  // Hit flash effects
  for (const fx of hitFx) {
    const age = currentTime - fx.t
    if (age > 0.28) continue
    const alpha = (1 - age / 0.28) * 0.55
    const { x, hw: fhw } = lanePos(fx.lane, 0.98)
    ctx.fillStyle = fx.perfect
      ? `rgba(255,220,80,${alpha})`
      : `rgba(120,200,120,${alpha})`
    const fw = fhw * 2.4
    ctx.fillRect(x - fw / 2, HIT_Y - fw * 0.3, fw, fw * 0.5)
  }

  // Hit zone line
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.beginPath()
  let hzFirst = true
  for (let i = 0; i < 4; i++) {
    const lx = VPX + (LX[i] - HW - VPX)
    const rx = VPX + (LX[i] + HW - VPX)
    if (hzFirst) { ctx.moveTo(lx, HIT_Y); hzFirst = false } else ctx.lineTo(lx, HIT_Y)
    ctx.lineTo(rx, HIT_Y)
  }
  ctx.stroke()

  // Target diamonds at hit zone
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = LANE_LITE[i]
    ctx.lineWidth = 1.5
    const dx = LX[i], dy = HIT_Y, ds = HW * 0.22
    ctx.beginPath()
    ctx.moveTo(dx, dy - ds); ctx.lineTo(dx + ds, dy)
    ctx.lineTo(dx, dy + ds); ctx.lineTo(dx - ds, dy)
    ctx.closePath(); ctx.stroke()
  }

  // Buttons
  for (let i = 0; i < 4; i++) {
    const pressed = pressedLanes[i]
    const bx = LX[i] - HW
    const bw2 = HW * 2

    // Button bg block (Minecraft style)
    ctx.fillStyle = pressed ? LANE_LITE[i] : LANE_MID[i]
    ctx.fillRect(bx, BTN_Y, bw2, BTN_H)
    // Top stripe
    ctx.fillStyle = pressed ? '#ffffff' : LANE_LITE[i]
    ctx.fillRect(bx, BTN_Y, bw2, BTN_H * 0.18)
    // Left shadow
    ctx.fillStyle = LANE_DARK[i]
    ctx.fillRect(bx, BTN_Y, bw2 * 0.08, BTN_H)
    // Pixel grid
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'
    ctx.lineWidth = 1
    for (let g = 1; g < 4; g++) {
      const gx = bx + bw2 / 4 * g
      ctx.beginPath(); ctx.moveTo(gx, BTN_Y); ctx.lineTo(gx, BTN_Y + BTN_H); ctx.stroke()
    }
    for (let g = 1; g < 3; g++) {
      const gy = BTN_Y + BTN_H / 3 * g
      ctx.beginPath(); ctx.moveTo(bx, gy); ctx.lineTo(bx + bw2, gy); ctx.stroke()
    }
    // Border
    ctx.strokeStyle = pressed ? '#ffffff' : LANE_LITE[i]
    ctx.lineWidth = pressed ? 2.5 : 1.5
    ctx.strokeRect(bx + 0.5, BTN_Y + 0.5, bw2 - 1, BTN_H - 1)
    // Label
    ctx.fillStyle = pressed ? '#000000' : 'rgba(255,255,255,0.85)'
    const fsize = Math.max(10, Math.min(22, bw2 * 0.38))
    ctx.font = `bold ${fsize}px 'Courier New', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(LANE_LABEL[i], LX[i], BTN_Y + BTN_H / 2)
  }

  // ── UI overlay ──
  // Score
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#eef2ff'
  ctx.font = 'bold 16px Inter, sans-serif'
  ctx.fillText(score.toLocaleString(), 10, 10)

  // Combo
  if (combo >= 2) {
    const csize = Math.min(26, 12 + Math.floor(combo / 5))
    ctx.font = `bold ${csize}px Inter, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillStyle = combo >= 20 ? '#ffdd44' : '#9ab0d0'
    ctx.fillText(`${combo}×`, W / 2, 8)
  }

  // Miss counter (hearts)
  const maxMiss = MISS_LIMITS[track.d]
  const remaining = maxMiss - misses
  ctx.textAlign = 'right'
  ctx.font = '13px Inter, sans-serif'
  ctx.fillStyle = remaining <= 3 ? '#ff5555' : remaining <= maxMiss * 0.4 ? '#ffaa44' : '#4d9a4d'
  ctx.fillText(`♥ ${remaining}`, W - 10, 10)

  // Progress bar
  const trackDur = track.beats / bps
  const prog = Math.min(1, currentTime / trackDur)
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fillRect(0, VPY - 4, W, 3)
  ctx.fillStyle = LANE_LITE[2]
  ctx.fillRect(0, VPY - 4, W * prog, 3)

  // Hit feedback label
  if (feedbackLabel && currentTime - feedbackAt < 0.5) {
    const alpha = Math.max(0, 1 - (currentTime - feedbackAt) / 0.5)
    ctx.globalAlpha = alpha
    ctx.font = `bold 18px Inter, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillStyle = feedbackLabel === 'PERFECT' ? '#ffdd44' : feedbackLabel === 'GOOD' ? '#78c840' : '#ff5555'
    ctx.fillText(feedbackLabel, W / 2, H * 0.68)
    ctx.globalAlpha = 1
  }
}

// ─── Track picker ────────────────────────────────────────────────────────────
function pickTracks() {
  const byDiff = d => ALL_TRACKS.filter(t => t.d === d)
  const pick = arr => arr[Math.floor(Math.random() * arr.length)]
  return [pick(byDiff('easy')), pick(byDiff('medium')), pick(byDiff('hard'))]
}

// ─── SelectScreen ────────────────────────────────────────────────────────────
function SelectScreen({ options, onSelect }) {
  const DIFF_COL  = { easy: '#4a7c2f', medium: '#c87a30', hard: '#c04040' }
  const DIFF_ICON = { easy: '🌿', medium: '🔥', hard: '💎' }

  function fmtDuration(track) {
    const secs = Math.round(track.beats / (track.bpm / 60))
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100%',
      padding: '24px 16px', gap: 20,
    }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '0.04em',
          color: '#eef2ff', fontFamily: "'Courier New', monospace",
          textShadow: '0 0 20px rgba(120,200,120,0.4)',
        }}>
          ⛏ BLOCK HERO
        </div>
        <div style={{ fontSize: 11, color: '#374d66', marginTop: 4, letterSpacing: '0.15em' }}>
          select a track
        </div>
      </div>

      {options.map((track, idx) => (
        <button
          key={track.id}
          onClick={() => onSelect(track)}
          style={{
            width: '100%', maxWidth: 380, padding: '18px 20px',
            background: '#0d1221', border: `1px solid ${DIFF_COL[track.d]}`,
            borderRadius: 4, cursor: 'pointer', textAlign: 'left',
            transition: 'background 0.15s, transform 0.1s',
            fontFamily: 'Inter, sans-serif',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(120,200,120,0.06)'}
          onMouseLeave={e => e.currentTarget.style.background = '#0d1221'}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: 9, color: DIFF_COL[track.d], letterSpacing: '0.15em', fontWeight: 600 }}>
                {DIFF_ICON[track.d]} {track.d.toUpperCase()}
              </span>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#eef2ff', marginTop: 4 }}>
                {track.name}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
              <div style={{ fontSize: 12, color: '#9ab0d0' }}>{track.bpm} BPM</div>
              <div style={{ fontSize: 11, color: '#374d66', marginTop: 2 }}>{fmtDuration(track)}</div>
            </div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            {['D', 'F', 'J', 'K'].map((k, i) => (
              <div key={i} style={{
                width: 22, height: 22, background: LANE_MID[i],
                border: `1px solid ${LANE_LITE[i]}`, borderRadius: 2,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, color: '#fff',
                fontFamily: "'Courier New', monospace",
              }}>{k}</div>
            ))}
          </div>
        </button>
      ))}

      <div style={{ fontSize: 10, color: '#1a2840', marginTop: 8, letterSpacing: '0.12em' }}>
        keyboard: D · F · J · K
      </div>
    </div>
  )
}

// ─── ResultsScreen ───────────────────────────────────────────────────────────
function ResultsScreen({ result, onPlayAgain }) {
  const { track, score, hits, misses, total, failed } = result
  const acc = total > 0 ? Math.round((hits / total) * 100) : 0
  const grade = acc >= 95 ? 'S' : acc >= 85 ? 'A' : acc >= 70 ? 'B' : acc >= 55 ? 'C' : 'D'
  const gradeCol = { S: '#ffdd44', A: '#78c840', B: '#3ab8f0', C: '#c87a30', D: '#c04040' }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100%', padding: '32px 16px', gap: 16,
    }}>
      {failed && (
        <div style={{ fontSize: 13, color: '#c04040', letterSpacing: '0.15em', fontWeight: 600 }}>
          ✗ STAGE FAILED
        </div>
      )}
      {!failed && (
        <div style={{ fontSize: 13, color: '#78c840', letterSpacing: '0.15em', fontWeight: 600 }}>
          ✓ TRACK COMPLETE
        </div>
      )}

      <div style={{
        fontSize: 72, fontWeight: 700, color: gradeCol[grade],
        fontFamily: "'Courier New', monospace", lineHeight: 1,
        textShadow: `0 0 30px ${gradeCol[grade]}88`,
      }}>{grade}</div>

      <div style={{
        background: '#0d1221', border: '1px solid #1a2840', borderRadius: 4,
        padding: '20px 28px', width: '100%', maxWidth: 320,
      }}>
        <div style={{ fontSize: 11, color: '#374d66', marginBottom: 12, letterSpacing: '0.12em' }}>
          {track.name} · {track.d.toUpperCase()}
        </div>
        {[
          ['Score', score.toLocaleString()],
          ['Accuracy', `${acc}%`],
          ['Hits', `${hits} / ${total}`],
          ['Misses', misses],
        ].map(([label, val]) => (
          <div key={label} style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '5px 0', borderBottom: '1px solid #0f1a2e',
          }}>
            <span style={{ fontSize: 12, color: '#9ab0d0' }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#eef2ff' }}>{val}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onPlayAgain}
        style={{
          padding: '10px 32px', background: 'none',
          border: '1px solid #4a7c2f', color: '#78c840',
          fontSize: 13, fontFamily: 'Inter, sans-serif',
          cursor: 'pointer', letterSpacing: '0.1em',
          borderRadius: 2,
        }}
      >
        play again →
      </button>
    </div>
  )
}

// ─── GameScreen ──────────────────────────────────────────────────────────────
function GameScreen({ track, onEnd }) {
  const canvasRef  = useRef(null)
  const gameRef    = useRef(null)
  const engineRef  = useRef(null)
  const rafRef     = useRef(null)
  const endedRef   = useRef(false)

  useEffect(() => {
    endedRef.current = false
    const notes  = generateChart(track)
    const stars  = makeStars(60, track.seed)
    gameRef.current = {
      track, notes, stars,
      pressedLanes: [false, false, false, false],
      hitFx: [],
      score: 0, combo: 0, misses: 0,
      currentTime: 0,
      feedbackLabel: '', feedbackAt: -1,
    }

    const engine = new MusicEngine(track)
    engineRef.current = engine
    engine.start().then(() => {
      rafRef.current = requestAnimationFrame(tick)
    })

    return () => {
      cancelAnimationFrame(rafRef.current)
      engine.stop()
    }
  }, [track])

  useEffect(() => {
    function onKey(e) {
      if (e.repeat) return
      const idx = LANE_KEYS.indexOf(e.key.toLowerCase())
      if (idx >= 0) { e.preventDefault(); pressLane(idx) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [track])

  function pressLane(lane) {
    const game = gameRef.current
    const engine = engineRef.current
    if (!game || !engine || endedRef.current) return

    const now = engine.getElapsed()
    const bps = track.bpm / 60

    game.pressedLanes[lane] = true
    setTimeout(() => { if (gameRef.current) gameRef.current.pressedLanes[lane] = false }, 90)

    let best = null, bestDelta = Infinity
    for (const n of game.notes) {
      if (n.hit || n.missed || n.lane !== lane) continue
      const delta = Math.abs(now - n.beat / bps)
      if (delta < HIT_GOOD_S && delta < bestDelta) { best = n; bestDelta = delta }
    }

    if (best) {
      const perfect = bestDelta < HIT_PERFECT_S
      best.hit = true
      best.hitPerfect = perfect
      game.combo++
      const mult = Math.min(8, Math.ceil(game.combo / 10))
      game.score += (perfect ? SCORE_PERFECT : SCORE_GOOD) * mult
      game.hitFx.push({ lane, t: now, perfect })
      game.feedbackLabel = perfect ? 'PERFECT' : 'GOOD'
      game.feedbackAt = now
    }
  }

  function tick() {
    if (endedRef.current) return
    const game = gameRef.current
    const engine = engineRef.current
    const canvas = canvasRef.current
    if (!game || !engine || !canvas) return

    const t = engine.getElapsed()
    game.currentTime = t
    const bps = track.bpm / 60

    // Mark misses
    for (const n of game.notes) {
      if (!n.hit && !n.missed && t > n.beat / bps + HIT_GOOD_S) {
        n.missed = true
        game.misses++
        game.combo = 0
        game.feedbackLabel = 'MISS'
        game.feedbackAt = t
      }
    }

    // Prune old hit effects
    game.hitFx = game.hitFx.filter(fx => t - fx.t < 0.32)

    drawFrame(canvas, game)

    const trackEnd = (track.beats + 1.5) / bps
    const failed   = game.misses >= MISS_LIMITS[track.d]
    const done     = t >= trackEnd

    if (failed || done) {
      endedRef.current = true
      cancelAnimationFrame(rafRef.current)
      engine.stop()
      const total = game.notes.length
      onEnd({
        track,
        score: game.score,
        hits:  game.notes.filter(n => n.hit).length,
        misses: game.misses,
        total,
        failed,
      })
      return
    }

    rafRef.current = requestAnimationFrame(tick)
  }

  function onCanvasPointer(e) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    const relY = clientY - rect.top
    if (relY < rect.height * 0.80) return  // only in button zone
    const relX = clientX - rect.left
    const lane = Math.min(3, Math.floor(relX / rect.width * 4))
    pressLane(lane)
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
        onPointerDown={onCanvasPointer}
        onTouchStart={e => { e.preventDefault(); onCanvasPointer(e) }}
      />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function BlockHero() {
  const [screen, setScreen]    = useState('select')
  const [options, setOptions]  = useState(() => pickTracks())
  const [track, setTrack]      = useState(null)
  const [result, setResult]    = useState(null)

  function handleSelect(t) {
    setTrack(t)
    setScreen('game')
  }

  function handleGameEnd(r) {
    setResult(r)
    setScreen('results')
  }

  function handlePlayAgain() {
    setOptions(pickTracks())
    setScreen('select')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/games"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title" style={{ fontFamily: "'Courier New', monospace" }}>
            ⛏ block hero
          </span>
        </div>
        <div className="topbar-right">
          <span className="topbar-version">v1.0</span>
        </div>
      </div>

      <div style={{ flex: 1, marginTop: 32, overflow: 'hidden', background: '#04060f' }}>
        {screen === 'select'  && <SelectScreen  options={options}  onSelect={handleSelect} />}
        {screen === 'game'    && <GameScreen    track={track}      onEnd={handleGameEnd}   />}
        {screen === 'results' && <ResultsScreen result={result}    onPlayAgain={handlePlayAgain} />}
      </div>
    </div>
  )
}
