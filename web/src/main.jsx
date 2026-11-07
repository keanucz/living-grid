import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import UpdateChip from './shell/UpdateChip.jsx'
import './styles/app.css'
import { startLive } from './live/index.js'
import { matchView } from './views/index.js'

// The map's SpacetimeDB feed (~12k rows) only matters on the map. Phone views such as #/market and #/game open
// their own small subscriptions; starting the map feed there made them wait ~9 s on 'Connecting'.
const startForMap = () => {
  if (!matchView(location.hash)) startLive()
}
startForMap()
addEventListener('hashchange', startForMap)

createRoot(document.getElementById('root')).render(
  <>
    <App />
    <UpdateChip />
  </>,
)
