import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { cal } from '../api'

// ── Helpers ────────────────────────────────────────────────────
// Format a yyyy-mm-dd string as dd.mm.yyyy without creating a Date object
function fmtIsoDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}.${m}.${y}`
}

// ── Constants ──────────────────────────────────────────────────
const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const COLORS   = ['#4a9eff','#e74c3c','#2ecc71','#f1c40f','#9b59b6','#e67e22','#1abc9c','#e91e63']
const COUNTRIES = ['DE','AT','US','GB','FR','CN','JP']
const COUNTRY_LABEL = { DE:'Bavaria', AT:'Austria', US:'USA', GB:'UK', FR:'France', CN:'China', JP:'Japan' }

// Tinted backgrounds and dot colors for each country's holidays
const HOLIDAY_BG = {
  DE: 'rgba(255,200,0,0.22)',
  AT: 'rgba(210,40,40,0.22)',
  US: 'rgba(40,80,210,0.22)',
  GB: 'rgba(210,40,110,0.22)',
  FR: 'rgba(130,40,210,0.22)',
  CN: 'rgba(210,90,15,0.22)',
  JP: 'rgba(15,170,90,0.22)',
}
const HOLIDAY_DOT = {
  DE: '#c8960a',
  AT: '#c42828',
  US: '#2850d2',
  GB: '#c2286e',
  FR: '#7828c8',
  CN: '#c85a0f',
  JP: '#0faa5a',
}

// ── Holiday computation ────────────────────────────────────────
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day   = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

// n=1 → first, n=-1 → last occurrence of weekday (0=Sun) in month (0-indexed)
function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const d = new Date(year, month, 1)
    let count = 0
    while (d.getMonth() === month) {
      if (d.getDay() === weekday && ++count === n) return new Date(d)
      d.setDate(d.getDate() + 1)
    }
  } else {
    const d = new Date(year, month + 1, 0)
    while (d.getMonth() === month) {
      if (d.getDay() === weekday) return new Date(d)
      d.setDate(d.getDate() - 1)
    }
  }
  return null
}

function fmtKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function fixedKey(year, month, day) {
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}

function easterKey(e, offset) {
  const d = new Date(e)
  d.setDate(d.getDate() + offset)
  return fmtKey(d)
}

// Returns Map<"YYYY-MM-DD", [{name, country}]>
function getHolidays(years, countries) {
  const map = new Map()
  function add(key, name, country) {
    if (!map.has(key)) map.set(key, [])
    map.get(key).push({ name, country })
  }

  for (const year of years) {
    const e = easter(year)

    if (countries.includes('DE')) {
      add(fixedKey(year,1,1),  'Neujahr', 'DE')
      add(fixedKey(year,1,6),  'Heilige Drei Könige', 'DE')
      add(easterKey(e,-2),     'Karfreitag', 'DE')
      add(fmtKey(e),           'Ostersonntag', 'DE')
      add(easterKey(e,1),      'Ostermontag', 'DE')
      add(fixedKey(year,5,1),  'Tag der Arbeit', 'DE')
      add(easterKey(e,39),     'Christi Himmelfahrt', 'DE')
      add(easterKey(e,49),     'Pfingstsonntag', 'DE')
      add(easterKey(e,50),     'Pfingstmontag', 'DE')
      add(easterKey(e,60),     'Fronleichnam', 'DE')
      add(fixedKey(year,8,15), 'Mariä Himmelfahrt', 'DE')
      add(fixedKey(year,10,3), 'Tag der deutschen Einheit', 'DE')
      add(fixedKey(year,11,1), 'Allerheiligen', 'DE')
      add(fixedKey(year,12,25),'1. Weihnachtstag', 'DE')
      add(fixedKey(year,12,26),'2. Weihnachtstag', 'DE')
    }

    if (countries.includes('AT')) {
      add(fixedKey(year,1,1),  'Neujahr', 'AT')
      add(fixedKey(year,1,6),  'Heilige Drei Könige', 'AT')
      add(easterKey(e,1),      'Ostermontag', 'AT')
      add(fixedKey(year,5,1),  'Staatsfeiertag', 'AT')
      add(easterKey(e,39),     'Christi Himmelfahrt', 'AT')
      add(easterKey(e,50),     'Pfingstmontag', 'AT')
      add(easterKey(e,60),     'Fronleichnam', 'AT')
      add(fixedKey(year,8,15), 'Mariä Himmelfahrt', 'AT')
      add(fixedKey(year,10,26),'Nationalfeiertag', 'AT')
      add(fixedKey(year,11,1), 'Allerheiligen', 'AT')
      add(fixedKey(year,12,8), 'Mariä Empfängnis', 'AT')
      add(fixedKey(year,12,25),'Christtag', 'AT')
      add(fixedKey(year,12,26),'Stefanitag', 'AT')
    }

    if (countries.includes('US')) {
      add(fixedKey(year,1,1),  "New Year's Day", 'US')
      const mlk = nthWeekday(year,0,1,3);  if (mlk)  add(fmtKey(mlk),  'MLK Day', 'US')
      const pres = nthWeekday(year,1,1,3); if (pres) add(fmtKey(pres), "Presidents' Day", 'US')
      const mem = nthWeekday(year,4,1,-1); if (mem)  add(fmtKey(mem),  'Memorial Day', 'US')
      add(fixedKey(year,6,19), 'Juneteenth', 'US')
      add(fixedKey(year,7,4),  'Independence Day', 'US')
      const lab = nthWeekday(year,8,1,1);  if (lab)  add(fmtKey(lab),  'Labor Day', 'US')
      const col = nthWeekday(year,9,1,2);  if (col)  add(fmtKey(col),  'Columbus Day', 'US')
      add(fixedKey(year,11,11),'Veterans Day', 'US')
      const tg = nthWeekday(year,10,4,4); if (tg)   add(fmtKey(tg),   'Thanksgiving', 'US')
      add(fixedKey(year,12,25),'Christmas Day', 'US')
    }

    if (countries.includes('GB')) {
      add(fixedKey(year,1,1),  "New Year's Day", 'GB')
      add(easterKey(e,-2),     'Good Friday', 'GB')
      add(easterKey(e,1),      'Easter Monday', 'GB')
      const may1 = nthWeekday(year,4,1,1);  if (may1)  add(fmtKey(may1),  'Early May Bank Holiday', 'GB')
      const may2 = nthWeekday(year,4,1,-1); if (may2)  add(fmtKey(may2),  'Spring Bank Holiday', 'GB')
      const aug  = nthWeekday(year,7,1,-1); if (aug)   add(fmtKey(aug),   'Summer Bank Holiday', 'GB')
      add(fixedKey(year,12,25),'Christmas Day', 'GB')
      add(fixedKey(year,12,26),'Boxing Day', 'GB')
    }

    if (countries.includes('FR')) {
      add(fixedKey(year,1,1),  "Jour de l'an", 'FR')
      add(easterKey(e,1),      'Lundi de Pâques', 'FR')
      add(fixedKey(year,5,1),  'Fête du Travail', 'FR')
      add(fixedKey(year,5,8),  'Victoire 1945', 'FR')
      add(easterKey(e,39),     'Ascension', 'FR')
      add(easterKey(e,50),     'Lundi de Pentecôte', 'FR')
      add(fixedKey(year,7,14), 'Fête Nationale', 'FR')
      add(fixedKey(year,8,15), 'Assomption', 'FR')
      add(fixedKey(year,11,1), 'Toussaint', 'FR')
      add(fixedKey(year,11,11),'Armistice', 'FR')
      add(fixedKey(year,12,25),'Noël', 'FR')
    }

    if (countries.includes('CN')) {
      add(fixedKey(year,1,1),  'New Year', 'CN')
      add(fixedKey(year,5,1),  'Labour Day', 'CN')
      add(fixedKey(year,10,1), 'National Day', 'CN')
      add(fixedKey(year,10,2), 'National Day', 'CN')
      add(fixedKey(year,10,3), 'National Day', 'CN')
    }

    if (countries.includes('JP')) {
      add(fixedKey(year,1,1),  "New Year's Day", 'JP')
      const coa = nthWeekday(year,0,1,2);  if (coa)  add(fmtKey(coa),  'Coming of Age Day', 'JP')
      add(fixedKey(year,2,11), 'National Foundation Day', 'JP')
      add(fixedKey(year,2,23), "Emperor's Birthday", 'JP')
      add(fixedKey(year,4,29), 'Showa Day', 'JP')
      add(fixedKey(year,5,3),  'Constitution Memorial Day', 'JP')
      add(fixedKey(year,5,4),  'Greenery Day', 'JP')
      add(fixedKey(year,5,5),  "Children's Day", 'JP')
      const mar = nthWeekday(year,6,1,3);  if (mar)  add(fmtKey(mar),  'Marine Day', 'JP')
      add(fixedKey(year,8,11), 'Mountain Day', 'JP')
      const rag = nthWeekday(year,8,1,3);  if (rag)  add(fmtKey(rag),  'Respect for the Aged Day', 'JP')
      const spo = nthWeekday(year,9,1,2);  if (spo)  add(fmtKey(spo),  'Sports Day', 'JP')
      add(fixedKey(year,11,3), 'Culture Day', 'JP')
      add(fixedKey(year,11,23),'Labour Thanksgiving Day', 'JP')
    }
  }
  return map
}

// ── Date helpers ───────────────────────────────────────────────
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function parseDate(s) { return s ? new Date(s + 'T00:00:00') : null }

function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate() }

function getISOWeek(y, m, d) {
  const date = new Date(y, m, d)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7)
  const w1 = new Date(date.getFullYear(), 0, 4)
  return 1 + Math.round(((date - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7)
}

function isInRange(y, m, d, start, end) {
  const date = new Date(y, m, d)
  return date >= parseDate(start) && date <= parseDate(end)
}

function addWorkingDays(date, n) {
  const d = new Date(date)
  let added = 0
  while (added < n) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) added++
  }
  return d
}

function computeStart(form, projects) {
  const today = new Date(); today.setHours(0,0,0,0)
  if (form.startMode === 'after' && form.afterProjectId) {
    const proj = projects.find(p => p.id === Number(form.afterProjectId))
    if (proj?.end_date) {
      const d = parseDate(proj.end_date)
      d.setDate(d.getDate() + 1)
      return d
    }
  }
  const v = Math.max(0, parseInt(form.startValue) || 0)
  if (form.startUnit === 'days')   return addWorkingDays(today, v)
  if (form.startUnit === 'weeks')  { const d = new Date(today); d.setDate(d.getDate() + v * 7); return d }
  if (form.startUnit === 'months') { const d = new Date(today); d.setMonth(d.getMonth() + v); return d }
  return today
}

function computeEnd(startDate, form) {
  const v = Math.max(1, parseInt(form.durationValue) || 1)
  if (form.durationUnit === 'days')   return addWorkingDays(startDate, v)
  if (form.durationUnit === 'weeks')  { const d = new Date(startDate); d.setDate(d.getDate() + v * 7); return d }
  if (form.durationUnit === 'months') { const d = new Date(startDate); d.setMonth(d.getMonth() + v); return d }
  return startDate
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16)
  const g = parseInt(hex.slice(3,5), 16)
  const b = parseInt(hex.slice(5,7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ── Default form state ─────────────────────────────────────────
const DEFAULT_ADD = {
  name: '', color: COLORS[0],
  startMode: 'offset', startValue: 5, startUnit: 'days',
  afterProjectId: '',
  durationValue: 30, durationUnit: 'days',
}

// ── Component ──────────────────────────────────────────────────
export default function Calendar() {
  const [projects, setProjects]         = useState([])
  const [settings, setSettings]         = useState(null)
  const [showForm, setShowForm]         = useState(false)
  const [editId, setEditId]             = useState(null)
  const [form, setForm]                 = useState({ ...DEFAULT_ADD })
  const [editForm, setEditForm]         = useState({ name:'', color: COLORS[0], start_date:'', end_date:'' })
  const [showSettings, setShowSettings] = useState(false)
  const [tooltip, setTooltip]           = useState(null) // { lines, x, y, below }
  const tooltipRef                      = useRef(null)
  const todayRef                        = useRef(null)
  const formPanelRef                    = useRef(null)
  const [formPanelH, setFormPanelH]     = useState(0)

  useEffect(() => {
    cal.getProjects().then(setProjects)
    cal.getSettings().then(setSettings)
  }, [])

  useEffect(() => {
    if (settings && todayRef.current) {
      todayRef.current.scrollIntoView({ block: 'center' })
    }
  }, [settings])

  // Track fixed controls panel height so the calendar grid can be pushed down
  useEffect(() => {
    const el = formPanelRef.current
    if (!el) { setFormPanelH(0); return }
    const ro = new ResizeObserver(([entry]) => setFormPanelH(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [showForm, editId, projects])

  // Dismiss tooltip on any outside click/touch
  useEffect(() => {
    if (!tooltip) return
    const dismiss = () => setTooltip(null)
    document.addEventListener('click', dismiss)
    document.addEventListener('touchstart', dismiss)
    return () => {
      document.removeEventListener('click', dismiss)
      document.removeEventListener('touchstart', dismiss)
    }
  }, [tooltip])

  // After tooltip renders, clamp it within the viewport and reveal it
  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current) return
    const el = tooltipRef.current
    const { width } = el.getBoundingClientRect()
    const MARGIN = 8
    const vw = window.innerWidth
    const centeredLeft = tooltip.x - width / 2
    const clampedLeft  = Math.max(MARGIN, Math.min(centeredLeft, vw - width - MARGIN))
    el.style.left      = clampedLeft + 'px'
    el.style.transform = tooltip.below ? 'none' : 'translateY(-100%)'
    el.style.opacity   = '1'
  }, [tooltip])

  function openTooltip(e, lines) {
    if (!lines.length) return
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const below = rect.top < 80
    setTooltip({ lines, x: rect.left + rect.width / 2, y: below ? rect.bottom : rect.top, below })
  }

  const countries = settings?.countries || []

  // Years visible in calendar (for holiday pre-computation)
  const visibleYears = settings
    ? Array.from({ length: (settings.end_year ?? new Date().getFullYear()) - (settings.start_year ?? new Date().getFullYear()) + 2 },
        (_, i) => (settings.start_year ?? new Date().getFullYear()) + i)
    : [new Date().getFullYear()]
  const holidays = getHolidays(visibleYears, countries)

  function months() {
    if (!settings) return []
    const result = []
    let y = settings.start_year ?? new Date().getFullYear()
    let m = settings.start_month ?? new Date().getMonth()
    const ey = settings.end_year  ?? new Date().getFullYear()
    const em = settings.end_month ?? 11
    while (y < ey || (y === ey && m <= em)) {
      result.push({ y, m })
      m++; if (m > 11) { m = 0; y++ }
    }
    return result
  }

  // Live date preview for the add form
  const previewStart = computeStart(form, projects)
  const previewEnd   = computeEnd(previewStart, form)

  function setF(k, v)  { setForm(f    => ({ ...f,    [k]: v })) }
  function setEF(k, v) { setEditForm(f => ({ ...f, [k]: v })) }

  async function saveAdd(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    const p = await cal.createProject({
      name: form.name, color: form.color,
      start_date: toDateStr(previewStart),
      end_date:   toDateStr(previewEnd),
    })
    setProjects(ps => [...ps, p])
    setShowForm(false)
    setForm({ ...DEFAULT_ADD, color: COLORS[(projects.length + 1) % COLORS.length] })
  }

  async function saveEdit(e) {
    e.preventDefault()
    if (!editForm.name.trim() || !editForm.start_date || !editForm.end_date) return
    const p = await cal.updateProject(editId, editForm)
    setProjects(ps => ps.map(x => x.id === editId ? p : x))
    setEditId(null)
  }

  async function deleteProject(id) {
    await cal.deleteProject(id)
    setProjects(ps => ps.filter(p => p.id !== id))
    if (editId === id) setEditId(null)
  }

  function startEdit(p) {
    setEditForm({ name: p.name, color: p.color, start_date: p.start_date, end_date: p.end_date })
    setEditId(p.id)
    setShowForm(false)
  }

  function toMonthInput(year, month) {
    if (year == null || month == null) return ''
    return `${year}-${String(month + 1).padStart(2, '0')}`
  }

  async function updateRange(key, val) {
    if (!val) return
    const [y, m] = val.split('-')
    const patch = key === 'start'
      ? { start_year: parseInt(y), start_month: parseInt(m) - 1 }
      : { end_year:   parseInt(y), end_month:   parseInt(m) - 1 }
    const updated = await cal.updateSettings(patch)
    setSettings(updated)
  }

  async function toggleCountry(code) {
    const next = countries.includes(code)
      ? countries.filter(c => c !== code)
      : [...countries, code]
    const updated = await cal.updateSettings({ countries: next })
    setSettings(updated)
  }

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">cal</span>
        </div>
        <div className="topbar-right">
          <span className="topbar-version">v4.3</span>
          <button className="btn btn-sm" onClick={() => setShowSettings(s => !s)}>
            {showSettings ? 'close' : 'settings'}
          </button>
        </div>
      </div>
      <div className="page" style={{ maxWidth: 900 }}>

        {/* Spacer that matches the fixed controls panel height */}
        <div style={{ height: formPanelH }} />

        {/* Calendar grid */}
        {settings && months().map(({ y, m }) => {
          const days      = daysInMonth(y, m)
          const today     = new Date()
          const thisMonth = today.getFullYear() === y && today.getMonth() === m
          // Monday-first offset; build flat cell array then chunk into weeks
          const offset = (new Date(y, m, 1).getDay() + 6) % 7
          const cells  = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
          while (cells.length % 7) cells.push(null)
          const weekRows = []
          for (let i = 0; i < cells.length; i += 7) weekRows.push(cells.slice(i, i + 7))
          const DOW_HDR = ['Mo','Tu','We','Th','Fr','Sa','Su']
          const COLS    = '28px repeat(7, 1fr)'

          return (
            <div key={`${y}-${m}`} style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 11, color: '#5d7592', letterSpacing: '0.2em', marginBottom: 8, textTransform: 'uppercase' }}>
                {MONTHS[m]} {y}
              </div>
              {/* Day-of-week header — blank CW cell + Mo…Su */}
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 2, marginBottom: 2 }}>
                <div />
                {DOW_HDR.map(d => (
                  <div key={d} style={{ textAlign: 'center', fontSize: 9, color: '#374d66', letterSpacing: '0.05em', padding: '2px 0' }}>
                    {d}
                  </div>
                ))}
              </div>
              {weekRows.map((week, wi) => {
                const firstDay = week.find(d => d !== null)
                const cw = firstDay != null ? getISOWeek(y, m, firstDay) : null
                return (
                  <div key={wi} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 2, marginBottom: 2 }}>
                    {/* CW label */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 8, color: '#374d66', letterSpacing: '0.03em' }}>
                      {cw}
                    </div>
                    {week.map((d, di) => {
                      if (d === null) return <div key={`blank-${wi}-${di}`} style={{ aspectRatio: '1' }} />
                      const isToday   = thisMonth && today.getDate() === d
                      const dateKey   = fixedKey(y, m + 1, d)
                      const dayHols   = holidays.get(dateKey) || []
                      const dayProjs  = projects.filter(p => isInRange(y, m, d, p.start_date, p.end_date))
                      const holBg     = dayHols[0] ? HOLIDAY_BG[dayHols[0].country] : null
                      const tipLines  = [
                        ...dayHols.map(h => `${h.name} (${h.country})`),
                        ...dayProjs.map(p => p.name),
                      ]
                      return (
                        <div key={d}
                          ref={isToday ? todayRef : null}
                          onMouseEnter={e => openTooltip(e, tipLines)}
                          onMouseLeave={() => setTooltip(null)}
                          onClick={e => openTooltip(e, tipLines)}
                          style={{
                            aspectRatio: '1',
                            background: holBg || '#0d1221',
                            border: isToday ? '1px solid #8855ff' : '1px solid #1a2840',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, position: 'relative',
                            color: isToday ? '#8855ff' : dayHols.length ? '#9ab0d0' : '#374d66',
                          }}>
                          {dayProjs.map(p => (
                            <div key={p.id} style={{
                              position: 'absolute', inset: 0,
                              background: hexToRgba(p.color, 0.35),
                              pointerEvents: 'none',
                            }} />
                          ))}
                          <span style={{ position: 'relative', zIndex: 1 }}>{d}</span>
                          {dayHols.length > 0 && (
                            <span style={{
                              position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)',
                              width: 3, height: 3, borderRadius: '50%',
                              background: HOLIDAY_DOT[dayHols[0].country] || '#aaa',
                              zIndex: 1,
                            }} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}

              {/* Projects active this month */}
              {projects.filter(p => {
                const s = parseDate(p.start_date), en = parseDate(p.end_date)
                return s <= new Date(y, m + 1, 0) && en >= new Date(y, m, 1)
              }).map(p => (
                <div key={p.id} style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9ab0d0' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.color }} />
                  {p.name}
                  <span style={{ color: '#374d66' }}>{fmtIsoDate(p.start_date)} → {fmtIsoDate(p.end_date)}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* Settings overlay — fixed below topbar, overlays the calendar */}
      {showSettings && (
        <div style={{
          position: 'fixed', top: 32, left: 0, right: 0, zIndex: 40,
          background: '#07091a', borderBottom: '1px solid #1a2840',
          maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
        }}>
          <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 16px' }}>
            <div style={{ fontSize: 11, color: '#9ab0d0', marginBottom: 8, letterSpacing: '0.08em' }}>RANGE</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <div>
                <label className="label">from</label>
                <input type="month" lang="en" className="input"
                  value={toMonthInput(settings?.start_year, settings?.start_month)}
                  onChange={e => updateRange('start', e.target.value)} />
              </div>
              <div>
                <label className="label">to</label>
                <input type="month" lang="en" className="input"
                  value={toMonthInput(settings?.end_year, settings?.end_month)}
                  onChange={e => updateRange('end', e.target.value)} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#9ab0d0', marginBottom: 8, letterSpacing: '0.08em' }}>HOLIDAYS</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {COUNTRIES.map(code => (
                <button key={code} type="button" className="btn btn-sm"
                  style={{ borderColor: countries.includes(code) ? '#4d6fa0' : '#1a2840',
                           color:       countries.includes(code) ? '#eef2ff' : '#5d7592' }}
                  onClick={() => toggleCountry(code)}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                    background: HOLIDAY_DOT[code], marginRight: 5 }} />
                  {code}
                  <span style={{ marginLeft: 4, fontSize: 10, color: '#374d66' }}>{COUNTRY_LABEL[code]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Fixed controls panel — chips, add button, and forms always in view */}
      <div ref={formPanelRef} style={{
        position: 'fixed', top: 32, left: 0, right: 0, zIndex: 30,
        background: '#07091a', borderBottom: '1px solid #1a2840',
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '10px 16px' }}>
          {/* Project chips + add button */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: (showForm || editId) ? 10 : 0 }}>
            {projects.map(p => (
              <span key={p.id} onClick={() => startEdit(p)}
                style={{ display: 'flex', alignItems: 'center', gap: 6,
                  background: editId === p.id ? '#1a2840' : '#0d1221',
                  border: `1px solid ${editId === p.id ? '#2a3d5c' : '#1a2840'}`,
                  padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: '#ccc' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
                {p.name}
              </span>
            ))}
            <button className="btn btn-sm" onClick={() => {
              setShowForm(s => !s); setEditId(null)
              setForm({ ...DEFAULT_ADD, color: COLORS[projects.length % COLORS.length] })
            }}>+ add</button>
          </div>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {showForm && !editId && (
              <form onSubmit={saveAdd} className="card" style={{ marginBottom: 0 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
                  <div style={{ flex: '1 1 160px' }}>
                    <label className="label">name</label>
                    <input className="input" value={form.name} onChange={e => setF('name', e.target.value)} placeholder="Project name" autoFocus />
                  </div>
                  <div>
                    <label className="label">color</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {COLORS.map(c => (
                        <button key={c} type="button" onClick={() => setF('color', c)}
                          style={{ width: 20, height: 20, background: c, borderRadius: 2,
                                   border: form.color === c ? '2px solid #fff' : '2px solid transparent' }} />
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label className="label">start</label>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    {projects.length > 0 && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#9ab0d0' }}>
                        <input type="radio" checked={form.startMode === 'after'} onChange={() => setF('startMode', 'after')} />
                        after
                        <select className="input" style={{ width: 'auto', padding: '2px 6px', fontSize: 12 }}
                          value={form.afterProjectId}
                          onChange={e => { setF('afterProjectId', e.target.value); setF('startMode', 'after') }}>
                          <option value="">select…</option>
                          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </label>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#9ab0d0' }}>
                      <input type="radio" checked={form.startMode === 'offset'} onChange={() => setF('startMode', 'offset')} />
                      in
                      <input type="number" min="0" className="input" style={{ width: 52, padding: '2px 6px', fontSize: 12 }}
                        value={form.startValue}
                        onChange={e => { setF('startValue', e.target.value); setF('startMode', 'offset') }} />
                      <select className="input" style={{ width: 'auto', padding: '2px 6px', fontSize: 12 }}
                        value={form.startUnit}
                        onChange={e => { setF('startUnit', e.target.value); setF('startMode', 'offset') }}>
                        <option value="days">working days</option>
                        <option value="weeks">weeks</option>
                        <option value="months">months</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="label">stop after</label>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <input type="number" min="1" className="input" style={{ width: 52, padding: '2px 6px', fontSize: 12 }}
                      value={form.durationValue} onChange={e => setF('durationValue', e.target.value)} />
                    <select className="input" style={{ width: 'auto', padding: '2px 6px', fontSize: 12 }}
                      value={form.durationUnit} onChange={e => setF('durationUnit', e.target.value)}>
                      <option value="days">working days</option>
                      <option value="weeks">weeks</option>
                      <option value="months">months</option>
                    </select>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#5d7592', marginBottom: 12 }}>
                  {toDateStr(previewStart)} → {toDateStr(previewEnd)}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary btn-sm">save</button>
                  <button type="button" className="btn btn-sm" onClick={() => setShowForm(false)}>cancel</button>
                </div>
              </form>
            )}
            {editId && (
              <form onSubmit={saveEdit} className="card" style={{ marginBottom: 0 }}>
                <div style={{ marginBottom: 10 }}>
                  <label className="label">name</label>
                  <input className="input" value={editForm.name} onChange={e => setEF('name', e.target.value)} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div>
                    <label className="label">start</label>
                    <input className="input" type="date" value={editForm.start_date} onChange={e => setEF('start_date', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">end</label>
                    <input className="input" type="date" value={editForm.end_date} onChange={e => setEF('end_date', e.target.value)} />
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="label">color</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setEF('color', c)}
                        style={{ width: 20, height: 20, background: c, borderRadius: 2,
                                 border: editForm.color === c ? '2px solid #fff' : '2px solid transparent' }} />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary btn-sm">save</button>
                  <button type="button" className="btn btn-sm" onClick={() => setEditId(null)}>cancel</button>
                  <button type="button" className="btn btn-danger btn-sm" style={{ marginLeft: 'auto' }}
                    onClick={() => deleteProject(editId)}>delete</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {tooltip && (
        <div ref={tooltipRef} style={{
          position: 'fixed',
          left: tooltip.x,
          top: tooltip.below ? tooltip.y + 6 : tooltip.y - 6,
          transform: tooltip.below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
          background: '#0d1221',
          border: '1px solid #2a3d5c',
          padding: '6px 10px',
          fontSize: 11,
          color: '#9ab0d0',
          zIndex: 200,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          lineHeight: 1.8,
          opacity: 0,
        }}>
          {tooltip.lines.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </div>
  )
}
