import { useEffect, useMemo, useRef, useState } from 'react'
import { DeckGL, TextLayer, WebMercatorViewport } from 'deck.gl'
import { buildCostLayers, costScale, locate, SCOTLAND, ZONE_LABEL, ZONE_NAME, ZONE_ORDER } from '../../layers/dcCost/index.js'
import regionsGeo from '../../layers/gbRegions/regions.json'
import { useGeo } from '../replay/useMapState.js'
import { Building, FlexDay, Compare } from './visuals.jsx'
import { CSS } from './styles.js'
import { label, money, tonnes, mwh, useReducedMotion } from './format.js'

// Data centre builder: a weather forecast for where to put a GPU site. The map is tinted by the annual energy cost of the
// current spec at each zone's trailing-year prices (GET /datacentre: wholesale energy only, modelled), a draggable pin
// places a site and the cost, carbon and grid notes follow it. Up to three pins are compared side by side.
const TYPES = [{ id: 'h100', label: 'H100' }, { id: 'b200', label: 'B200' }, { id: 'consumer', label: 'RTX 4090' }]
const PIN_COLOURS = ['#c5f06b', '#6bc8f0', '#f06bd0']
const PRESETS = [
  { name: 'London', lng: -0.12, lat: 51.5 },
  { name: 'North Scotland', lng: -4.3, lat: 57.4 },
  { name: 'Southern Norway', lng: 7.6, lat: 59.3 },
]
const PHONE = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches
const START_VIEW = PHONE ? { longitude: 3, latitude: 52.5, zoom: 2.9 } : { longitude: 4.2, latitude: 52.2, zoom: 3.85 }
const logGpu = (v) => Math.round(10 ** (2 + (v / 100) * 3.3))
const unlog = (g) => Math.round(((Math.log10(g) - 2) / 3.3) * 100)

async function getJson(url, signal) {
  const r = await fetch(url, { signal })
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

// Debounced fetch of `make(signal)`, aborted when the inputs change.
function useQuery(key, make) {
  const [state, setState] = useState({ data: undefined })
  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      const timer = setTimeout(() => ctrl.abort(), 20000)
      try {
        setState({ data: await make(ctrl.signal) })
      } catch (e) {
        if (e.name !== 'AbortError') setState({ data: null })
      } finally {
        clearTimeout(timer)
      }
    }, 300)
    return () => { clearTimeout(t); ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state.data
}

