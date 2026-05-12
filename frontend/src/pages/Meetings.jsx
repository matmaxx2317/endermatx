import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { mtg } from '../api'
import VersionBadge from '../components/VersionBadge'

function uid() { return Date.now() + Math.random().toString(36).slice(2) }

export default function Meetings() {
  const [meetings, setMeetings] = useState([])
  const [tab, setTab] = useState('meetings')
  const [openId, setOpenId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ title: '', date: '', notes: '', attendees: [], actions: [], summary: '' })
  const [newAttendee, setNewAttendee] = useState('')
  const [newAction, setNewAction] = useState('')
  const [actionsFilter, setActionsFilter] = useState('open')

  useEffect(() => { mtg.getMeetings().then(setMeetings) }, [])

  function openMeeting(m) {
    setForm({ title: m.title, date: m.date, notes: m.notes, attendees: [...m.attendees], actions: [...m.actions], summary: m.summary })
    setOpenId(m.id)
    setCreating(false)
  }

  function startCreate() {
    setForm({ title: '', date: new Date().toISOString().slice(0,10), notes: '', attendees: [], actions: [], summary: '' })
    setOpenId(null)
    setCreating(true)
  }

  async function save() {
    if (!form.title.trim()) return
    if (creating) {
      const m = await mtg.createMeeting(form)
      setMeetings(ms => [m, ...ms])
    } else {
      const m = await mtg.updateMeeting(openId, form)
      setMeetings(ms => ms.map(x => x.id === openId ? m : x))
    }
    setCreating(false)
    setOpenId(null)
  }

  async function deleteMeeting(id) {
    await mtg.deleteMeeting(id)
    setMeetings(ms => ms.filter(m => m.id !== id))
    if (openId === id) setOpenId(null)
  }

  function addAttendee() {
    if (!newAttendee.trim()) return
    setForm(f => ({ ...f, attendees: [...f.attendees, newAttendee.trim()] }))
    setNewAttendee('')
  }

  function removeAttendee(i) {
    setForm(f => ({ ...f, attendees: f.attendees.filter((_, idx) => idx !== i) }))
  }

  function addAction() {
    if (!newAction.trim()) return
    setForm(f => ({ ...f, actions: [...f.actions, { id: uid(), text: newAction.trim(), done: false }] }))
    setNewAction('')
  }

  function toggleAction(actionId) {
    setForm(f => ({ ...f, actions: f.actions.map(a => a.id === actionId ? { ...a, done: !a.done } : a) }))
  }

  async function toggleSavedAction(mid, actionId) {
    const meeting = meetings.find(m => m.id === mid)
    if (!meeting) return
    const actions = meeting.actions.map(a => a.id === actionId ? { ...a, done: !a.done } : a)
    const updated = await mtg.updateMeeting(mid, { actions })
    setMeetings(ms => ms.map(m => m.id === mid ? updated : m))
  }

  const allActions = meetings.flatMap(m =>
    (m.actions || []).map(a => ({ ...a, meetingTitle: m.title, meetingId: m.id }))
  )
  const filteredActions = actionsFilter === 'all' ? allActions
    : actionsFilter === 'open' ? allActions.filter(a => !a.done)
    : allActions.filter(a => a.done)

  const isEditing = creating || openId !== null

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">mtg</span>
          <VersionBadge version="v3.0" />
        </div>
      </div>
      <div className="page">
        <div className="tabs">
          <button className={`tab${tab === 'meetings' ? ' active' : ''}`} onClick={() => setTab('meetings')}>Meetings</button>
          <button className={`tab${tab === 'actions' ? ' active' : ''}`} onClick={() => setTab('actions')}>Actions</button>
        </div>

        {tab === 'meetings' && (
          <>
            {!isEditing && (
              <button className="btn btn-primary btn-sm" style={{ marginBottom: 16 }} onClick={startCreate}>+ new meeting</button>
            )}

            {isEditing && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="section-header">{creating ? 'new meeting' : 'edit'}</div>
                <label className="label">title</label>
                <input className="input" value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} placeholder="Meeting title" />
                <label className="label mt8">date</label>
                <input className="input" type="date" value={form.date} onChange={e => setForm(f => ({...f, date: e.target.value}))} />
                <label className="label mt8">attendees</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {form.attendees.map((a, i) => (
                    <span key={i} style={{ background: '#1a1a1a', border: '1px solid #333', padding: '2px 8px', fontSize: 12, color: '#ccc' }}>
                      {a} <button style={{ background: 'none', border: 'none', color: '#555', marginLeft: 4, cursor: 'pointer' }} onClick={() => removeAttendee(i)}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input" value={newAttendee} onChange={e => setNewAttendee(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addAttendee()} placeholder="Add attendee" />
                  <button className="btn btn-sm" onClick={addAttendee}>add</button>
                </div>
                <label className="label mt8">notes</label>
                <textarea className="textarea" rows={4} value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} />
                <label className="label mt8">action items</label>
                {form.actions.map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <input type="checkbox" checked={a.done} onChange={() => toggleAction(a.id)} />
                    <span style={{ fontSize: 13, color: a.done ? '#555' : '#ccc', textDecoration: a.done ? 'line-through' : 'none' }}>{a.text}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input className="input" value={newAction} onChange={e => setNewAction(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addAction()} placeholder="Add action item" />
                  <button className="btn btn-sm" onClick={addAction}>add</button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button className="btn btn-primary btn-sm" onClick={save}>save</button>
                  <button className="btn btn-sm" onClick={() => { setCreating(false); setOpenId(null) }}>cancel</button>
                  {!creating && <button className="btn btn-danger btn-sm" style={{ marginLeft: 'auto' }} onClick={() => deleteMeeting(openId)}>delete</button>}
                </div>
              </div>
            )}

            {meetings.map(m => (
              <div key={m.id} className="card" style={{ cursor: 'pointer' }} onClick={() => openMeeting(m)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 14, color: '#ddd' }}>{m.title}</div>
                    <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                      {m.date && <span>{m.date}</span>}
                      {m.attendees?.length > 0 && <span style={{ marginLeft: 10 }}>{m.attendees.join(', ')}</span>}
                    </div>
                  </div>
                  {m.actions?.length > 0 && (
                    <div style={{ fontSize: 11, color: '#555' }}>
                      {m.actions.filter(a => !a.done).length} open / {m.actions.filter(a => a.done).length} done
                    </div>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === 'actions' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {['open','done','all'].map(f => (
                <button key={f} className={`btn btn-sm${actionsFilter === f ? ' btn-primary' : ''}`} onClick={() => setActionsFilter(f)}>{f}</button>
              ))}
            </div>
            {filteredActions.length === 0 && <div style={{ color: '#444', fontSize: 13 }}>no actions</div>}
            {filteredActions.map((a, i) => (
              <div key={i} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px' }}>
                <input type="checkbox" checked={a.done} onChange={() => toggleSavedAction(a.meetingId, a.id)} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: a.done ? '#555' : '#ccc', textDecoration: a.done ? 'line-through' : 'none' }}>{a.text}</div>
                  <div style={{ fontSize: 11, color: '#444', marginTop: 2 }}>{a.meetingTitle}</div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
