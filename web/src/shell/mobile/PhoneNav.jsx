import { Icon } from '../icons.jsx'
import { SECTIONS } from '../sections.js'

// The phone's bottom tabs: the same six sections, labels and order as the desktop tabs and the welcome doors.
export default function PhoneNav({ current, onSelect }) {
  return (
    <nav className="m-tabs" aria-label="Sections">
      {SECTIONS.map((x) => (
        <button key={x.id} className={x.id === current ? 'on' : ''} onClick={() => onSelect(x.id)} aria-current={x.id === current ? 'page' : undefined}>
          <Icon name={x.icon} size={18} />
          <span>{x.label}</span>
        </button>
      ))}
    </nav>
  )
}
