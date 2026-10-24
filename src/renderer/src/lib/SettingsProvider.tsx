import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ShopSettings } from '../../../shared/types'
import { SettingsContext } from './useSettings'

export function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<ShopSettings | null>(null)
  const reload = useCallback(async () => {
    const r = await window.api.settings.get()
    if (r.ok) {
      setSettings(r.data)
      document.title = r.data.shopName
    }
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])
  return (
    <SettingsContext.Provider value={{ settings, reload }}>{children}</SettingsContext.Provider>
  )
}
