import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { log } from '../api'

function fmt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function resultColor(result) {
  if (/^error|^exception/i.test(result)) return '#ff6b6b'
  if (/updated/i.test(result)) return '#7effa0'
  return 'var(--text-secondary)'
}

export default function UpdateLog() {
  const [rows, setRows]   = useState(null)   // null = loading
  const [error, setError] = useState(null)

  useEffect(() => {
    log.list()
      .then(setRows)
      .catch(e => { setError(String(e)); setRows([]) })
  }, [])

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">update log</span>
        </div>
        <div className="topbar-right">
          <span className="topbar-version">v1.0</span>
        </div>
      </div>

      <div className="page">
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
                  <span style={{ color: resultColor(r.result), fontSize: '0.8rem', textAlign: 'right' }}>
                    {r.result}
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                  nächster Lauf: {fmt(r.next_run_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
