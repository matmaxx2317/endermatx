import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { drv } from '../api'

const DRIVE = '#2ecc71'
const WAIT  = '#e8a33d'

function fmt(ms) {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = n => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export default function DrivingTracker() {
  const [ride, setRide]     = useState(null)   // active server ride, or null
  const [result, setResult] = useState(null)   // finished-ride overlay data
  const [, setTick]         = useState(0)
  // baseline for local ticking: time we received `ride` + its segment elapsed
  const base  = useRef({ t: 0, segMs: 0 })
  const chain = useRef(Promise.resolve())       // serialises mutations in order

  // store a server ride and capture the tick baseline from it
  function apply(r) {
    setRide(r && r.active ? r : null)
    base.current = { t: Date.now(), segMs: r && r.active ? r.current_segment_ms : 0 }
  }

  async function refresh() {
    try { apply(await drv.getActive()) } catch (e) { console.error(e) }
  }

  // run a mutation serialised after any in-flight one, preserving order
  function run(fn) {
    const next = chain.current.then(fn).catch(e => console.error(e))
    chain.current = next.catch(() => {})
    return next
  }

  // resume an in-progress ride on load, and resync whenever the app returns to view
  useEffect(() => {
    refresh()
    function onVisible() { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // tick to refresh the live timer while a ride is active
  useEffect(() => {
    if (!ride?.active) return
    const id = setInterval(() => setTick(t => t + 1), 200)
    return () => clearInterval(id)
  }, [ride?.active])

  const start = () => run(async () => { setResult(null); apply(await drv.start()) })
  const switchMode = next => run(async () => { if (ride?.active) apply(await drv.setMode(next)) })
  const stop = () => run(async () => {
    const r = await drv.stop()
    setResult({ driveMs: r.drive_ms, waitMs: r.wait_ms, alternations: r.alternations })
    apply(null)
  })

  const active = !!ride?.active
  const mode = ride?.mode
  const segNow = active ? base.current.segMs + (Date.now() - base.current.t) : 0
  const liveDrive = (ride?.drive_ms ?? 0) + (active && mode === 'drive' ? segNow : 0)
  const liveWait  = (ride?.wait_ms  ?? 0) + (active && mode === 'wait'  ? segNow : 0)

  const timerBox = (label, value, accent, on) => (
    <div style={{
      width: '100%', boxSizing: 'border-box', padding: '14px 18px',
      borderRadius: 12, border: `1px solid ${on ? accent : 'var(--border)'}`,
      background: on ? `${accent}1a` : 'var(--surface)',
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      transition: 'background 0.15s, border-color 0.15s',
    }}>
      <span style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: on ? accent : 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 34, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
        lineHeight: 1, color: on ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
        {fmt(value)}
      </span>
    </div>
  )

  const bigBtn = (label, onClick, opts = {}) => {
    const { height = 64, disabled = false, accent, on = false } = opts
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          width: '100%', height, borderRadius: 14, cursor: disabled ? 'default' : 'pointer',
          fontSize: 20, fontWeight: 600, fontFamily: 'inherit',
          letterSpacing: '0.04em', textTransform: 'uppercase',
          border: `2px solid ${on ? accent : 'var(--border)'}`,
          background: on ? `${accent}26` : 'var(--surface)',
          color: disabled ? 'var(--text-dim)' : (on ? accent : 'var(--text-primary)'),
          opacity: disabled ? 0.4 : 1,
          transition: 'background 0.15s, border-color 0.15s, opacity 0.15s',
          userSelect: 'none', touchAction: 'manipulation',
        }}>
        {label}
      </button>
    )
  }

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/personal"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">drv</span>
        </div>
        <div className="topbar-right">
          <span className="topbar-version">v1.1</span>
        </div>
      </div>

      <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 24 }}>
        {/* timers */}
        {timerBox('drive', liveDrive, DRIVE, active && mode === 'drive')}
        {timerBox('wait',  liveWait,  WAIT,  active && mode === 'wait')}

        <div style={{ height: 4 }} />

        {/* buttons */}
        {bigBtn('start', start, { height: 64, disabled: active })}
        {bigBtn('wait',  () => switchMode('wait'),  { height: 128, disabled: !active, accent: WAIT,  on: active && mode === 'wait' })}
        {bigBtn('drive', () => switchMode('drive'), { height: 128, disabled: !active, accent: DRIVE, on: active && mode === 'drive' })}
        {bigBtn('stop',  stop,  { height: 64, disabled: !active })}
      </div>

      {/* end-of-ride overlay */}
      {result && (
        <div
          onClick={() => setResult(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 300, background: 'var(--overlay-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 420, background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 18, padding: '32px 28px',
              display: 'flex', flexDirection: 'column', gap: 22,
            }}>
            <div style={{ fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase',
              color: 'var(--text-muted)', textAlign: 'center' }}>ride complete</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: DRIVE }}>drive</span>
              <span style={{ fontSize: 52, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                color: 'var(--text-primary)' }}>{fmt(result.driveMs)}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: WAIT }}>wait</span>
              <span style={{ fontSize: 52, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                color: 'var(--text-primary)' }}>{fmt(result.waitMs)}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              borderTop: '1px solid var(--border)', paddingTop: 18 }}>
              <span style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase',
                color: 'var(--text-muted)' }}>alternations</span>
              <span style={{ fontSize: 34, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                color: 'var(--text-primary)' }}>{result.alternations}</span>
            </div>

            <button className="btn" onClick={() => setResult(null)}
              style={{ width: '100%', padding: '14px 0', fontSize: 15 }}>
              close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
