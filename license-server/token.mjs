import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

const b64u = (buf) => Buffer.from(buf).toString('base64url')

/** A token is base64url(JSON payload) + "." + base64url(ed25519 signature of those payload bytes). */
export function signToken(payload, privateKeyPem) {
  const body = Buffer.from(JSON.stringify(payload))
  const sig = sign(null, body, createPrivateKey(privateKeyPem))
  return `${b64u(body)}.${b64u(sig)}`
}

/** Returns the payload when the signature is valid, otherwise null. */
export function verifyToken(token, publicKeyPem) {
  try {
    const [body, sig] = String(token).split('.')
    if (!body || !sig) return null
    const bytes = Buffer.from(body, 'base64url')
    const ok = verify(null, bytes, createPublicKey(publicKeyPem), Buffer.from(sig, 'base64url'))
    return ok ? JSON.parse(bytes.toString('utf8')) : null
  } catch {
    return null
  }
}
