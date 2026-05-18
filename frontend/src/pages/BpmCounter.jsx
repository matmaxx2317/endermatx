import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'

export default function BpmCounter() {
  const [taps, setTaps]   = useState([])
  const [bpm, setBpm]     = useState(null)
  const [flash, setFlash] = useState(false)
  const resetTimer        = useRef(null)
  const flashTimer        = useRef(null)

  const handleTap = useCallback(() => {
    const now = Date.now()

    setFlash(true)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(false), 80)

    setTaps(prev => {
      const last = prev[prev.length - 1]
      const next = last && now - last > 3000 ? [now] : [...prev, now]
      if (next.length >= 2) {
        const avgInterval = (next[next.length - 1] - next[0]) / (next.length - 1)
        setBpm(Math.round(60000 / avgInterval))
      }
      return next
    })

    clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => {
      setTaps([])
      setBpm(null)
    }, 3000)
  }, [])

  function reset() {
    clearTimeout(resetTimer.current)
    setTaps([])
    setBpm(null)
  }

  useEffect(() => {
    function onKey(e) {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        handleTap()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleTap])

  useEffect(() => () => {
    clearTimeout(resetTimer.current)
    clearTimeout(flashTimer.current)
  }, [])

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/personal"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">bpm</span>
        </div>
        <div className="topbar-right">
          <span className="topbar-version">v4.0</span>
        </div>
      </div>
      <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 60 }}>

        <div style={{ fontSize: 96, fontWeight: 600, lineHeight: 1, marginBottom: 6,
          color: bpm ? '#eef2ff' : '#374d66', fontVariantNumeric: 'tabular-nums' }}>
          {bpm ?? '--'}
        </div>
        <div style={{ fontSize: 11, color: '#374d66', letterSpacing: '0.2em', marginBottom: 52 }}>BPM</div>

        <button
          onPointerDown={handleTap}
          style={{
            width: '100%', height: 160, borderRadius: 16,
            background: flash ? 'rgba(77,111,160,0.2)' : '#0d1221',
            border: `2px solid ${flash ? '#4d6fa0' : '#1a2840'}`,
            color: '#9ab0d0', fontSize: 15, fontFamily: 'inherit',
            letterSpacing: '0.18em', cursor: 'pointer',
            transition: 'background 0.05s, border-color 0.05s',
            userSelect: 'none', touchAction: 'none',
          }}>
          tap
        </button>

        <div style={{ marginTop: 12, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          {taps.length > 0 && <>
            <button className="btn btn-sm" onClick={reset}
              style={{ width: '100%', padding: '10px 0' }}>
              reset · {taps.length} tap{taps.length !== 1 ? 's' : ''}
            </button>
          </>}
        </div>

        <div style={{ marginTop: 28, fontSize: 11, color: '#1a2840' }}>space bar also works</div>
      </div>
    </div>
  )
}
