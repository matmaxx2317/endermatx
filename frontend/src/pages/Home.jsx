import { Link } from 'react-router-dom'

const TOOLS = [
  { path: '/tts', name: 'tts', desc: 'time tracker' },
  { path: '/cal', name: 'cal', desc: 'calendar' },
  { path: '/pom', name: 'pom', desc: 'pomodoro' },
  { path: '/mtg', name: 'mtg', desc: 'meeting notes' },
  { path: '/idx', name: 'idx', desc: 'idea inbox' },
  { path: '/str', name: 'str', desc: 'string tracker' },
  { path: '/crd', name: 'crd', desc: 'chord aligner' },
]

export default function Home() {
  return (
    <div style={{ padding: '40px 20px', maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, letterSpacing: '0.15em', marginBottom: 8 }}>
        ENDERMATX
      </h1>
      <p style={{ color: '#555', fontSize: 12, marginBottom: 32 }}>personal tools</p>
      <div className="home-grid">
        {TOOLS.map(t => (
          <Link key={t.path} to={t.path} className="home-card">
            <div className="home-card-name">{t.name}</div>
            <div className="home-card-desc">{t.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
