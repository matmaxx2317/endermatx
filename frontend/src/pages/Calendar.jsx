import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { cal } from '../api'
import VersionBadge from '../components/VersionBadge'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const COLORS = ['#4a9eff','#e74c3c','#2ecc71','#f1c40f','#9b59b6','#e67e22','#1abc9c','#e91e63']

function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate() }

function parseDate(s) { return s ? new Date(s) : null }

function isInRange(y, m, d, start, end) {
  const date = new Date(y, m, d)
  return date >= parseDate(start) && date <= parseDate(end)
}

export default function Calendar() {
  const [projects, setProjects] = useState([])
  const [settings, setSettings] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ name: '', color: COLORS[0], start_date: '', end_date: '' })

  useEffect(() => {
    cal.getProjects().then(setProjects)
    cal.getSettings().then(setSettings)
  }, [])

  function months() {
    if (!settings) return []
    const result = []
    let y = settings.start_year, m = settings.start_month
    const ey = settings.end_year, em = settings.end_month
    while (y < ey || (y === ey && m <= em)) {
      result.push({ y, m })
      m++; if (m > 11) { m = 0; y++ }
    }
    return result
  }

  async function saveProject(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.start_date || !form.end_date) return
    if (editId) {
      const p = await cal.updateProject(editId, form)
      setProjects(ps => ps.map(x => x.id === editId ? p : x))
    } else {
      const p = await cal.createProject(form)
      setProjects(ps => [...ps, p])
    }
    setShowForm(false)
    setEditId(null)
    setForm({ name: '', color: COLORS[projects.length % COLORS.length], start_date: '', end_date: '' })
  }

  async function deleteProject(id) {
    await cal.deleteProject(id)
    setProjects(ps => ps.filter(p => p.id !== id))
    if (editId === id) { setEditId(null); setShowForm(false) }
  }

  function startEdit(p) {
    setForm({ name: p.name, color: p.color, start_date: p.start_date, end_date: p.end_date })
    setEditId(p.id)
    setShowForm(true)
  }

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">cal</span>
          <VersionBadge version="v3.0" />
        </div>
      </div>
      <div className="page" style={{ maxWidth: 900 }}>
        {/* Projects list */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          {projects.map(p => (
            <span key={p.id} onClick={() => startEdit(p)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#111', border: '1px solid #222',
                padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: '#ccc' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
              {p.name}
            </span>
          ))}
          <button className="btn btn-sm" onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', color: COLORS[projects.length % COLORS.length], start_date: '', end_date: '' }) }}>+ add</button>
        </div>

        {showForm && (
          <form onSubmit={saveProject} className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 160px' }}>
                <label className="label">name</label>
                <input className="input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Project name" />
              </div>
              <div style={{ flex: '1 1 120px' }}>
                <label className="label">start</label>
                <input className="input" type="date" value={form.start_date} onChange={e => setForm(f => ({...f, start_date: e.target.value}))} />
              </div>
              <div style={{ flex: '1 1 120px' }}>
                <label className="label">end</label>
                <input className="input" type="date" value={form.end_date} onChange={e => setForm(f => ({...f, end_date: e.target.value}))} />
              </div>
              <div>
                <label className="label">color</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm(f => ({...f, color: c}))}
                      style={{ width: 20, height: 20, background: c, border: form.color === c ? '2px solid #fff' : '2px solid transparent', borderRadius: 2 }} />
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="submit" className="btn btn-primary btn-sm">save</button>
              <button type="button" className="btn btn-sm" onClick={() => { setShowForm(false); setEditId(null) }}>cancel</button>
              {editId && <button type="button" className="btn btn-danger btn-sm" style={{ marginLeft: 'auto' }} onClick={() => deleteProject(editId)}>delete</button>}
            </div>
          </form>
        )}

        {/* Calendar grid */}
        {settings && months().map(({ y, m }) => {
          const days = daysInMonth(y, m)
          const today = new Date()
          const isThisMonth = today.getFullYear() === y && today.getMonth() === m

          return (
            <div key={`${y}-${m}`} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: '#555', letterSpacing: '0.2em', marginBottom: 8 }}>
                {MONTHS[m]} {y}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {Array.from({ length: days }, (_, i) => {
                  const d = i + 1
                  const isToday = isThisMonth && today.getDate() === d
                  const projectsOnDay = projects.filter(p => isInRange(y, m, d, p.start_date, p.end_date))
                  return (
                    <div key={d} style={{
                      width: 28, height: 28,
                      background: projectsOnDay.length > 0 ? projectsOnDay[0].color + '33' : '#111',
                      border: isToday ? '1px solid #8855ff' : '1px solid #1a1a1a',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: isToday ? '#8855ff' : '#555',
                      position: 'relative',
                    }}>
                      {d}
                      {projectsOnDay.length > 1 && (
                        <span style={{ position: 'absolute', bottom: 1, right: 1, width: 4, height: 4, borderRadius: '50%', background: projectsOnDay[1].color }} />
                      )}
                    </div>
                  )
                })}
              </div>
              {projects.filter(p => {
                const start = parseDate(p.start_date)
                const end = parseDate(p.end_date)
                const monthStart = new Date(y, m, 1)
                const monthEnd = new Date(y, m + 1, 0)
                return start <= monthEnd && end >= monthStart
              }).map(p => (
                <div key={p.id} style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.color }} />
                  {p.name}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
