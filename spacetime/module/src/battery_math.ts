// The room game's battery rules, mirrored from engine/game/settle.py (the reference, with the tests): 1 MW / 2 MWh,
// 88% round trip, a decision covers one half-hour. No SpacetimeDB imports, so the same code can be run against Python.

export const BATTERY = { power_mw: 1, energy_mwh: 2, round_trip: 0.88, degradation_per_mwh: 2, soc0_mwh: 1, slot_hours: 0.5 };
const ETA = Math.sqrt(BATTERY.round_trip);
const SLOT_MWH = BATTERY.power_mw * BATTERY.slot_hours;
export const ACTIONS = ['charge', 'hold', 'discharge'];

// [grid MWh (positive when buying), new state of charge] for one half-hour; impossible actions are clipped.
export function step(soc: number, action: string): [number, number] {
  if (action === 'charge') {
    const stored = Math.min(SLOT_MWH * ETA, BATTERY.energy_mwh - soc);
    return [stored / ETA, soc + stored];
  }
  if (action === 'discharge') {
    const sold = Math.min(SLOT_MWH, soc * ETA);
    return [-sold, soc - sold / ETA];
  }
  return [0, soc];
}

export const slotPnl = (price: number, grid: number): number =>
  Math.round((-price * grid - BATTERY.degradation_per_mwh * Math.abs(grid)) * 100) / 100;
