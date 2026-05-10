import { Link } from 'react-router-dom'
import Enderman from '../components/Enderman'

export default function Home() {
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
    </div>
  )
}
