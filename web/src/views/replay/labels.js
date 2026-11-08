// Plain names for the replay's series chips. All continental series are day-ahead prices, so the country name is
// enough; Britain has two prices and says which.
const ZONE = { GB: 'Britain', FR: 'France', 'DE-LU': 'Germany', NL: 'Netherlands', BE: 'Belgium', NO2: 'Southern Norway' }
const TARGET = { gb_system_price: 'system price', price_da: 'day-ahead price', load: 'load', wind: 'wind' }

export function seriesLabel({ zone, target }) {
  const z = ZONE[zone] ?? zone
  if (zone === 'GB') return `${z} ${TARGET[target] ?? target}`
  return target === 'price_da' ? z : `${z} ${TARGET[target] ?? target}`
}