function DataCentre() {
  const geo = useGeo()
  const reduced = useReducedMotion()
  const [pins, setPins] = useState([PRESETS[0]])
  const [active, setActive] = useState(0)
  const [type, setType] = useState('h100')
  const [gpuPos, setGpuPos] = useState(unlog(1000))
  const [pue, setPue] = useState(1.5)
  const [util, setUtil] = useState(60)
  const [flex, setFlex] = useState(20)
  const [flexOn, setFlexOn] = useState(false)
  const [view, setView] = useState({ ...START_VIEW, pitch: 0, bearing: 0 })
  const [size, setSize] = useState({ width: 800, height: 480 })
  const mapRef = useRef(null)
  const drag = useRef(null)
  const gpus = logGpu(gpuPos)

  useEffect(() => {
    if (!mapRef.current) return undefined
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(mapRef.current)
    return () => ro.disconnect()
  }, [])

  const places = useMemo(() => pins.map((p) => locate(p.lng, p.lat, geo, regionsGeo)), [pins, geo])
  const spec = `gpus=${gpus}&gpu_type=${type}&pue=${pue}&utilisation=${util / 100}&flexible_share=${flex / 100}`

  // Heat map: all six zones for this spec (two calls of three; the API takes up to three places at once).
  const heat = useQuery(spec, async (signal) => {
    const rows = await Promise.all([ZONE_ORDER.slice(0, 3), ZONE_ORDER.slice(3)].map((z) => getJson(`/api/datacentre?locations=${z.join(',')}&${spec}`, signal)))
    return Object.fromEntries(rows.flatMap((d) => d.sites.map((s) => [s.zone, s])))
  })
  const locs = [...new Set(places.filter(Boolean).map((p) => p.location))]
  const sitesQ = useQuery(`${spec}|${locs.join()}`, (signal) => (locs.length ? getJson(`/api/datacentre?locations=${locs.join(',')}&${spec}`, signal) : null))

  const costs = useMemo(() => {
    if (!heat) return null
    return Object.fromEntries(Object.entries(heat).filter(([, s]) => s.energy).map(([z, s]) => [z, flexOn ? s.energy.cost_flex_eur : s.energy.cost_eur]))
  }, [heat, flexOn])
  const scale = costs && Object.keys(costs).length ? costScale(costs) : null

  const viewport = useMemo(() => new WebMercatorViewport({ ...view, ...size }), [view, size])
  const hotRegions = places.filter((p) => p && SCOTLAND.includes(p.location)).map((p) => p.location)
  const layers = useMemo(() => [
    ...buildCostLayers({ geo, regions: regionsGeo, costs, hot: hotRegions, marked: places.filter(Boolean).map((p) => p.location) }),
    costs && new TextLayer({
      id: 'dc-labels', data: ZONE_ORDER.filter((z) => costs[z] != null), getPosition: (z) => ZONE_LABEL[z],
      getText: (z) => `${ZONE_NAME[z]}\n${money(costs[z])}`, getSize: PHONE ? 11 : 13, getColor: [16, 16, 14, 255], fontWeight: 700,
      fontFamily: 'system-ui, sans-serif', background: false,
      updateTriggers: { getText: [JSON.stringify(costs)] },
    }),
  ].filter(Boolean), [geo, costs, places.map((p) => p?.location).join()]) // eslint-disable-line react-hooks/exhaustive-deps

  const sites = sitesQ?.sites ?? []
  const siteOf = (place) => sites.find((s) => s.location === place?.location)
  const cur = siteOf(places[active])
  const best = sitesQ?.cheapest_site

  const startDrag = (i) => (e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const [px, py] = viewport.project([pins[i].lng, pins[i].lat])
    const rect = mapRef.current.getBoundingClientRect()
    drag.current = { i, dx: e.clientX - rect.left - px, dy: e.clientY - rect.top - py }
    setActive(i)
  }
  const moveDrag = (e) => {
    const d = drag.current
    if (!d) return
    const rect = mapRef.current.getBoundingClientRect()
    const [lng, lat] = viewport.unproject([e.clientX - rect.left - d.dx, e.clientY - rect.top - d.dy])
    setPins((ps) => ps.map((p, i) => (i === d.i ? { ...p, name: undefined, lng, lat } : p)))
  }
  const endDrag = () => { drag.current = null }
  const nudge = (i) => (e) => {
    const s = { ArrowLeft: [-0.3, 0], ArrowRight: [0.3, 0], ArrowUp: [0, 0.2], ArrowDown: [0, -0.2] }[e.key]
    if (!s) return
    e.preventDefault()
    setPins((ps) => ps.map((p, k) => (k === i ? { ...p, name: undefined, lng: p.lng + s[0], lat: p.lat + s[1] } : p)))
  }
  const addPin = () => {
    const taken = places.map((p) => p?.location)
    const next = PRESETS.find((p) => !taken.includes(locate(p.lng, p.lat, geo, regionsGeo)?.location)) ?? PRESETS[pins.length % PRESETS.length]
    setPins([...pins, next])
    setActive(pins.length)
  }
  const jump = (p) => { setPins(pins.map((q, i) => (i === active ? p : q))) }

  return (
    <div className="dcv">
      <header className="dcv-head">
        <h1>Plan around the forecast: where should the data centre go?</h1>
        <p>Drag a pin. The map shows what a year of power would cost at each country’s recent prices, for the data centre you describe on the right. It is a wholesale energy estimate, not a quote.</p>
      </header>

      <div className="dcv-main">
        <section className="dcv-mapcol" aria-label="Cost map">
          <div className="dcv-map" ref={mapRef}>
            <DeckGL viewState={view} onViewStateChange={({ viewState }) => setView({ ...viewState, pitch: 0, bearing: 0 })}
              controller={{ dragRotate: false, touchRotate: false }} layers={layers} style={{ position: 'absolute', inset: 0 }} />
            {pins.map((p, i) => {
              const [x, y] = viewport.project([p.lng, p.lat])
              const warn = places[i] && SCOTLAND.includes(places[i].location)
              return (
                <button key={i} className={`dcv-pin ${i === active ? 'on' : ''} ${warn ? 'warn' : ''}`} style={{ left: x, top: y, '--pin': PIN_COLOURS[i] }}
                  onPointerDown={startDrag(i)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={nudge(i)}
                  aria-label={`Site ${'ABC'[i]}: ${places[i] ? label(places[i].location) : 'not in one of the six zones'}. Drag, or use the arrow keys, to move it.`}>
                  <span className="dcv-ring" /><b>{'ABC'[i]}</b>
                </button>
              )
            })}
            {!geo && <p className="dcv-load">Loading the map…</p>}
            <div className="dcv-legend" aria-label="Colour scale">
              <span>Cheaper</span><i /><span>Dearer</span>
              {scale && <small>{money(scale.lo)} to {money(scale.hi)} a year</small>}
            </div>
          </div>
          <div className="dcv-jumps" aria-label="Quick places">
            <span>Try the pin in:</span>
            {PRESETS.map((p) => <button key={p.name} onClick={() => jump(p)}>{p.name}</button>)}
            {pins.length < 3 && <button className="add" onClick={addPin}>+ Compare another site</button>}
            {pins.length > 1 && <button onClick={() => { setPins(pins.slice(0, -1)); setActive(0) }}>Remove site {'ABC'[pins.length - 1]}</button>}
          </div>
        </section>

        <aside className="dcv-side">
          <div className="dcv-types" role="tablist" aria-label="GPU type">
            {TYPES.map((t) => <button key={t.id} role="tab" aria-selected={t.id === type} className={t.id === type ? 'on' : ''} onClick={() => setType(t.id)}>{t.label}</button>)}
          </div>
          <label className="dcv-sl"><span>GPUs <b className="num">{gpus.toLocaleString('en-GB')}</b></span>
            <input type="range" min={0} max={100} value={gpuPos} onChange={(e) => setGpuPos(+e.target.value)} /></label>
          <label className="dcv-sl"><span>Cooling overhead (PUE) <b className="num">{pue.toFixed(2)}</b></span>
            <input type="range" min={1} max={2} step={0.01} value={pue} onChange={(e) => setPue(+e.target.value)} /></label>
          <label className="dcv-sl"><span>Busy <b className="num">{util}%</b></span>
            <input type="range" min={10} max={100} step={5} value={util} onChange={(e) => setUtil(+e.target.value)} /></label>
          <Building gpuPos={gpuPos} gpus={gpus} pue={pue} mw={cur ? cur.facility_kw_avg / 1000 : null} reduced={reduced} />
        </aside>
      </div>

      <div className="dcv-row">
        <section className="dcv-card" aria-label="Flexible work">
          <div className="dcv-ct">
            <h2>Move the flexible work</h2>
            <button className={`dcv-toggle ${flexOn ? 'on' : ''}`} role="switch" aria-checked={flexOn} onClick={() => setFlexOn((v) => !v)}><i /><span>{flexOn ? 'On' : 'Off'}</span></button>
          </div>
          <label className="dcv-sl"><span>Work that can wait within the day <b className="num">{flex}%</b></span>
            <input type="range" min={0} max={60} step={5} value={flex} onChange={(e) => setFlex(+e.target.value)} /></label>
          <FlexDay on={flexOn} share={flex} site={cur} reduced={reduced} />
        </section>

        <section className="dcv-card" aria-label="Sites compared">
          <h2>{pins.length > 1 ? 'Your sites side by side' : 'Your site'}</h2>
          {sitesQ === undefined && <p className="dcv-muted">Working it out…</p>}
          {sitesQ === null && <p className="dcv-muted">The data centre model isn’t reachable right now.</p>}
          {sitesQ && <Compare pins={pins} places={places} sites={sites} best={best} flexOn={flexOn} colours={PIN_COLOURS} active={active} onPick={setActive} />}
          {pins.length < 3 && sitesQ && <p className="dcv-muted">Add up to {3 - pins.length} more pin{3 - pins.length > 1 ? 's' : ''} to compare cost, carbon and grid flags.</p>}
        </section>
      </div>

      {cur && (
        <section className="dcv-card dcv-detail" aria-label="Site details">
          <h2>Site {'ABC'[active]}: {label(places[active]?.location)}</h2>
          {cur.energy ? (
            <div className="dcv-nums">
              <div><span>Power drawn</span><b className="num">{(cur.facility_kw_avg / 1000).toFixed(1)} MW</b><small>{mwh(cur.annual_mwh)} a year</small></div>
              <div><span>Energy a year</span><b className="num">{money(flexOn ? cur.energy.cost_flex_eur : cur.energy.cost_eur)}</b>
                {flexOn && <small>{money(cur.energy.saving_flex_eur)} less than not moving it</small>}</div>
              <div><span>Carbon</span><b className="num">{tonnes(flexOn ? cur.carbon.tonnes_flex : cur.carbon.tonnes)}</b><small>{cur.carbon.intensity_g_kwh.toFixed(0)} g/kWh, modelled</small></div>
            </div>
          ) : <p className="dcv-muted">No prices cached for this zone.</p>}
          {flexOn && cur.carbon && cur.carbon.tonnes_flex > cur.carbon.tonnes && <p className="dcv-warnline">Chasing cheap hours adds carbon here: {tonnes(cur.carbon.tonnes_flex)} a year, not {tonnes(cur.carbon.tonnes)}.</p>}
          <ul className="dcv-notes">
            {cur.grid_notes.map((n) => (
              <li key={n.topic} className={n.topic === 'Scottish wind constraints' ? 'hot' : ''}>
                <b>{n.topic === 'Scottish wind constraints' ? 'Grid warning. ' : `${n.topic}. `}</b>{n.topic === 'Scottish wind constraints' && `${n.topic}: `}{n.text}
                <small> Source: {n.source}</small>
              </li>
            ))}
          </ul>
          <p className="dcv-muted">{cur.price_basis}; {cur.price_days} days of prices. Carbon is modelled. {cur.next_job && `Best start for the movable work in the next 24 h: ${new Date(cur.next_job.start).toISOString().slice(11, 16)} UTC (${cur.next_job.kind}).`}</p>
        </section>
      )}
      {places[active] === null && <p className="dcv-muted">That pin is outside the six zones we model. Drag it onto the map’s coloured countries.</p>}
      {sitesQ?.note && <details className="dcv-muted"><summary>How this is worked out</summary><p>{sitesQ.note}</p></details>}
      <style>{CSS}</style>
    </div>
  )
}

export default { path: '/datacentre', title: 'Data centre builder', Component: DataCentre }
