import { constraintBill } from '../../layers/ghostWind/data.js'
import { whatIf } from '../../layers/boundaries/data.js'
import { FLAG } from '../../layers/carbon/data.js'

// Story intros: Keanu's human-written copy, used verbatim. No numbers on purpose, so they stay true.
export const INTROS = {
  wind: 'If Scotland generates more wind power than the grid lines to England can take, wind farms are paid to turn off and gas-fired power stations further south are paid to turn on. We all pay for both through our electricity bills.',
  carbon: "A country's electricity is only as clean as the power it imports. When a country with a clean grid imports from a dirtier neighbour over an undersea cable, the carbon travels with it, but it never shows up in the importing country's own generation figures.",
  bottleneck: "Britain's grid has a few pinch points, and the biggest is on the border between Scotland and England. If power can't get through, it's wasted on one side and has to be replaced on the other.",
  sunny: 'On a sunny Sunday with little demand, Germany generates more power than it can use. Prices fall below zero, and some power plants pay to keep running rather than shut down.',
}

// The four Hidden grid story cards: what each one switches on, which sourced number it leads with, and where it links.
// Everything here is pure (data in, text out) so it can be checked without a browser. Numbers come from the loaded
// API data or the event library, never from this file, and each carries its source.
const OFF = { ghostWind: false, carbon: false, boundaries: false, wind: false, solar: false }

export const CARDS = [
  { id: 'wind', title: 'Scotland’s wind, paid to stop', layers: { ...OFF, ghostWind: true, boundaries: true },
    detail: ['constraintBill'], links: [{ label: 'Watch the storm that cost £36.5m', href: '#/events?e=storm' }],
    overTime: 'wind' },
  { id: 'carbon', title: 'Carbon that comes in by cable', layers: { ...OFF, carbon: true },
    detail: ['carbonLegend'], links: [] },
  { id: 'bottleneck', title: 'The bottleneck', layers: { ...OFF, boundaries: true },
    detail: [], links: [{ label: 'Build a power line', href: '#/infrastructure' }] },
  { id: 'sunny', title: 'A sunny Sunday, negative prices', layers: { ...OFF, solar: true },
    detail: ['renewables'], links: [{ label: 'Watch the movie', href: '#/events?e=sunny-weekend' }], overTime: 'solar' },
]

export const CARD_IDS = CARDS.map((c) => c.id)

const gwh = (mwh) => `${(mwh / 1000).toFixed(mwh >= 10000 ? 0 : 1)} GWh`
const money = (v) => (Math.abs(v) >= 1e6 ? `£${(v / 1e6).toFixed(1)}m` : `£${Math.round(v / 1e3)}k`)
const pct = (v) => `${Math.round(v * 100)}%`
// constraintBill notes read 'NESO, 29 Oct (newest, ~1 week lag)': fold the bracket into the outer one.
const flat = (note) => note.replace(/\s*\((.*)\)/, '; $1')

// Card 1: wind switched off over Scotland (ghost wind, accepted bids) and how often B6 was over its limit.
export function windHeadline(gw, infra) {
  const d = gw?.data
  const out = { value: '…', text: 'Loading the wind that was paid to switch off.', source: 'Elexon accepted bids (BOALF) and NESO constraint costs; an estimate', estimate: true, extra: null }
  if (d && !gw.loading) {
    const mwh = d.total_boalf_mwh ?? 0
    const bill = constraintBill(d, gw.window)
    out.sample = gw.source === 'sample'
    out.value = gwh(mwh)
    if (gw.window === 'storm') {
      out.when = '26 October'
      out.text = `No wind was paid to switch off in the last 24 hours. On 26 October it was ${gwh(mwh)}${bill.gbp ? `, and the day’s constraint bill was ${money(bill.gbp)} (${flat(bill.note)})` : ''}.`
    } else {
      out.when = 'last 24 h'
      out.text = `${mwh ? 'of Scottish wind was paid to switch off in the last 24 hours.' : 'No wind was paid to switch off in the last 24 hours.'}${bill.gbp ? ` The newest published daily constraint bill was ${money(bill.gbp)} (${flat(bill.note)}).` : ''}`
    }
  }
  const b6 = infra?.data?.boundaries?.find((b) => b.id === 'SCOTEX')
  if (b6?.over_share != null) {
    out.extra = `B6, the Scotland to England boundary, was forecast over its limit in ${pct(b6.over_share)} of hours over the last ${infra.data.window_days} days (NESO day-ahead flows).${infra.source === 'sample' ? ' Sample figures.' : ''}`
  }
  return out
}

