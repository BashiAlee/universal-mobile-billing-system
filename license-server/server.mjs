import { createHandler, listen } from './app.mjs'
import { mongoStore } from './store.mjs'

const need = (name) => {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing ${name}. See README.md.`)
    process.exit(1)
  }
  return v
}

const privateKeyPem = Buffer.from(need('SIGNING_PRIVATE_KEY_BASE64'), 'base64').toString('utf8')
const store = await mongoStore(need('MONGODB_URI'), process.env.MONGODB_DB || 'ubs_licenses')
const handler = createHandler({
  store,
  privateKeyPem,
  adminToken: need('ADMIN_TOKEN'),
  graceDays: Number(process.env.GRACE_DAYS) || 7
})
const port = Number(process.env.PORT) || 3000
await listen(handler, port)
console.log(`License server listening on port ${port}`)
