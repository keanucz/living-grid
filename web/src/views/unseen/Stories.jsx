import { useEffect, useMemo, useState } from 'react'
import { actions, setState } from '../../store/store.js'
import { PANELS } from '../../panels/registry.js'
import { openSection } from '../../shell/sections.js'
import { load as loadGhost, useGhostWind } from '../../layers/ghostWind/data.js'
import { useInfra } from '../../layers/boundaries/data.js'
import { load as loadCarbon, getCarbon, intensities } from '../../layers/carbon/data.js'
import { CARDS, INTROS, windHeadline, carbonHeadline, bottleneckHeadline, sunnyHeadline } from './cards.js'

// Hidden grid as a small 2x2 picker: icon and title only. Choosing a tile sets the map (layers) and opens that story:
// the plain intro first, then at most three live facts with their source, then the existing panels behind 'More detail'.
// Nothing is open until a tile is chosen; choosing the open tile again closes it. Estimates are labelled.
const events = import.meta.glob('../../../../data/events/sunny-weekend.json')

function useSunnyEvent() {
  const [ev, setEv] = useState(null)
  useEffect(() => {
    const f = Object.values(events)[0]
    f?.().then((m) => setEv(m.default ?? m)).catch(() => setEv(null))
  }, [])
  return ev
}

// Same stroke style as shell/icons.jsx (24 box, round caps).
const ICONS = {
  wind: 'M12 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12.3 8.5l1-6M13.3 10.8l4.6 3.4M10.6 10.6l-5.3 1.9M11.6 11.5 11 21M12.4 11.5 13 21M9 21h6',
  carbon: 'M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v2a3 3 0 0 0 3 3h6',
  bottleneck: 'M3 5c5 0 6 5 9 5s4-5 9-5M3 19c5 0 6-5 9-5s4 5 9 5M5 12h2M17 12h2',
  sunny: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
}

function TileIcon({ id }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[id]} /></svg>
  )
}

// A headline whose text continues its number ('of Scottish wind was…') reads as one sentence with the number in front.
const lead = (h) => (/^[a-z]/.test(h.text) ? <><b className="num">{h.value}</b> {h.text}</> : h.text)

function Detail({ ids, ctx }) {
  const items = PANELS.filter((p) => ids.includes(p.id))
  return items.map((p) => <p.Component key={p.id} ctx={ctx} />)
}

