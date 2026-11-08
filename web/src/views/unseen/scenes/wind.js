// Scene 1, wind paid to stop. Built from loaded data: d = { billGbp, windMwh, label }. The counter is that day's published
// constraint bill; with none published it counts the estimated wind switched off instead.
const SCOTLAND = { longitude: -3.6, latitude: 57.3, zoom: 6.1, pitch: 45, bearing: 0 }

export default function windScene(d = {}) {
  const gbp = d.billGbp > 0
  return {
    id: 'wind',
    duration: 10000,
    caption: 'A windy day in Scotland.',
    counter: gbp
      ? { label: d.label ? `Constraint bill, ${d.label}` : 'Constraint bill', from: 0, to: 0, format: 'gbp' }
      : { label: 'Wind paid to switch off (estimate)', from: 0, to: 0, format: 'gwh' },
    steps: [
      { at: 0, layers: { ghostWind: true, boundaries: true, wind: false, carbon: false, solar: false } },
      { at: 100, camera: SCOTLAND, dur: 2200 },
      { at: 600, overlay: 'streaks', kind: 'streaks', speed: 1.2 },
      { at: 2200, overlay: 'farms', kind: 'farms', dim: 0 },
      { at: 2500, caption: 'Wind farms make more than the lines south can carry.' },
      { at: 3000, overlay: 'b6', kind: 'pulse', where: [-2.6, 55.12], color: '#c8322e' },
      { at: 3200, tween: { overlay: 'farms', prop: 'dim', from: 0, to: 1, dur: 4200 } },
      { at: 3400, caption: 'So they are paid to switch off.' },
      { at: 3600, count: { to: gbp ? d.billGbp : (d.windMwh ?? 0), dur: 4500 } },
      { at: 8200, caption: gbp ? 'We all pay for it on our bills.' : 'An estimate, from accepted bids.' },
    ],
  }
}
