import { useEffect, useState } from 'react'
import { api } from '../../api/client.js'
import { Icon } from '../../shell/icons.jsx'
import { actions } from '../../store/store.js'
import Explain from '../../ui/Explain.jsx'
import Term from '../../ui/Term.jsx'
import Builder from '../../views/datacentre/Builder.jsx'
import compute from '../compute/index.jsx'
import { RESULT_CSS, ResultCard, duration } from './Result.jsx'
import { EVENTS, HOUSEHOLD, KEY, answer, why } from './copy.js'

// What if (ELI5 step 3): four picture cards; a tap runs that event at its defaults (POST /intervene, or the
// pre-computed /scenarios result if the API cannot be reached) and the answer is one sentence and one number.
// Everything that was here before (magnitude, likely range, method, battery, ghost wind, winners and losers, the
// data centre builder and AI cost) is under "For experts".
const magLabel = (v, unit) => (unit.startsWith('MW') ? `${(v / 1000).toFixed(1)} GW` : `+${v}%`)
const SYM = { GBP: '£', EUR: '€' }

// The figures layer 1 needs, from a raw InterventionResult (live or pre-computed).
function figures(res, deltaEur, zoneById) {
  const zones = res?.zones ?? []
  const total = res?.cost_total_gbp?.p50 ?? zones.reduce((a, z) => a + (z.cost_gbp ?? 0), 0)
  const gb = zones.find((z) => z.zone === 'GB')?.avg_delta ?? 0
  const rising = zones.some((z) => (deltaEur?.[z.zone] ?? 0) > 0)
  const ranked = [...zones].sort((a, b) => (rising ? (deltaEur[b.zone] ?? 0) - (deltaEur[a.zone] ?? 0) : (deltaEur[a.zone] ?? 0) - (deltaEur[b.zone] ?? 0)))
  const top = ranked[0]
  const biggest = top && Math.abs(top.avg_delta) >= 0.005
    ? { name: zoneById[top.zone]?.name ?? top.zone, delta: top.avg_delta, sym: SYM[top.currency] ?? '€' }
    : null
  return { total, gb, biggest }
}

function SimDock({ ctx }) {
  const all = ctx.data.scenarios
  const armed = ctx.ui.scenarioArmed
  const ev = EVENTS.find((e) => e.id === armed)
  const sc = all?.[armed]
  const [mags, setMags] = useState({})
  const mag = mags[armed] ?? sc?.magnitude ?? 0
  const [run, setRun] = useState({ status: 'idle', result: null, key: 0, type: null })
  const [dcOpen, setDcOpen] = useState(false)

  const go = async (id, magnitude) => {
    const s = all?.[id]
    if (!s) return
    const key = Date.now()
    actions.armScenario(id)
    actions.runScenario(id, magnitude)
    actions.setLiveResult(null, null)
    setRun({ status: 'running', result: null, key, type: id })
    try {
      const result = await api.intervene({ type: id, magnitude, hours: s.hours })
      setRun({ status: 'done', result, key, type: id })
      actions.setLiveResult(id, result)
    } catch {
      setRun({ status: 'fallback', result: null, key, type: id })
    }
  }

  // The map colours each country by its change while a result is up, so the price legend would mislead.
  // Also shown when something else ran it (the tour arms and runs a scenario without this panel).
  const mine = run.type === armed
  const shown = !!sc && ctx.ui.scenario?.id === armed && (mine ? run.status === 'done' || run.status === 'fallback' : true)
  useEffect(() => {
    const el = document.documentElement
    if (shown) el.dataset.simChange = '1'
    else delete el.dataset.simChange
    return () => delete el.dataset.simChange
  }, [shown])

  if (!all) return null
  const live = mine && run.status === 'done'
  const res = live ? run.result : sc?.result
  const f = shown && res ? figures(res, ctx.scenario?.price_delta_eur ?? sc.price_delta_eur, ctx.zoneById) : null
  const hours = live ? res.applied_hours : sc?.hours
  const usedMag = live ? res.applied_magnitude : sc?.magnitude
  const a = f && answer(armed, usedMag, hours, f.total, f.gb)

  return (
    <>
      <section className="wi-cards fade-in" aria-label="What if">
        {EVENTS.map((e) => (
          <button key={e.id} className={`wi-card ${e.id === armed && shown ? 'on' : ''}`} onClick={() => go(e.id, mags[e.id] ?? all[e.id]?.magnitude)}
            disabled={!all[e.id] || run.status === 'running'} aria-pressed={e.id === armed && shown}>
            <span className="wi-ic"><Icon name={e.icon} size={28} /></span>
            <b>{e.title}</b>
            {e.sub && <span className="wi-sub">{e.sub}</span>}
          </button>
        ))}
      </section>

      {run.status === 'running' && <div className="faint wi-wait" aria-live="polite">Working it out…</div>}

      {shown && f && (
        <Explain
          key={run.key}
          icon={<Icon name={ev.icon} size={18} />}
          question={ev.title}
          tag={live ? 'Modelled' : 'Pre-computed'}
          answer={
            <>
              <p>{a.clause} {a.bill.before}<Term id="wholesale">wholesale</Term>{a.bill.after}{a.tail}</p>
              <p className="wi-house">{HOUSEHOLD}</p>
              <p className="wi-key"><span className="wi-ramp" aria-hidden="true" />{KEY}</p>
            </>
          }
          why={why(armed, f.biggest)}
          experts={
            <div className="wi-experts">
              <div className="sim-sub">Magnitude</div>
              <div className="segs">
                {Array.from({ length: 10 }, (_, i) => (
                  <button key={i} className={i < Math.round((mag / ev.max) * 10) ? 'on' : ''} onClick={() => setMags((m) => ({ ...m, [armed]: (i + 1) * ev.step }))}
                    aria-label={`Set magnitude ${i + 1} of 10`} />
                ))}
              </div>
              <div className="segs-scale faint"><span>0</span><span>{magLabel(ev.max, sc.magnitude_unit)}</span></div>
              <div className="sim-tiles">
                <div><span>{sc.magnitude_unit.replace(/^% /, '').replace('MW lost', 'Lost')}</span><b className="num">{magLabel(mag, sc.magnitude_unit)}</b></div>
                <div><span>Duration</span><b className="num">{duration(sc.hours)}</b></div>
                <div><span>Zones hit</span><b className="num">{Object.values(sc.price_delta_eur).filter((d) => Math.abs(d) >= 1).length} of 6</b></div>
              </div>
              <div className="sim-actions">
                <button className="btn ghost" onClick={() => { actions.clearScenario(); setRun({ status: 'idle', result: null, key: run.key, type: null }) }}>
                  <Icon name="reset" size={16} /> Reset
                </button>
                <button className="btn primary" onClick={() => go(armed, mag)} disabled={run.status === 'running'}>
                  <Icon name="play" size={14} fill="currentColor" /> Run again
                </button>
              </div>
              <ResultCard result={live ? res : null} scenario={sc} runKey={run.key} />
              <div className="faint note">Gas and carbon pass-through approximates market coupling. The map shows the pre-computed shape scaled to your magnitude; the figures come from the live model.</div>
              <button className="sim-row dc-toggle" onClick={() => setDcOpen((v) => !v)} aria-expanded={dcOpen}>
                <span className="sim-title">Data centre builder</span>
                <span style={{ flex: 1 }} />
                <span className="faint" style={{ fontSize: 12 }}>{dcOpen ? 'Hide' : 'Cost, carbon and grid for a GPU site'}</span>
              </button>
              {dcOpen && <div style={{ marginTop: 12 }}><Builder initialZone={ctx.ui.selectedZone} /></div>}
              <compute.Component ctx={ctx} />
            </div>
          }
        />
      )}
      <style>{CSS}</style>
    </>
  )
}

