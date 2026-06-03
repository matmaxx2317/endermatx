import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { str } from '../api'

function daysSince(iso) {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso)) / 86400000)
}

function statusColor(days, threshold) {
  if (days === null) return '#f44336'
  if (days >= threshold) return '#f44336'
  if (days >= threshold * 0.8) return '#ff9800'
  return '#4caf50'
}

function fmtDate(iso) {
  if (!iso) return 'never'
  const d = new Date(iso)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export default function StringTracker() {
  const [guitars, setGuitars] = useState([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [threshold, setThreshold] = useState(30)
  const [expandedId, setExpandedId] = useState(null)
  // per-guitar "changed on" date value
  const [changedOnDates, setChangedOnDates] = useState({})

  // swipe-to-delete state
  const [swipeOffset, setSwipeOffset] = useState({ id: null, x: 0 })
  const touchState = useRef({ id: null, startX: 0, startY: 0, cancelled: false, swiped: false, currentX: 0 })
  const didSwipeRef = useRef(false)

  useEffect(() => { str.getGuitars().then(setGuitars) }, [])

  function getChangedOnDate(id) {
    return changedOnDates[id] ?? todayStr()
  }

  function setChangedOnDate(id, date) {
    setChangedOnDates(prev => ({ ...prev, [id]: date }))
  }

  // ── touch handlers ───────────────────────────────────────────

  function onTouchStart(e, id) {
    const t = e.touches[0]
    touchState.current = { id, startX: t.clientX, startY: t.clientY, cancelled: false, swiped: false, currentX: 0 }
    didSwipeRef.current = false
    setSwipeOffset({ id, x: 0 })
  }

  function onTouchMove(e, id) {
    const ts = touchState.current
    if (ts.id !== id || ts.cancelled) return
    const t = e.touches[0]
    const dx = t.clientX - ts.startX
    const dy = t.clientY - ts.startY
    // cancel if predominantly vertical before we commit to a horizontal swipe
    if (!ts.swiped && Math.abs(dy) > Math.abs(dx)) {
      touchState.current.cancelled = true
      setSwipeOffset({ id: null, x: 0 })
      return
    }
    if (dx < 0) {
      const newX = Math.max(dx, -100)
      touchState.current.swiped = true
      touchState.current.currentX = newX
      didSwipeRef.current = Math.abs(dx) > 10
      setSwipeOffset({ id, x: newX })
    }
  }

  function onTouchEnd(id) {
    const ts = touchState.current
    if (ts.id !== id || ts.cancelled) {
      setSwipeOffset({ id: null, x: 0 })
      return
    }
    if (ts.currentX < -80) {
      deleteGuitar(id)
    }
    touchState.current = { ...ts, id: null, currentX: 0 }
    setSwipeOffset({ id: null, x: 0 })
  }

  function handleCardClick(id) {
    if (didSwipeRef.current) {
      didSwipeRef.current = false
      return
    }
    setExpandedId(prev => prev === id ? null : id)
  }

  // ── data actions ─────────────────────────────────────────────

  async function addGuitar(e) {
    e.preventDefault()
    if (!name.trim()) return
    const g = await str.createGuitar({ name: name.trim(), threshold_days: Number(threshold) })
    setGuitars(gs => [...gs, g])
    setName('')
    setThreshold(30)
    setAdding(false)
  }

  async function recordChange(id, dateStr) {
    // noon UTC avoids date-display drift across UTC± timezones
    const changedAt = dateStr ? dateStr + 'T12:00:00' : null
    const g = await str.recordChange(id, changedAt)
    setGuitars(gs => gs.map(x => x.id === id ? g : x))
  }

  async function undoChange(id) {
    const g = await str.undoChange(id)
    setGuitars(gs => gs.map(x => x.id === id ? g : x))
  }

  async function deleteGuitar(id) {
    await str.deleteGuitar(id)
    setGuitars(gs => gs.filter(g => g.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">str</span>
        </div>
        <div className="topbar-right">
          <span className="topbar-version">v4.0</span>
        </div>
      </div>
      <div className="page">
        <div className="section-header">guitars</div>

        {guitars.map(g => {
          const days = daysSince(g.last_changed)
          const color = statusColor(days, g.threshold_days)
          // positive → days remaining; negative → days overdue; null → never changed
          const remaining = days !== null ? g.threshold_days - days : null
          const expanded = expandedId === g.id
          const swipeX = swipeOffset.id === g.id ? swipeOffset.x : 0
          const snapping = swipeOffset.id !== g.id

          return (
            <div key={g.id} style={{ position: 'relative', marginBottom: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
              {/* delete zone revealed by left swipe */}
              <div style={{
                position: 'absolute', top: 0, right: 0, bottom: 0, width: 80,
                background: '#c62828', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 12, color: '#fff', userSelect: 'none',
              }}>
                delete
              </div>

              {/* card content */}
              <div
                className="card"
                style={{
                  marginBottom: 0, border: 'none', borderRadius: 0,
                  transform: `translateX(${swipeX}px)`,
                  transition: snapping ? 'transform 0.2s ease' : 'none',
                }}
                onTouchStart={e => onTouchStart(e, g.id)}
                onTouchMove={e => onTouchMove(e, g.id)}
                onTouchEnd={() => onTouchEnd(g.id)}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                  onClick={() => handleCardClick(g.id)}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 14, color: 'var(--text-sub)' }}>{g.name}</span>
                  <span style={{ fontSize: 12, color }}>{days !== null ? `${days}d` : '—'}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 2px' }}>|</span>
                  <span style={{ fontSize: 12, color }}>{remaining !== null ? `${Math.abs(remaining)}d` : '—'}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 2px' }}>|</span>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{g.threshold_days}d</span>
                </div>

                {expanded && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--border-dark)', paddingTop: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-faintest)', marginBottom: 8 }}>
                      last changed: {fmtDate(g.last_changed)}
                    </div>
                    {g.history?.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div className="label">change history</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {[...g.history].reverse().slice(0, 10).map((h, i) => (
                            <div key={i} style={{ fontSize: 12, color: 'var(--text-faintest)' }}>{fmtDate(h)}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => recordChange(g.id, null)}>just changed</button>
                      {g.history?.length > 0 && (
                        <button className="btn btn-sm" onClick={() => undoChange(g.id)}>undo</button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="date"
                        className="input"
                        style={{ flex: 1 }}
                        value={getChangedOnDate(g.id)}
                        max={todayStr()}
                        onChange={e => setChangedOnDate(g.id, e.target.value)}
                      />
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => recordChange(g.id, getChangedOnDate(g.id))}
                      >
                        changed on
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {adding ? (
          <form onSubmit={addGuitar} className="card mt8">
            <label className="label">guitar name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Strat" autoFocus />
            <label className="label mt8">threshold (days)</label>
            <input className="input" type="number" min={1} value={threshold} onChange={e => setThreshold(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="submit" className="btn btn-primary btn-sm">add</button>
              <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>cancel</button>
            </div>
          </form>
        ) : (
          <button className="btn btn-sm mt8" onClick={() => setAdding(true)}>+ guitar</button>
        )}
      </div>
    </div>
  )
}
