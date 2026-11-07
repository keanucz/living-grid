import { api, useApi } from '../../api/client.js'
import fixture from './scores.fixture.json'

// Live /scores through the shared client; if it cannot be read the bundled snapshot is shown and labelled.
export function useScores() {
  const res = useApi(() => api.scores().catch(() => ({ data: fixture, source: 'fixture' })), [])
  return { scores: res.data, source: res.source }
}
