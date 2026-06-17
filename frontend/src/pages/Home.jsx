import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { isUpdateLogDomain } from '../domain'

function fmtDeployTime(iso) {
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `deployed ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const CATEGORIES = [
  { to: '/productivity', label: '01', name: 'productivity' },
  { to: '/personal',    label: '02', name: 'personal' },
  { to: '/games',       label: '03', name: 'games' },
]

export default function Home() {
  const [deployInfo, setDeployInfo] = useState(null)

  useEffect(() => {
    fetch('/api/info')
      .then(r => r.json())
      .then(setDeployInfo)
      .catch(() => {})
  }, [])

  const deployLabel = deployInfo?.started_at ? fmtDeployTime(deployInfo.started_at) : null
  const deployUrl   = deployInfo?.deploy_url

  return (
    <div className="landing-page">
      <header className="landing-header">
        <h1 className="landing-title">endermatx</h1>
        <p className="landing-sub">productivity · personal · games</p>
      </header>
      <nav className="landing-grid">
        {CATEGORIES.map(c => (
          <Link key={c.to} to={c.to} className="nav-card">
            <div className="nav-card-label">{c.label}</div>
            <div className="nav-card-name">{c.name}</div>
            <div className="nav-card-arrow">→</div>
          </Link>
        ))}
      </nav>
      {deployLabel && (
        <div className="landing-deploy">
          {deployUrl
            ? <a href={deployUrl} target="_blank" rel="noopener noreferrer">{deployLabel}</a>
            : <span>{deployLabel}</span>
          }
        </div>
      )}
      {isUpdateLogDomain() && (
        <div className="landing-deploy">
          <Link to="/update-log">update log</Link>
        </div>
      )}
    </div>
  )
}
