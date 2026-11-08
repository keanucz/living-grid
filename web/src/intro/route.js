// The Beauly to Denny 400 kV line in the Scottish Highlands, which carries Highland wind south over the B6 boundary.
// The waypoints are approximate (schematic, read off the public route near Beauly, Dalwhinnie, Dunkeld and Denny), and
// the pylon drawn in the intro is procedural: this is a sketch of the idea, not a survey.
export const ROUTE = [
  [-4.468, 57.478],
  [-4.25, 56.93],
  [-3.59, 56.57],
  [-3.91, 56.02],
]
// Where the intro stands: on the line near Dalwhinnie, looking down it towards Dunkeld.
export const SITE = { longitude: -4.25, latitude: 56.93, bearing: 149, zoom: 7.5, pitch: 75 }

const PHONE = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches
export const OVERVIEW = PHONE
  ? { longitude: 3.6, latitude: 54.2, zoom: 3.15, pitch: 0, bearing: 0 }
  : { longitude: 6.5, latitude: 54.4, zoom: 4.05, pitch: 0, bearing: 0 }
export const IS_PHONE = PHONE

const KEY = 'lg-intro-seen'
export function seen() {
  try {
    return !!localStorage.getItem(KEY)
  } catch {
    return false
  }
}
export function markSeen() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* private mode */
  }
}
