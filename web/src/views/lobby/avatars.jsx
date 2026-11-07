// Six energy avatars. Players send the id; the picture is drawn here, so nothing is uploaded.
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }

export const AVATARS = [
  { id: 'turbine', label: 'Wind turbine', draw: <><path {...P} d="M12 13V22M9 22h6" /><circle {...P} cx="12" cy="11" r="1.6" /><path {...P} d="M12 9.4V2.5M10.6 11.8 4.6 15.3M13.4 11.8l6 3.5" /></> },
  { id: 'pylon', label: 'Pylon', draw: <><path {...P} d="M12 2v4M8 6h8M12 6l-5 16M12 6l5 16M9.5 13h5M8 18h8M3 9h18" /></> },
  { id: 'solar', label: 'Solar panel', draw: <><path {...P} d="M4 8h16l-2 9H6zM9.3 8l-.8 9M14.7 8l.8 9M5 12.5h14M12 17v4M8 21h8" /></> },
  { id: 'flame', label: 'Gas flame', draw: <><path {...P} d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4 .2 1.5 1 2.3 1.8 2.5C10.5 8.5 11 5.5 12 3z" /></> },
  { id: 'battery', label: 'Battery', draw: <><rect {...P} x="3" y="7" width="16" height="10" rx="2" /><path {...P} d="M21 10.5v3M11.5 9.5 9 12.5h3l-1 2.5" /></> },
  { id: 'wave', label: 'Wave', draw: <><path {...P} d="M2 12c2.5-4 4.5-4 7 0s4.5 4 7 0 4-3 6-1M2 18c2.5-4 4.5-4 7 0s4.5 4 7 0 4-3 6-1" /></> },
]

export const avatarIds = AVATARS.map((a) => a.id)

export function Avatar({ id, size = 36 }) {
  const a = AVATARS.find((x) => x.id === id) ?? AVATARS[0]
  return (
    <svg className="av" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={a.label}>
      {a.draw}
    </svg>
  )
}
