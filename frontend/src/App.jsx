import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Productivity from './pages/Productivity'
import Personal from './pages/Personal'
import Games from './pages/Games'
import TimeTracker from './pages/TimeTracker'
import Calendar from './pages/Calendar'
import IdeaInbox from './pages/IdeaInbox'
import StringTracker from './pages/StringTracker'
import BpmCounter from './pages/BpmCounter'

function VersionFooter() {
  return (
    <div className="version-footer">
      <a
        href={`https://github.com/matmaxx2317/endermatx/commit/${__GIT_HASH_FULL__}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        v{__APP_VERSION__}-{__GIT_HASH__}
      </a>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/productivity" element={<Productivity />} />
        <Route path="/personal" element={<Personal />} />
        <Route path="/games" element={<Games />} />
        <Route path="/tts" element={<TimeTracker />} />
        <Route path="/cal" element={<Calendar />} />
        <Route path="/idx" element={<IdeaInbox />} />
        <Route path="/str" element={<StringTracker />} />
        <Route path="/bpm" element={<BpmCounter />} />
      </Routes>
      <VersionFooter />
    </BrowserRouter>
  )
}
