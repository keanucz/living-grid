// The room game's battery rules, mirrored from engine/game/settle.py (the reference, with the tests): 1 MW / 2 MWh,
// 88% round trip, a decision covers one half-hour. No SpacetimeDB imports, so the same code can be run against Python.

export const BATTERY = { power_mw: 1, energy_mwh: 2, round_trip: 0.88, degradation_per_mwh: 2, soc0_mwh: 1, slot_hours: 0.5 };
const ETA = Math.sqrt(BATTERY.round_trip);
const SLOT_MWH = BATTERY.power_mw * BATTERY.slot_hours;

// Action grammar (one place for validation and sizing):
//   charge | hold | discharge            full power for the half-hour
//   charge:50 | discharge:25             a share of the power, 1 to 100 per cent
//   offer:discharge:180[:50]             sell only if the settlement price is at or above the limit (GBP/MWh)
export type Parsed = { kind: 'charge' | 'hold' | 'discharge'; pct: number; limit: number | null };

export function parseAction(action: string): Parsed | null {
  const parts = String(action).split(':');
  const pct = (x: string | undefined) => (x === undefined ? 100 : /^\d{1,3}$/.test(x) && +x >= 1 && +x <= 100 ? +x : NaN);
  if (parts[0] === 'hold' && parts.length === 1) return { kind: 'hold', pct: 100, limit: null };
  if ((parts[0] === 'charge' || parts[0] === 'discharge') && parts.length <= 2) {
    const p = pct(parts[1]);
    return Number.isNaN(p) ? null : { kind: parts[0], pct: p, limit: null };
  }
  if (parts[0] === 'offer' && parts[1] === 'discharge' && parts.length >= 3 && parts.length <= 4) {
    const limit = Number(parts[2]);
    const p = pct(parts[3]);
    return parts[2] !== '' && Number.isFinite(limit) && !Number.isNaN(p) ? { kind: 'discharge', pct: p, limit } : null;
  }
  return null;
}

// [grid MWh (positive when buying), new state of charge] for one half-hour; impossible actions are clipped.
// An offer below its limit price does not trade; pass the settlement price as `price` to apply it.
export function step(soc: number, action: string, price: number | null = null): [number, number] {
  const a = parseAction(action) ?? { kind: 'hold' as const, pct: 100, limit: null };
  if (a.limit !== null && price !== null && price < a.limit) return [0, soc];
  const slot = SLOT_MWH * (a.pct / 100);
  if (a.kind === 'charge') {
    const stored = Math.min(slot * ETA, BATTERY.energy_mwh - soc);
    return [stored / ETA, soc + stored];
  }
  if (a.kind === 'discharge') {
    const sold = Math.min(slot, soc * ETA);
    return [-sold, soc - sold / ETA];
  }
  return [0, soc];
}

export const slotPnl = (price: number, grid: number): number =>
  Math.round((-price * grid - BATTERY.degradation_per_mwh * Math.abs(grid)) * 100) / 100;
