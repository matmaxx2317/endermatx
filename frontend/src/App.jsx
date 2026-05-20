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
import SpotifyExplorer from './pages/SpotifyExplorer'
import BlockHero from './pages/BlockHero'

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
        <Route path="/spt" element={<SpotifyExplorer />} />
        <Route path="/block-hero" element={<BlockHero />} />
      </Routes>
    </BrowserRouter>
  )
}
