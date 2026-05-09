import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { idx } from '../api'

const TABS = [
  { key: 'inbox',    label: 'IN',  status: 'inbox' },
  { key: 'promoted', label: 'DO',  status: 'promoted' },
  { key: 'deferred', label: 'BL',  status: 'deferred' },
]

const TRANSITIONS = {
  inbox:    [{ label: 'DO', status: 'promoted' }, { label: 'BL', status: 'deferred' }, { label: 'kill', status: 'killed' }],
  promoted: [{ label: 'DONE', status: 'done' }, { label: 'kill', status: 'killed' }],
  deferred: [{ label: 'DO', status: 'promoted' }, { label: 'kill', status: 'killed' }],
}

export default function IdeaInbox() {
  const [ideas, setIdeas] = useState([])
  const [tab, setTab] = useState('inbox')
  const [text, setText] = useState('')
  const [editId, setEditId] = useState(null)
  const [editText, setEditText] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { idx.getIdeas().then(setIdeas) }, [])

  async function addIdea(e) {
    e.preventDefault()
    if (!text.trim()) return
    const idea = await idx.createIdea({ text: text.trim() })
    setIdeas(is => [idea, ...is])
    setText('')
  }

  async function transition(id, status) {
    const idea = await idx.updateIdea(id, { status })
    setIdeas(is => is.map(i => i.id === id ? idea : i))
  }

  async function saveEdit(id) {
    if (!editText.trim()) return
    const idea = await idx.updateIdea(id, { text: editText.trim() })
    setIdeas(is => is.map(i => i.id === id ? idea : i))
    setEditId(null)
  }

  const visible = ideas.filter(i => i.status === tab)
  const counts = {}
  TABS.forEach(t => { counts[t.key] = ideas.filter(i => i.status === t.status).length })

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">idx</span>
          <span style={{ fontSize: 10, color: '#bbb', letterSpacing: '0.05em' }}>v3.0</span>
        </div>
      </div>
      <div className="page">
        <form onSubmit={addIdea} style={{ marginBottom: 20 }}>
          <input
            ref={inputRef}
            className="input"
            style={{ borderLeft: '2px solid #8855ff' }}
            placeholder="capture an idea…"
            value={text}
            onChange={e => setText(e.target.value)}
          />
        </form>

        <div className="tabs">
          {TABS.map(t => (
            <button key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label} <span style={{ fontSize: 11, color: '#555', marginLeft: 4 }}>{counts[t.key]}</span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visible.length === 0 && (
            <div style={{ color: '#444', fontSize: 13, padding: '20px 0' }}>empty</div>
          )}
          {visible.map(idea => (
            <div key={idea.id} className="card" style={{ padding: '10px 12px' }}>
              {editId === idea.id ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(idea.id); if (e.key === 'Escape') setEditId(null) }}
                    autoFocus
                  />
                  <button className="btn btn-sm btn-primary" onClick={() => saveEdit(idea.id)}>save</button>
                  <button className="btn btn-sm" onClick={() => setEditId(null)}>cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span
                    style={{ flex: 1, fontSize: 14, color: '#ddd', cursor: tab === 'inbox' ? 'pointer' : 'default' }}
                    onClick={() => { if (tab === 'inbox') { setEditId(idea.id); setEditText(idea.text) } }}
                  >
                    {idea.text}
                  </span>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {(TRANSITIONS[tab] || []).map(tr => (
                      <button key={tr.status} className="btn btn-sm"
                        style={tr.status === 'killed' ? { color: '#555', borderColor: '#222' } : {}}
                        onClick={() => transition(idea.id, tr.status)}>
                        {tr.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
