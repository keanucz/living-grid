const P = {
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18',
  chart: 'M4 19h16M7 16V9M12 16V5M17 16v-4',
  sim: 'M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  battery: 'M3 8h15v8H3zM21 11v2M6 11v2M9 11v2',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  replay: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  share: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  layers: 'M12 3 3 8l9 5 9-5-9-5zM3 16l9 5 9-5',
  arrowUpRight: 'M7 17 17 7M8 7h9v9',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  compass: 'm15.5 8.5-2.2 5-4.8 2 2.2-5 4.8-2z',
  back: 'M15 5l-7 7 7 7',
  wind: 'M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h8',
  atom: 'M12 12m-1.5 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M12 3c4 0 6 4 6 9s-2 9-6 9-6-4-6-9 2-9 6-9z',
  flame: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1 1 2 2 2 4 1-2 1-4 1-7z',
  drop: 'M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z',
  ship: 'M3 17l2 3h14l2-3M5 17l1-6h12l1 6M9 11V6h6v5M12 3v3',
  plug: 'M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v5',
  storm: 'M7 15a4 4 0 1 1 .5-8A5 5 0 0 1 17 8a3.5 3.5 0 0 1 0 7M13 13l-2 4h3l-2 4',
  play: 'M7 4l13 8-13 8V4z',
  reset: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
  pound: 'M16 6.5A3.5 3.5 0 0 0 9.5 8v5c0 2-1 4-2.5 5H17M7 12h7',
  leaf: 'M5 19c0-8 6-14 14-14 0 8-6 14-14 14zM5 19l7-7',
}

export function Icon({ name, size = 18, stroke = 1.8, fill = 'none' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  )
}

export const ASSET_ICON = { wind: 'wind', nuclear: 'atom', gas: 'flame', hydro: 'drop' }
