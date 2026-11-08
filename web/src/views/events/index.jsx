import { useEffect, useState } from 'react'
import { Icon } from '../../shell/icons.jsx'
import Explain from '../../ui/Explain.jsx'
import Movie from './Movie.jsx'

// #/events?e=<slug>: one event movie on its own page, for the Hidden grid stories ("Watch the storm") and the time
// bar's event card ("Watch the movie"). Movie reads ?e= when it mounts (default: the first event) and shows the
// chips to switch, so it is keyed on the slug to follow a new link while this page is open.
const slugOf = () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('e') ?? ''

// Back goes to wherever the viewer came from inside the app (the map keeps its section, since the store persists).
// Registered when the views are loaded at start-up, so the first visit already knows where it came from.
let from = '#/'
if (typeof window !== 'undefined') {
  addEventListener('hashchange', (e) => {
    const old = new URL(e.oldURL).hash
    if (!old.startsWith('#/events')) from = old || '#/'
  })
}

function Events() {
  const [slug, setSlug] = useState(slugOf)
  useEffect(() => {
    const on = () => setSlug(slugOf())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])

  return (
    <div className="evp">
      <header className="evp-top">
        <a href={from} className="evp-back" aria-label="Back"><Icon name="back" /></a>
        <h1>Event movies</h1>
      </header>
      <Explain question="What happened on the grid?" answer="Real days on Europe's grid, played back from the data as a short film." className="evp-intro" />
      <Movie key={slug} onOpenReplay={() => { location.hash = '#/replay' }} />
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.evp { max-width: 1280px; margin: 0 auto; padding: 28px 24px 40px; }
.evp-top { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.evp-top h1 { margin: 0; font-size: 30px; letter-spacing: -0.02em; }
.evp-back { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--card); color: var(--text); flex: none; }
.evp-back:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.evp-intro { margin-bottom: 16px; }
.evp-intro .ex-a { margin-bottom: 4px; }
@media (max-width: 600px) { .evp { padding: 16px 16px 32px; } .evp-top h1 { font-size: 24px; } }
.evp .rp-controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.evp .rp-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.evp .rp-tabs button { padding: 8px 12px; border-radius: 999px; background: var(--card); color: var(--text-2); font-weight: 600; font-size: 13px; }
.evp .rp-tabs button.on { background: var(--accent-dim); color: var(--accent); }
.evp .rp-play { height: 42px; padding: 0 18px; border-radius: 999px; background: var(--hot); color: #1b0d00; font-weight: 700; display: inline-flex; gap: 8px; align-items: center; }
.evp .rp-muted { color: var(--text-2); }
`

export default { path: '/events', title: 'Event movies', Component: Events }
