/** Where licenses are kept. The in-memory one is for tests; the Mongo one is the real thing. */
export function memoryStore() {
  const rows = new Map()
  return {
    async find(key) {
      const r = rows.get(key)
      return r ? structuredClone(r) : null
    },
    async list() {
      return [...rows.values()]
        .map((r) => structuredClone(r))
        .sort((a, b) => a.shop.localeCompare(b.shop))
    },
    async insert(license) {
      rows.set(license.key, structuredClone(license))
    },
    async update(key, patch) {
      const r = rows.get(key)
      if (!r) return false
      Object.assign(r, structuredClone(patch))
      return true
    },
    async remove(key) {
      return rows.delete(key)
    }
  }
}

export async function mongoStore(uri, dbName = 'ubs_licenses') {
  const { MongoClient } = await import('mongodb')
  const client = new MongoClient(uri)
  await client.connect()
  const col = client.db(dbName).collection('licenses')
  await col.createIndex({ key: 1 }, { unique: true })
  const clean = (r) => (r ? (({ _id, ...rest }) => rest)(r) : null)
  return {
    async find(key) {
      return clean(await col.findOne({ key }))
    },
    async list() {
      return (await col.find({}).sort({ shop: 1 }).toArray()).map(clean)
    },
    async insert(license) {
      await col.insertOne({ ...license })
    },
    async update(key, patch) {
      return (await col.updateOne({ key }, { $set: patch })).matchedCount > 0
    },
    async remove(key) {
      return (await col.deleteOne({ key })).deletedCount > 0
    }
  }
}
