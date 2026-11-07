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

// Shows a small chip when a newer build is deployed; reloads by itself if the tab is in the background.
export default function UpdateChip() {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    if (!running || import.meta.env.DEV) return
    const check = async () => {
      const next = await latestBundle()
      if (next && !running.endsWith(next)) {
        if (document.hidden) location.reload()
        else setStale(true)
      }
    }
    const id = setInterval(check, 120_000)
    document.addEventListener('visibilitychange', check)
    return () => (clearInterval(id), document.removeEventListener('visibilitychange', check))
  }, [])
  if (!stale) return null
  return (
    <button className="update-chip" onClick={() => location.reload()}>
      New version available · Reload
      <style>{`.update-chip { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 50;
        padding: 9px 14px; border-radius: 6px; background: var(--accent); color: var(--accent-ink);
        font: 500 12px var(--mono); box-shadow: var(--shadow); }`}</style>
    </button>
  )
}
