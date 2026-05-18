import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { idx } from '../api'

const TABS = [
  { key: 'inbox',    label: 'IN',  status: 'inbox' },
  { key: 'promoted', label: 'DO',  status: 'promoted' },
  { key: 'deferred', label: 'BL',  status: 'deferred' },
  { key: 'stats',    label: 'ST',  status: null },
]

function IdeaCard({ idea, tab, onTransition, onUpdate, editId, setEditId }) {
  const wrapRef = useRef(null)
  const cardRef = useRef(null)
  const stateRef = useRef({ tab, onTransition, ideaId: idea.id })
  const [editText, setEditText] = useState(idea.text)

  useEffect(() => {
    stateRef.current = { tab, onTransition, ideaId: idea.id }
  })

  useEffect(() => {
    const wrap = wrapRef.current
    const card = cardRef.current
    if (!wrap || !card) return

    const SWIPE_THRESHOLD = 72
    let startX, startY, direction

    function getRightLeft() {
      const t = stateRef.current.tab
      if (t === 'inbox')    return { right: 'promoted', left: 'deferred' }
      if (t === 'deferred') return { right: 'promoted', left: 'killed' }
      return { right: 'done', left: 'killed' }
    }

    function collapseAndComplete(status) {
      const h = wrap.offsetHeight
      wrap.style.height = h + 'px'
      wrap.style.overflow = 'hidden'
      wrap.offsetHeight // force reflow
      wrap.style.transition = 'height 0.15s ease'
      wrap.style.height = '0'
      setTimeout(() => stateRef.current.onTransition(stateRef.current.ideaId, status), 160)
    }

    function handleTouchStart(e) {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      direction = null
      card.style.transition = 'none'
    }

    function handleTouchMove(e) {
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (!direction) {
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) direction = 'h'
        else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) direction = 'v'
        else return
      }
      if (direction !== 'h') return
      e.preventDefault()
      card.style.transform = `translateX(${dx}px)`
      const bgRight = wrap.querySelector('.swipe-right')
      const bgLeft  = wrap.querySelector('.swipe-left')
      const progress = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1)
      if (bgRight) bgRight.style.opacity = dx > 0 ? progress : 0
      if (bgLeft)  bgLeft.style.opacity  = dx < 0 ? progress : 0
    }

    function handleTouchEnd(e) {
      if (direction !== 'h') return
      const dx = e.changedTouches[0].clientX - startX
      const bgRight = wrap.querySelector('.swipe-right')
      const bgLeft  = wrap.querySelector('.swipe-left')
      if (bgRight) bgRight.style.opacity = 0
      if (bgLeft)  bgLeft.style.opacity  = 0

      if (dx > SWIPE_THRESHOLD) {
        card.style.transition = 'transform 0.2s ease'
        card.style.transform  = 'translateX(110%)'
        setTimeout(() => collapseAndComplete(getRightLeft().right), 200)
      } else if (dx < -SWIPE_THRESHOLD) {
        card.style.transition = 'transform 0.2s ease'
        card.style.transform  = 'translateX(-110%)'
        setTimeout(() => collapseAndComplete(getRightLeft().left), 200)
      } else {
        card.style.transition = 'transform 0.25s ease'
        card.style.transform  = 'translateX(0)'
      }
    }

    wrap.addEventListener('touchstart', handleTouchStart, { passive: true })
    wrap.addEventListener('touchmove',  handleTouchMove,  { passive: false })
    wrap.addEventListener('touchend',   handleTouchEnd,   { passive: true })

    return () => {
      wrap.removeEventListener('touchstart', handleTouchStart)
      wrap.removeEventListener('touchmove',  handleTouchMove)
      wrap.removeEventListener('touchend',   handleTouchEnd)
    }
  }, [idea.id])

  function handleKill() {
    const wrap = wrapRef.current
    if (wrap) {
      wrap.style.transition = 'opacity 0.15s ease, transform 0.15s ease'
      wrap.style.opacity = '0'
      wrap.style.transform = 'translateX(10px)'
    }
    setTimeout(() => {
      const h = wrap?.offsetHeight || 0
      if (wrap) {
        wrap.style.height = h + 'px'
        wrap.style.overflow = 'hidden'
        wrap.offsetHeight
        wrap.style.transition = 'height 0.15s ease'
        wrap.style.height = '0'
      }
      setTimeout(() => onTransition(idea.id, 'killed'), 160)
    }, 150)
  }

  async function saveEdit() {
    const trimmed = editText.trim()
    setEditId(null)
    if (!trimmed || trimmed === idea.text) return
    try {
      const updated = await idx.updateIdea(idea.id, { text: trimmed })
      onUpdate(updated)
    } catch (_) {}
  }

  const leftKill = tab !== 'inbox'
  const rightLabel = tab === 'promoted' ? 'DONE' : 'DO'
  const leftLabel  = leftKill ? 'KILL' : 'BL'
  const isEditing  = editId === idea.id

  return (
    <div className="idea-wrap" ref={wrapRef}>
      <div className="swipe-bg swipe-right">{rightLabel}</div>
      <div className={`swipe-bg swipe-left${leftKill ? ' kill-swipe' : ''}`}>{leftLabel}</div>
      <div className="idea-card" ref={cardRef}>
        <div className="idea-body">
          {isEditing ? (
            <input
              className="idea-edit"
              value={editText}
              onChange={e => setEditText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  { e.preventDefault(); saveEdit() }
                if (e.key === 'Escape') { setEditId(null); setEditText(idea.text) }
              }}
              onBlur={saveEdit}
              autoFocus
            />
          ) : (
            <div
              className={`idea-text${tab === 'inbox' ? ' clickable' : ''}`}
              onClick={() => { if (tab === 'inbox') { setEditText(idea.text); setEditId(idea.id) } }}
            >
              {idea.text}
            </div>
          )}
        </div>
        {tab === 'inbox' && !isEditing && (
          <div className="idea-actions">
            <button className="act kill" onClick={handleKill}>KILL</button>
          </div>
        )}
      </div>
    </div>
  )
}

