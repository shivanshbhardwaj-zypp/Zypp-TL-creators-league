// Runs the built apps-script/Code.js (exactly what gets pasted into Apps Script) against a fake spreadsheet.
// Covers what api.test.ts can't: setup(), header-based reads, writes that keep admin-added columns, Date cells, doPost JSON.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

type Grid = any[][]
function fakeSheet() {
  const g: Grid = []
  const filled = (v: unknown) => v !== '' && v != null
  const sheet = {
    g,
    getLastRow: () => { for (let r = g.length; r > 0; r--) if (g[r - 1]?.some(filled)) return r; return 0 },
    getLastColumn: () => Math.max(0, ...g.map((row) => { for (let c = row.length; c > 0; c--) if (filled(row[c - 1])) return c; return 0 })),
    getMaxRows: () => Math.max(1000, g.length),
    setFrozenRows() {},
    getRange: (r: number, c: number, nr = 1, nc = 1) => {
      const range = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => g[r - 1 + i]?.[c - 1 + j] ?? '')),
        setValues: (v: Grid) => { v.forEach((row, i) => row.forEach((x, j) => { (g[r - 1 + i] ??= [])[c - 1 + j] = x })); return range },
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (g[r - 1 + i]) g[r - 1 + i][c - 1 + j] = ''; return range },
        setFontWeight: () => range,
        setNumberFormat: () => range,
      }
      return range
    },
  }
  return sheet
}

function load(props: Record<string, string> = { ADMIN_PASSWORD: 'pw-123456' }) {
  const sheets = new Map<string, ReturnType<typeof fakeSheet>>()
  const cache = new Map<string, string>()
  let uuid = 0
  const ctx: any = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n: string) => sheets.get(n) ?? null, insertSheet: (n: string) => { const s = fakeSheet(); sheets.set(n, s); return s } }) },
    CacheService: { getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => cache.set(k, v), remove: (k: string) => cache.delete(k) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props[k] ?? null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { formatDate: (d: Date) => d.toISOString().slice(0, 10), getUuid: () => `uuid-${++uuid}` },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s: string) => ({ body: s, setMimeType() { return this } }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => '[]' }) },
    ScriptApp: {},
  }
  vm.createContext(ctx)
  vm.runInContext(readFileSync('apps-script/Code.js', 'utf8'), ctx)
  const post = (path: string, method = 'GET', body?: unknown, token?: string) =>
    JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ path, method, body, token }) } }).body)
  ctx.setup()
  ctx.setup() // must be safe to re-run
  sheets.get('CAMPAIGN_SETTINGS')!.g.find((r) => r[0] === 'Available Cities')![1] = 'Delhi NCR, Bengaluru'
  return { ctx, sheets, post }
}

const today = new Date().toISOString().slice(0, 10)
const FORM = { name: 'Asha', employeeId: '00123', email: 'asha@zypp.app', city: 'Delhi NCR', platform: 'instagram', url: 'https://www.instagram.com/reel/Abc/', terms: true }

test('setup() creates the six sheets with the exact headers and default settings', () => {
  const { sheets, post } = load()
  assert.deepEqual([...sheets.keys()], ['TL_REGISTRATIONS', 'VIDEO_SUBMISSIONS', 'REWARDS', 'CAMPAIGN_SETTINGS', 'LEADERBOARD', 'SYNC_LOGS'])
  assert.deepEqual(sheets.get('TL_REGISTRATIONS')!.g[0], ['Participant ID', 'Name', 'Employee ID', 'Email ID', 'City', 'Registration Date', 'Participant Status'])
  assert.deepEqual(sheets.get('REWARDS')!.g[0], ['Reward ID', 'Participant ID', 'TL Name', 'Platform', 'Submission ID', 'Highest Milestone', 'Reward Amount', 'Reward Status', 'Reward Date', 'Claimed Views', 'Claim Date', 'Verified Views', 'Rejection Reason'])
  const settings = sheets.get('CAMPAIGN_SETTINGS')!.g
  assert.equal(settings.length, 10)
  assert.deepEqual(settings.find((r) => r[0] === 'Reward Milestones'), ['Reward Milestones', '25000=200; 100000=500; 500000=1500; 1000000=3000; 10000000=15000'])
  assert.deepEqual(post('/public/meta').data.cities, ['Delhi NCR', 'Bengaluru'])
  assert.deepEqual(JSON.parse(load().ctx.doGet().body).data.ok, true)
})

