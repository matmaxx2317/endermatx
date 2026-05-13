import { Link } from 'react-router-dom'

const GAMES = [
  { href: '/games/teleport-tap/', label: '01', name: 'teleport-tap' },
  { href: '/games/mobs-magic/',   label: '02', name: 'mobs-magic' },
]

export default function Games() {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <Link to="/" className="landing-crumb">endermatx</Link>
        <h1 className="landing-title">games</h1>
      </header>
      <nav className="landing-grid">
        <Link to="/" className="nav-card">
          <div className="nav-card-label"></div>
          <div className="nav-card-name">← back</div>
          <div className="nav-card-arrow"></div>
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
