import { useEffect, useState } from 'react'
import { Icon } from '../../shell/icons.jsx'
import { actions } from '../../store/store.js'
import { fmt } from '../../styles/tokens.js'

// Rough placeholder for the world-events menu; task #11 replaces it with the real /intervene flow.
const EVENTS = [
  { id: 'hormuz', icon: 'ship', max: 100, step: 10 },
  { id: 'interconnector_trip', icon: 'plug', max: 1400, step: 140 },
  { id: 'nuclear_outage', icon: 'atom', max: 10000, step: 1000 },
  { id: 'scottish_storm', icon: 'storm', max: 70, step: 7 },
]

const duration = (h) => (h >= 168 ? `${Math.round(h / 168)} wk` : h >= 48 ? `${Math.round(h / 24)} days` : `${h} h`)
const magLabel = (v, unit) => (unit.startsWith('MW') ? `${(v / 1000).toFixed(1)} GW` : `+${v}%`)

function SimDock({ ctx }) {
  const all = ctx.data.scenarios
  const armed = ctx.ui.scenarioArmed
  const ev = EVENTS.find((e) => e.id === armed)
  const sc = all?.[armed]
  const [mag, setMag] = useState(sc?.magnitude ?? 0)
  useEffect(() => setMag(sc?.magnitude ?? 0), [armed, sc?.magnitude])
  if (!all || !sc) return null

  const filled = Math.round((mag / ev.max) * 10)
  const ran = ctx.ui.scenario?.id === armed
  const zonesHit = Object.values(sc.price_delta_eur).filter((d) => Math.abs(d) >= 1).length

  return (
    <>
      <section className="sim-card dark fade-in">
        <div className="sim-row">
          <button className="sim-round" onClick={() => actions.setMode('overview')} title="Back to overview"><Icon name="back" /></button>
          <span className="sim-title">Scenario</span>
          <span className="tag hot">{sc.kind}</span>
          <span style={{ flex: 1 }} />
          <button className="sim-round" title="Settings"><Icon name="settings" size={17} /></button>
        </div>
        <div className="sim-hero">
          <div className="sim-icon"><Icon name={ev.icon} size={26} /></div>
          <div>
            <div className="sim-name">{sc.label}</div>
            <div className="muted">{sc.summary}</div>
          </div>
        </div>
        <div className="sim-sub">Magnitude</div>
        <div className="segs">
          {Array.from({ length: 10 }, (_, i) => (
            <button key={i} className={i < filled ? 'on' : ''} onClick={() => setMag((i + 1) * ev.step)} aria-label={`Set magnitude ${i + 1} of 10`} />
          ))}
        </div>
        <div className="segs-scale faint"><span>0</span><span>{magLabel(ev.max, sc.magnitude_unit)}</span></div>
        <div className="sim-tiles">
          <div><span>{sc.magnitude_unit.replace(/^% /, '').replace('MW lost', 'Lost')}</span><b className="num">{magLabel(mag, sc.magnitude_unit)}</b></div>
          <div><span>Duration</span><b className="num">{duration(sc.hours)}</b></div>
          <div><span>Zones hit</span><b className="num">{zonesHit} of 6</b></div>
        </div>
      </section>

      <section className="sim-card fade-in">
        <div className="sim-row" style={{ marginBottom: 6 }}>
          <span className="sim-title">World events</span>
          <span style={{ flex: 1 }} />
          <span className="faint" style={{ fontSize: 12 }}>One tap, sensible defaults</span>
        </div>
        {EVENTS.map((e) => {
          const s = all[e.id]
          return (
            <button key={e.id} className={`ev ${e.id === armed ? 'on' : ''}`} onClick={() => actions.armScenario(e.id)}>
              <span className="ev-ic"><Icon name={e.icon} size={17} /></span>
              <span className="ev-txt"><b>{s.label}</b><span>{s.kind}</span></span>
              <Icon name="arrowUpRight" size={15} />
            </button>
          )
        })}
        <div className="sim-actions">
          <button className="btn ghost" onClick={actions.clearScenario}><Icon name="reset" size={16} /> Reset</button>
          <button className="btn primary" onClick={() => actions.runScenario(armed, mag)}><Icon name="play" size={14} fill="currentColor" /> {ran ? 'Run again' : 'Run scenario'}</button>
        </div>
      </section>

      {ctx.scenario && (
        <section className="sim-card fade-in" key={ctx.ui.scenario.ranAt}>
          <div className="sim-row"><span className="sim-title">Why prices moved</span><span style={{ flex: 1 }} /><span className="tag">Modelled</span></div>
          <p className="why">{ctx.scenario.explanation}</p>
          <div className="wl">
            <div><span className="faint">Winners</span>{ctx.scenario.winners.map((w) => <span key={w} className="tag accent">{w}</span>)}</div>
            <div><span className="faint">Losers</span>{ctx.scenario.losers.map((w) => <span key={w} className="tag hot">{w}</span>)}</div>
          </div>
          <div className="faint" style={{ fontSize: 11, marginTop: 10 }}>Gas and carbon pass-through approximates market coupling. Total {fmt.money(ctx.scenario.cost_gbp * ctx.scenario.scale)} over {duration(ctx.scenario.hours)}.</div>
        </section>
      )}
      <style>{CSS}</style>
    </>
  )
}

