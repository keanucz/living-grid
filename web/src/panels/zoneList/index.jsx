import { useState } from 'react'
import { line } from 'd3-shape'
import { scaleLinear } from 'd3-scale'
import { Icon } from '../../shell/icons.jsx'
import { actions } from '../../store/store.js'
import { fmt, priceColor } from '../../styles/tokens.js'

const MIX_COLOR = { wind: 'var(--wind)', solar: '#facc15', nuclear: 'var(--nuclear)', gas: 'var(--gas)', hydro: 'var(--hydro)', coal: '#8b6f5a', biomass: '#84a35b', imports: '#5d5d58' }

function Spark({ series }) {
  const pts = series.filter((r) => r.actual != null)
  const x = scaleLinear().domain([0, pts.length - 1]).range([0, 72])
  const vals = pts.map((r) => r.actual)
  const y = scaleLinear().domain([Math.min(...vals), Math.max(...vals)]).range([22, 2])
  const d = line().x((_, i) => x(i)).y((r) => y(r.actual))(pts)
  return (
    <svg width="72" height="24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function Row({ z, st, on }) {
  const c = priceColor(st.price_eur)
  const up = st.change_24h_eur >= 0
  return (
    <div className={`zrow ${on ? 'on' : ''}`} onClick={() => actions.selectZone(z.id)}>
      <div className="zrow-main">
        <div className="zav" style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }}>{z.id.replace('-LU', '')}</div>
        <div className="zname">
          <div>{z.name}</div>
          <div className="faint num">{fmt.gw(st.demand_mw)} demand</div>
        </div>
        <div className="zspark" style={{ color: on ? 'var(--accent)' : 'var(--text-3)' }}><Spark series={st.series} /></div>
        <div className="zprice">
          <div className="num">{fmt.price(st.price, st.currency)}</div>
          <div className={`pill-delta ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {Math.abs(st.change_24h_eur).toFixed(1)}</div>
        </div>
      </div>
      {on && (
        <div className="zdetail fade-in">
          <div className="mixbar">
            {Object.entries(st.mix).map(([k, v]) => (
              <span key={k} title={`${k} ${(v * 100).toFixed(0)}%`} style={{ flex: v, background: MIX_COLOR[k] ?? '#777' }} />
            ))}
          </div>
          <div className="mixlegend">
            {Object.entries(st.mix).slice(0, 4).map(([k, v]) => (
              <span key={k}><i style={{ background: MIX_COLOR[k] }} />{k} {(v * 100).toFixed(0)}%</span>
            ))}
          </div>
          <div className="zfacts">
            <div><span className="faint">Net {st.net_import_mw >= 0 ? 'import' : 'export'}</span><b className="num">{fmt.gw(Math.abs(st.net_import_mw))}</b></div>
            <div><span className="faint">Carbon</span><b className="num">{st.carbon.consumption_gco2_kwh} g/kWh</b></div>
          </div>
        </div>
      )}
    </div>
  )
}

function ZoneList({ ctx }) {
  const [q, setQ] = useState('')
  const zones = ctx.data.zones?.zones ?? []
  const shown = zones.filter((z) => `${z.id} ${z.name}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <section className="panel zonelist fade-in">
      <div className="panel-head">
        <span>Zones</span>
        <button className="square-btn" title="Open zone detail"><Icon name="arrowUpRight" size={15} /></button>
      </div>
      <div className="zsearch">
        <label className="search">
          <Icon name="search" size={15} />
          <input placeholder="Search zone" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="zrows">
        {shown.map((z) => ctx.stateByZone[z.id] && (
          <Row key={z.id} z={z} st={ctx.stateByZone[z.id]} on={ctx.ui.selectedZone === z.id} />
        ))}
      </div>
      <style>{CSS}</style>
    </section>
  )
}

const CSS = `
.zonelist { display: flex; flex-direction: column; min-height: 0; max-height: 100%; }
.zsearch { padding: 0 14px 10px; }
.search { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-radius: 12px; background: var(--card); color: var(--text-3); border: 1px solid var(--line); }
.search input { flex: 1; background: none; border: 0; outline: 0; }
.zrows { overflow-y: auto; padding: 0 8px 10px; }
.zrow { padding: 10px; border-radius: 14px; cursor: pointer; border: 1px solid transparent; transition: background .2s; }
.zrow:hover { background: rgba(255,255,255,.03); }
.zrow.on { background: linear-gradient(100deg, rgba(197,240,107,.10), rgba(197,240,107,.02) 70%); border-color: rgba(197,240,107,.22); }
.zrow-main { display: flex; align-items: center; gap: 12px; }
.zav { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.5); flex: none; }
.zname { flex: 1; min-width: 0; font-weight: 500; }
.zname > div:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zname .faint { font-size: 12px; margin-top: 2px; font-weight: 400; }
.zprice { text-align: right; font-weight: 600; }
.zdetail { padding: 12px 2px 2px; }
.mixbar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; gap: 2px; }
.mixlegend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; font-size: 11px; color: var(--text-2); text-transform: capitalize; }
.mixlegend i { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 5px; }
.zfacts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.zfacts > div { background: var(--card); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.zfacts b { font-size: 15px; }
`

export default { id: 'zoneList', slot: 'left', order: 10, modes: ['overview'], Component: ZoneList }
