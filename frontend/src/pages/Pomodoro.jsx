import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { pom } from '../api'
import VersionBadge from '../components/VersionBadge'

const WORK_MINS = 25
const BREAK_MINS = 5

const MESSAGES = [
  "tick tock, chop chop",
  "no scrolling",
  "you said you'd focus",
  "eyes on the prize",
  "almost there",
  "this is the way",
]

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

export default function Pomodoro() {
  const [mode, setMode] = useState('idle')   // idle | work | break
  const [secsLeft, setSecsLeft] = useState(WORK_MINS * 60)
  const [cycles, setCycles] = useState(0)
  const [totalMins, setTotalMins] = useState(0)
  const [msg, setMsg] = useState(pick(MESSAGES))
  const intervalRef = useRef(null)
  const saveRef = useRef(null)

  useEffect(() => {
    pom.getState().then(s => {
      setTotalMins(s.total_mins || 0)
      if (s.timer) {
        const t = s.timer
        const elapsed = Math.floor((Date.now() - (t.savedAt || Date.now())) / 1000)
        const remaining = Math.max(0, (t.secsLeft || WORK_MINS * 60) - elapsed)
        setMode(t.state || 'idle')
        setSecsLeft(remaining)
      }
      const todayKey = new Date().toDateString()
      setCycles((s.sessions || {})[todayKey] || 0)
    })
  }, [])

  useEffect(() => {
    if (mode === 'idle') {
      clearInterval(intervalRef.current)
      return
    }
    intervalRef.current = setInterval(() => {
      setSecsLeft(s => {
        if (s <= 1) {
          handleTimerEnd()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(intervalRef.current)
  }, [mode])

  function handleTimerEnd() {
    clearInterval(intervalRef.current)
    if (mode === 'work') {
      const todayKey = new Date().toDateString()
      const newCycles = cycles + 1
      const addedMins = WORK_MINS
      setCycles(newCycles)
      setTotalMins(t => t + addedMins)
      setMode('break')
      setSecsLeft(BREAK_MINS * 60)
      setMsg(pick(MESSAGES))
      pom.updateState({
        total_mins: totalMins + addedMins,
        sessions: { [todayKey]: newCycles },
        timer: { state: 'break', secsLeft: BREAK_MINS * 60, savedAt: Date.now() },
      })
    } else {
      setMode('idle')
      setSecsLeft(WORK_MINS * 60)
      pom.updateState({ timer: null })
    }
  }

  function start() {
    setMode('work')
    setSecsLeft(WORK_MINS * 60)
    setMsg(pick(MESSAGES))
    pom.updateState({ timer: { state: 'work', secsLeft: WORK_MINS * 60, savedAt: Date.now() } })
  }

  function stop() {
    clearInterval(intervalRef.current)
    setMode('idle')
    setSecsLeft(WORK_MINS * 60)
    pom.updateState({ timer: null })
  }

  const mins = Math.floor(secsLeft / 60)
  const secs = secsLeft % 60
  const timerStr = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`

  const modeColor = mode === 'work' ? '#e74c3c' : mode === 'break' ? '#2ecc71' : '#555'

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">pom</span>
          <VersionBadge version="v3.0" />
        </div>
      </div>
      <div className="page" style={{ textAlign: 'center', paddingTop: 48 }}>
        <div style={{ fontSize: 11, color: modeColor, letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: 16 }}>
          {mode === 'idle' ? 'ready' : mode}
        </div>

        <div style={{ fontSize: 72, fontWeight: 'bold', color: modeColor, letterSpacing: '0.05em', marginBottom: 8 }}>
          {timerStr}
        </div>

        {mode !== 'idle' && (
          <div style={{ fontSize: 12, color: '#555', marginBottom: 32 }}>{msg}</div>
        )}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 32 }}>
          {mode === 'idle' ? (
            <button className="btn btn-primary" onClick={start} style={{ padding: '8px 24px', fontSize: 13 }}>start</button>
          ) : (
            <button className="btn btn-danger" onClick={stop} style={{ padding: '8px 24px', fontSize: 13 }}>stop</button>
          )}
        </div>

        <div style={{ marginTop: 64, display: 'flex', gap: 48, justifyContent: 'center' }}>
          <div>
            <div style={{ fontSize: 28, color: '#ccc' }}>{cycles}</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>today</div>
          </div>
          <div>
            <div style={{ fontSize: 28, color: '#ccc' }}>{Math.floor(totalMins)}m</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>total</div>
          </div>
        </div>
      </div>
    </div>
  )
}
