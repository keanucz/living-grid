// Each folder in panels/ registers itself by default-exporting
//   { id, slot: 'left' | 'bottomRight' | 'bottom' | 'right', order, modes: ['overview','simulate'], Component }
// Component receives { ctx } (same ctx as layers). Never edit this file to add a panel.
const mods = import.meta.glob('./*/index.jsx', { eager: true })

export const PANELS = Object.values(mods)
  .map((m) => m.default)
  .filter(Boolean)
  .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
