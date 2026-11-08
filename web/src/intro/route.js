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

// After the cross-fade (#308): north-up on Edinburgh, hold, then zoom out to Scotland, the UK and the six countries.
// [at seconds, camera, fly duration ms]; the phone sits a little further out at each stage.
export const EDINBURGH = { longitude: -3.19, latitude: 55.95 }
export const MAP_STAGES = [
  [3.0, { ...EDINBURGH, zoom: 7.5, pitch: 0, bearing: 0 }, 600],
  [4.6, { longitude: -4.2, latitude: 57.0, zoom: PHONE ? 5.0 : 5.8, pitch: 0, bearing: 0 }, 700],
  [5.3, { longitude: -2.6, latitude: 54.6, zoom: PHONE ? 4.1 : 4.9, pitch: 0, bearing: 0 }, 700],
  [6.0, OVERVIEW, 800],
]

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
