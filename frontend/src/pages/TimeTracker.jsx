import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { tts } from '../api'
import VersionBadge from '../components/VersionBadge'

const COLORS = [
  '#7effa0','#ff6b6b','#6bb5ff','#ffd56b','#d06bff',
  '#ff9f6b','#6bfff0','#ff6bd6','#b5ff6b','#6b7fff',
  '#c8c8c8',
]

const TABS = [
  { key: 'log',  label: 'log'  },
  { key: 'day',  label: 'day'  },
  { key: 'week', label: 'week' },
  { key: 'org',  label: 'org'  },
  { key: 'stat', label: 'stat' },
]
const TAB_KEYS = TABS.map(t => t.key)

function fmtMs(ms) {
  if (ms <= 0) ms = 0
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  if (h >= 100) return `${h}:${String(m).padStart(2,'0')}`
  return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
}

function fmtMsStat(ms) {
  return ms > 1000 ? fmtMs(ms) : '—'
}

function fmtHHMM(dt) {
  const d = new Date(dt)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function fmtCell(ms) {
  const sec = Math.round(ms / 1000)
  const r = Math.round(sec / 900) * 900
  if (r === 0) return '--'
  const h = Math.floor(r / 3600)
  const m = Math.floor((r % 3600) / 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function isToday(dt) {
  return new Date(dt).toDateString() === new Date().toDateString()
}

function isSameDay(a, b) {
  const da = new Date(a), db = new Date(b)
  return da.getFullYear() === db.getFullYear() &&
         da.getMonth()    === db.getMonth()    &&
         da.getDate()     === db.getDate()
}

function getMondayOf(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return d
}

function getISOWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7)
  const w1 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7)
}

function getISOWeekYear(date) {
  const d = new Date(date)
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7)
  return d.getFullYear()
}

