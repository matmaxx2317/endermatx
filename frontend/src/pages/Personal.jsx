import { Link } from 'react-router-dom'

const TOOLS = [
  { path: '/str', label: '01', name: 'str', desc: 'string tracker' },
  { path: '/crd', label: '02', name: 'crd', desc: 'chord aligner' },
]

export default function Personal() {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <Link to="/" className="landing-crumb">endermatx</Link>
        <h1 className="landing-title">personal</h1>
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
