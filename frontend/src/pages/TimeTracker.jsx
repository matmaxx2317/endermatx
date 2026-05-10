import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { tts } from '../api'

const COLORS = ['#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c','#3498db','#9b59b6','#e91e63']

function fmtMs(ms) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
    : `${m}:${String(ss).padStart(2,'0')}`
}

function fmtDuration(start, end) {
  const ms = (end ? new Date(end) : new Date()) - new Date(start)
  return fmtMs(ms)
}

function fmtTime(dt) {
  return new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function todayEntries(entries) {
  const today = new Date().toDateString()
  return entries.filter(e => new Date(e.start_time).toDateString() === today)
}

export default function TimeTracker() {
  const [projects, setProjects] = useState([])
  const [entries, setEntries] = useState([])
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLORS[0])
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    Promise.all([tts.getProjects(), tts.getEntries()])
      .then(([ps, es]) => { setProjects(ps); setEntries(es) })
      .catch(err => setError(err.message))
  }, [])

  useEffect(() => {
    timerRef.current = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timerRef.current)
  }, [])

  const activeEntry = entries.find(e => !e.end_time)
  const activeProjectId = activeEntry?.project_id

  async function handleProjectClick(pid) {
    try {
      if (activeEntry) {
        const updated = await tts.updateEntry(activeEntry.id, { end_time: new Date().toISOString() })
        setEntries(es => es.map(e => e.id === updated.id ? updated : e))
        if (pid === activeProjectId) return
      }
      const entry = await tts.createEntry({ project_id: pid, start_time: new Date().toISOString() })
      setEntries(es => [entry, ...es])
    } catch (err) {
      setError(err.message)
    }
  }

  async function addProject(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true)
    setError(null)
    try {
      const proj = await tts.createProject({ name: newName.trim(), color: newColor })
      setProjects(ps => [...ps, proj])
      setNewName('')
      setAdding(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function archiveProject(pid) {
    try {
      await tts.updateProject(pid, { archived: true })
      setProjects(ps => ps.filter(p => p.id !== pid))
      if (activeEntry?.project_id === pid) {
        const updated = await tts.updateEntry(activeEntry.id, { end_time: new Date().toISOString() })
        setEntries(es => es.map(e => e.id === updated.id ? updated : e))
      }
    } catch (err) {
      setError(err.message)
    }
  }

  async function deleteEntry(eid) {
    try {
      await tts.deleteEntry(eid)
      setEntries(es => es.filter(e => e.id !== eid))
    } catch (err) {
      setError(err.message)
    }
  }

  const visibleProjects = projects.filter(p => !p.archived)
  const today = todayEntries(entries)

  const projectTotals = {}
  entries.forEach(e => {
    const ms = (e.end_time ? new Date(e.end_time) : new Date()) - new Date(e.start_time)
    projectTotals[e.project_id] = (projectTotals[e.project_id] || 0) + ms
  })

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/productivity"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">tts</span>
          <span style={{ fontSize: 10, color: '#bbb', letterSpacing: '0.05em' }}>v3.0</span>
        </div>
      </div>
      <div className="page">
        {error && (
          <div style={{ background: '#2a0000', border: '1px solid #f44336', color: '#f44336', fontSize: 12, padding: '8px 12px', marginBottom: 12 }}>
            {error} <button style={{ float: 'right', background: 'none', border: 'none', color: '#f44336', cursor: 'pointer' }} onClick={() => setError(null)}>×</button>
          </div>
        )}

        <div className="section-header">projects</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visibleProjects.map(p => (
            <div key={p.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
              <span className="color-dot" style={{ background: p.color }} />
              <button
                onClick={() => handleProjectClick(p.id)}
                style={{ flex: 1, background: 'none', border: 'none', color: p.id === activeProjectId ? p.color : '#ccc', textAlign: 'left', fontSize: 14, padding: 0 }}
              >
                {p.name}
                {p.id === activeProjectId && activeEntry && (
                  <span style={{ marginLeft: 10, fontSize: 12, color: p.color }}>
                    {fmtMs(Date.now() - new Date(activeEntry.start_time))}
                  </span>
                )}
              </button>
              {projectTotals[p.id] && (
                <span style={{ fontSize: 11, color: '#555' }}>{fmtMs(projectTotals[p.id])}</span>
              )}
              <button className="btn btn-sm" style={{ color: '#444', borderColor: '#222' }} onClick={() => archiveProject(p.id)}>×</button>
            </div>
          ))}
        </div>

        {adding ? (
          <form onSubmit={addProject} className="card mt8" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="project name" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
            <div style={{ display: 'flex', gap: 4 }}>
              {COLORS.map(c => (
                <button key={c} type="button" onClick={() => setNewColor(c)}
                  style={{ width: 18, height: 18, background: c, border: newColor === c ? '2px solid #fff' : '2px solid transparent', borderRadius: 2 }} />
              ))}
            </div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? '…' : 'add'}</button>
            <button type="button" className="btn btn-sm" onClick={() => { setAdding(false); setError(null) }}>cancel</button>
          </form>
        ) : (
          <button className="btn btn-sm mt8" onClick={() => setAdding(true)}>+ project</button>
        )}

        {today.length > 0 && (
          <>
            <div className="section-header mt24">today</div>
            {today.map(e => {
              const proj = projects.find(p => p.id === e.project_id)
              return (
                <div key={e.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px' }}>
                  <span className="color-dot" style={{ background: proj?.color || '#555' }} />
                  <span style={{ flex: 1, fontSize: 13, color: '#ccc' }}>{proj?.name || '—'}</span>
                  <span style={{ fontSize: 12, color: '#666' }}>{fmtTime(e.start_time)}</span>
                  <span style={{ fontSize: 12, color: '#555', minWidth: 60, textAlign: 'right' }}>
                    {fmtDuration(e.start_time, e.end_time)}
                    {!e.end_time && <span style={{ color: '#ff9800' }}> ●</span>}
                  </span>
                  {e.end_time && (
                    <button className="btn btn-sm" style={{ color: '#333', borderColor: '#1e1e1e' }} onClick={() => deleteEntry(e.id)}>×</button>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
