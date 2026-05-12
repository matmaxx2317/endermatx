import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { str } from '../api'

function daysSince(iso) {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso)) / 86400000)
}

function statusColor(days, threshold) {
  if (days === null) return '#f44336'
  if (days >= threshold) return '#f44336'
  if (days >= Math.floor(threshold * 0.75)) return '#ff9800'
  return '#4caf50'
}

function fmtDate(iso) {
  if (!iso) return 'never'
  return new Date(iso).toLocaleDateString()
}

export default function StringTracker() {
  const [guitars, setGuitars] = useState([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [threshold, setThreshold] = useState(30)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => { str.getGuitars().then(setGuitars) }, [])

  async function addGuitar(e) {
    e.preventDefault()
    if (!name.trim()) return
    const g = await str.createGuitar({ name: name.trim(), threshold_days: Number(threshold) })
    setGuitars(gs => [...gs, g])
    setName('')
    setThreshold(30)
    setAdding(false)
  }

  async function recordChange(id) {
    const g = await str.recordChange(id)
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
      </div>
      <div className="page">
        <div className="section-header">guitars</div>

        {guitars.map(g => {
          const days = daysSince(g.last_changed)
          const color = statusColor(days, g.threshold_days)
          const expanded = expandedId === g.id
          return (
            <div key={g.id} className="card" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setExpandedId(expanded ? null : g.id)}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 14, color: '#ddd' }}>{g.name}</span>
                <span style={{ fontSize: 12, color: color }}>
                  {days === null ? 'never changed' : `${days}d ago`}
                </span>
                <span style={{ fontSize: 11, color: '#444' }}>/{g.threshold_days}d</span>
              </div>

              {expanded && (
                <div style={{ marginTop: 12, borderTop: '1px solid #1e1e1e', paddingTop: 12 }}>
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
                    last changed: {fmtDate(g.last_changed)}
                  </div>
                  {g.history?.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div className="label">change history</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {[...g.history].reverse().slice(0, 10).map((h, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#555' }}>{fmtDate(h)}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-sm btn-primary" onClick={() => recordChange(g.id)}>just changed</button>
                    {g.history?.length > 0 && (
                      <button className="btn btn-sm" onClick={() => undoChange(g.id)}>undo</button>
                    )}
                    <button className="btn btn-sm btn-danger" style={{ marginLeft: 'auto' }} onClick={() => deleteGuitar(g.id)}>delete</button>
                  </div>
                </div>
              )}
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
