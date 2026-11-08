import { useMemo } from 'react'
import MapView from '../../map/MapView.jsx'
import { api, useApi } from '../../api/client.js'
import { useStore } from '../../store/store.js'
import { useGeo } from './useMapState.js'

// The same map as the main screen (price colours, flows, ghost wind), driven by the replay's playhead hour. `state` is the
// /state response for that hour.
export function ReplayMap({ state }) {
  const ui = useStore()
  const geo = useGeo()
  const zones = useApi(api.zones)
  const ctx = useMemo(() => {
    const zoneById = Object.fromEntries((zones.data?.zones ?? []).map((z) => [z.id, z]))
    const stateByZone = Object.fromEntries((state?.zones ?? []).map((z) => [z.zone, z]))
    const priceOf = (id) => stateByZone[id]?.price_eur ?? null
    return { data: { geo, zones: zones.data, state, scenarios: null, assets: null }, ui, zoneById, stateByZone, scenario: null, priceOf, source: null }
  }, [geo, zones.data, state, ui])
  return (
    <div className="rp-map" aria-label="Map at the playhead hour">
      <MapView ctx={ctx} />
    </div>
  )
}
