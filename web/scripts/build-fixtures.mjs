// Writes deterministic offline fixtures to web/src/fixtures/. Values are invented but plausible.
// Shapes are the front end's proposal for the HTTP contract; align with engine/contract once #13 lands.
// Run: node scripts/build-fixtures.mjs
import { writeFileSync, mkdirSync } from 'node:fs'

const AT = Date.UTC(2026, 10, 7, 14)
const H = 3600e3
const GBP_EUR = 1.15

const zones = [
  { id: 'GB', name: 'Great Britain', currency: 'GBP', centroid: [-1.9, 53.4], label_at: [-3.2, 54.6] },
  { id: 'FR', name: 'France', currency: 'EUR', centroid: [2.4, 46.8], label_at: [2.4, 46.8] },
  { id: 'DE-LU', name: 'Germany–Luxembourg', currency: 'EUR', centroid: [10.2, 51.1], label_at: [10.2, 51.1] },
  { id: 'NL', name: 'Netherlands', currency: 'EUR', centroid: [5.6, 52.3], label_at: [5.6, 52.6] },
  { id: 'BE', name: 'Belgium', currency: 'EUR', centroid: [4.6, 50.6], label_at: [4.4, 50.5] },
  { id: 'NO2', name: 'Southern Norway', currency: 'EUR', centroid: [7.6, 59.2], label_at: [8.4, 60.4] },
]

const interconnectors = [
  { id: 'NSL', name: 'North Sea Link', from: 'NO2', to: 'GB', capacity_mw: 1400, from_at: [6.4, 59.0], to_at: [-1.6, 55.1] },
  { id: 'IFA', name: 'IFA', from: 'FR', to: 'GB', capacity_mw: 2000, from_at: [2.6, 48.9], to_at: [-0.1, 51.5] },
  { id: 'IFA2', name: 'IFA2', from: 'FR', to: 'GB', capacity_mw: 1000, from_at: [-0.4, 48.6], to_at: [-1.3, 50.95] },
  { id: 'ELEC', name: 'ElecLink', from: 'FR', to: 'GB', capacity_mw: 1000, from_at: [1.7, 50.2], to_at: [0.5, 51.3] },
  { id: 'BRITNED', name: 'BritNed', from: 'NL', to: 'GB', capacity_mw: 1000, from_at: [4.9, 52.2], to_at: [0.6, 51.75] },
  { id: 'NEMO', name: 'Nemo Link', from: 'BE', to: 'GB', capacity_mw: 1000, from_at: [4.2, 50.9], to_at: [0.9, 51.45] },
  { id: 'NORNED', name: 'NorNed', from: 'NO2', to: 'NL', capacity_mw: 700, from_at: [6.8, 58.4], to_at: [5.8, 52.7] },
  { id: 'NORDLINK', name: 'NordLink', from: 'NO2', to: 'DE-LU', capacity_mw: 1400, from_at: [8.0, 58.6], to_at: [10.0, 53.6] },
  { id: 'FR-BE', name: 'France–Belgium', from: 'FR', to: 'BE', capacity_mw: 3000, from_at: [2.9, 48.9], to_at: [4.4, 50.6] },
  { id: 'FR-DE', name: 'France–Germany', from: 'FR', to: 'DE-LU', capacity_mw: 3000, from_at: [3.6, 48.4], to_at: [9.0, 49.4] },
  { id: 'BE-NL', name: 'Belgium–Netherlands', from: 'BE', to: 'NL', capacity_mw: 2400, from_at: [4.7, 50.95], to_at: [5.3, 52.0] },
  { id: 'NL-DE', name: 'Netherlands–Germany', from: 'DE-LU', to: 'NL', capacity_mw: 4000, from_at: [9.4, 52.1], to_at: [6.0, 52.25] },
  { id: 'ALEGRO', name: 'ALEGrO', from: 'BE', to: 'DE-LU', capacity_mw: 1000, from_at: [5.1, 50.55], to_at: [8.0, 50.8] },
]

