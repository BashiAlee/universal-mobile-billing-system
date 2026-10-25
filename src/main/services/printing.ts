import type { WebContents } from 'electron'

export interface PrinterOption {
  name: string
  displayName: string
  isDefault: boolean
}

export interface PrintOptions {
  /** The printer's system name (as listed). Printing goes straight to it, with no Windows print window. */
  deviceName: string
  /** Paper size in mm. Labels give both; receipts give neither and use the printer's own paper setting. */
  widthMm?: number
  heightMm?: number
  /** Turn the page 90 degrees. */
  landscape?: boolean
}

export async function listPrinters(contents: WebContents): Promise<PrinterOption[]> {
  const list = await contents.getPrintersAsync()
  return list.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    // Not in Electron's typings for every version, but present at run time on most systems.
    isDefault: (p as unknown as { isDefault?: boolean }).isDefault === true
  }))
}

function checkSize(label: string, v: unknown): number | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 10 || v > 1000)
    throw new Error(`${label} must be between 10 and 1000 mm`)
  return v
}

/** Prints the current page silently to the chosen printer. Resolves when the job is handed to Windows. */
export function printSilently(contents: WebContents, opts: PrintOptions): Promise<void> {
  if (!opts || typeof opts.deviceName !== 'string' || !opts.deviceName.trim())
    return Promise.reject(new Error('No printer chosen'))
  const w = checkSize('Paper width', opts.widthMm)
  const h = checkSize('Paper height', opts.heightMm)
  return new Promise((resolve, reject) => {
    contents.print(
      {
        silent: true,
        deviceName: opts.deviceName,
        printBackground: true,
        landscape: opts.landscape === true,
        margins: { marginType: 'none' },
        ...(w && h
          ? { pageSize: { width: Math.round(w * 1000), height: Math.round(h * 1000) } }
          : {})
      },
      (success, reason) =>
        success ? resolve() : reject(new Error(reason || 'The printer did not accept the job'))
    )
  })
}
