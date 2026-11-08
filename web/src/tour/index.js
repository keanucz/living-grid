import { LAYERS } from '../layers/registry.js'
import { PANELS } from '../panels/registry.js'
import { SECTIONS, sectionById } from '../shell/sections.js'
import { TOURS } from './tours.js'

export { TOURS } from './tours.js'
export { start, resumable, stepsOf } from './engine.js'
export { default as Tour } from './Tour.jsx'

// Every id a step names, with the reason it is missing, for the #debug page (#231). `dom` also checks that a
// [data-tour] element is on screen right now (only meaningful once the step's section is open).
const FIXED = new Set(['layers', 'map', ...SECTIONS.map((s) => `tab-${s.id}`)])

export function tourTargets(name) {
  return (TOURS[name]?.steps ?? []).map((s, i) => ({ tour: name, i, id: s.id, section: s.section, target: s.target ?? s.panel }))
}

export function verifyTours(opts = {}) {
  const problems = []
  const panels = new Set(PANELS.map((p) => p.id))
  const layers = new Set(LAYERS.map((l) => l.id))
  for (const [name, t] of Object.entries(TOURS)) {
    t.steps.forEach((s, i) => {
      const where = `${name}[${i}] ${s.id}`
      if (s.section && !sectionById[s.section]) problems.push(`${where}: unknown section "${s.section}"`)
      for (const l of Object.keys(s.layers ?? {})) if (!layers.has(l)) problems.push(`${where}: unknown layer "${l}"`)
      const target = s.target ?? s.panel
      if (target && !panels.has(target) && !FIXED.has(target)) problems.push(`${where}: unknown target "${target}"`)
      if (s.panel && !panels.has(s.panel)) problems.push(`${where}: unknown panel "${s.panel}"`)
      if (opts.dom && target && !document.querySelector(`[data-tour="${CSS.escape(target)}"]`)) problems.push(`${where}: no [data-tour="${target}"] on screen`)
      for (const k of (s.say.match(/\{(\w+)\}/g) ?? []).map((m) => m.slice(1, -1))) if (!s.live?.[k]) problems.push(`${where}: caption uses {${k}} without a live entry`)
    })
  }
  return problems
}
