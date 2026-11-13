// TEST-ONLY in-memory stand-in for the Google Sheets environment (same handler, same row mapping). Used by *.test.ts only.
import { seed } from '../server/test-fixture'
import type { AuditEntry, DB } from '../server/types'
import { handle, type Env } from './api'
import { fromTables, toTables } from './schema'

export function memEnv(db0: DB = seed(), props: Record<string, string> = { ADMIN_PASSWORD: 'correct-horse' }, day = '2026-11-12') {
  let tables = toTables(db0)
  const logs: AuditEntry[] = []
  const cache = new Map<string, string>()
  let n = 0
  let nightly = false
  const env: Env = {
    load: () => fromTables(JSON.parse(JSON.stringify(tables))),
    save: (db) => { tables = toTables(db); logs.push(...db.audit); db.audit = [] },
    appendLog: (es) => { logs.push(...es) },
    readLogs: (l) => logs.slice(-l).reverse(),
    cache: { get: (k) => cache.get(k) ?? null, put: (k, v) => { cache.set(k, v) }, remove: (k) => { cache.delete(k) } },
    prop: (k) => props[k],
    setProp: (k, v) => { if (v == null) delete props[k]; else props[k] = v },
    installTriggers: () => { nightly = true },
    nightlyOn: () => nightly,
    lock: (fn) => fn(),
    token: () => `tok${++n}${Math.random().toString(36).slice(2)}`,
    today: () => day,
    now: () => new Date().toISOString(),
    http: () => ({ status: 200, text: '[]' }),
  }
  const call = (path: string, method = 'GET', body?: unknown, token?: string) => handle(env, { path, method, body, token })
  return { env, call, tables: () => tables, logs }
}
