import { DbConnection } from '../spacetime/index.ts'

// Subscribes to the tables the UI shows and keeps plain-object copies of them, reporting every change.
// The SDK reconnects by itself after a drop; we only report status.
const DB = 'living-grid'
const TABLES = ['zone', 'actual', 'latest_forecast', 'score', 'intervention', 'ghost_wind', 'carbon', 'battery']
const micros = (t) => (t == null ? null : Number(t.microsSinceUnixEpoch))

const ROW = {
  actual: (r) => ({ key: r.key, ts: micros(r.ts), zone: r.zone, series: r.series, value: r.value, unit: r.unit }),
  latest_forecast: (r) => ({ key: r.key, made_at: micros(r.madeAt), zone: r.zone, target: r.target, ts: micros(r.ts), horizon_h: r.horizonH, p10: r.p10, p50: r.p50, p90: r.p90, model_version: r.modelVersion }),
  carbon: (r) => ({ key: r.key, ts: micros(r.ts), zone: r.zone, production_gco2_kwh: r.productionGco2Kwh, consumption_gco2_kwh: r.consumptionGco2Kwh, imports_share: r.importsShare }),
  zone: (r) => ({ key: r.code, code: r.code, name: r.name, currency: r.currency, lat: r.lat, lon: r.lon }),
  score: (r) => ({ key: r.key, zone: r.zone, target: r.target, metric: r.metric, model: r.model, value: r.value, n: r.n, window_end: micros(r.windowEnd) }),
  ghost_wind: (r) => ({ key: r.key, ts: micros(r.ts), region: r.region, method: r.method, mwh: r.mwh, cost_gbp: r.costGbp }),
  battery: (r) => ({ key: r.key, zone: r.zone, strategy: r.strategy, soc_mwh: r.socMwh, profit: r.profit, currency: r.currency, share_of_perfect: r.shareOfPerfect }),
  intervention: (r) => ({ key: r.slot, slot: r.slot, seq: r.seq, type: r.type, target: r.target, magnitude: r.magnitude, hours: r.hours, triggered_at: micros(r.triggeredAt), triggered_by: r.triggeredBy, cost_total: r.costTotal, currency: r.currency, explanation: r.explanation, result_json: r.resultJson }),
}

export function connect({ uri, onRows, onStatus, onIntervention }) {
  const store = Object.fromEntries(TABLES.map((t) => [t, new Map()]))
  let applied = false
  let timer = 0
  const changed = () => {
    if (!applied) return
    clearTimeout(timer)
    timer = setTimeout(() => onRows(snapshot(store)), 400)
  }

  const conn = DbConnection.builder()
    .withUri(uri)
    .withDatabaseName(DB)
    .onConnect((c) => {
      onStatus('connecting')
      for (const name of TABLES) {
        const table = c.db[name]
        const conv = ROW[name]
        const put = (_ctx, row) => {
          store[name].set(conv(row).key, conv(row))
          if (name === 'intervention') onIntervention?.(conv(row), applied)
          changed()
        }
        table.onInsert(put)
        table.onUpdate((ctx, _old, row) => put(ctx, row))
        table.onDelete((_ctx, row) => {
          store[name].delete(conv(row).key)
          changed()
        })
      }
      c.subscriptionBuilder()
        .onApplied(() => {
          // Read the rows the subscription just delivered straight from the client cache.
          for (const name of TABLES) {
            for (const row of c.db[name].iter()) {
              const r = ROW[name](row)
              store[name].set(r.key, r)
              if (name === 'intervention') onIntervention?.(r, false)
            }
          }
          applied = true
          onStatus('live')
          onRows(snapshot(store))
        })
        .onError(() => onStatus('offline'))
        .subscribe(TABLES.map((t) => `SELECT * FROM ${t}`))
    })
    .onConnectError(() => onStatus('offline'))
    .onDisconnect(() => onStatus('offline'))
    .build()
  return () => {
    clearTimeout(timer)
    conn.disconnect()
  }
}

function snapshot(store) {
  return {
    zone: [...store.zone.values()],
    actual: [...store.actual.values()],
    latestForecast: [...store.latest_forecast.values()],
    carbon: [...store.carbon.values()],
    score: [...store.score.values()],
    ghostWind: [...store.ghost_wind.values()],
    battery: [...store.battery.values()],
    intervention: [...store.intervention.values()],
  }
}
