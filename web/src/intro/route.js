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

// After the cross-fade (#308, #317): north-up on Edinburgh, hold, then one smooth eased zoom-out to the six countries,
// with captions fading in as the zoom passes Scotland and then the UK.
export const EDINBURGH = { longitude: -3.19, latitude: 55.95 }
export const EDINBURGH_VIEW = { ...EDINBURGH, zoom: 7.5, pitch: 0, bearing: 0 }
export const ARRIVE_AT = 3.0 // s: turn north-up on Edinburgh (0.6 s move)
export const ZOOM_OUT_AT = 4.8 // s: after about 1.2 s on the dot
export const ZOOM_OUT_MS = 3000
// Each caption peaks at this share of the way out (by zoom) from Edinburgh to the overview.
export const CAPTIONS = [['Scotland', 0.4], ['United Kingdom', 0.75]]
export const TITLE_IN = 0.5 // s, once the camera has stopped
export const TITLE_HOLD = 1.5
export const CROSSFADE = 0.4 // title out while the welcome comes in

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
