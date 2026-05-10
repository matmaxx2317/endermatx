import { Link } from 'react-router-dom'
import Enderman from '../components/Enderman'

const TOOLS = [
  { path: '/tts', label: '01', name: 'tts', desc: 'time tracker' },
  { path: '/cal', label: '02', name: 'cal', desc: 'calendar' },
  { path: '/pom', label: '03', name: 'pom', desc: 'pomodoro' },
  { path: '/mtg', label: '04', name: 'mtg', desc: 'meeting notes' },
  { path: '/idx', label: '05', name: 'idx', desc: 'idea inbox' },
]

export default function Productivity() {
  return (
    <div className="landing-page">
      <Enderman />
      <header className="landing-header">
        <h1 className="landing-title">END<br />ERM<br />ATX</h1>
        <p className="landing-sub">tools</p>
      </header>
      <nav className="landing-grid">
        <Link to="/" className="nav-card">
          <div className="nav-card-label">←</div>
          <div className="nav-card-name">back</div>
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
