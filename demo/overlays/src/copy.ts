// On-screen words. Plain English, British spelling, no em dashes.
export const TITLE = {
  name: 'The Living Grid',
  tagline: 'Your daily weather report for power. What it costs now, what happens next, and proof we got it right.',
  event: 'HackTheBurgh XIII',
}

export const BEATS: Record<string, { step: string; line: string }> = {
  now: { step: 'Now', line: 'Power prices across Europe right now, and the electricity flowing between countries.' },
  'hidden-grid': { step: 'Hidden grid', line: 'Wind farms paid to switch off, and carbon that comes in by cable.' },
  'what-if': { step: 'What if', line: 'Close the Strait of Hormuz and see the bill across Europe, in pounds.' },
  forecast: { step: 'Forecast', line: 'Where prices are going next, with a likely range and the reasons why.' },
  proof: { step: 'Proof', line: 'Every forecast is logged before the outcome, then scored against a simple baseline.' },
  tonight: { step: 'Tonight', line: 'The cheapest hours tonight to charge a car or run the dishwasher.' },
  meter: { step: 'At home', line: 'The same forecast on a little screen at home: the price now, and the cheapest hours tonight.' },
  datacentre: { step: 'Data centres', line: 'Where should a data centre go? A year of power costs by country, with flexible work moved to cheap hours.' },
  tamper: { step: 'Tamper test', line: 'We change one digit of the sealed file. Its fingerprint no longer matches the one on Solana, so any edit would be caught.' },
  play: { step: 'Play', line: 'Call a real, hidden day and see if you beat our model.' },
  reveal: { step: 'Reveal', line: 'Monday’s forecast, sealed on Solana before the auction, meets the real result.' },
}

export const END = {
  url: 'htb.stefvuck.dev',
  repo: 'github.com/keanucz/living-grid',
  cta: 'Try it on your phone',
}
