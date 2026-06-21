import { useState, useEffect } from 'react'
import { log } from '../api'
import { useTheme } from '../context/ThemeContext'

function fmt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// Theme-aware status colours: the bright dark-mode green/red are illegible on
// the light theme's white cards, so use darker shades there.
function resultColor(result, theme) {
  const light = theme === 'light'
  if (/^error|^exception/i.test(result)) return light ? '#c0392b' : '#ff6b6b'
  if (/^no changes$|^unknown$/i.test(result)) return 'var(--text-secondary)'
  return light ? '#1a7a3e' : '#7effa0'   // an actual update (named match(es) or count)
}

// Scheduler run log, newest first. Self-contained (fetches on mount), so it can
// be dropped into any container — currently the WMT "Update-Log" tab.
export default function UpdateLogList() {
  const { theme }         = useTheme()
  const [rows, setRows]   = useState(null)   // null = loading
  const [error, setError] = useState(null)

  useEffect(() => {
    log.list()
      .then(setRows)
      .catch(e => { setError(String(e)); setRows([]) })
  }, [])

  return (
    <div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 0, marginBottom: 16 }}>
        Scheduler-Läufe, neuester zuerst. Zeiten in lokaler Zeit.
      </p>

      {error && (
        <div style={{
          background: 'var(--error-bg)', color: '#ff6b6b', borderRadius: 8,
          padding: '8px 12px', fontSize: '0.8rem', marginBottom: 12,
        }}>{error}</div>
      )}

      {rows === null && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Lädt…</div>
      )}

      {rows !== null && rows.length === 0 && !error && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          Noch keine Einträge.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => (
            <div key={r.id} style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'baseline', gap: 12,
              }}>
                <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500 }}>
                  {fmt(r.ran_at)}
                </span>
                <span style={{ color: resultColor(r.result, theme), fontSize: '0.8rem', textAlign: 'right' }}>
                  {r.result}
                </span>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                nächster Lauf: {fmt(r.next_run_at)}
                {r.next_run_reason ? ` (${r.next_run_reason})` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