const CSS = `
${RESULT_CSS}
.wi-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.wi-card { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-height: 132px; padding: 16px; border-radius: 22px; text-align: left;
  background: var(--panel-solid); border: 1px solid var(--line); box-shadow: var(--shadow); color: var(--text); transition: border-color .15s, background .15s; }
.wi-card:hover { border-color: var(--line-2); }
.wi-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.wi-card.on { background: var(--hot-dim); border-color: rgba(255,138,31,.35); }
.wi-card:disabled { cursor: progress; }
.wi-card b { font-size: 16px; font-weight: 600; line-height: 1.25; }
.wi-sub { font-size: 12px; color: var(--text-2); }
.wi-ic { width: 52px; height: 52px; border-radius: 16px; background: var(--card); display: grid; place-items: center; color: var(--hot); margin-bottom: 4px; }
.wi-wait { font-size: 13px; padding: 0 6px; }
.wi-house { font-size: 15px; color: var(--text-2); font-weight: 400; }
.wi-key { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); font-weight: 400; }
.wi-ramp { width: 56px; height: 8px; border-radius: 4px; background: linear-gradient(90deg, rgb(60,60,58), rgb(214,64,48)); flex: none; }
.wi-experts { display: flex; flex-direction: column; gap: 10px; }
.wi-experts .sim-card { padding: 0; border: 0; box-shadow: none; background: none; }
[data-sim-change] .legend { display: none; }
.btn:disabled { opacity: .6; cursor: progress; }
.sim-card { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 28px; padding: 18px; box-shadow: var(--shadow); }
.sim-row { display: flex; align-items: center; gap: 10px; }
.sim-title { font-size: 15px; font-weight: 600; }
.sim-sub { font-weight: 600; color: var(--text); }
.segs { display: flex; gap: 6px; }
.segs button { flex: 1; height: 40px; border-radius: 10px; background: var(--card-2); transition: background .15s; }
.segs button.on { background: var(--hot); }
.segs-scale { display: flex; justify-content: space-between; font-size: 12px; }
.sim-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.sim-tiles > div { background: var(--card); border-radius: 16px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.sim-tiles span { font-size: 12px; color: var(--text-2); text-transform: capitalize; }
.sim-tiles b { font-size: 16px; color: var(--text); }
.sim-actions { display: grid; grid-template-columns: 1fr 1.4fr; gap: 10px; }
.btn { height: 44px; border-radius: 999px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 8px; color: var(--text); }
.btn.ghost { background: var(--card-2); }
.btn.primary { background: var(--hot); color: #1b0d00; }
.why { margin: 12px 0; line-height: 1.5; color: var(--text); }
.wl { display: flex; flex-direction: column; gap: 8px; }
.wl > div { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; }
.wl .faint { width: 58px; }
.dc-toggle { width: 100%; background: none; color: var(--text); text-align: left; padding: 8px 0; }
.mode-simulate .slot-left { overflow-y: auto; scrollbar-width: none; }
`

export default { id: 'simDock', slot: 'left', order: 10, modes: ['simulate'], Component: SimDock }
