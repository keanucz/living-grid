import { useEffect, useState } from 'react'

// The bundle this tab is running, e.g. /assets/index-AbC123.js (Vite content-hashes it per build).
const running = [...document.scripts].map((s) => s.src).find((s) => /\/assets\/index-[^/]+\.js/.test(s))

async function latestBundle() {
  try {
    const html = await (await fetch(`/?v=${Date.now()}`, { cache: 'no-store' })).text()
    return html.match(/\/assets\/index-[^"']+\.js/)?.[0] ?? null
  } catch {
    return null
  }
}

// Live games and the big screen must never reload under a player (a phone switching apps counts as hidden), and a
// tour on the big screen should play undisturbed: there the chip stays quiet.
const busy = () => /^#\/(play|game|screen|market|room|lobby)/.test(location.hash) || !!document.documentElement.dataset.tourStep

// Shows a small chip when a newer build is deployed; reloads by itself if the tab is in the background.
export default function UpdateChip() {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    if (!running || import.meta.env.DEV) return
    const check = async () => {
      const next = await latestBundle()
      if (next && !running.endsWith(next)) {
        if (busy()) return
        if (document.hidden) location.reload()
        else setStale(true)
      }
    }
    const id = setInterval(check, 120_000)
    document.addEventListener('visibilitychange', check)
    return () => (clearInterval(id), document.removeEventListener('visibilitychange', check))
  }, [])
  const [, tick] = useState(0)
  useEffect(() => {
    const on = () => tick((n) => n + 1)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  if (!stale || busy()) return null
  return (
    <button className="update-chip" onClick={() => location.reload()}>
      New version available · Reload
      <style>{`.update-chip { position: fixed; right: 16px; top: 76px; z-index: 50;
        padding: 7px 11px; border-radius: 6px; background: var(--accent); color: var(--accent-ink);
        font: 500 11px var(--mono); box-shadow: var(--shadow); }
        @media (max-width: 700px) { .update-chip { top: 104px; right: 8px; padding: 5px 9px; font-size: 10px; } }`}</style>
    </button>
  )
}