// base price (EUR/MWh), daily swing, carbon production/consumption, demand MW, net import MW, mix
const Z = {
  GB: { p: 97, sw: 30, prod: 165, cons: 178, demand: 31200, imp: 5200, mix: { wind: 0.36, gas: 0.31, nuclear: 0.12, solar: 0.03, biomass: 0.06, imports: 0.12 } },
  FR: { p: 78, sw: 18, prod: 38, cons: 41, demand: 52800, imp: -9800, mix: { nuclear: 0.68, hydro: 0.11, wind: 0.1, gas: 0.06, solar: 0.05 } },
  'DE-LU': { p: 91, sw: 34, prod: 382, cons: 356, demand: 58300, imp: 2100, mix: { wind: 0.29, coal: 0.22, gas: 0.15, solar: 0.08, biomass: 0.09, imports: 0.17 } },
  NL: { p: 93, sw: 30, prod: 318, cons: 331, demand: 13100, imp: 900, mix: { gas: 0.41, wind: 0.33, solar: 0.07, coal: 0.08, imports: 0.11 } },
  BE: { p: 86, sw: 24, prod: 132, cons: 171, demand: 10400, imp: 1500, mix: { nuclear: 0.31, gas: 0.28, wind: 0.19, solar: 0.05, imports: 0.17 } },
  NO2: { p: 48, sw: 8, prod: 17, cons: 19, demand: 5600, imp: -3900, mix: { hydro: 0.93, wind: 0.07 } },
}

const flows = {
  NSL: 1310, IFA: 1720, IFA2: 880, ELEC: 940, BRITNED: 410, NEMO: -150,
  NORNED: 520, NORDLINK: 1260, 'FR-BE': 1900, 'FR-DE': 2300, 'BE-NL': -600, 'NL-DE': -1100, ALEGRO: 340,
}

const shape = (h) => {
  const hod = (h + 24) % 24
  return 0.55 * Math.exp(-((hod - 18) ** 2) / 6) + 0.3 * Math.exp(-((hod - 8) ** 2) / 4) - 0.35 * Math.exp(-((hod - 3) ** 2) / 8)
}
let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5)

const series = (id) => {
  const z = Z[id]
  const rows = []
  for (let k = -24; k <= 24; k++) {
    const ts = new Date(AT + k * H).toISOString()
    const hod = (14 + k + 48) % 24
    const mid = z.p + z.sw * shape(hod)
    const row = { ts }
    if (k <= 0) row.actual = +(mid + z.sw * 0.25 * rand()).toFixed(1)
    if (k >= -12) {
      const spread = z.sw * (0.12 + 0.03 * Math.max(0, k))
      row.p50 = +(mid + z.sw * 0.08 * rand()).toFixed(1)
      row.p10 = +(row.p50 - spread).toFixed(1)
      row.p90 = +(row.p50 + spread * 1.2).toFixed(1)
    }
    rows.push(row)
  }
  return rows
}

const state = {
  at: new Date(AT).toISOString(),
  source: 'fixture',
  zones: zones.map(({ id, currency }) => {
    const z = Z[id]
    const s = series(id)
    const now = s.find((r) => r.ts === new Date(AT).toISOString())
    const yesterday = s[0].actual
    const eur = now.actual
    return {
      zone: id,
      currency,
      price: +(currency === 'GBP' ? eur / GBP_EUR : eur).toFixed(1),
      price_eur: eur,
      change_24h_eur: +(eur - yesterday).toFixed(1),
      demand_mw: z.demand,
      net_import_mw: z.imp,
      mix: z.mix,
      carbon: { production_gco2_kwh: z.prod, consumption_gco2_kwh: z.cons },
      series: s,
    }
  }),
  flows: Object.entries(flows).map(([id, mw]) => ({ interconnector: id, mw })),
}

