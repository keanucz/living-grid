import { useEffect, useMemo, useState } from 'react'

// Data centre builder: GET /datacentre for up to three sites. No route of its own: the Simulate panel renders it.
// Everything shown is a modelled estimate of wholesale energy at the trailing year's prices; the API's note says how.
const ZONES = ['GB', 'FR', 'DE-LU', 'NL', 'BE', 'NO2']
const REGIONS = {
  A: 'East England', B: 'East Midlands', C: 'London', D: 'North Wales and Merseyside', E: 'West Midlands', F: 'North East England',
  G: 'North West England', H: 'Southern England', J: 'South East England', K: 'South Wales', L: 'South West England', M: 'Yorkshire',
  N: 'South and Central Scotland', P: 'North Scotland',
}
const TYPES = [{ id: 'h100', label: 'H100' }, { id: 'b200', label: 'B200' }, { id: 'consumer', label: 'RTX 4090' }]
const MAX_SITES = 3
const label = (loc) => (REGIONS[loc] ? `${REGIONS[loc]} (GB ${loc})` : loc)
const SYM = { EUR: '€', GBP: '£' }

function money(v, cur = 'EUR') {
  const a = Math.abs(v)
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}m` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0)
  return `${v < 0 ? '−' : ''}${SYM[cur]}${s}`
}
const tonnes = (t) => (t >= 1e4 ? `${(t / 1e3).toFixed(1)}k t` : `${t.toFixed(0)} t`)
const mwh = (v) => (v >= 1e3 ? `${(v / 1e3).toFixed(1)} GWh` : `${v.toFixed(0)} MWh`)
const logGpu = (v) => Math.round(10 ** (2 + (v / 100) * 3.3)) // 100 to ~200k
const unlog = (g) => Math.round(((Math.log10(g) - 2) / 3.3) * 100)

export default function Builder({ initialZone }) {
  const [sites, setSites] = useState([initialZone && ZONES.includes(initialZone) ? initialZone : 'GB'])
  const [gpuPos, setGpuPos] = useState(unlog(1000))
  const [type, setType] = useState('h100')
  const [pue, setPue] = useState(1.5)
  const [util, setUtil] = useState(60)
  const [flex, setFlex] = useState(20)
  const [d, setD] = useState(undefined)
  const [slides, setSlides] = useState(false)
  const gpus = logGpu(gpuPos)

  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      const q = new URLSearchParams({ locations: sites.join(','), gpus, gpu_type: type, pue, utilisation: util / 100, flexible_share: flex / 100 })
      const timeout = setTimeout(() => ctrl.abort(), 15000)
      try {
        const r = await fetch(`/api/datacentre?${q}`, { signal: ctrl.signal })
        setD(r.ok ? await r.json() : null)
      } catch (e) {
        if (e.name !== 'AbortError') setD(null)
      } finally {
        clearTimeout(timeout)
      }
    }, 350)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [sites, gpus, type, pue, util, flex])

  const free = useMemo(() => [...ZONES, ...Object.keys(REGIONS)].filter((x) => !sites.includes(x)), [sites])
  const best = d?.cheapest_site

  return (
    <div className="dc">
      <div className="dc-sites" aria-label="Sites">
        {sites.map((s) => (
          <span key={s} className={`dc-chip ${s === best && sites.length > 1 ? 'best' : ''}`}>
            {label(s)}{s === best && sites.length > 1 ? ' · cheapest' : ''}
            {sites.length > 1 && <button onClick={() => setSites(sites.filter((x) => x !== s))} aria-label={`Remove ${label(s)}`}>×</button>}
          </span>
        ))}
        {sites.length < MAX_SITES && (
          <select value="" onChange={(e) => e.target.value && setSites([...sites, e.target.value])} aria-label="Add a site">
            <option value="">+ Add a site</option>
            <optgroup label="Zones">{free.filter((x) => ZONES.includes(x)).map((x) => <option key={x} value={x}>{x}</option>)}</optgroup>
            <optgroup label="GB regions">{free.filter((x) => REGIONS[x]).map((x) => <option key={x} value={x}>{label(x)}</option>)}</optgroup>
          </select>
        )}
      </div>

      <div className="dc-types" role="tablist" aria-label="GPU type">
        {TYPES.map((t) => <button key={t.id} role="tab" aria-selected={t.id === type} className={t.id === type ? 'on' : ''} onClick={() => setType(t.id)}>{t.label}</button>)}
      </div>

      <label className="dc-sl"><span>GPUs <b className="num">{gpus.toLocaleString('en-GB')}</b></span>
        <input type="range" min={0} max={100} value={gpuPos} onChange={(e) => setGpuPos(+e.target.value)} /></label>
      <label className="dc-sl"><span>PUE (overhead) <b className="num">{pue.toFixed(2)}</b></span>
        <input type="range" min={1} max={2} step={0.01} value={pue} onChange={(e) => setPue(+e.target.value)} /></label>
      <label className="dc-sl"><span>Utilisation <b className="num">{util}%</b></span>
        <input type="range" min={10} max={100} step={5} value={util} onChange={(e) => setUtil(+e.target.value)} /></label>
      <label className="dc-sl"><span>Work that can move within the day <b className="num">{flex}%</b></span>
        <input type="range" min={0} max={60} step={5} value={flex} onChange={(e) => setFlex(+e.target.value)} /></label>

      {d === undefined && <p className="dc-muted">Working it out…</p>}
      {d === null && <p className="dc-muted">The data centre model isn’t reachable right now.</p>}

      {d && (
        <>
          <div className="dc-grid">
            {d.sites.map((s) => (
              <article key={s.location} className={`dc-card ${s.location === best && d.sites.length > 1 ? 'best' : ''}`}>
                <h4>{label(s.location)}</h4>
                <div className="dc-row"><span>Draw</span><b className="num">{(s.facility_kw_avg / 1000).toFixed(1)} MW · {mwh(s.annual_mwh)}/yr</b></div>
                {s.energy ? (
                  <>
                    <div className="dc-row"><span>Energy a year</span><b className="num">{money(s.energy.cost_eur)}</b></div>
                    <div className="dc-row"><span>Moving the flexible work</span>
                      <b className="num acc">{money(s.energy.cost_flex_eur)} <small>(−{s.energy.saving_flex_pct.toFixed(1)}%)</small></b></div>
                    <div className="dc-row"><span>Carbon</span><b className="num">{tonnes(s.carbon.tonnes)} <small>{s.carbon.intensity_g_kwh.toFixed(0)} g/kWh</small></b></div>
                    {s.carbon.tonnes_flex > s.carbon.tonnes && <p className="dc-warn">Chasing cheap hours adds carbon here: {tonnes(s.carbon.tonnes_flex)} a year.</p>}
                    <p className="dc-src">{s.price_basis}; from {s.price_days} days of prices. Carbon is modelled.</p>
                  </>
                ) : <p className="dc-muted">No prices cached for this zone.</p>}
                {s.next_job && <p className="dc-src">Best start for the movable work in the next 24 h: {new Date(s.next_job.start).toISOString().slice(11, 16)} UTC ({s.next_job.kind}).</p>}
                <ul className="dc-notes">{s.grid_notes.map((n) => <li key={n.topic}><b>{n.topic}.</b> {n.text}</li>)}</ul>
              </article>
            ))}
          </div>

          <button className="dc-ghost" onClick={() => setSlides((v) => !v)} aria-expanded={slides}>{slides ? 'Hide summary' : 'Show summary cards'}</button>
          {slides && <Slides d={d} best={best} />}
          <details className="dc-src"><summary>How this is worked out</summary><p>{d.note}</p></details>
        </>
      )}
      <style>{CSS}</style>
    </div>
  )
}

function Slides({ d, best }) {
  const top = d.sites.find((s) => s.location === best) ?? d.sites[0]
  const cards = [
    { k: 'Size', v: `${d.gpus.toLocaleString('en-GB')} GPUs`, t: `${(top.facility_kw_avg / 1000).toFixed(1)} MW on average, ${mwh(top.annual_mwh)} a year.` },
    top.energy && { k: 'Energy', v: money(top.energy.cost_eur), t: `a year at ${label(top.location)} prices; ${money(top.energy.saving_flex_eur)} less if ${(d.flexible_share * 100).toFixed(0)}% of the work moves to cheap hours.` },
    top.carbon && { k: 'Carbon', v: tonnes(top.carbon.tonnes), t: `a year at ${top.carbon.intensity_g_kwh.toFixed(0)} g/kWh (modelled). Worth about ${money(top.carbon.cost_eur ?? 0)} at the carbon allowance price, already inside the power price.` },
    { k: d.sites.length > 1 ? 'Best site' : 'Site', v: label(top.location), t: d.sites.length > 1 ? 'Lowest energy cost once flexible work is moved. Cost is one factor: grid connection is not in our data yet.' : top.grid_notes[0]?.text ?? '' },
  ].filter(Boolean)
  return <div className="dc-slides">{cards.map((c) => <div key={c.k}><span>{c.k}</span><b className="num">{c.v}</b><p>{c.t}</p></div>)}</div>
}

const CSS = `
.dc { display: flex; flex-direction: column; gap: 10px; }
.dc-sites { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.dc-chip { display: inline-flex; gap: 6px; align-items: center; padding: 6px 10px; border-radius: 999px; background: var(--card); font-size: 13px; }
.dc-chip.best { background: var(--hot-dim); color: var(--hot); }
.dc-chip button { background: none; color: inherit; font-size: 16px; line-height: 1; padding: 0 2px; min-width: 24px; min-height: 24px; }
.dc select { background: var(--card); color: var(--text); border-radius: 999px; padding: 7px 10px; border: 1px solid var(--line); font-size: 13px; }
.dc-types { display: flex; gap: 6px; }
.dc-types button { flex: 1; height: 38px; border-radius: 12px; background: var(--card); color: var(--text-2); font-weight: 600; }
.dc-types button.on { background: var(--hot); color: #1b0d00; }
.dc-sl { display: block; font-size: 13px; color: var(--text-2); }
.dc-sl span { display: flex; justify-content: space-between; margin-bottom: 2px; }
.dc-sl b { color: var(--text); }
.dc-sl input { width: 100%; accent-color: var(--hot); }
.dc-grid { display: grid; gap: 10px; }
.dc-card { background: var(--card); border-radius: 16px; padding: 12px; border: 1px solid transparent; }
.dc-card.best { border-color: rgba(255,138,31,.4); }
.dc-card h4 { margin: 0 0 6px; font-size: 14px; }
.dc-row { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; padding: 2px 0; }
.dc-row span { color: var(--text-2); }
.dc-row small { color: var(--text-3); font-weight: 400; }
.dc .acc { color: var(--accent); }
.dc-warn { font-size: 12px; color: var(--hot); margin: 4px 0 0; }
.dc-src, .dc-muted { font-size: 12px; color: var(--text-3); line-height: 1.5; margin: 4px 0 0; }
.dc-notes { margin: 6px 0 0; padding-left: 16px; font-size: 12px; color: var(--text-2); line-height: 1.45; }
.dc-ghost { height: 40px; border-radius: 999px; background: var(--card-2); color: var(--text-2); font-weight: 600; }
.dc-slides { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.dc-slides > div { background: var(--card); border-radius: 16px; padding: 12px; }
.dc-slides span { font-size: 12px; color: var(--text-3); }
.dc-slides b { display: block; font-size: 19px; margin: 2px 0 4px; }
.dc-slides p { margin: 0; font-size: 12px; color: var(--text-2); line-height: 1.4; }
`
