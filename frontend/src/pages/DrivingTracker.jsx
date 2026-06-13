import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

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
  const [driveMs, setDriveMs]           = useState(0)
  const [waitMs, setWaitMs]             = useState(0)
  const [mode, setMode]                 = useState(null)   // 'drive' | 'wait' | null
  const [active, setActive]             = useState(false)
  const [alternations, setAlternations] = useState(0)
  const [result, setResult]             = useState(null)   // { driveMs, waitMs, alternations }
  const segStart                        = useRef(null)
  const [, setTick]                     = useState(0)

  // tick to refresh the live timer while a ride is active
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setTick(t => t + 1), 200)
    return () => clearInterval(id)
  }, [active])

  // commit the elapsed time of the current segment into its accumulator
  function flush() {
    if (!active || !mode || segStart.current == null) return
    const elapsed = Date.now() - segStart.current
    if (mode === 'drive') setDriveMs(d => d + elapsed)
    else                  setWaitMs(w => w + elapsed)
    segStart.current = Date.now()
  }

  function start() {
    setDriveMs(0)
    setWaitMs(0)
    setAlternations(0)
    setResult(null)
    setMode('drive')          // a new ride always starts in drive mode
    setActive(true)
    segStart.current = Date.now()
  }

  function switchMode(next) {
    if (!active) return
    flush()
    if (mode !== next) setAlternations(a => a + 1)
    setMode(next)
  }

  function stop() {
    if (!active) return
    const elapsed = segStart.current != null ? Date.now() - segStart.current : 0
    const finalDrive = driveMs + (mode === 'drive' ? elapsed : 0)
    const finalWait  = waitMs  + (mode === 'wait'  ? elapsed : 0)
    setDriveMs(finalDrive)
    setWaitMs(finalWait)
    setResult({ driveMs: finalDrive, waitMs: finalWait, alternations })
    setActive(false)
    setMode(null)
    segStart.current = null
  }

  // live values (committed accumulator + the running segment)
  const running = active && segStart.current != null
  const liveDrive = driveMs + (running && mode === 'drive' ? Date.now() - segStart.current : 0)
  const liveWait  = waitMs  + (running && mode === 'wait'  ? Date.now() - segStart.current : 0)

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
          <span className="topbar-version">v1.0</span>
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
