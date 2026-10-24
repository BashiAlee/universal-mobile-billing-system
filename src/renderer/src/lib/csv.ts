export type Cell = string | number | null | undefined

/** Money cell: plain number text such as 1250.00 so Excel can add it up. */
export function money(minor: number): string {
  const abs = Math.abs(minor)
  return `${minor < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

function cell(v: Cell): string {
  if (v === null || v === undefined) return ''
  let t = String(v)
  // Stop spreadsheet formulas: text beginning with = + - @ would be run by Excel. Real numbers are left alone.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = `'${t}`
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