function Stats({ ideas }) {
  const total      = ideas.length
  const inCount    = ideas.filter(i => i.status === 'inbox').length
  const doCount    = ideas.filter(i => i.status === 'promoted').length
  const blCount    = ideas.filter(i => i.status === 'deferred').length
  const doneCount  = ideas.filter(i => i.status === 'done').length
  const killedCount = ideas.filter(i => i.status === 'killed').length

  if (total === 0) return (
    <div style={{ color: '#444', fontSize: 13, padding: '32px 0', textAlign: 'center', letterSpacing: '0.1em' }}>no data yet</div>
  )

  const resolved   = doneCount + killedCount
  const doneRate   = resolved > 0 ? Math.round(doneCount   / resolved * 100) : 0
  const killedRate = resolved > 0 ? Math.round(killedCount / resolved * 100) : 0

  const now = new Date()
  const dow = (now.getDay() + 6) % 7
  const curWeekStart = new Date(now)
  curWeekStart.setHours(0, 0, 0, 0)
  curWeekStart.setDate(curWeekStart.getDate() - dow)

  const weeks = []
  for (let w = 7; w >= 0; w--) {
    const ws = new Date(curWeekStart)
    ws.setDate(curWeekStart.getDate() - w * 7)
    const we = new Date(ws)
    we.setDate(ws.getDate() + 7)
    const wStart = ws.getTime()
    const wEnd   = we.getTime()
    const cnt = ideas.filter(i => {
      const ts = new Date(i.created_at).getTime()
      return ts >= wStart && ts < wEnd
    }).length
    weeks.push({ cnt, lbl: `${ws.getMonth() + 1}/${ws.getDate()}` })
  }
  const maxW = Math.max(...weeks.map(w => w.cnt)) || 1

  const dayCounts = [0, 0, 0, 0, 0, 0, 0]
  ideas.forEach(i => { dayCounts[(new Date(i.created_at).getDay() + 6) % 7]++ })
  const maxD = Math.max(...dayCounts) || 1
  const dayLabels = ['MO','TU','WE','TH','FR','SA','SU']

  function FunnelRow({ label, count, color }) {
    const pct  = Math.round(count / total * 100)
    const barW = count > 0 ? Math.max(pct, 1) : 0
    return (
      <div className="stat-funnel-row">
        <div className="stat-funnel-label">{label}</div>
        <div className="stat-funnel-wrap">
          <div className="stat-funnel-bar" style={{ width: `${barW}%`, background: color }} />
        </div>
        <div className="stat-funnel-count">{count} <span className="stat-pct">({pct}%)</span></div>
      </div>
    )
  }

  return (
    <div>
      <div className="stat-topline">
        <div className="stat-box"><div className="stat-box-val" style={{ color: '#aaa' }}>{total}</div><div className="stat-box-label">TOTAL</div></div>
        <div className="stat-box"><div className="stat-box-val" style={{ color: '#8855ff' }}>{doCount}</div><div className="stat-box-label">DO</div></div>
        <div className="stat-box"><div className="stat-box-val" style={{ color: '#44cc88' }}>{doneCount}</div><div className="stat-box-label">DONE</div></div>
        <div className="stat-box"><div className="stat-box-val" style={{ color: '#ff5555' }}>{killedCount}</div><div className="stat-box-label">KILLED</div></div>
      </div>

      <div className="stat-section">
        <div className="stat-heading">FATE OF ALL IDEAS</div>
        <FunnelRow label="DONE"   count={doneCount}   color="#44cc88" />
        <FunnelRow label="DO"     count={doCount}     color="#8855ff" />
        <FunnelRow label="BL"     count={blCount}     color="#ccaa00" />
        <FunnelRow label="IN"     count={inCount}     color="#888888" />
        <FunnelRow label="KILLED" count={killedCount} color="#ff5555" />
      </div>

      {resolved > 0 && (
        <div className="stat-section">
          <div className="stat-heading">RESOLUTION OF CLOSED IDEAS</div>
          <div className="stat-resolution">
            <div className="stat-res-item">
              <span className="stat-res-pct" style={{ color: '#44cc88' }}>{doneRate}%</span>
              <span className="stat-res-label">DONE</span>
            </div>
            <div className="stat-res-item">
              <span className="stat-res-pct" style={{ color: '#ff5555' }}>{killedRate}%</span>
              <span className="stat-res-label">KILLED</span>
            </div>
          </div>
          <div className="stat-res-bar">
            <div style={{ flex: doneRate,   background: '#44cc88' }} />
            <div style={{ flex: killedRate, background: '#ff5555' }} />
          </div>
        </div>
      )}

      <div className="stat-section">
        <div className="stat-heading">CAPTURES BY WEEK (last 8)</div>
        <div className="stat-bars">
          {weeks.map((w, i) => {
            const barH = w.cnt > 0 ? Math.max(Math.round((w.cnt / maxW) * 60), 3) : 0
            return (
              <div key={i} className="stat-bar-col">
                <div className="stat-bar-val">{w.cnt || ''}</div>
                <div className="stat-bar-out"><div className="stat-bar-in" style={{ height: barH }} /></div>
                <div className="stat-bar-date">{w.lbl}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="stat-section">
        <div className="stat-heading">CAPTURE BY DAY OF WEEK</div>
        <div className="stat-dow">
          {dayLabels.map((lbl, i) => {
            const alpha = (0.08 + (dayCounts[i] / maxD) * 0.92).toFixed(2)
            return (
              <div key={lbl} className="stat-dow-col">
                <div className="stat-dow-cell" style={{ background: `rgba(136,85,255,${alpha})` }} />
                <div className="stat-dow-label">{lbl}</div>
                <div className="stat-dow-count">{dayCounts[i]}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function IdeaInbox() {
  const [ideas, setIdeas]   = useState([])
  const [tab, setTab]       = useState('inbox')
  const [text, setText]     = useState('')
  const [editId, setEditId] = useState(null)

  useEffect(() => { idx.getIdeas().then(setIdeas).catch(() => {}) }, [])

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

  function onUpdate(updated) {
    setIdeas(is => is.map(i => i.id === updated.id ? updated : i))
  }

  const visible = ideas.filter(i => {
    const t = TABS.find(t => t.key === tab)
    return t?.status && i.status === t.status
  })

  const counts = {}
  TABS.forEach(t => {
    if (t.status) counts[t.key] = ideas.filter(i => i.status === t.status).length
  })

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/productivity"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">idx</span>
        </div>
        <div className="topbar-right">
          <span className="topbar-version">v1.0</span>
        </div>
      </div>
      <div className="page">
        <form onSubmit={addIdea} style={{ marginBottom: 20 }}>
          <input
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
              {t.label}
              {t.status && <span style={{ fontSize: 11, color: '#555', marginLeft: 4 }}>{counts[t.key]}</span>}
            </button>
          ))}
        </div>

        {tab === 'stats' ? (
          <Stats ideas={ideas} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visible.length === 0 && (
              <div style={{ color: '#444', fontSize: 13, padding: '20px 0', textAlign: 'center', letterSpacing: '0.05em' }}>empty</div>
            )}
            {visible.map(idea => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                tab={tab}
                onTransition={transition}
                onUpdate={onUpdate}
                editId={editId}
                setEditId={setEditId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
