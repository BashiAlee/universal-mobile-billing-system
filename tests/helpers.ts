import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../src/main/db/database'

export function memoryDb(): Db {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}
