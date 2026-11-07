import { Icon } from './icons.jsx'
import { actions, useStore } from '../store/store.js'

// Map modes switch in place; views are hash routes (#/replay etc.).
const ITEMS = [
  { icon: 'globe', label: 'Overview', mode: 'overview' },
  { icon: 'sim', label: 'Simulate', mode: 'simulate' },
  { icon: 'chart', label: 'Scoreboard (overview, right)', mode: 'overview', focus: '.scoreboard, .panel:has(.score-grid)' },
  { icon: 'battery', label: 'Batteries (simulate, right)', mode: 'simulate', focus: '.batt' },
  { icon: 'replay', label: 'Replay: 26 October storm', href: '#/replay' },
  { icon: 'calendar', label: 'Day-ahead reveal', href: '#/reveal' },
  { icon: 'phone', label: 'Household: cheapest hours', href: '#/household' },
]

function go(it) {
  if (it.href) return void (location.hash = it.href)
  actions.setMode(it.mode)
  if (it.mode === 'overview') actions.setAt(null)
  if (!it.focus) return
  setTimeout(() => {
    const el = document.querySelector(it.focus)
    if (!el) return
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    el.classList.remove('flash')
    void el.offsetWidth
    el.classList.add('flash')
  }, 350)
}

export default function Rail() {
  const mode = useStore((s) => s.mode)
  return (
    <nav className="rail">
      <div className="logo"><Icon name="bolt" size={20} stroke={2.2} /></div>
      {ITEMS.map((it) => (
        <button key={it.label} title={it.label} aria-label={it.label} className={!it.focus && it.mode === mode ? 'on' : ''}
          onClick={() => go(it)}>
          <Icon name={it.icon} />
        </button>
      ))}
      <div className="spacer" />
      <button title="Help"><Icon name="help" /></button>
      <button title="Settings"><Icon name="settings" /></button>
    </nav>
  )
}
