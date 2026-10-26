import { createContext, useContext } from 'react'

/** True while a receipt or label job is being sent to the printer; print buttons are disabled meanwhile. */
export const PrintingContext = createContext<{ printing: boolean }>({ printing: false })

export const usePrinting = (): { printing: boolean } => useContext(PrintingContext)
