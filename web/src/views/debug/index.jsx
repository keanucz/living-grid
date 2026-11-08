import { useEffect, useMemo, useState } from 'react'
import spec from '../../../../engine/contract/openapi.json'
import { SECTIONS, openSection, sectionOfPath } from '../../shell/sections.js'
import { LAYERS } from '../../layers/registry.js'
import { PANELS } from '../../panels/registry.js'
import { VIEWS, REDIRECTS } from '../index.js'
import { setState } from '../../store/store.js'

// Debug page (#debug or ?debug=1), not in the navigation. Everything here is generated: the sections, routes, layers and
// panels come from the registries, the endpoints from engine/contract/openapi.json, and the task that added each one from
// GET /debug/features (the merged hub tasks). Each row has a button that opens the thing in place.
const fixtures = import.meta.glob('../../../../engine/contract/fixtures/*.json', { import: 'default' })
const FIXTURE_OF = { '/unseen/carbon': 'carbon', '/unseen/ghost-wind': 'ghost_wind' }
const fixtureName = (path) => FIXTURE_OF[path] ?? path.replace(/^\//, '').replace(/[/-]/g, '_')

const when = (t) => (t ? new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ') : '')

function listedIn(panelId) {
  return SECTIONS.filter((s) => (s.panels ?? []).includes(panelId) || (s.more ?? []).includes(panelId)).map((s) => s.id)
}

function showLayer(id) {
  openSection('now')
  setState((s) => ({ mode: 'overview', layers: { ...s.layers, [id]: true } }))
}

function showPanel(p) {
  const mode = p.modes?.[0] ?? 'overview'
  const sec = SECTIONS.find((s) => (s.panels ?? []).includes(p.id) || (s.more ?? []).includes(p.id)) ?? SECTIONS.find((s) => !s.href && s.mode === mode) ?? SECTIONS[0]
  openSection(sec.id)
  setState({ forcePanels: [p.id], mode })
}

function paramsFor(op) {
  const q = new URLSearchParams()
  for (const p of op.parameters ?? []) {
    if (p.in !== 'query' || !p.required) continue
    const sch = p.schema ?? {}
    q.set(p.name, sch.enum?.[0] ?? sch.default ?? sch.example ?? (sch.type === 'number' || sch.type === 'integer' ? 1 : 'GB'))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

async function probe(path, op) {
  const t0 = performance.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30000)
    const res = await fetch(`/api${path}${paramsFor(op)}`, { signal: ctrl.signal })
    clearTimeout(timer)
    const text = await res.text()
    const ms = Math.round(performance.now() - t0)
    let kind = res.ok ? 'live' : 'error'
    const load = fixtures[`../../../../engine/contract/fixtures/${fixtureName(path)}.json`]
    if (res.ok && load) {
      try {
        if (JSON.stringify(JSON.parse(text)) === JSON.stringify(await load())) kind = 'fixture'
      } catch { /* not JSON: leave as live */ }
    }
    return { status: res.status, ms, bytes: text.length, kind }
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), bytes: 0, kind: 'error', err: String(e.message ?? e).slice(0, 60) }
  }
}

function Flags({ f }) {
  if (!f) return null
  return (
    <>
      {f.orphan && <span className="dbg-b warn" title={f.orphan_reason}>orphan</span>}
      {f.paused && <span className="dbg-b off" title={f.paused}>paused</span>}
    </>
  )
}

function Added({ f }) {
  if (!f) return null
  const t = f.added_by
  if (!t) return <span className="dbg-faint">no merged task</span>
  return <span title={`${t.title}\n${t.paths.join(' ')}`}>#{t.id} · {t.agent} · {when(t.merged_at)}<span className="dbg-faint"> {t.title.replace(/^\[[^\]]*\]\s*/, '').slice(0, 44)}</span></span>
}

function Block({ title, count, children, note }) {
  return (
    <section className="dbg-block">
      <h2>{title} <span className="dbg-faint">{count}</span></h2>
      {note && <p className="dbg-note">{note}</p>}
      <div className="dbg-rows">{children}</div>
    </section>
  )
}

function Row({ name, meta, f, action, label = 'Open', extra }) {
  return (
    <div className="dbg-row">
      <div className="dbg-main"><b>{name}</b><span className="dbg-faint">{meta}</span></div>
      <div className="dbg-added"><Added f={f} /> <Flags f={f} /></div>
      {extra}
      {action && <button className="dbg-open" onClick={action}>{label}</button>}
    </div>
  )
}

