import { Icon } from './icons.jsx'
import { actions, useStore } from '../store/store.js'

const ITEMS = [
  { icon: 'globe', label: 'Overview', mode: 'overview' },
  { icon: 'sim', label: 'Simulate', mode: 'simulate' },
  { icon: 'chart', label: 'Scoreboard' },
  { icon: 'battery', label: 'Batteries' },
  { icon: 'replay', label: 'Replay' },
  { icon: 'phone', label: 'Household' },
]

export default function Rail() {
  const mode = useStore((s) => s.mode)
  return (
    <nav className="rail">
      <div className="logo"><Icon name="bolt" size={20} stroke={2.2} /></div>
      {ITEMS.map((it) => (
        <button key={it.label} title={it.label} className={it.mode === mode ? 'on' : ''}
          onClick={() => it.mode && actions.setMode(it.mode)}>
          <Icon name={it.icon} />
        </button>
      ))}
      <div className="spacer" />
      <button title="Help"><Icon name="help" /></button>
      <button title="Settings"><Icon name="settings" /></button>
    </nav>
  )
}