export default function Stories({ ctx }) {
  const gw = useGhostWind()
  const infra = useInfra()
  const ev = useSunnyEvent()
  const [open, setOpen] = useState(null)
  const [more, setMore] = useState(false)
  const at = ctx.ui.at

  useEffect(() => {
    loadCarbon()
    if (!gw.window && !gw.loading) loadGhost('live')
  }, [gw.window, gw.loading])

  // Enter on the first card's map state, with nothing open underneath.
  useEffect(() => setLayers('wind'), []) // eslint-disable-line react-hooks/exhaustive-deps

  function setLayers(id) {
    const card = CARDS.find((c) => c.id === id)
    setState((s) => ({ layers: { ...s.layers, ...card.layers } }))
  }

  function choose(id) {
    setMore(false)
    if (open === id) return setOpen(null)
    setOpen(id)
    setLayers(id)
  }

  const names = useMemo(() => Object.fromEntries(Object.entries(ctx.zoneById ?? {}).map(([k, z]) => [k, z.name])), [ctx.zoneById])
  const by = intensities(ctx.stateByZone, getCarbon().zones)
  const heads = {
    wind: windHeadline(gw, infra),
    carbon: carbonHeadline(by, names),
    bottleneck: bottleneckHeadline(infra),
    sunny: sunnyHeadline(ev),
  }

  // The same map over time: the Forecast view has the history scrubber; keep wind or sun on when going there.
  const overTime = (layer) => {
    openSection('forecast')
    setState((s) => ({ layers: { ...s.layers, [layer]: true } }))
  }

  return (
    <section className="panel stories fade-in" aria-label="Four stories from the hidden grid">
      <div className="story-tiles" role="tablist">
        {CARDS.map((c) => (
          <button key={c.id} role="tab" aria-selected={open === c.id} aria-expanded={open === c.id}
            className={`story-tile ${open === c.id ? 'on' : ''}`} onClick={() => choose(c.id)}>
            <span className="story-ic"><TileIcon id={c.id} /></span>
            <span className="story-title">{c.title}</span>
          </button>
        ))}
      </div>
      {CARDS.filter((c) => c.id === open).map((c) => {
        const h = heads[c.id]
        return (
          <div key={c.id} className="story-body fade-in" role="tabpanel">
            <p className="story-intro">{INTROS[c.id]}</p>
            <ul className="story-facts">
              <li>{lead(h)} {h.when && h.value !== '…' && <span className="faint">({h.when})</span>} {h.estimate && <span className="tag hot">{h.sample ? 'Sample data' : 'Estimated'}</span>}</li>
              {h.extra && <li>{h.extra}</li>}
            </ul>
            {c.id === 'wind' && (
              <p className="story-legend"><span className="story-dot" aria-hidden="true" />Circles: Scottish wind farms; size = wind estimated switched off (paid bids plus the weather-implied gap). Hover one for its figures.</p>
            )}
            <div className="faint story-src">Source: {h.source}</div>
            {c.id === 'sunny' && (
              <div className="story-actions">
                {h.dipTs && <button onClick={() => actions.setAt(h.dipTs)}>Show prices at the deepest dip</button>}
                {at && <button onClick={() => actions.setAt(null)}>Back to live</button>}
                <span className="faint">The map shows prices for the chosen hour; the sun overlay only has weather for the last week.</span>
              </div>
            )}
            <div className="story-actions">
              {c.links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
              {c.overTime && <button onClick={() => overTime(c.overTime)}>See it over time</button>}
              {c.detail.length > 0 && (
                <button className="story-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>{more ? 'Less detail' : 'More detail'}</button>
              )}
            </div>
            {more && c.detail.length > 0 && <div className="story-detail fade-in"><Detail ids={c.detail} ctx={ctx} /></div>}
          </div>
        )
      })}
      <style>{`
        .stories { width: min(420px, 100%); padding: 8px; max-height: 76vh; overflow-y: auto; scrollbar-width: none; }
        .stories::-webkit-scrollbar { display: none; }
        .story-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .story-tile { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 10px; border-radius: 12px; background: var(--card); color: var(--text); text-align: left; border: 1px solid transparent; }
        .story-tile.on { border-color: var(--accent); background: var(--card-2); }
        .story-ic { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: var(--card-2); color: var(--accent); }
        .story-title { font-weight: 600; font-size: 12.5px; line-height: 1.25; }
        .story-body { padding: 12px 6px 4px; font-size: 13px; line-height: 1.55; }
        .story-body p { margin: 0 0 8px; }
        .story-intro { font-size: 14px; color: var(--text); }
        .story-facts { margin: 0 0 8px; padding-left: 18px; color: var(--text-2, var(--text)); }
        .story-facts li { margin-bottom: 4px; }
        .story-facts b { color: var(--accent); font-weight: 600; }
        .story-legend { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2, var(--text)); }
        .story-dot { flex: none; width: 12px; height: 12px; border-radius: 50%; border: 1.2px solid #5ed6c4; background: rgba(94, 214, 196, .3); }
        .story-src { font-size: 11px; margin-bottom: 6px; }
        .story-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
        .story-actions a, .story-actions button { padding: 5px 12px; border-radius: 999px; background: var(--card-2); color: var(--text); font-size: 12px; }
        .story-actions .story-more { border: 1px solid var(--accent); }
        .story-actions span { font-size: 11px; }
        .story-detail { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
        .story-detail > .panel { width: 100% !important; max-height: none !important; }
      `}</style>
    </section>
  )
}
