import { useEffect, useMemo, useState } from 'react'
import { actions, setState } from '../../store/store.js'
import { PANELS } from '../../panels/registry.js'
import { openSection } from '../../shell/sections.js'
import { load as loadGhost, useGhostWind } from '../../layers/ghostWind/data.js'
import { useInfra } from '../../layers/boundaries/data.js'
import { load as loadCarbon, getCarbon, intensities } from '../../layers/carbon/data.js'
import { CARDS, windHeadline, carbonHeadline, bottleneckHeadline, sunnyHeadline } from './cards.js'

// Hidden grid as four story cards. Choosing a card sets the map (layers) and opens that story's detail underneath, using
// the existing panels rather than copies. One card is open at a time; the headline numbers are live or from the event
// library and always show their source. Estimates are labelled.
const events = import.meta.glob('../../../../data/events/sunny-weekend.json')

function useSunnyEvent() {
  const [ev, setEv] = useState(null)
  useEffect(() => {
    const f = Object.values(events)[0]
    f?.().then((m) => setEv(m.default ?? m)).catch(() => setEv(null))
  }, [])
  return ev
}

function Detail({ ids, ctx }) {
  const items = PANELS.filter((p) => ids.includes(p.id))
  return items.map((p) => <p.Component key={p.id} ctx={ctx} />)
}

export default function Stories({ ctx }) {
  const gw = useGhostWind()
  const infra = useInfra()
  const ev = useSunnyEvent()
  const [open, setOpen] = useState('wind')
  const at = ctx.ui.at

  useEffect(() => {
    loadCarbon()
    if (!gw.window && !gw.loading) loadGhost('live')
  }, [gw.window, gw.loading])

  // Enter on the first card's map state.
  useEffect(() => choose('wind'), []) // eslint-disable-line react-hooks/exhaustive-deps

  function choose(id) {
    const card = CARDS.find((c) => c.id === id)
    setOpen(id)
    setState((s) => ({ layers: { ...s.layers, ...card.layers } }))
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
        {CARDS.map((c) => {
          const h = heads[c.id]
          return (
            <button key={c.id} role="tab" aria-selected={open === c.id} className={`story-tile ${open === c.id ? 'on' : ''}`} onClick={() => choose(c.id)}>
              <span className="story-title">{c.title}</span>
              <span className="story-val num">{h.value}{h.when && <small>{h.when}</small>}</span>
            </button>
          )
        })}
      </div>
      {CARDS.filter((c) => c.id === open).map((c) => {
        const h = heads[c.id]
        return (
          <div key={c.id} className="story-body fade-in" role="tabpanel">
            <p>{h.text} {h.estimate && <span className="tag hot">{h.sample ? 'Sample data' : 'Estimated'}</span>}</p>
            {h.extra && <p className="muted">{h.extra}</p>}
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
            </div>
            {c.detail.length > 0 && <div className="story-detail"><Detail ids={c.detail} ctx={ctx} /></div>}
          </div>
        )
      })}
      <style>{`
        .stories { width: min(560px, 100%); padding: 8px; max-height: 76vh; overflow-y: auto; scrollbar-width: none; }
        .stories::-webkit-scrollbar { display: none; }
        .story-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .story-tile { display: flex; flex-direction: column; justify-content: space-between; gap: 6px; min-height: 72px; padding: 10px 12px; border-radius: 14px; background: var(--card); color: var(--text); text-align: left; border: 1px solid transparent; }
        .story-tile.on { border-color: var(--accent); background: var(--card-2); }
        .story-title { font-weight: 600; font-size: 13px; line-height: 1.25; }
        .story-val { color: var(--accent); font-size: 16px; white-space: nowrap; }
        .story-val small { margin-left: 6px; font-size: 10px; font-weight: 400; color: var(--text-3); }
        .story-body { padding: 12px 6px 6px; font-size: 13px; line-height: 1.5; }
        .story-body p { margin: 0 0 6px; }
        .story-src { font-size: 11px; margin-bottom: 8px; }
        .story-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
        .story-actions a, .story-actions button { padding: 5px 12px; border-radius: 999px; background: var(--card-2); color: var(--text); font-size: 12px; }
        .story-actions span { font-size: 11px; }
        .story-detail { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
        .story-detail > .panel { width: 100% !important; max-height: none !important; }
      `}</style>
    </section>
  )
}
