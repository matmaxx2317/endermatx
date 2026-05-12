import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { crd } from '../api'

function distributeChords(lyrics, chordsText) {
  const words = lyrics.trim().split(/\s+/).filter(Boolean)
  const chords = chordsText.trim().split(/\s+/).filter(Boolean)
  if (!words.length || !chords.length) return []

  const result = []
  const step = words.length / chords.length
  chords.forEach((chord, i) => {
    const wordIdx = Math.round(i * step)
    result.push({ chord, wordIdx: Math.min(wordIdx, words.length - 1) })
  })
  return result
}

function renderAligned(lyrics, chords) {
  if (!lyrics.trim()) return ''
  const words = lyrics.trim().split(/\s+/)
  const chordMap = {}
  chords.forEach(c => { chordMap[c.wordIdx] = c.chord })

  const lines = []
  let chordLine = ''
  let lyricLine = ''
  let col = 0

  words.forEach((word, i) => {
    const chord = chordMap[i] || ''
    const len = Math.max(word.length, chord.length) + 1
    chordLine += (chord + ' ').padEnd(len)
    lyricLine += (word + ' ').padEnd(len)
    col += len
    if (col > 60 || i === words.length - 1) {
      lines.push(chordLine.trimEnd())
      lines.push(lyricLine.trimEnd())
      lines.push('')
      chordLine = ''
      lyricLine = ''
      col = 0
    }
  })
  return lines.join('\n')
}

export default function ChordAligner() {
  const [lyrics, setLyrics] = useState('')
  const [manualChords, setManualChords] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [aligned, setAligned] = useState('')
  const [saved, setSaved] = useState(false)
  const saveTimer = useRef(null)

  useEffect(() => {
    crd.getState().then(s => {
      setLyrics(s.lyrics || '')
      setManualChords(s.manual_chords || '')
      setMediaUrl(s.media_url || '')
      if (s.lines?.length) {
        setAligned(renderAligned(s.lyrics, s.chords || []))
      }
    })
  }, [])

  function scheduleSave(update) {
    clearTimeout(saveTimer.current)
    setSaved(false)
    saveTimer.current = setTimeout(async () => {
      await crd.updateState(update)
      setSaved(true)
    }, 1500)
  }

  function handleLyricsChange(v) {
    setLyrics(v)
    scheduleSave({ lyrics: v })
  }

  function handleChordsChange(v) {
    setManualChords(v)
    scheduleSave({ manual_chords: v })
  }

  function handleUrlChange(v) {
    setMediaUrl(v)
    scheduleSave({ media_url: v })
  }

  function autoAlign() {
    const chords = distributeChords(lyrics, manualChords)
    const output = renderAligned(lyrics, chords)
    setAligned(output)
    scheduleSave({ chords, lines: lyrics.split('\n'), manual_chords: manualChords })
  }

  return (
    <div>
      <div className="topbar">
        <div className="topbar-left">
          <Link to="/"><button className="topbar-back btn btn-sm">←</button></Link>
          <span className="topbar-title">crd</span>
        </div>
        <span style={{ fontSize: 11, color: saved ? '#4caf50' : '#555' }}>{saved ? 'saved' : '…'}</span>
      </div>
      <div className="page">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">lyrics</label>
            <textarea className="textarea" rows={12} value={lyrics} onChange={e => handleLyricsChange(e.target.value)} placeholder="Paste lyrics here…" />
          </div>
          <div>
            <label className="label">chords (space-separated)</label>
            <textarea className="textarea" rows={4} value={manualChords} onChange={e => handleChordsChange(e.target.value)} placeholder="G G C G D G C G" />
            <label className="label mt8">audio / video URL</label>
            <input className="input" value={mediaUrl} onChange={e => handleUrlChange(e.target.value)} placeholder="https://…" />
            {mediaUrl && (
              <audio controls src={mediaUrl} style={{ marginTop: 8, width: '100%' }} />
            )}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={autoAlign}>auto-align</button>
        </div>

        {aligned && (
          <div style={{ marginTop: 20 }}>
            <div className="section-header">aligned</div>
            <pre style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: 16, fontSize: 13, color: '#ccc', overflowX: 'auto', whiteSpace: 'pre' }}>
              {aligned}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
