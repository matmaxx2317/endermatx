import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import TimeTracker from './pages/TimeTracker'
import Calendar from './pages/Calendar'
import Pomodoro from './pages/Pomodoro'
import Meetings from './pages/Meetings'
import IdeaInbox from './pages/IdeaInbox'
import StringTracker from './pages/StringTracker'
import ChordAligner from './pages/ChordAligner'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tts" element={<TimeTracker />} />
        <Route path="/cal" element={<Calendar />} />
        <Route path="/pom" element={<Pomodoro />} />
        <Route path="/mtg" element={<Meetings />} />
        <Route path="/idx" element={<IdeaInbox />} />
        <Route path="/str" element={<StringTracker />} />
        <Route path="/crd" element={<ChordAligner />} />
      </Routes>
    </BrowserRouter>
  )
}
