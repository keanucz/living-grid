// On-screen words. Plain English, British spelling, no em dashes.
export const TITLE = {
  name: 'The Living Grid',
  tagline: 'Europe’s hidden power grid, made visible, and where it is heading next.',
  event: 'HackTheBurgh XIII',
}

export const BEATS: Record<string, { step: string; line: string }> = {
  now: { step: 'Now', line: 'Power prices across Europe right now, and the electricity flowing between countries.' },
  'hidden-grid': { step: 'Hidden grid', line: 'Wind farms paid to switch off, and carbon that comes in by cable.' },
  'what-if': { step: 'What if', line: 'Close the Strait of Hormuz and see the bill across Europe, in pounds.' },
  forecast: { step: 'Forecast', line: 'Where prices are going in the next hours, with honest uncertainty bands.' },
  proof: { step: 'Proof', line: 'Every forecast is logged before the outcome, then scored against a simple baseline.' },
  tonight: { step: 'Tonight', line: 'The cheapest hours tonight to charge a car or run the dishwasher.' },
  meter: { step: 'Big loads', line: 'What running AI costs in each country, and how a battery answers the shock.' },
  play: { step: 'Play', line: 'Call a real, hidden day and see if you beat our model.' },
  reveal: { step: 'Reveal', line: 'Monday’s forecast, frozen hours ago, meets the real auction result.' },
}

export const END = {
  url: 'htb.stefvuck.dev',
  repo: 'github.com/keanucz/living-grid',
  cta: 'Try it on your phone',
}
