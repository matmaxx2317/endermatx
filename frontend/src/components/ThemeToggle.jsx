import { useState, useRef, useEffect } from 'react'
import { useTheme } from '../context/ThemeContext'

function LightbulbIcon() {
  return (
    <svg width="13" height="14" viewBox="0 0 13 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.5 1a3.2 3.2 0 0 1 2 5.7c-.38.3-.65.74-.65 1.3H5.15c0-.56-.27-1-.65-1.3A3.2 3.2 0 0 1 6.5 1z"
        stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
      <line x1="5.15" y1="8" x2="7.85" y2="8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      <line x1="5.45" y1="9.4" x2="7.55" y2="9.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      <line x1="5.9" y1="10.7" x2="7.1" y2="10.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  )
}

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div ref={ref} className="theme-toggle-wrap">
      <button
        onClick={() => setOpen(o => !o)}
        title="Toggle theme"
        className={`theme-toggle-btn${open ? ' open' : ''}`}
      >
        <LightbulbIcon />
      </button>
      {open && (
        <div className="theme-flyout">
          {['dark', 'light'].map(t => (
            <button
              key={t}
              onClick={() => { setTheme(t); setOpen(false) }}
              className={`theme-option${t === theme ? ' active' : ''}`}
            >
              <span className="theme-option-dot" />
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
