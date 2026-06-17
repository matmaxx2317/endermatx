import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import ThemeToggle from './components/ThemeToggle'
import BackToTop from './components/BackToTop'
import { isWmtOnlyDomain } from './domain'
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
import DrivingTracker from './pages/DrivingTracker'
import BlockHero from './pages/BlockHero'
import Wmt from './pages/Wmt'

export default function App() {
  const wmtOnly = isWmtOnlyDomain()

  return (
    <ThemeProvider>
      <ThemeToggle />
      <BackToTop />
      <BrowserRouter>
        <Routes>
          {wmtOnly ? (
            <Route path="*" element={<Wmt />} />
          ) : (
            <>
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
              <Route path="/drv" element={<DrivingTracker />} />
              <Route path="/block-hero" element={<BlockHero />} />
              <Route path="/wmt" element={<Wmt />} />
            </>
          )}
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}
