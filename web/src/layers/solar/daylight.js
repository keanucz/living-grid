// Is the sun up over the middle of our map (50 N, 5 E) at this time? A rough solar elevation, enough to decide whether the
// Sun layer has anything to show. ms is a timestamp; null means now.
export function sunUp(ms = Date.now()) {
  const d = new Date(ms)
  const doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5
  const decl = (-23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10)) * Math.PI) / 180
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60
  const hourAngle = (((hours - 12) * 15 + 5) * Math.PI) / 180
  const lat = (50 * Math.PI) / 180
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)
  return Math.asin(sinEl) > (3 * Math.PI) / 180
}
