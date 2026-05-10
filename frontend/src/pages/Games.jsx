import { Link } from 'react-router-dom'
import Enderman from '../components/Enderman'

const GAMES = [
  { href: '/games/teleport-tap/', label: '01', name: 'teleport-tap' },
  { href: '/games/mobs-magic/', label: '02', name: 'mobs-magic' },
]

export default function Games() {
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
        {GAMES.map(g => (
          <a key={g.href} href={g.href} className="nav-card">
            <div className="nav-card-label">{g.label}</div>
            <div className="nav-card-name">{g.name}</div>
            <div className="nav-card-arrow">→</div>
          </a>
        ))}
      </nav>
    </div>
  )
}
