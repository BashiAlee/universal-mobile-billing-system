/** Money helpers. Amounts are integer minor units with 2 decimals (e.g. 1250 = 12.50). */

export function formatMoney(minor: number, symbol: string): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const whole = Math.floor(abs / 100).toLocaleString('en-US')
  return `${sign}${symbol} ${whole}.${String(abs % 100).padStart(2, '0')}`
}

/** Parses user text like "12", "12.5", "12.50" into minor units. Returns null if invalid. */
export function parseMoney(text: string): number | null {
  const t = text.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const [w, f = ''] = t.split('.')
  return Number(w) * 100 + Number(f.padEnd(2, '0'))
}

export function minorToInput(minor: number): string {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`
}
