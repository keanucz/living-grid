import { useEffect, useState } from 'react'
import { api } from '../../api/client.js'
import { Icon } from '../../shell/icons.jsx'

const STRATS = [
  { id: 'risk_aware', label: 'Risk-aware', color: 'var(--accent)' },
  { id: 'median_only', label: 'Median-only', color: 'var(--hydro)' },
  { id: 'naive', label: 'Naive (cheap night, sell evening)', color: 'var(--text-3)' },
  { id: 'perfect_foresight', label: 'Perfect foresight', color: 'var(--text-2)' },
]

function Battery({ ctx }) {
  const [rows, setRows] = useState(null)
  const [zone, setZone] = useState(ctx.ui.selectedZone ?? 'GB')
  useEffect(() => {
    let live = true
    const load = () => api.scores().then((r) => live && setRows(r.data?.battery ?? [])).catch(() => live && setRows([]))
    load()
    const id = setInterval(load, 5 * 60_000)
    return () => ((live = false), clearInterval(id))
  }, [])
  if (!rows?.length) return null

  const zones = [...new Set(rows.map((r) => r.zone))]
  const z = zones.includes(zone) ? zone : zones[0]
  const by = Object.fromEntries(rows.filter((r) => r.zone === z).map((r) => [r.strategy, r]))
  const cur = by.perfect_foresight?.currency === 'GBP' ? '£' : '€'
  const max = Math.max(1, ...STRATS.map((s) => Math.abs(by[s.id]?.profit ?? 0)))
  const ra = by.risk_aware
  const mo = by.median_only
  const lossGap = ra && mo && mo.worst_hour_loss != null && ra.worst_hour_loss != null ? mo.worst_hour_loss - ra.worst_hour_loss : null

  return (
    <section className="panel batt fade-in">
      <div className="panel-head">
        <span><Icon name="battery" size={16} /> 1 MW / 2 MWh battery <span className="tag" style={{ marginLeft: 6 }}>Settled on real prices</span></span>
        <div className="batt-zones">
          {zones.map((k) => <button key={k} className={k === z ? 'on' : ''} onClick={() => setZone(k)}>{k}</button>)}
        </div>
      </div>
      <div className="batt-body">
        {STRATS.map((s) => {
          const r = by[s.id]
          if (!r) return null
          const w = (Math.abs(r.profit) / max) * 50
          return (
            <div key={s.id} className="batt-row">
              <span className="batt-l">{s.label}</span>
              <div className="batt-track">
                <i style={{ background: s.color, width: `${w}%`, left: r.profit >= 0 ? '50%' : `${50 - w}%` }} />
                <b className="batt-mid" />
              </div>
              <span className="batt-v num">{r.profit < 0 ? '−' : ''}{cur}{Math.abs(r.profit).toFixed(0)}</span>
              <span className="batt-s num faint">{s.id === 'perfect_foresight' ? 'ceiling' : `${Math.round(r.share_of_perfect * 100)}%`}</span>
            </div>
          )
        })}
        <p className="batt-h">
          {ra && <>Risk-aware earned <b>{Math.round(ra.share_of_perfect * 100)}%</b> of perfect foresight{mo ? <> vs <b>{Math.round(mo.share_of_perfect * 100)}%</b> for median-only</> : null}.</>}
          {lossGap != null && <> Its worst hour cost {cur}{Math.abs(lossGap).toFixed(0)} {lossGap >= 0 ? 'less' : 'more'} than median-only’s.</>}
        </p>
      </div>
      <style>{`
        .batt { width: 560px; }
        .batt .panel-head > span { display: flex; align-items: center; gap: 8px; }
        .batt-zones { display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--card); }
        .batt-zones button { padding: 4px 8px; border-radius: 999px; font-size: 11px; color: var(--text-2); font-weight: 600; }
        .batt-zones button.on { background: var(--card-2); color: var(--accent); }
        .batt-body { padding: 0 18px 16px; }
        .batt-row { display: grid; grid-template-columns: 170px 1fr 64px 44px; gap: 10px; align-items: center; margin-bottom: 8px; font-size: 12px; }
        .batt-l { color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .batt-track { position: relative; height: 10px; background: var(--card); border-radius: 5px; }
        .batt-track i { position: absolute; top: 0; bottom: 0; border-radius: 5px; }
        .batt-mid { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: var(--line-2); }
        .batt-v { text-align: right; font-weight: 600; font-size: 13px; }
        .batt-s { text-align: right; }
        .batt-h { margin: 8px 0 0; font-size: 12px; color: var(--text-2); line-height: 1.45; }
        .batt-h b { color: var(--text); }
      `}</style>
    </section>
  )
}

export default { id: 'battery', slot: 'bottomRight', order: 6, modes: ['simulate'], Component: Battery }
