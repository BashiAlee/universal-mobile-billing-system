import { app } from 'electron'

/**
 * Address of the license server (see license-server/README.md). While this is empty the program
 * does not check any license at all. Set it once the server is deployed, then rebuild the installer.
 */
export const LICENSE_SERVER_URL = 'https://universal-mobile-billing-system.onrender.com'

/** Public half of the signing key. Answers are trusted only if they carry a valid signature from the private half. */
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEACm4L6s54krNdFRNNUi6SImp79ZwtUvoOJcmvFnqTw1A=
-----END PUBLIC KEY-----
`

export interface LicenseConfig {
  enforced: boolean
  url: string
  publicKey: string
}

/**
 * In the installed program the address and key above are the only ones used. While developing (not installed)
 * environment variables may replace them, and UBS_ENFORCE_LICENSE=1 switches checking on, so it can be tested.
 */
export function licenseConfig(): LicenseConfig {
  const dev = !app.isPackaged
  const url = (dev && process.env['UBS_LICENSE_URL']) || LICENSE_SERVER_URL
  const key =
    (dev && process.env['UBS_LICENSE_PUBKEY_BASE64']
      ? Buffer.from(process.env['UBS_LICENSE_PUBKEY_BASE64'], 'base64').toString('utf8')
      : '') || LICENSE_PUBLIC_KEY
  const enforced = !!url && (!dev || process.env['UBS_ENFORCE_LICENSE'] === '1')
  return { enforced, url, publicKey: key }
}