const scenarios = {
  hormuz: {
    type: 'hormuz', label: 'Strait of Hormuz closes', kind: 'World event',
    summary: 'LNG supply shock lifts European gas prices', magnitude: 40, magnitude_unit: '% gas', hours: 504,
    price_delta_eur: { GB: 21.4, FR: 9.8, 'DE-LU': 17.6, NL: 22.9, BE: 16.1, NO2: 4.2 },
    cost_gbp: 612_000_000,
    explanation: 'GB price up £18.6/MWh: gas up 40% sets the price in 64% of hours (+£16), less spare French nuclear to import (+£3).',
    winners: ['NO2 hydro', 'FR nuclear'], losers: ['GB households', 'NL industry'],
    focus: 'GB', links: ['IFA', 'IFA2', 'ELEC', 'BRITNED'],
  },
  interconnector_trip: {
    type: 'interconnector_trip', label: 'Norway link trips', kind: 'Grid fault',
    summary: 'North Sea Link to Blyth goes offline', magnitude: 1400, magnitude_unit: 'MW lost', hours: 48,
    price_delta_eur: { GB: 11.2, FR: 1.4, 'DE-LU': 0.8, NL: 1.1, BE: 1.0, NO2: -6.3 },
    cost_gbp: 14_800_000,
    explanation: 'GB price up £9.7/MWh: 1.3 GW of Norwegian hydro replaced by gas at the margin (+£8), more pull on French links (+£2).',
    winners: ['NO2 consumers', 'GB gas plant'], losers: ['GB households'],
    focus: 'GB', links: ['NSL'], tripped: ['NSL'],
  },
  nuclear_outage: {
    type: 'nuclear_outage', label: 'French nuclear outage', kind: 'Plant outage',
    summary: '5 GW of French reactors offline', magnitude: 5000, magnitude_unit: 'MW lost', hours: 168,
    price_delta_eur: { GB: 8.9, FR: 26.3, 'DE-LU': 7.4, NL: 5.1, BE: 12.7, NO2: 1.9 },
    cost_gbp: 188_000_000,
    explanation: 'FR price up €26/MWh: residual load up 5 GW pushes gas to the margin (+€21), exports to GB fall (+€5).',
    winners: ['DE coal and gas'], losers: ['FR consumers', 'BE consumers'],
    focus: 'FR', links: ['IFA', 'IFA2', 'ELEC', 'FR-BE', 'FR-DE'],
  },
  scottish_storm: {
    type: 'scottish_storm', label: 'Storm over Scotland', kind: 'Weather',
    summary: 'Gusts lift Scottish wind; boundaries saturate', magnitude: 35, magnitude_unit: '% wind', hours: 24,
    price_delta_eur: { GB: -14.8, FR: -1.2, 'DE-LU': -0.6, NL: -1.0, BE: -0.9, NO2: -0.4 },
    cost_gbp: -21_300_000, ghost_wind_mwh: 18_400, constraint_cost_gbp: 9_600_000,
    explanation: 'GB price down £12.9/MWh: wind up 35% (−£15) but 18 GWh paid to switch off behind the B6 boundary (+£2).',
    winners: ['GB households'], losers: ['GB gas plant', 'Constraint bill payers'],
    focus: 'GB', links: ['NSL', 'IFA'],
  },
}

// Approximate locations of notable plants, for the simulation view only.
const assets = [
  { name: 'Viking', type: 'wind', mw: 443, coord: [-1.25, 60.3] },
  { name: 'Moray East', type: 'wind', mw: 950, coord: [-2.75, 58.2] },
  { name: 'Seagreen', type: 'wind', mw: 1075, coord: [-1.85, 56.6] },
  { name: 'Hornsea', type: 'wind', mw: 2500, coord: [1.85, 53.9] },
  { name: 'Dogger Bank', type: 'wind', mw: 3600, coord: [2.1, 54.8] },
  { name: 'Gemini', type: 'wind', mw: 600, coord: [6.0, 54.05] },
  { name: 'Borkum Riffgrund', type: 'wind', mw: 1300, coord: [6.6, 54.0] },
  { name: 'Torness', type: 'nuclear', mw: 1185, coord: [-2.41, 55.97] },
  { name: 'Heysham', type: 'nuclear', mw: 2400, coord: [-2.92, 54.03] },
  { name: 'Sizewell B', type: 'nuclear', mw: 1198, coord: [1.62, 52.21] },
  { name: 'Gravelines', type: 'nuclear', mw: 5460, coord: [2.11, 51.01] },
  { name: 'Flamanville', type: 'nuclear', mw: 4250, coord: [-1.88, 49.54] },
  { name: 'Paluel', type: 'nuclear', mw: 5320, coord: [0.63, 49.86] },
  { name: 'Doel', type: 'nuclear', mw: 1000, coord: [4.26, 51.32] },
  { name: 'Pembroke', type: 'gas', mw: 2200, coord: [-4.99, 51.68] },
  { name: 'Grain', type: 'gas', mw: 1275, coord: [0.71, 51.45] },
  { name: 'Eemshaven', type: 'gas', mw: 2700, coord: [6.83, 53.43] },
  { name: 'Kvilldal', type: 'hydro', mw: 1240, coord: [6.65, 59.52] },
  { name: 'Sima', type: 'hydro', mw: 1120, coord: [7.12, 60.47] },
]

const dir = new URL('../src/fixtures/', import.meta.url)
mkdirSync(dir, { recursive: true })
const out = (name, data) => writeFileSync(new URL(name, dir), JSON.stringify(data, null, 1) + '\n')
out('zones.json', { zones, interconnectors, gb_regions: [] })
out('state.json', state)
out('scenarios.json', scenarios)
out('assets.json', assets)
console.log('fixtures written')
