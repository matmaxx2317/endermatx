import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

let gitHash = ''
let gitHashFull = ''
try {
  gitHash     = execSync('git rev-parse --short HEAD').toString().trim()
  gitHashFull = execSync('git rev-parse HEAD').toString().trim()
} catch {}

// Fallback to Railway's build-time env var when .git is unavailable
if (!gitHash && process.env.RAILWAY_GIT_COMMIT_SHA) {
  gitHashFull = process.env.RAILWAY_GIT_COMMIT_SHA
  gitHash     = gitHashFull.slice(0, 7)
}
if (!gitHash) gitHash = 'unknown'
if (!gitHashFull) gitHashFull = 'unknown'

const { version: semver } = JSON.parse(readFileSync('./package.json', 'utf8'))
const version = semver.split('.').slice(0, 2).join('.')  // "1.0" from "1.0.0"

export default defineConfig({
  plugins: [react()],
  define: {
    __GIT_HASH__:      JSON.stringify(gitHash),
    __GIT_HASH_FULL__: JSON.stringify(gitHashFull),
    __APP_VERSION__:   JSON.stringify(version),
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
