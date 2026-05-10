import { Link } from 'react-router-dom'
import Enderman from '../components/Enderman'

const TOOLS = [
  { path: '/str', label: '01', name: 'str', desc: 'string tracker' },
  { path: '/crd', label: '02', name: 'crd', desc: 'chord aligner' },
]

export default function Personal() {
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
