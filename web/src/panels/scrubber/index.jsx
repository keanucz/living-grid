import { useEffect, useState } from 'react'
import { actions } from '../../store/store.js'

const hourIso = (t) => {
  const d = new Date(t)
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString().replace('.000Z', 'Z')
}

function Scrubber({ ctx }) {
  const nowH = Date.parse(hourIso(Date.now()))
  const committed = ctx.ui.at ? Math.round((Date.parse(ctx.ui.at) - nowH) / 3600e3) : 0
  const [h, setH] = useState(committed)
  useEffect(() => setH(committed), [committed])
  const commit = (v) => actions.setAt(v === 0 ? null : hourIso(nowH + v * 3600e3))
  const when = new Date(nowH + h * 3600e3).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
  const kind = h > 0 ? 'Forecast' : h < 0 ? 'Actual' : 'Now'

  return (
    <section className="panel scrubber fade-in">
      <div className="scrub-head">
        <span className={`tag ${h > 0 ? 'accent' : ''}`}>{kind}</span>
        <b className="num">{h === 0 ? 'Now' : `${h > 0 ? '+' : '−'}${Math.abs(h)} h`}</b>
        <span className="faint num">{when} UTC</span>
        <span style={{ flex: 1 }} />
        {h !== 0 && <button className="scrub-live" onClick={() => (setH(0), commit(0))}>Back to now</button>}
      </div>
      <input
        type="range" min={-24} max={24} step={1} value={h}
        aria-label="Hours from now"
        onChange={(e) => setH(+e.target.value)}
        onPointerUp={(e) => commit(+e.target.value)}
        onKeyUp={(e) => commit(+e.target.value)}
        style={{ '--p': `${((h + 24) / 48) * 100}%` }}
      />
      <div className="scrub-scale faint"><span>−24 h</span><span>now</span><span>+24 h</span></div>
      {h > 0 && <div className="scrub-note">Ghost = forecast P50; fainter where the P10–P90 band is wider.</div>}
      <style>{`
        .mode-overview .slot-bottom { top: 76px; bottom: auto; left: 50%; right: auto; transform: translateX(-50%); max-width: none; }
        .scrubber { width: 400px; padding: 12px 16px 10px; }
        .scrub-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .scrub-head b { font-size: 16px; }
        .scrub-live { font-size: 12px; color: var(--accent); }
        .scrubber input { width: 100%; appearance: none; height: 6px; border-radius: 3px; outline: none;
          background: linear-gradient(90deg, var(--text-3) 0 50%, rgba(197,240,107,.35) 50% 100%); }
        .scrubber input::-webkit-slider-thumb { appearance: none; width: 18px; height: 18px; border-radius: 50%; background: var(--text); box-shadow: 0 0 0 4px rgba(197,240,107,.25); cursor: grab; }
        .scrubber input::-moz-range-thumb { width: 18px; height: 18px; border: 0; border-radius: 50%; background: var(--text); cursor: grab; }
        .scrub-scale { display: flex; justify-content: space-between; font-size: 11px; margin-top: 4px; }
        .scrub-note { font-size: 11px; color: var(--text-2); margin-top: 6px; }
      `}</style>
    </section>
  )
}

export default { id: 'scrubber', slot: 'bottom', order: 10, modes: ['overview'], Component: Scrubber }
