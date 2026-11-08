// Scene 3, the bottleneck. d = { savedGbp, savedMwh, days }: the existing +2 GW what-if on the Scotland to England boundary
// (an upper bound, from NESO day-ahead flows and constraint costs; see bottleneckHeadline).
const B6 = [[-3.6, 54.95], [-2.6, 55.12], [-1.7, 55.2]]
const NORTH = [[-4.2, 56.6], [-3.9, 55.8], [-3.6, 54.95]]
const SOUTH = [[-1.7, 55.2], [-1.4, 54.2], [-1.2, 53.2]]
const CAMERA = { longitude: -3, latitude: 55.4, zoom: 6.6, pitch: 40, bearing: 0 }

export default function bottleneckScene(d = {}) {
  return {
    id: 'bottleneck',
    duration: 11000,
    caption: 'Power flows south from Scotland.',
    counter: { label: 'Could have been saved with 2 GW more room', from: 0, to: 0, format: 'gbp' },
    steps: [
      { at: 0, layers: { boundaries: true, ghostWind: false, wind: false, carbon: false, solar: false } },
      { at: 100, camera: CAMERA, dur: 2000 },
      { at: 1500, overlay: 'north', kind: 'arrows', path: NORTH, speed: 1.4, jam: 0 },
      { at: 1500, overlay: 'south', kind: 'arrows', path: SOUTH, speed: 1.4, jam: 0 },
      { at: 2500, overlay: 'pipe', kind: 'pipe', path: B6, fill: 0 },
      { at: 2600, tween: { overlay: 'pipe', prop: 'fill', from: 0, to: 1, dur: 2600 } },
      { at: 2600, tween: { overlay: 'north', prop: 'jam', from: 0, to: 1, dur: 2600 } },
      { at: 2600, caption: 'The line fills up. More power is waiting than it can carry.' },
      { at: 5400, overlay: 'full', kind: 'pulse', where: [-2.6, 55.12], color: '#c8322e' },
      { at: 5400, caption: 'The rest is wasted, and replaced further south.' },
      { at: 6800, caption: 'Now add 2 GW of room.' },
      { at: 6800, tween: { overlay: 'pipe', prop: 'fill', from: 1, to: 0.55, dur: 1800 } },
      { at: 6800, tween: { overlay: 'north', prop: 'jam', from: 1, to: 0, dur: 1800 } },
      { at: 6900, overlay: 'full', on: false },
      { at: 7200, count: { to: d.savedGbp ?? 0, dur: 3000 } },
      { at: 9300, caption: d.savedMwh ? 'That wind would no longer be wasted. An upper bound.' : 'An upper bound.' },
    ],
  }
}
