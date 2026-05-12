import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Enderman from '../components/Enderman'

function fmtDeployTime(iso) {
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function Home() {
  const [deployInfo, setDeployInfo] = useState(null)

  useEffect(() => {
    fetch('/api/info')
      .then(r => r.json())
      .then(setDeployInfo)
      .catch(() => {})
  }, [])

  const label = deployInfo?.started_at ? `deployed ${fmtDeployTime(deployInfo.started_at)}` : null
  const url   = deployInfo?.deploy_url

  return (
    <div className="landing-page">
      <Enderman />
      <header className="landing-header">
        <h1 className="landing-title">END<br />ERM<br />ATX</h1>
        <p className="landing-sub">tools</p>
      </header>
      <nav className="landing-grid">
        <Link to="/productivity" className="nav-card">
          <div className="nav-card-label">01</div>
          <div className="nav-card-name">productivity</div>
          <div className="nav-card-arrow">→</div>
        </Link>
        <Link to="/personal" className="nav-card">
          <div className="nav-card-label">02</div>
          <div className="nav-card-name">personal</div>
          <div className="nav-card-arrow">→</div>
        </Link>
        <Link to="/games" className="nav-card">
          <div className="nav-card-label">03</div>
          <div className="nav-card-name">games</div>
          <div className="nav-card-arrow">→</div>
        </Link>
      </nav>
      {label && (
        <footer className="landing-footer">
          {url
            ? <a href={url} target="_blank" rel="noopener noreferrer">{label}</a>
            : <span>{label}</span>
          }
        </footer>
      )}
    </div>
  )
}
