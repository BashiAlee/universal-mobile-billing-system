import { BrowserWindow, dialog } from 'electron'
import { writeFileSync } from 'fs'
import { basename, join } from 'path'
import type { Result } from '../../shared/types'

const MAX_BYTES = 20 * 1024 * 1024

/** Plain, safe file name ending in .csv (no folders, no odd characters). */
export function safeCsvName(name: string): string {
  const base = basename(String(name))
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\.csv$/i, '')
  return `${base.slice(0, 80) || 'export'}.csv`
}

/**
 * Asks the user where to save a CSV and writes it. The renderer only supplies the text; the main process picks
 * nothing on its own. Returns the saved path, or null if the user cancelled. (UBS_EXPORT_DIR skips the dialog for tests.)
 */
export async function saveCsv(name: string, content: string): Promise<Result<string | null>> {
  try {
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_BYTES)
      throw new Error('Nothing to export, or the export is too large')
    const file = safeCsvName(name)
    let path: string | undefined
    if (process.env['UBS_EXPORT_DIR']) {
      path = join(process.env['UBS_EXPORT_DIR'], file)
    } else {
      const win = BrowserWindow.getFocusedWindow()
      const opts = {
        defaultPath: file,
        filters: [{ name: 'CSV (opens in Excel)', extensions: ['csv'] }]
      }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (r.canceled || !r.filePath) return { ok: true, data: null }
      path = r.filePath
    }
    writeFileSync(path, '﻿' + content, 'utf8') // BOM so Excel reads names/Urdu correctly
    return { ok: true, data: path }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save the file' }
  }
}
