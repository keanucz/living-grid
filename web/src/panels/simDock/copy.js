// What if, in one sentence and one number (ELI5 step 3). Every figure is passed in from the live result or the
// chosen magnitude and duration; nothing numeric is typed here. Hormuz is the approved copy; the other events
// follow its pattern with their own clause.
import { fmtPence } from '../../lib/wholesale.js'
import { fmt } from '../../styles/tokens.js'

export const EVENTS = [
  { id: 'hormuz', icon: 'ship', title: 'Gas gets dearer', sub: 'The Strait of Hormuz closes', max: 100, step: 10 },
  { id: 'interconnector_trip', icon: 'plug', title: 'The cable to Norway breaks', max: 1400, step: 140 },
  { id: 'nuclear_outage', icon: 'atom', title: 'France loses nuclear plants', max: 10000, step: 1000 },
  { id: 'scottish_storm', icon: 'storm', title: 'A big storm hits Scotland', max: 70, step: 7 },
]

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const count = (n, unit) => `${WORDS[n] ?? n} ${unit}${n === 1 ? '' : 's'}`

// 336 -> "two weeks", 72 -> "three days", 24 -> "one day", 6 -> "six hours".
export function durationWords(hours) {
  if (hours >= 168 && hours % 168 === 0) return count(hours / 168, 'week')
  if (hours >= 24 && hours % 24 === 0) return count(hours / 24, 'day')
  return count(Math.round(hours), 'hour')
}

const gw = (mw) => `${(mw / 1000).toFixed(mw % 1000 === 0 ? 0 : 1)} GW`

// The event clause: what happens, at the chosen magnitude and duration.
const CLAUSE = {
  hormuz: (m, h) => `If the Strait of Hormuz closed for ${durationWords(h)}, gas would cost ${Math.round(m)}% more.`,
  interconnector_trip: (m, h) => `If the cable to Norway broke for ${durationWords(h)}, Britain would lose ${gw(m)} of imports.`,
  nuclear_outage: (m, h) => `If France lost ${gw(m)} of nuclear plants for ${durationWords(h)}, it would have to make up the power elsewhere.`,
  scottish_storm: (m, h) => `If a big storm hit Scotland for ${durationWords(h)}, its wind farms would make ${Math.round(m)}% more power.`,
}

const verb = (v) => (v < 0 ? 'fall' : 'rise')
const pounds = (gbpPerMwh) => `£${Math.abs(gbpPerMwh).toFixed(2)}`

// Layer 1. `total` is Europe's wholesale bill change in £; `gbMwh` Britain's average change in £/MWh.
// Returns the event clause and the money sentence; the caller wraps "wholesale" in a <Term>.
export function answer(type, magnitude, hours, total, gbMwh) {
  const clause = CLAUSE[type]?.(magnitude, hours) ?? ''
  const same = Math.sign(total) === Math.sign(gbMwh) || gbMwh === 0
  const gb = `${fmtPence(gbMwh)} per kWh (${pounds(gbMwh)} per MWh)`
  const bill = { before: "Europe's ", after: ` electricity bill would ${verb(total)} by about ${fmt.money(Math.abs(total))}, ` }
  const tail = same ? `and Britain's wholesale price by about ${gb}.` : `and Britain's wholesale price would ${verb(gbMwh)} by about ${gb}.`
  return { clause, bill, tail }
}

export const HOUSEHOLD = 'Household bills follow later: suppliers buy ahead, and the price cap changes every three months.'
export const KEY = 'Redder = bigger rise'

const GAS_WHY = "Gas power stations set Britain's price in most hours, so dearer gas means dearer power."
const MONEY_WHY = 'Power stations earn more and the people buying power pay more: the same money changing hands, not two costs.'

// "Why?": the approved facts. The gas fact is Hormuz's own; the money fact only reads true for a rise. The model's
// explanation sentence stays under "For experts".
export function why(type, biggest) {
  const facts = type === 'hormuz' ? [GAS_WHY] : []
  if (biggest && biggest.delta > 0) facts.push(MONEY_WHY)
  if (biggest) facts.push(`Biggest ${biggest.delta < 0 ? 'fall' : 'rise'}: ${biggest.name} (${biggest.delta < 0 ? '−' : '+'}${biggest.sym}${Math.abs(biggest.delta).toFixed(2)} per MWh).`)
  return facts
}
