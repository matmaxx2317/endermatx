const BASE = '/api'

async function req(method, path, body) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, opts)
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
  if (res.status === 204) return null
  return res.json()
}

const get  = (path)        => req('GET',    path)
const post = (path, body)  => req('POST',   path, body)
const put  = (path, body)  => req('PUT',    path, body)
const del  = (path)        => req('DELETE', path)

// ── tts ───────────────────────────────────────────────────────
export const tts = {
  getProjects: ()            => get('/tts/projects'),
  createProject: (b)         => post('/tts/projects', b),
  updateProject: (id, b)     => put(`/tts/projects/${id}`, b),
  deleteProject: (id)        => del(`/tts/projects/${id}`),
  getEntries: (projectId)    => get('/tts/entries' + (projectId ? `?project_id=${projectId}` : '')),
  createEntry: (b)           => post('/tts/entries', b),
  updateEntry: (id, b)       => put(`/tts/entries/${id}`, b),
  deleteEntry: (id)          => del(`/tts/entries/${id}`),
}

// ── cal ───────────────────────────────────────────────────────
export const cal = {
  getProjects: ()            => get('/cal/projects'),
  createProject: (b)         => post('/cal/projects', b),
  updateProject: (id, b)     => put(`/cal/projects/${id}`, b),
  deleteProject: (id)        => del(`/cal/projects/${id}`),
  getSettings: ()            => get('/cal/settings'),
  updateSettings: (b)        => put('/cal/settings', b),
}

// ── idx ───────────────────────────────────────────────────────
export const idx = {
  getIdeas: ()               => get('/idx/ideas'),
  createIdea: (b)            => post('/idx/ideas', b),
  updateIdea: (id, b)        => put(`/idx/ideas/${id}`, b),
  deleteIdea: (id)           => del(`/idx/ideas/${id}`),
  reorderIdeas: (ids)        => put('/idx/ideas/reorder', { ids }),
}

// ── str ───────────────────────────────────────────────────────
export const str = {
  getGuitars: ()             => get('/str/guitars'),
  createGuitar: (b)          => post('/str/guitars', b),
  updateGuitar: (id, b)      => put(`/str/guitars/${id}`, b),
  deleteGuitar: (id)         => del(`/str/guitars/${id}`),
  recordChange: (id, changedAt) => post(`/str/guitars/${id}/change`, { changed_at: changedAt ?? null }),
  undoChange: (id)           => del(`/str/guitars/${id}/change`),
}

// ── wmt ───────────────────────────────────────────────────────
export const wmt = {
  getStatus: ()              => get('/wmt/status'),
  getMatches: ()             => get('/wmt/matches'),
  getMatchPredictions: (id)  => get(`/wmt/matches/${id}/predictions`),
  getTeams: ()               => get('/wmt/teams'),
  getSummaries: ()           => get('/wmt/summaries'),
  refresh: ()                => post('/wmt/refresh'),
  generateSummary: ()        => post('/wmt/summary/generate'),
  getBonus: ()               => get('/wmt/bonus'),
  generateBonus: ()          => post('/wmt/bonus/generate'),
  clearData: ()              => post('/wmt/clear'),
  warmup: ()                 => post('/wmt/warmup'),
  fakeMd1: ()                => post('/wmt/debug/fake-md1'),
  fakeMd2: ()                => post('/wmt/debug/fake-md2'),
  fakeMd3: ()                => post('/wmt/debug/fake-md3'),
  fakeRd32: ()               => post('/wmt/debug/fake-rd32'),
  fakeLast16: ()             => post('/wmt/debug/fake-last16'),
  fakeQf: ()                 => post('/wmt/debug/fake-qf'),
  fakeSf: ()                 => post('/wmt/debug/fake-sf'),
  fakeTp: ()                 => post('/wmt/debug/fake-tp'),
  fakeFinal: ()              => post('/wmt/debug/fake-final'),
  fakeAll: ()                => post('/wmt/debug/fake-all'),
}

