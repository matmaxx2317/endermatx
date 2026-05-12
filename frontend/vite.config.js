import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

let gitHash = 'unknown'
let gitHashFull = 'unknown'
try {
  gitHash     = execSync('git rev-parse --short HEAD').toString().trim()
  gitHashFull = execSync('git rev-parse HEAD').toString().trim()
} catch {}

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'))

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
