import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Enderman from '../components/Enderman'

function fmtDeployTime(iso) {
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `deployed ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

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
      <footer className="landing-footer">
        <span>
          v{__APP_VERSION__}-<a
            href={`https://github.com/matmaxx2317/endermatx/commit/${__GIT_HASH_FULL__}`}
            target="_blank"
            rel="noopener noreferrer"
          >{__GIT_HASH__}</a>
        </span>
        {deployLabel && (
          <>
            <span> · </span>
            {deployUrl
              ? <a href={deployUrl} target="_blank" rel="noopener noreferrer">{deployLabel}</a>
              : <span>{deployLabel}</span>
            }
          </>
        )}
      </footer>
    </div>
  )
}
