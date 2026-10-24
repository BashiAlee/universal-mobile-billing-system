import { createContext, useContext } from 'react'
import type { ShopSettings } from '../../../shared/types'

export interface SettingsCtx {
  settings: ShopSettings | null
  reload: () => Promise<void>
}

export const SettingsContext = createContext<SettingsCtx>({
  settings: null,
  reload: async () => {}
})

export const useSettings = (): SettingsCtx => useContext(SettingsContext)