test('doPost end to end: register, TL submits and claims, admin verifies; admin columns and Date cells survive writes', () => {
  const { sheets, post } = load()
  const reg = post('/public/register', 'POST', FORM)
  assert.equal(reg.status, 200, JSON.stringify(reg))
  const tl = sheets.get('TL_REGISTRATIONS')!.g
  assert.deepEqual(tl[1], ['P001', 'Asha', '00123', 'asha@zypp.app', 'Delhi NCR', today, 'Active'])

  // An admin adds their own column, and Sheets turns the date text into a Date object.
  tl[0][7] = 'Notes'
  tl[1][7] = 'met at Okhla hub'
  tl[1][5] = new Date(`${today}T00:00:00Z`) as any

  const login = post('/login', 'POST', { username: '00123', password: 'asha@zypp.app' })
  assert.equal(login.status, 200, JSON.stringify(login))
  const own = post('/me/submissions', 'POST', { platform: 'youtube', url: 'https://youtu.be/xyz12' }, login.data.token)
  assert.equal(own.status, 200, JSON.stringify(own))
  assert.equal(tl[1][7], 'met at Okhla hub')
  assert.equal(tl[1][5], today)

  const admin = post('/login', 'POST', { username: 'admin', password: 'pw-123456' }).data.token
  const r = post(`/admin/submissions/${reg.data.submissionId}`, 'PATCH', { status: 'active', verifiedViews: 30000 }, admin)
  assert.equal(r.status, 200, JSON.stringify(r))
  const sub = sheets.get('VIDEO_SUBMISSIONS')!.g
  const h = sub[0]
  assert.deepEqual([sub[1][h.indexOf('Submission ID')], sub[1][h.indexOf('Verification Status')], sub[1][h.indexOf('Reward Eligibility')]], ['S0001', 'Active', 'Yes'])
  assert.deepEqual([sub[2][h.indexOf('Submission ID')], sub[2][h.indexOf('Platform')], sub[2][h.indexOf('Verification Status')]], ['S0002', 'YouTube', 'Active'])

  assert.equal(post('/me/claims', 'POST', { submissionId: 'S0001' }, login.data.token).status, 200)
  assert.deepEqual(sheets.get('REWARDS')!.g[1], ['R0001', 'P001', 'Asha', 'Instagram', 'S0001', '25K views', 200, 'Claimed', today, 30000, today, '', ''])
  assert.equal(post('/admin/rewards/R0001/verify', 'POST', { action: 'approve', verifiedViews: 31000 }, admin).status, 200)
  assert.deepEqual(sheets.get('REWARDS')!.g[1].slice(7), ['Approved', today, 30000, today, 31000, ''])
  assert.deepEqual(sheets.get('LEADERBOARD')!.g[1], [1, 'P001', 'Asha', 'Delhi NCR', 2, 31000, 0, 0, 31000, 200])
  const logs = sheets.get('SYNC_LOGS')!.g
  assert.ok(logs.some((l) => String(l[1]).startsWith('claim.approved') && l[2] === 'Success' && l[4] === 'R0001'))

  const board = post('/leaderboard', 'GET', undefined, login.data.token)
  assert.deepEqual(board.data.rows, [{ rank: 1, name: 'Asha', city: 'Delhi NCR', entries: 2, views: 31000, isMe: true }])
})