function Debug() {
  const [feats, setFeats] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [probes, setProbes] = useState({})
  const [running, setRunning] = useState(false)

  useEffect(() => {
    fetch('/api/debug/features').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then(setFeats).catch((e) => setErr(e.message))
  }, [])

  const by = useMemo(() => Object.fromEntries((feats?.features ?? []).map((f) => [`${f.kind}:${f.id}`, f])), [feats])
  const match = (...s) => !q || s.join(' ').toLowerCase().includes(q.toLowerCase())

  const endpoints = useMemo(() => {
    const out = []
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) out.push({ method: method.toUpperCase(), path, op })
    }
    const inContract = new Set(out.map((e) => `${e.method} ${e.path}`))
    for (const f of feats?.features ?? []) {
      if (f.kind === 'endpoint' && !inContract.has(f.id)) {
        const [method, path] = f.id.split(' ')
        out.push({ method, path, op: {}, extra: true })
      }
    }
    return out
  }, [feats])

  async function runAll() {
    setRunning(true)
    setProbes({})
    for (const e of endpoints) {
      if (e.method !== 'GET' || e.path.includes('{')) continue
      const key = `${e.method} ${e.path}`
      setProbes((p) => ({ ...p, [key]: { kind: 'running' } }))
      const r = await probe(e.path, e.op)
      setProbes((p) => ({ ...p, [key]: r }))
    }
    setRunning(false)
  }

  const counts = feats ? { orphans: feats.orphans.length, paused: feats.paused.length, none: feats.no_task.length } : null
  const redirects = Object.entries(REDIRECTS)

  return (
    <div className="dbg">
      <header className="dbg-head">
        <div>
          <a href="#/" className="dbg-back">← Back to the map</a>
          <h1>Debug: everything in the build</h1>
          <p className="dbg-note">Generated from the code. Each row says which merged task added it. Orphans are not linked from any section; paused ones are switched off by the current direction.</p>
        </div>
        <div className="dbg-tools">
          <input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="dbg-open primary" onClick={runAll} disabled={running}>{running ? 'Checking…' : 'Check every endpoint'}</button>
        </div>
      </header>

      {err && <p className="dbg-err">GET /debug/features failed ({err}). Rows below show everything except which task added it.</p>}
      {feats && (
        <p className="dbg-sum">
          {feats.features.length} features · hub tasks merged {feats.hub_db.merged_tasks}{!feats.hub_db.readable && ' (hub database unreadable)'} ·{' '}
          <b>{counts.orphans}</b> orphans · <b>{counts.paused}</b> paused · <b>{counts.none}</b> with no merged task
          {feats.paused_tasks.length > 0 && <> · paused tasks: {feats.paused_tasks.map((t) => `#${t.id} (${t.status})`).join(', ')}</>}
        </p>
      )}

      <Block title="Sections" count={SECTIONS.length} note="The six tabs. Open switches the map to that section with its layer preset.">
        {SECTIONS.filter((s) => match(s.id, s.label, ...(s.panels ?? []), ...(s.more ?? []))).map((s) => (
          <Row key={s.id} name={s.label} meta={`${s.id} · ${s.href ? s.href : `${s.mode}, panels ${(s.panels ?? []).join(', ')}${s.more?.length ? `, more ${s.more.join(', ')}` : ''}`}`} f={by[`section:${s.id}`]} action={() => openSection(s.id)} />
        ))}
      </Block>

      <Block title="Routes" count={VIEWS.length + redirects.length} note="Stand-alone pages. The owner is the section whose tab stays lit.">
        {[...VIEWS].sort((a, b) => a.path.localeCompare(b.path)).filter((v) => match(v.path, v.title)).map((v) => (
          <Row key={v.path} name={`#${v.path}`} meta={`${v.title} · ${sectionOfPath(v.path) ? `in ${sectionOfPath(v.path)}` : 'no section'}`} f={by[`view:${v.path}`]} action={() => { location.hash = `#${v.path}` }} />
        ))}
        {redirects.filter(([from, to]) => match(from, to)).map(([from, to]) => (
          <Row key={from} name={`#${from}`} meta={`redirects to ${to}`} action={() => { location.hash = `#${from}` }} />
        ))}
      </Block>

      <Block title="Layers" count={LAYERS.length} note="Open turns the layer on and shows the Now map. All layers sit in the Layers menu.">
        {LAYERS.filter((l) => match(l.id, l.label)).map((l) => (
          <Row key={l.id} name={l.label ?? l.id} meta={`${l.id} · modes ${(l.modes ?? []).join(', ')} · ${l.defaultOn === false ? 'off' : 'on'} by default`} f={by[`layer:${l.id}`]} action={() => showLayer(l.id)} label="Show" />
        ))}
      </Block>

      <Block title="Panels" count={PANELS.length} note="Show forces the panel visible in its section, including panels that live in a More drawer.">
        {PANELS.filter((p) => match(p.id, listedIn(p.id).join(' '))).map((p) => (
          <Row key={p.id} name={p.id} meta={`slot ${p.slot} · modes ${(p.modes ?? []).join(', ')} · in ${listedIn(p.id).join(', ') || 'no section'}`} f={by[`panel:${p.id}`]} action={() => showPanel(p)} label="Show" />
        ))}
      </Block>

      <Block title="API endpoints" count={endpoints.length} note="From engine/contract/openapi.json plus routes outside the contract. Check calls each GET and says whether the answer is live data or the bundled fixture.">
        {endpoints.filter((e) => match(e.method, e.path)).map((e) => {
          const key = `${e.method} ${e.path}`
          const r = probes[key]
          const f = by[`endpoint:${key}`]
          return (
            <Row key={key} name={`${e.method} ${e.path}`} meta={e.extra ? 'not in the contract' : (e.op.summary ?? '')} f={f}
              extra={<div className={`dbg-status ${r?.kind ?? ''}`}>{!r ? (e.method === 'GET' && !e.path.includes('{') ? '' : 'not called') : r.kind === 'running' ? '…' : <>{r.status || 'fail'} · {r.ms} ms · <b>{r.kind}</b></>}</div>}
              action={e.method === 'GET' && !e.path.includes('{') ? async () => { setProbes((p) => ({ ...p, [key]: { kind: 'running' } })); const x = await probe(e.path, e.op); setProbes((p) => ({ ...p, [key]: x })) } : undefined} label="Call" />
          )
        })}
      </Block>

      {feats && (
        <Block title="Engine, ingest and module code" count={feats.features.filter((f) => ['engine', 'ingest', 'module'].includes(f.kind)).length} note="Folders and files with no screen of their own.">
          {feats.features.filter((f) => ['engine', 'ingest', 'module'].includes(f.kind) && match(f.kind, f.id)).map((f) => (
            <Row key={`${f.kind}:${f.id}`} name={f.id} meta={f.kind} f={f} />
          ))}
        </Block>
      )}
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.dbg { height: 100%; overflow-y: auto; padding: 24px clamp(16px, 4vw, 56px) 80px; background: var(--bg); color: var(--text); }
.dbg h1 { margin: 6px 0 4px; font-size: 28px; font-weight: 500; letter-spacing: -0.02em; }
.dbg h2 { margin: 0 0 6px; font-size: 16px; font-weight: 600; }
.dbg-head { display: flex; gap: 24px; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; }
.dbg-back { color: var(--text-2); font-size: 13px; text-decoration: none; }
.dbg-note { margin: 2px 0 8px; color: var(--text-3); font-size: 12px; max-width: 760px; line-height: 1.45; }
.dbg-sum { margin: 14px 0 0; padding: 10px 14px; border-radius: 8px; background: var(--panel-solid); border: 1px solid var(--line-2); font-size: 13px; }
.dbg-err { color: #f5b942; font-size: 13px; }
.dbg-tools { display: flex; gap: 8px; }
.dbg-tools input { width: 220px; padding: 9px 12px; border-radius: 8px; background: var(--panel-solid); border: 1px solid var(--line-2); color: var(--text); }
.dbg-block { margin-top: 26px; }
.dbg-rows { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.dbg-row { display: grid; grid-template-columns: minmax(180px, 1.1fr) minmax(220px, 1.6fr) auto auto; gap: 12px; align-items: center; padding: 9px 14px; border-top: 1px solid var(--line); font-size: 13px; }
.dbg-row:first-child { border-top: 0; }
.dbg-row:hover { background: rgba(255,255,255,.03); }
.dbg-main { display: flex; flex-direction: column; min-width: 0; }
.dbg-main b { font-weight: 600; overflow-wrap: anywhere; }
.dbg-main span, .dbg-faint { color: var(--text-3); font-size: 12px; }
.dbg-added { min-width: 0; }
.dbg-b { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 99px; font-size: 11px; font-weight: 600; }
.dbg-b.warn { background: #f5b942; color: #1b1300; }
.dbg-b.off { background: #404040; color: #e5e5e5; }
.dbg-status { min-width: 150px; font: 500 12px var(--mono); color: var(--text-2); text-align: right; }
.dbg-status.live b { color: #6dd58c; } .dbg-status.fixture b { color: #f5b942; } .dbg-status.error b { color: #ff6b6b; }
.dbg-open { padding: 6px 12px; border-radius: 6px; background: var(--card-2); color: var(--text); font-size: 12px; font-weight: 600; }
.dbg-open.primary { background: #fafafa; color: #0a0a0a; padding: 9px 14px; }
.dbg-open:disabled { opacity: .5; }
@media (max-width: 800px) { .dbg-row { grid-template-columns: 1fr auto; } .dbg-added { grid-column: 1 / -1; } .dbg-status { text-align: left; } }
`

export default { path: '/debug', title: 'Debug', Component: Debug }
