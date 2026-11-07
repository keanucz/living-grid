import { Icon } from './icons.jsx'
import { useStore } from '../store/store.js'
import { SECTIONS, openSection } from './sections.js'

// White rail: the five map views, then the stand-alone pages (hash routes).
const PAGES = [
  { icon: 'replay', label: 'Replay: 26 October storm', href: '#/replay' },
  { icon: 'calendar', label: 'Day-ahead reveal', href: '#/reveal' },
  { icon: 'phone', label: 'Household: cheapest hours', href: '#/household' },
  { icon: 'play', label: 'Mystery-day market', href: '#/market' },
  { icon: 'battery', label: 'Room game: battery', href: '#/game' },
]

export default function Rail() {
  const section = useStore((s) => s.section) ?? 'overview'
  return (
    <nav className="rail">
      <div className="logo"><Icon name="bolt" size={18} stroke={2.4} /></div>
      {SECTIONS.map((s) => (
        <button key={s.id} title={s.label} aria-label={s.label} className={s.id === section ? 'on' : ''} onClick={() => openSection(s.id)}>
          <Icon name={s.icon} />
        </button>
      ))}
      <div className="rail-sep" />
      {PAGES.map((p) => (
        <button key={p.href} title={p.label} aria-label={p.label} onClick={() => (location.hash = p.href)}>
          <Icon name={p.icon} />
        </button>
      ))}
      <div className="spacer" />
      <button title="Help" aria-label="Help"><Icon name="help" /></button>
    </nav>
  )
}
