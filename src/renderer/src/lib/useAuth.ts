import { createContext, useContext } from 'react'

export interface AuthCtx {
  username: string
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthCtx>({ username: '', logout: async () => {} })

export const useAuth = (): AuthCtx => useContext(AuthContext)
