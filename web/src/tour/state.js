import { useSyncExternalStore } from 'react'

// { name, i, autoplay } while a tour is running, else null. Kept apart from the app store: the tour only reads it.
let tour = null
const listeners = new Set()
const KEY = 'lg-tour'

export const getTour = () => tour
export function setTour(next) {
  tour = next
  listeners.forEach((l) => l())
}
export const useTour = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => tour)

export function saved() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY))
    return v && typeof v.name === 'string' && Number.isInteger(v.i) ? v : null
  } catch {
    return null
  }
}
export function save(v) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify({ name: v.name, i: v.i }))
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode */
  }
}
