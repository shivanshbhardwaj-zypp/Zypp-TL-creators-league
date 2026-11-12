// Google Apps Script glue: binds the platform-free handler in api.ts to Sheets, CacheService, LockService and UrlFetchApp.
// Built into apps-script/Code.js by `npm run build:gas`; paste that file into the Apps Script editor.
import { HttpError, handle, recalculate, refreshViews, type Env } from './api'
import { DEFAULT_SETTINGS, SHEETS, TEXT_COLUMNS, fromTables, logToRec, recToLog, toTables, type Rec } from './schema'

declare const SpreadsheetApp: any, CacheService: any, PropertiesService: any, LockService: any, Utilities: any, UrlFetchApp: any, ContentService: any, Session: any, ScriptApp: any

const props = () => PropertiesService.getScriptProperties()
const book = () => {
  const id = props().getProperty('SPREADSHEET_ID')
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet()
}
const fmtDate = (d: Date) => Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd')
const sheetOf = (name: string) => {
  const sh = book().getSheetByName(name)
  if (!sh) throw new Error(`Sheet ${name} is missing. Run setup() from the Apps Script editor.`)
  return sh
}

function readRecords(name: string): Rec[] {
  const sh = sheetOf(name)
  const rows = sh.getLastRow(), cols = sh.getLastColumn()
  if (rows < 2 || cols < 1) return []
  const [head, ...body] = sh.getRange(1, 1, rows, cols).getValues()
  return body.map((r: any[]) => Object.fromEntries(head.map((h: any, i: number) => [String(h).trim(), Object.prototype.toString.call(r[i]) === '[object Date]' ? fmtDate(r[i]) : r[i]])))
}

/** Rewrites a sheet's data rows from records, keeping any extra columns admins added (matched by the row's ID). */
function writeRecords(name: string, idCol: string, headers: readonly string[], recs: Rec[]) {
  const sh = sheetOf(name)
  const old = new Map(readRecords(name).map((r) => [String(r[idCol]), r]))
  const head: string[] = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((h: any) => String(h).trim()) : []
  for (const h of headers) if (!head.includes(h)) head.push(h)
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold')
  head.forEach((h, i) => { if (TEXT_COLUMNS.includes(h)) sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@') })
  const values = recs.map((r) => head.map((h) => (h in r ? r[h] ?? '' : old.get(String(r[idCol]))?.[h] ?? '')))
  if (values.length) sh.getRange(2, 1, values.length, head.length).setValues(values)
  const extra = sh.getLastRow() - 1 - values.length
  if (extra > 0) sh.getRange(values.length + 2, 1, extra, head.length).clearContent()
}

function appendLogs(entries: Rec[]) {
  if (!entries.length) return
  const sh = sheetOf(SHEETS.logs.name)
  sh.getRange(sh.getLastRow() + 1, 1, entries.length, SHEETS.logs.headers.length).setValues(entries.map((e) => SHEETS.logs.headers.map((h) => e[h] ?? '')))
}

function env(): Env {
  const cache = CacheService.getScriptCache()
  return {
    load: () => fromTables({
      registrations: readRecords(SHEETS.registrations.name),
      submissions: readRecords(SHEETS.submissions.name),
      rewards: readRecords(SHEETS.rewards.name),
      settings: readRecords(SHEETS.settings.name),
    }),
    save: (db) => {
      const t = toTables(db)
      for (const k of ['registrations', 'submissions', 'rewards', 'settings', 'leaderboard'] as const) writeRecords(SHEETS[k].name, SHEETS[k].id, SHEETS[k].headers, t[k])
      appendLogs(db.audit.map(logToRec))
      db.audit = []
    },
    appendLog: (es) => appendLogs(es.map(logToRec)),
    readLogs: (limit) => readRecords(SHEETS.logs.name).slice(-limit).reverse().map(recToLog),
    cache: { get: (k) => cache.get(k), put: (k, v, s) => cache.put(k, v, s), remove: (k) => cache.remove(k) },
    prop: (k) => props().getProperty(k) || undefined,
    setProp: (k, v) => { if (v == null) props().deleteProperty(k); else props().setProperty(k, v) },
    installTriggers: () => { installTriggers() },
    nightlyOn: () => ScriptApp.getProjectTriggers().some((t: any) => t.getHandlerFunction() === 'refreshViewsJob'),
    lock: (fn) => {
      const l = LockService.getScriptLock()
      if (!l.tryLock(30000)) throw new HttpError(503, 'The sheet is busy. Please try again in a moment.')
      try { return fn() } finally { l.releaseLock() }
    },
    token: () => (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''),
    today: () => fmtDate(new Date()),
    now: () => new Date().toISOString(),
    http: (url, init) => {
      const r = UrlFetchApp.fetch(url, { method: init.method, headers: init.headers, ...(init.method === 'get' ? {} : { payload: init.body }), muteHttpExceptions: true, followRedirects: true })
      return { status: r.getResponseCode(), text: r.getContentText() }
    },
  }
}

const json = (o: unknown) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)

/** Every website call: POST text/plain {path, method, body, token} → {status, data}. text/plain avoids a CORS preflight. */
export function doPost(e: any) {
  let req
  try { req = JSON.parse(e?.postData?.contents ?? '{}') } catch { return json({ status: 400, data: { error: 'Bad request' } }) }
  return json(handle(env(), req))
}

export const doGet = () => json({ status: 200, data: { ok: true, service: 'Zypp Creator League API' } })

/** One-time (safe to re-run): creates any missing sheets with headers and default campaign settings. */
export function setup() {
  const b = book()
  for (const k of Object.keys(SHEETS) as (keyof typeof SHEETS)[]) {
    const { name, headers } = SHEETS[k]
    const sh = b.getSheetByName(name) ?? b.insertSheet(name)
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, headers.length).setValues([headers as unknown as string[]]).setFontWeight('bold')
    sh.setFrozenRows(1)
  }
  const st = sheetOf(SHEETS.settings.name)
  if (st.getLastRow() < 2) st.getRange(2, 1, DEFAULT_SETTINGS.length, 2).setNumberFormat('@').setValues(DEFAULT_SETTINGS)
  return 'Sheets ready. Fill CAMPAIGN_SETTINGS (dates, cities), then deploy as a web app.'
}

/** Run once: view refresh every night at 2 AM (script time zone, Asia/Kolkata) + 10-minute recalculation after hand edits. */
export function installTriggers() {
  for (const t of ScriptApp.getProjectTriggers()) if (['recalculateJob', 'refreshViewsJob'].includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t)
  ScriptApp.newTrigger('recalculateJob').timeBased().everyMinutes(10).create()
  // Google runs "atHour(2)" somewhere between 2:00 and 3:00 AM.
  ScriptApp.newTrigger('refreshViewsJob').timeBased().everyDays(1).atHour(2).create()
  return 'Triggers installed: views refresh nightly around 2 AM; leaderboard recalculates every 10 minutes'
}

export const recalculateJob = () => recalculate(env())
export const refreshViewsJob = () => refreshViews(env(), 'scheduler')

export function onOpen() {
  SpreadsheetApp.getUi().createMenu('Creator League')
    .addItem('Recalculate leaderboard & rewards', 'recalculateJob')
    .addItem('Fetch live views (Apify)', 'refreshViewsJob')
    .addToUi()
}