// ── Modals ─────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div className="tts-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="tts-modal">
        <div className="tts-modal-head">
          <span>{title}</span>
          <button className="tts-modal-x" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function AdjustStartModal({ entry, prevEntry, isFirst, onApply, onClose }) {
  const toLocalTime = dt => {
    const d = new Date(dt)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }
  const [time, setTime] = useState(entry ? toLocalTime(entry.start_time) : '00:00')

  function apply() {
    const base = new Date()
    const [hh, mm] = time.split(':').map(Number)
    base.setHours(hh, mm, 0, 0)
    if (isNaN(base.getTime())) return
    onApply(base.toISOString())
  }

  return (
    <Modal title="adjust start time" onClose={onClose}>
      <div className="tts-modal-body">
        <label className="tts-modal-label">start time</label>
        <input
          className="input"
          type="time"
          value={time}
          onChange={e => setTime(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') apply() }}
          autoFocus
        />
        {prevEntry && (
          <div className="tts-modal-hint">previous entry end time will be adjusted to match</div>
        )}
        {isFirst && (
          <div className="tts-modal-hint">global timer start will also be adjusted</div>
        )}
      </div>
      <div className="tts-modal-foot">
        <button className="btn" onClick={onClose}>cancel</button>
        <button className="btn btn-primary" onClick={apply}>apply</button>
      </div>
    </Modal>
  )
}

function ProjectModal({ project, onSave, onClose }) {
  const [name, setName]   = useState(project?.name  || '')
  const [color, setColor] = useState(project?.color || COLORS[0])

  function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave({ name: trimmed, color })
  }

  return (
    <Modal title={project?.id ? 'edit project' : 'new project'} onClose={onClose}>
      <div className="tts-modal-body">
        <label className="tts-modal-label">name</label>
        <input
          className="input"
          placeholder="project name"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          autoFocus
        />
        <label className="tts-modal-label" style={{ marginTop: 14 }}>color</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          {COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              style={{
                width: 22, height: 22, background: c, border: 'none', borderRadius: '50%',
                cursor: 'pointer',
                outline: color === c ? '2px solid #fff' : '2px solid transparent',
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
      </div>
      <div className="tts-modal-foot">
        <button className="btn" onClick={onClose}>cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={!name.trim()}>save</button>
      </div>
    </Modal>
  )
}

// ── Today's Log ────────────────────────────────────────────────────────────────

function TodayLog({ entries, projects, onDelete }) {
  const now = Date.now()

  function getProject(pid) {
    return projects.find(p => p.id === pid) || { name: '?', color: '#666' }
  }

  const todayAll  = entries.filter(e => isToday(e.start_time))
  const active    = todayAll.find(e => !e.end_time)
  const completed = todayAll
    .filter(e => e.end_time)
    .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))

  if (!active && completed.length === 0) {
    return (
      <div style={{ color: '#444', fontSize: 12, padding: '20px 0', textAlign: 'center', letterSpacing: '0.08em' }}>
        no entries today yet
      </div>
    )
  }

  function renderEntry(e) {
    const p = getProject(e.project_id)
    const isLive = !e.end_time
    const durationMs = isLive
      ? now - new Date(e.start_time).getTime()
      : new Date(e.end_time).getTime() - new Date(e.start_time).getTime()
    return (
      <div key={e.id} className={`tts-log-entry${isLive ? ' tts-log-live' : ''}`}>
        <span className="tts-log-dot" style={{ background: p.color }} />
        <div className="tts-log-info">
          <span className="tts-log-project">{p.name}</span>
          <span className="tts-log-meta">{fmtHHMM(e.start_time)}</span>
        </div>
        <span className="tts-log-dur">{fmtMs(durationMs)}</span>
        {!isLive && (
          <button className="tts-log-del" onClick={() => onDelete(e.id)}>×</button>
        )}
      </div>
    )
  }

  return (
    <div className="tts-log">
      {active && renderEntry(active)}
      {completed.map(renderEntry)}
    </div>
  )
}

// ── Weekly Overview ────────────────────────────────────────────────────────────

function WeeklyOverview({ entries, projects }) {
  const [weekMonday, setWeekMonday] = useState(() => getMondayOf(new Date()))
  const now = Date.now()
  const today = new Date()

  const activeProjects = projects.filter(p => !p.archived)
  const cw     = getISOWeek(weekMonday)
  const cwYear = getISOWeekYear(weekMonday)

  const days = []
  for (let i = 0; i < 5; i++) {
    const d = new Date(weekMonday)
    d.setDate(d.getDate() + i)
    days.push(d)
  }

  function getDayMs(pid, dayDate) {
    return entries
      .filter(e => e.project_id === pid && isSameDay(e.start_time, dayDate))
      .reduce((acc, e) => {
        const end = e.end_time ? new Date(e.end_time).getTime() : now
        return acc + Math.max(0, end - new Date(e.start_time).getTime())
      }, 0)
  }

  function getDayBounds(dayDate) {
    const dayEntries = entries.filter(e => isSameDay(e.start_time, dayDate))
    if (!dayEntries.length) return null
    let minStart = Infinity, maxEnd = -Infinity
    dayEntries.forEach(e => {
      const s   = new Date(e.start_time).getTime()
      const end = e.end_time ? new Date(e.end_time).getTime() : now
      if (s   < minStart) minStart = s
      if (end > maxEnd)   maxEnd   = end
    })
    return { start: minStart, end: maxEnd }
  }

  function prevWeek() {
    setWeekMonday(d => { const nd = new Date(d); nd.setDate(nd.getDate() - 7); return nd })
  }
  function nextWeek() {
    setWeekMonday(d => { const nd = new Date(d); nd.setDate(nd.getDate() + 7); return nd })
  }

  const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const p2 = n => String(n).padStart(2, '0')

  const dayTotals = [0, 0, 0, 0, 0]
  let grandTotal = 0
  const projectRows = activeProjects.map(p => {
    const rowTotals = days.map(d => getDayMs(p.id, d))
    const rowTotal  = rowTotals.reduce((a, b) => a + b, 0)
    rowTotals.forEach((ms, i) => { dayTotals[i] += ms })
    grandTotal += rowTotal
    return { p, rowTotals, rowTotal }
  })

  return (
    <>
      <div className="tts-week-nav">
        <button className="btn btn-sm" onClick={prevWeek}>←</button>
        <span className="tts-week-cw">CW {cw} · {cwYear}</span>
        <button className="btn btn-sm" onClick={nextWeek}>→</button>
      </div>
      <div className="tts-week-wrap">
        <table className="tts-week-table">
          <thead>
            <tr>
              <th className="tts-wk-proj-col"></th>
              {days.map((d, i) => (
                <th key={i} className={`tts-wk-day-col${isSameDay(d, today) ? ' tts-wk-today' : ''}`}>
                  {DAY_SHORT[i]}
                  <span className="tts-wk-date">{p2(d.getDate())}.{p2(d.getMonth()+1)}</span>
                </th>
              ))}
              <th className="tts-wk-total-col">total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="tts-wk-label tts-wk-bounds-label">start · end</td>
              {days.map((d, i) => {
                const b = getDayBounds(d)
                return (
                  <td key={i} className={`tts-wk-bounds-cell${!b ? ' tts-wk-empty' : ''}`}>
                    {b ? <>{fmtHHMM(b.start)}<br />{fmtHHMM(b.end)}</> : '--'}
                  </td>
                )
              })}
              <td className="tts-wk-total-cell"></td>
            </tr>
            {projectRows.map(({ p, rowTotals, rowTotal }) => (
              <tr key={p.id}>
                <td className="tts-wk-label">
                  <span className="tts-wk-dot" style={{ background: p.color }} />
                  {p.name}
                </td>
                {rowTotals.map((ms, i) => (
                  <td key={i} className={`tts-wk-cell${ms === 0 ? ' tts-wk-empty' : ''}`}>
                    {fmtCell(ms)}
                  </td>
                ))}
                <td className="tts-wk-cell tts-wk-row-total">{fmtCell(rowTotal)}</td>
              </tr>
            ))}
            <tr className="tts-wk-total-row">
              <td className="tts-wk-label">total</td>
              {dayTotals.map((ms, i) => (
                <td key={i} className="tts-wk-cell">{fmtCell(ms)}</td>
              ))}
              <td className="tts-wk-cell tts-wk-row-total">{fmtCell(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Stats ──────────────────────────────────────────────────────────────────────

function Stats({ entries, projects }) {
  const [stackWeek, setStackWeek] = useState(() => getMondayOf(new Date()))
  const now = Date.now()
  const activeProjects = projects.filter(p => !p.archived)

  function msOf(e) {
    const end = e.end_time ? new Date(e.end_time).getTime() : now
    return Math.max(0, end - new Date(e.start_time).getTime())
  }

  function projMs(pid, filterFn) {
    return entries
      .filter(e => e.project_id === pid && (!filterFn || filterFn(e)))
      .reduce((acc, e) => acc + msOf(e), 0)
  }

  function hexRgb(hex) {
    if (!hex || hex.length < 7) return '128,128,128'
    return `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`
  }

  function fmtH(ms) {
    if (ms < 60000) return ''
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    if (h >= 10) return `${h}h`
    if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`
    return `${m}m`
  }

  // Chart 1: all-time totals, sorted desc
  const allTime = activeProjects
    .map(p => ({ p, ms: projMs(p.id) }))
    .filter(d => d.ms > 0)
    .sort((a, b) => b.ms - a.ms)

  // Chart 2: this week totals, sorted desc
  const thisMonday = getMondayOf(new Date())
  const nextMonday = new Date(thisMonday)
  nextMonday.setDate(nextMonday.getDate() + 7)
  const weekData = activeProjects
    .map(p => ({
      p,
      ms: projMs(p.id, e => {
        const s = new Date(e.start_time)
        return s >= thisMonday && s < nextMonday
      })
    }))
    .filter(d => d.ms > 0)
    .sort((a, b) => b.ms - a.ms)

  // Chart 3: horizontal stacked daily bars, week-navigable
  const stackDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(stackWeek)
    d.setDate(d.getDate() + i)
    return d
  })
  const stackRows = stackDays.map(day => {
    const segs = activeProjects
      .map(p => ({ p, ms: projMs(p.id, e => isSameDay(e.start_time, day)) }))
      .filter(s => s.ms > 0)
    return { day, segs, total: segs.reduce((a, s) => a + s.ms, 0) }
  })
  const maxDayMs = Math.max(...stackRows.map(r => r.total), 1)
  const stackCw = getISOWeek(stackWeek)
  const stackCwYear = getISOWeekYear(stackWeek)
  const p2 = n => String(n).padStart(2, '0')
  const DOW_SHORT = ['Mo','Tu','We','Th','Fr','Sa','Su']

  // Chart 4: heatmap — average ms per project per weekday
  const DOW_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const heatRows = activeProjects.map(p => {
    const msByDate = new Map()
    entries
      .filter(e => e.project_id === p.id)
      .forEach(e => {
        const ds = new Date(e.start_time).toDateString()
        msByDate.set(ds, (msByDate.get(ds) || 0) + msOf(e))
      })
    const msPerDow = [0,0,0,0,0,0,0]
    const cntPerDow = [0,0,0,0,0,0,0]
    for (const [ds, ms] of msByDate) {
      const dow = (new Date(ds).getDay() + 6) % 7
      msPerDow[dow] += ms
      cntPerDow[dow]++
    }
    const avg = msPerDow.map((ms, i) => cntPerDow[i] > 0 ? ms / cntPerDow[i] : 0)
    return { p, avg }
  }).filter(r => r.avg.some(v => v > 0))
  const heatMax = Math.max(...heatRows.flatMap(r => r.avg), 1)

  function renderVertBars(data) {
    const maxMs = Math.max(...data.map(d => d.ms), 1)
    return (
      <div className="tts-stat-vbars">
        {data.map(({ p, ms }) => (
          <div key={p.id} className="tts-stat-vbar-col">
            <div className="tts-stat-vbar-val">{fmtH(ms)}</div>
            <div className="tts-stat-vbar-track">
              <div className="tts-stat-vbar-fill" style={{ height: (ms / maxMs * 100) + '%', background: p.color }} />
            </div>
            <div className="tts-stat-vbar-name">{p.name}</div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="tts-stat">
      <div className="tts-stat-section">
        <div className="tts-stat-heading">all time</div>
        {allTime.length === 0
          ? <div className="tts-stat-empty">no data</div>
          : renderVertBars(allTime)
        }
      </div>

      <div className="tts-stat-section">
        <div className="tts-stat-heading">this week</div>
        {weekData.length === 0
          ? <div className="tts-stat-empty">no data</div>
          : renderVertBars(weekData)
        }
      </div>

      <div className="tts-stat-section">
        <div className="tts-stat-heading">daily breakdown</div>
        <div className="tts-week-nav">
          <button className="btn btn-sm" onClick={() => setStackWeek(d => { const nd = new Date(d); nd.setDate(nd.getDate() - 7); return nd })}>←</button>
          <span className="tts-week-cw">CW {stackCw} · {stackCwYear}</span>
          <button className="btn btn-sm" onClick={() => setStackWeek(d => { const nd = new Date(d); nd.setDate(nd.getDate() + 7); return nd })}>→</button>
        </div>
        <div className="tts-stat-stack">
          {stackRows.map(({ day, segs, total }) => (
            <div key={day.toDateString()} className="tts-stat-stack-row">
              <div className="tts-stat-stack-lbl">
                {DOW_SHORT[(day.getDay() + 6) % 7]}
                <span className="tts-stat-stack-date">{p2(day.getDate())}.{p2(day.getMonth() + 1)}</span>
              </div>
              <div className="tts-stat-stack-track">
                <div className="tts-stat-stack-bar" style={{ width: (total / maxDayMs * 100) + '%' }}>
                  {segs.map(s => (
                    <div key={s.p.id} style={{ flex: s.ms, background: s.p.color, opacity: 0.85 }}
                      title={`${s.p.name}: ${fmtH(s.ms)}`} />
                  ))}
                </div>
              </div>
              <div className="tts-stat-stack-total">{fmtH(total)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="tts-stat-section">
        <div className="tts-stat-heading">weekday avg</div>
        {heatRows.length === 0
          ? <div className="tts-stat-empty">no data</div>
          : (
            <div className="tts-stat-heat-wrap">
              <table className="tts-stat-heat">
                <thead>
                  <tr>
                    <th className="tts-stat-heat-phd"></th>
                    {DOW_LABELS.map(d => <th key={d} className="tts-stat-heat-dhd">{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {heatRows.map(({ p, avg }) => (
                    <tr key={p.id}>
                      <td className="tts-stat-heat-proj">
                        <span className="tts-wk-dot" style={{ background: p.color }} />
                        {p.name}
                      </td>
                      {avg.map((ms, i) => {
                        const alpha = ms > 0 ? 0.15 + 0.85 * (ms / heatMax) : 0
                        return (
                          <td key={i} className="tts-stat-heat-cell"
                            style={ms > 0 ? { background: `rgba(${hexRgb(p.color)},${alpha.toFixed(2)})` } : undefined}>
                            {fmtH(ms)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function TimeTracker() {
  const [projects, setProjects] = useState([])
  const [entries,  setEntries]  = useState([])
  const [globalStart, setGlobalStart] = useState(() => {
    const s = localStorage.getItem('tts_global_start')
    return s ? new Date(s) : null
  })
  const [tab, setTab]   = useState('log')
  const [, setTick]     = useState(0)
  const [adjustModal, setAdjustModal]   = useState(null)
  const [projectModal, setProjectModal] = useState(null)
  const [error, setError] = useState(null)
  const swipeRef = useRef({ startX: 0, startY: 0 })

  // Document-level swipe so empty space below content also triggers tab change
  useEffect(() => {
    function onStart(e) {
      swipeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY }
    }
    function onEnd(e) {
      const dx = e.changedTouches[0].clientX - swipeRef.current.startX
      const dy = e.changedTouches[0].clientY - swipeRef.current.startY
      if (Math.abs(dx) > 50 && Math.abs(dy) < 80) {
        setTab(t => {
          const i = TAB_KEYS.indexOf(t)
          if (dx < 0) return i < TAB_KEYS.length - 1 ? TAB_KEYS[i + 1] : t
          return i > 0 ? TAB_KEYS[i - 1] : t
        })
      }
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchend', onEnd)
    }
  }, [])

  useEffect(() => {
    Promise.all([tts.getProjects(), tts.getEntries()])
      .then(([ps, es]) => { setProjects(ps); setEntries(es) })
      .catch(err => setError(err.message))
  }, [])

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!localStorage.getItem('tts_global_start') && entries.some(e => !e.end_time)) {
      const todayEs = entries.filter(e => isToday(e.start_time))
      if (todayEs.length > 0) {
        const earliest = todayEs.reduce((a, b) =>
          new Date(a.start_time) < new Date(b.start_time) ? a : b
        )
        const s = new Date(earliest.start_time)
        setGlobalStart(s)
        localStorage.setItem('tts_global_start', s.toISOString())
      }
    }
  }, [entries])

  const activeEntry     = entries.find(e => !e.end_time)
  const activeProjectId = activeEntry?.project_id

  // ── Global timer controls ──────────────────────────────────────────────────

  function startGlobal() {
    const now = new Date()
    setGlobalStart(now)
    localStorage.setItem('tts_global_start', now.toISOString())
  }

  async function stopGlobal() {
    if (activeEntry) {
      try {
        const updated = await tts.updateEntry(activeEntry.id, { end_time: new Date().toISOString() })
        setEntries(es => es.map(e => e.id === updated.id ? updated : e))
      } catch (err) { setError(err.message) }
    }
    setGlobalStart(null)
    localStorage.removeItem('tts_global_start')
  }

  // ── Project card click ─────────────────────────────────────────────────────

  async function handleCardClick(pid) {
    if (!globalStart) startGlobal()

    if (pid === activeProjectId) {
      const todayEs = entries
        .filter(e => isToday(e.start_time))
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
      const idx = todayEs.findIndex(e => e.id === activeEntry.id)
      setAdjustModal({
        entry:     activeEntry,
        prevEntry: idx > 0 ? todayEs[idx - 1] : null,
        isFirst:   idx === 0,
      })
      return
    }

    const now = new Date().toISOString()
    try {
      if (activeEntry) {
        const stopped = await tts.updateEntry(activeEntry.id, { end_time: now })
        setEntries(es => es.map(e => e.id === stopped.id ? stopped : e))
      }
      const entry = await tts.createEntry({ project_id: pid, start_time: now })
      setEntries(es => [entry, ...es])
    } catch (err) { setError(err.message) }
  }

  // ── Adjust start time ──────────────────────────────────────────────────────

  async function applyAdjust(newStartIso) {
    const { entry, prevEntry, isFirst } = adjustModal
    try {
      const updated = await tts.updateEntry(entry.id, { start_time: newStartIso })
      setEntries(es => es.map(e => e.id === updated.id ? updated : e))
      if (prevEntry) {
        const prevUpd = await tts.updateEntry(prevEntry.id, { end_time: newStartIso })
        setEntries(es => es.map(e => e.id === prevUpd.id ? prevUpd : e))
      }
      if (isFirst) {
        const s = new Date(newStartIso)
        setGlobalStart(s)
        localStorage.setItem('tts_global_start', newStartIso)
      }
    } catch (err) { setError(err.message) }
    setAdjustModal(null)
  }

  // ── Project management ─────────────────────────────────────────────────────

  async function saveProject({ name, color }) {
    try {
      if (projectModal?.id) {
        const upd = await tts.updateProject(projectModal.id, { name, color })
        setProjects(ps => ps.map(p => p.id === upd.id ? upd : p))
      } else {
        const proj = await tts.createProject({ name, color })
        setProjects(ps => [...ps, proj])
      }
    } catch (err) { setError(err.message) }
    setProjectModal(null)
  }

  async function deleteOrArchive(pid) {
    const hasEntries = entries.some(e => e.project_id === pid)
    try {
      if (hasEntries) {
        const upd = await tts.updateProject(pid, { archived: true })
        setProjects(ps => ps.map(p => p.id === upd.id ? upd : p))
        if (pid === activeProjectId && activeEntry) {
          const stopped = await tts.updateEntry(activeEntry.id, { end_time: new Date().toISOString() })
          setEntries(es => es.map(e => e.id === stopped.id ? stopped : e))
        }
      } else {
        await tts.deleteProject(pid)
        setProjects(ps => ps.filter(p => p.id !== pid))
      }
    } catch (err) { setError(err.message) }
  }

  async function reactivate(pid) {
    try {
      const upd = await tts.updateProject(pid, { archived: false })
      setProjects(ps => ps.map(p => p.id === upd.id ? upd : p))
    } catch (err) { setError(err.message) }
  }

  async function deleteEntry(id) {
    try {
      await tts.deleteEntry(id)
      setEntries(es => es.filter(e => e.id !== id))
    } catch (err) { setError(err.message) }
  }

  // ── Stats helpers ──────────────────────────────────────────────────────────

  function projectStats(pid) {
    const all   = entries.filter(e => e.project_id === pid)
    const today = all.filter(e => isToday(e.start_time))
    const now   = Date.now()

    let sessionMs = 0
    if (activeEntry?.project_id === pid) {
      sessionMs = now - new Date(activeEntry.start_time).getTime()
    } else {
      const lastCompleted = today
        .filter(e => e.end_time)
        .sort((a, b) => new Date(b.end_time) - new Date(a.end_time))[0]
      if (lastCompleted) {
        sessionMs = new Date(lastCompleted.end_time).getTime()
                  - new Date(lastCompleted.start_time).getTime()
      }
    }

    const todayMs = today.reduce((acc, e) => {
      const end = e.end_time ? new Date(e.end_time) : new Date()
      return acc + Math.max(0, end - new Date(e.start_time))
    }, 0)

    const totalMs = all.reduce((acc, e) => {
      const end = e.end_time ? new Date(e.end_time) : new Date()
      return acc + Math.max(0, end - new Date(e.start_time))
    }, 0)

    return { sessionMs, todayMs, totalMs }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const activeProjects   = projects.filter(p => !p.archived)
  const archivedProjects = projects.filter(p =>  p.archived)
  const globalElapsed    = globalStart ? Date.now() - globalStart.getTime() : 0
  const activeProject    = projects.find(p => p.id === activeProjectId)

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/productivity"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">tts</span>
          <VersionBadge version="v3.8" />
        </div>
      </div>

      <div className="page">
        {error && (
          <div style={{ background: '#2a0000', border: '1px solid #f44336', color: '#f44336', fontSize: 12, padding: '8px 12px', marginBottom: 16 }}>
            {error}
            <button style={{ float: 'right', background: 'none', border: 'none', color: '#f44336', cursor: 'pointer' }} onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── log: global timer + project cards ── */}
        {tab === 'log' && (
          <>
            <div className="tts-global">
              <div className="tts-timer" style={{ color: globalStart ? '#f0f0f0' : '#2a2a2a' }}>
                {fmtMs(globalElapsed)}
              </div>
              <button
                className={`tts-toggle ${globalStart ? 'tts-stop' : 'tts-start'}`}
                onClick={globalStart ? stopGlobal : startGlobal}
              >
                {globalStart ? 'STOP' : 'START'}
              </button>
            </div>

            {activeProject && (
              <div className="tts-active-bar">
                <span className="tts-pulse" style={{ background: activeProject.color }} />
                <span style={{ color: activeProject.color, fontSize: 11, letterSpacing: '0.1em' }}>
                  {activeProject.name}
                </span>
              </div>
            )}

            {activeProjects.length > 0 ? (
              <div className="tts-cards">
                {activeProjects.map(p => {
                  const isActive = p.id === activeProjectId
                  const { sessionMs, todayMs, totalMs } = projectStats(p.id)
                  return (
                    <button
                      key={p.id}
                      className={`tts-card${isActive ? ' tts-card-on' : ''}`}
                      style={isActive ? { borderColor: p.color } : undefined}
                      onClick={() => handleCardClick(p.id)}
                    >
                      <div className="tts-card-stripe" style={{ background: p.color }} />
                      <div className="tts-card-name" style={{ color: isActive ? p.color : '#f0f0f0' }}>
                        {p.name}
                        {isActive && <span className="tts-now-badge" style={{ color: p.color }}>ACTIVE</span>}
                      </div>
                      <div className="tts-card-rows">
                        <div className="tts-card-row">
                          <span className="tts-row-lbl">session</span>
                          <span className="tts-row-val" style={{ color: isActive ? p.color : '#666' }}>
                            {fmtMsStat(sessionMs)}
                          </span>
                        </div>
                        <div className="tts-card-row">
                          <span className="tts-row-lbl">today</span>
                          <span className="tts-row-val">{fmtMsStat(todayMs)}</span>
                        </div>
                        <div className="tts-card-row">
                          <span className="tts-row-lbl">total</span>
                          <span className="tts-row-val">{fmtMsStat(totalMs)}</span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div style={{ color: '#444', fontSize: 12, padding: '20px 0', textAlign: 'center', letterSpacing: '0.08em' }}>
                no projects yet — add one in the org tab
              </div>
            )}
          </>
        )}

        {/* ── day: today's log ── */}
        {tab === 'day' && (
          <TodayLog entries={entries} projects={projects} onDelete={deleteEntry} />
        )}

        {/* ── week: weekly overview ── */}
        {tab === 'week' && (
          <WeeklyOverview entries={entries} projects={projects} />
        )}

        {/* ── org: project management ── */}
        {tab === 'org' && (
          <>
            <div className="tts-mgmt-list">
              {activeProjects.map(p => (
                <div key={p.id} className="tts-mgmt-row">
                  <span className="color-dot" style={{ background: p.color }} />
                  <button className="tts-mgmt-name" onClick={() => setProjectModal(p)}>
                    {p.name}
                  </button>
                  <button
                    className="btn btn-sm tts-del-btn"
                    onClick={() => deleteOrArchive(p.id)}
                    title={entries.some(e => e.project_id === p.id) ? 'archive' : 'delete'}
                  >
                    −
                  </button>
                </div>
              ))}
            </div>
            <button className="btn btn-sm mt8" onClick={() => setProjectModal({})}>+ add project</button>

            {archivedProjects.length > 0 && (
              <>
                <div className="section-header mt24" style={{ color: '#2a2a2a' }}>archived</div>
                <div className="tts-mgmt-list">
                  {archivedProjects.map(p => (
                    <div key={p.id} className="tts-mgmt-row" style={{ opacity: 0.4 }}>
                      <span className="color-dot" style={{ background: p.color }} />
                      <span className="tts-mgmt-name" style={{ color: '#666', cursor: 'default' }}>
                        {p.name}
                      </span>
                      <button className="btn btn-sm" onClick={() => reactivate(p.id)} title="reactivate">
                        +
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── stat: statistics ── */}
        {tab === 'stat' && (
          <Stats entries={entries} projects={projects} />
        )}
      </div>

      {adjustModal && (
        <AdjustStartModal
          entry={adjustModal.entry}
          prevEntry={adjustModal.prevEntry}
          isFirst={adjustModal.isFirst}
          onApply={applyAdjust}
          onClose={() => setAdjustModal(null)}
        />
      )}
      {projectModal !== null && (
        <ProjectModal
          project={projectModal}
          onSave={saveProject}
          onClose={() => setProjectModal(null)}
        />
      )}
    </div>
  )
}