// Card 2: the zone whose imports add the most carbon on top of its own generation.
export function carbonHeadline(by, names = {}) {
  const rows = Object.entries(by ?? {}).filter(([, v]) => v.consumption != null && v.production != null)
    .map(([z, v]) => ({ zone: z, name: names[z] ?? z, diff: v.consumption - v.production, prod: v.production, cons: v.consumption }))
    .sort((a, b) => b.diff - a.diff)
  const source = 'Carbon tracing with standard emission factors (modelled)'
  if (!rows.length) return { value: '…', text: 'Loading the carbon each zone really consumes.', source, estimate: true }
  const top = rows[0]
  if (top.diff >= FLAG.grams) {
    return { value: `+${Math.round(top.diff)} g/kWh`, when: 'now', text: `${top.name} generates ${Math.round(top.prod)} g/kWh but consumes ${Math.round(top.cons)} g/kWh: imports add the rest.`, source, estimate: true }
  }
  return { value: `${top.diff >= 0 ? '+' : '−'}${Math.abs(Math.round(top.diff))} g/kWh`, when: 'now', text: `No zone is much dirtier than its own generation right now; the largest gap is ${top.name}.`, source, estimate: true }
}

// Card 3: what more Scotland to England capacity would have saved, and the fullest cable.
export function bottleneckHeadline(infra) {
  const d = infra?.data
  const out = { value: '…', text: 'Loading the grid bottlenecks.', source: 'NESO day-ahead flows and constraint costs; Elexon flows; an estimate', estimate: true, extra: null }
  if (!d) return out
  out.sample = infra.source === 'sample'
  const b6 = d.boundaries?.find((b) => b.id === 'SCOTEX') ?? d.boundaries?.find((b) => b.counterfactual?.length)
  const w = b6 ? whatIf(b6, 2000) : null
  if (w && b6.cf) {
    out.value = money(w.costSaved)
    out.when = `${b6.cf.cost_days} days`
    out.text = `of constraint cost, and ${gwh(w.windSaved)} of wind, would have been avoided over ${b6.cf.cost_days} days with ${(w.addMw / 1000).toFixed(0)} GW more across ${b6.name}. An upper bound: other Scottish boundaries would still bind.`
  } else {
    out.value = '—'
    out.text = 'No counterfactual is published yet.'
  }
  const full = [...(d.interconnectors ?? [])].filter((l) => l.full_import_share != null).sort((a, b) => b.full_import_share - a.full_import_share)[0]
  if (full) out.extra = `The ${full.name} cable was importing at full capacity in ${pct(full.full_import_share)} of hours (Elexon flows, nominal capacity).`
  return out
}

// Card 4: from the event library (computed from cached public data), not live.
export function sunnyHeadline(ev) {
  const source = ev ? `${ev.sources?.join(', ') ?? 'Energy-Charts'}; ${ev.label ?? 'computed from cached public data'}` : ''
  if (!ev) return { value: '…', text: 'Loading the event.', source, estimate: false }
  const kn = (s) => ev.key_numbers?.find((k) => k.label.toLowerCase().includes(s))
  const low = kn('lowest')
  const hrs = kn('negative')
  const peak = kn('solar peak')
  const dip = ev.moments?.find((m) => m.label.toLowerCase().includes('deepest'))
  const day = dip ? new Date(dip.ts).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''
  return {
    value: low ? `−€${Math.abs(Math.round(low.value))}/MWh` : '—',
    when: dip ? new Date(dip.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '',
    text: `${day ? `On ${day}, ` : ''}the German day-ahead price was negative for ${hrs ? Math.round(hrs.value) : '—'} hours${peak ? ` as solar peaked at ${(peak.value / 1000).toFixed(1)} GW` : ''}. Generators paid to produce.`,
    source, estimate: false, dipTs: dip?.ts ?? null,
  }
}
