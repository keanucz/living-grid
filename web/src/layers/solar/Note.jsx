import { sunUp } from './daylight.js'

// One line by the legend when the Sun layer is on but it is night at the hour shown.
export default function SunNote({ ui }) {
  if (!ui.layers?.solar || sunUp(ui.at ? Date.parse(ui.at) : Date.now())) return null
  return <span className="muted" style={{ fontSize: 11 }}>The sun layer is dark at night; scrub to daytime to see it.</span>
}
