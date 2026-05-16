import { Link } from 'react-router-dom'

const TOOLS = [
  { path: '/tts', label: '01', name: 'tts',  desc: 'time tracker' },
  { path: '/cal', label: '02', name: 'cal',  desc: 'calendar' },
  { path: '/idx', label: '03', name: 'idx',  desc: 'idea inbox' },
]

export default function Productivity() {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <Link to="/" className="landing-crumb">endermatx</Link>
        <h1 className="landing-title">productivity</h1>
      </header>
      <nav className="landing-grid">
        <Link to="/" className="nav-card">
          <div className="nav-card-label"></div>
          <div className="nav-card-name">← back</div>
          <div className="nav-card-arrow"></div>
        </Link>
        {TOOLS.map(t => (
          <Link key={t.path} to={t.path} className="nav-card">
            <div className="nav-card-label">{t.label}</div>
            <div className="nav-card-name">{t.name}</div>
            <div className="nav-card-arrow">→</div>
          </Link>
        ))}
      </nav>
    </div>
  )
}
