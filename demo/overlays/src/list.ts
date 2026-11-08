// Every composition: id, length in seconds and the frame where it is fully in (used for the PNG stills).
// scripts/render.mjs reads the same list from src/list.json.
import list from './list.json'

export type Entry = { id: string; seconds: number; still: number }
export const LIST = list as Entry[]
export const seconds = (id: string) => LIST.find((x) => x.id === id)!.seconds