const CSS = `
.sim-card { background: var(--panel-solid); border: 1px solid var(--line); border-radius: 28px; padding: 18px; box-shadow: var(--shadow); }
.sim-card.dark { background: #0d0d0d; }
.sim-row { display: flex; align-items: center; gap: 10px; }
.sim-title { font-size: 17px; font-weight: 600; }
.sim-round { width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; background: var(--card); color: var(--text); }
.sim-round:hover { background: var(--card-2); }
.sim-hero { display: flex; gap: 14px; align-items: center; margin: 18px 0 20px; }
.sim-icon { width: 60px; height: 60px; border-radius: 18px; background: var(--card); display: grid; place-items: center; color: var(--hot); flex: none; }
.sim-name { font-size: 17px; font-weight: 600; margin-bottom: 3px; }
.sim-sub { font-weight: 600; margin-bottom: 10px; }
.segs { display: flex; gap: 6px; }
.segs button { flex: 1; height: 46px; border-radius: 10px; background: var(--card-2); transition: background .15s, transform .15s; }
.segs button.on { background: var(--hot); box-shadow: 0 0 18px rgba(255,138,31,.25); }
.segs button:hover { transform: translateY(-2px); }
.segs-scale { display: flex; justify-content: space-between; font-size: 12px; margin-top: 8px; }
.sim-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 16px; }
.sim-tiles > div { background: var(--card); border-radius: 16px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.sim-tiles span { font-size: 12px; color: var(--text-2); text-transform: capitalize; }
.sim-tiles b { font-size: 16px; }
.ev { width: 100%; display: flex; align-items: center; gap: 12px; padding: 9px; border-radius: 16px; text-align: left; color: var(--text-2); border: 1px solid transparent; }
.ev:hover { background: rgba(255,255,255,.03); }
.ev.on { background: var(--hot-dim); border-color: rgba(255,138,31,.3); color: var(--hot); }
.ev-ic { width: 38px; height: 38px; border-radius: 50%; background: var(--card); display: grid; place-items: center; color: var(--text); flex: none; }
.ev.on .ev-ic { background: var(--hot); color: #1b0d00; }
.ev-txt { flex: 1; display: flex; flex-direction: column; }
.ev-txt b { color: var(--text); font-weight: 500; }
.ev-txt span { font-size: 12px; }
.sim-actions { display: grid; grid-template-columns: 1fr 1.4fr; gap: 10px; margin-top: 14px; }
.btn { height: 48px; border-radius: 999px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.btn.ghost { background: var(--card-2); }
.btn.primary { background: var(--hot); color: #1b0d00; box-shadow: 0 8px 24px rgba(255,138,31,.3); }
.btn.primary:hover { filter: brightness(1.08); }
.why { margin: 12px 0; line-height: 1.5; color: var(--text); }
.wl { display: flex; flex-direction: column; gap: 8px; }
.wl > div { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; }
.wl .faint { width: 58px; }
.mode-simulate .slot-left { overflow-y: auto; scrollbar-width: none; }
`

export default { id: 'simDock', slot: 'left', order: 10, modes: ['simulate'], Component: SimDock }
