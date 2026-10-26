import { randomBytes } from 'node:crypto'

const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const DAY_MS = 24 * 60 * 60 * 1000

/** A license key such as APEX-7K2Q-91XD-M3TP (random, easy to read out loud). */
export function newLicenseKey() {
  const part = () => Array.from(randomBytes(4), (b) => KEY_CHARS[b % KEY_CHARS.length]).join('')
  return `${part()}-${part()}-${part()}-${part()}`
}

export const normalizeKey = (k) =>
  String(k ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
export const formatKey = (k) =>
  normalizeKey(k)
    .match(/.{1,4}/g)
    ?.join('-') ?? ''

/** The last moment of a "paid until" date (YYYY-MM-DD), end of that day UTC. */
export function endOfDay(paidUntil) {
  const t = Date.parse(`${paidUntil}T23:59:59.999Z`)
  return Number.isNaN(t) ? 0 : t
}

/**
 * Decides what a shop is allowed to do right now.
 * Returns { status: 'active' | 'suspended', message, validUntil }.
 * An active answer is valid for at most `graceDays`, so a shop can work offline for that long.
 */
export function evaluate(license, now, graceDays) {
  if (license.status !== 'active')
    return {
      status: 'suspended',
      message: 'The subscription is switched off. Please contact the developer.',
      validUntil: now + DAY_MS
    }
  const end = endOfDay(license.paidUntil)
  if (end < now)
    return {
      status: 'suspended',
      message: `The subscription ended on ${license.paidUntil}. Please contact the developer to renew.`,
      validUntil: now + DAY_MS
    }
  return { status: 'active', message: '', validUntil: Math.min(end, now + graceDays * DAY_MS) }
}
