// End-to-end tests of the Apps Script handler against in-memory sheet tables (same row mapping the real sheets use).
import test from 'node:test'
import assert from 'node:assert/strict'
import { seed } from '../server/test-fixture'
import { leaderboard, summary } from '../server/logic'
import { handle } from './api'
import { memEnv } from './test-env'
import { fromTables, parseMilestones, toTables } from './schema'

const FORM = { name: 'Test TL', employeeId: 'ZYP9001', email: 'test.tl@zypp.app', city: 'Bengaluru', platform: 'instagram', url: 'https://www.instagram.com/reel/NewReel01/', terms: true }

test('sheet rows round-trip without changing any number', () => {
  const db = seed()
  const back = fromTables(JSON.parse(JSON.stringify(toTables(db))))
  assert.deepEqual(leaderboard(back), leaderboard(db))
  assert.deepEqual(summary(back, {}).kpis, summary(db, {}).kpis)
  assert.deepEqual(back.rewards.map((r) => [r.id, r.submissionId, r.amount, r.status]), db.rewards.map((r) => [r.id, r.submissionId, r.amount, r.status]))
  assert.deepEqual(back.milestones, db.milestones)
  assert.deepEqual(parseMilestones('25,000 = ₹200; 100000=500 (off)').map((m) => [m.views, m.amount, m.active]), [[25000, 200, true], [100000, 500, false]])
  assert.throws(() => parseMilestones('25000:200'), /Reward Milestones/)
})

test('landing form: new TL registers once, can add more videos, duplicates and mismatches are refused', () => {
  const { call, tables } = memEnv()
  const before = tables().registrations.length
  const r1 = call('/public/register', 'POST', FORM)
  assert.equal(r1.status, 200, JSON.stringify(r1.data))
  assert.equal(r1.data.newParticipant, true)
  assert.equal(tables().registrations.length, before + 1)
  const sub = tables().submissions.find((s) => s['Submission ID'] === r1.data.submissionId)!
  assert.equal(sub['Verification Status'], 'Active') // no approval step
  assert.equal(sub['Employee ID'], 'ZYP9001')
  assert.equal(sub['Submission Date'], '2026-11-12')

  assert.equal(r1.data.user.role, 'tl')
  assert.equal(call('/me/dashboard', 'GET', undefined, r1.data.token).data.name, 'Test TL')
  assert.equal(call('/admin/summary', 'GET', undefined, r1.data.token).status, 403)

  const r2 = call('/public/register', 'POST', { ...FORM, platform: 'youtube', url: 'https://youtube.com/shorts/NewShort01' })
  assert.equal(r2.data.newParticipant, false)
  assert.equal(tables().registrations.length, before + 1)

  assert.equal(call('/public/register', 'POST', { ...FORM, url: 'https://instagram.com/reel/NewReel01?igsh=x' }).status, 409) // same video
  assert.equal(call('/public/register', 'POST', { ...FORM, email: 'other@zypp.app', url: 'https://instagram.com/reel/Other01' }).status, 409) // someone else's ID
  assert.equal(call('/public/register', 'POST', { ...FORM, terms: false }).status, 400)
  assert.equal(call('/public/register', 'POST', { ...FORM, city: 'Atlantis' }).status, 400)
  assert.equal(call('/public/register', 'POST', { ...FORM, url: 'https://example.com/video' }).status, 400)
  const bot = call('/public/register', 'POST', { ...FORM, url: 'https://instagram.com/reel/Bot01', website: 'spam' })
  assert.equal(bot.status, 200)
  assert.ok(!tables().submissions.some((s) => String(s['Content Link']).includes('Bot01')))
})

test('landing form respects campaign status and per-ID rate limit', () => {
  const db = seed()
  db.settings.campaignStatus = 'Closed'
  assert.equal(memEnv(db).call('/public/register', 'POST', FORM).status, 403)
  const { call } = memEnv()
  for (let i = 0; i < 10; i++) call('/public/register', 'POST', { ...FORM, url: `https://instagram.com/reel/R${i}` })
  assert.equal(call('/public/register', 'POST', { ...FORM, url: 'https://instagram.com/reel/R99' }).status, 429)
  const meta = call('/public/meta')
  assert.equal(meta.status, 200)
  assert.deepEqual(Object.keys(meta.data).sort(), ['campaignEnd', 'campaignName', 'campaignStart', 'campaignStatus', 'cities', 'milestones', 'open', 'platforms', 'termsVersion'])
})

test('TL login is Employee ID + registered email; TL sees only public leaderboard data and no admin data', () => {
  const { call } = memEnv()
  const p = seed().participants[4]
  assert.equal(call('/login', 'POST', { username: p.employeeId, password: 'wrong@x.com' }).status, 401)
  const ok = call('/login', 'POST', { username: p.employeeId.toLowerCase(), password: p.email.toUpperCase() })
  assert.equal(ok.status, 200)
  const t = ok.data.token
  const lb = call('/leaderboard', 'GET', undefined, t)
  for (const r of lb.data.rows) assert.deepEqual(Object.keys(r).filter((k) => k !== 'isMe').sort(), ['city', 'entries', 'name', 'rank', 'views'])
  assert.ok(!/employeeId|email|participantId|rewards|url/.test(JSON.stringify(lb.data)))
  assert.equal(call('/meta', 'GET', undefined, t).data.milestones, undefined)
  assert.equal(call('/admin/summary', 'GET', undefined, t).status, 403)
  assert.equal(call('/admin/summary').status, 401)
  assert.equal(call('/me/dashboard', 'GET', undefined, t).data.name, p.name)
  for (let i = 0; i < 5; i++) call('/login', 'POST', { username: 'ZYP1002', password: 'nope@x.com' })
  assert.equal(call('/login', 'POST', { username: 'ZYP1002', password: seed().participants[1].email }).status, 429)
})

test('admin login needs ADMIN_PASSWORD in Script Properties', () => {
  assert.equal(memEnv(seed(), {}).call('/login', 'POST', { username: 'admin', password: 'x' }).status, 503)
  const { call } = memEnv()
  assert.equal(call('/login', 'POST', { username: 'admin', password: 'admin123' }).status, 401)
  assert.equal(call('/login', 'POST', { username: 'admin', password: 'correct-horse' }).data.user.role, 'admin')
})

test('claim flow: measured views, TL claims, admin verifies, paid; sheets and logs follow', () => {
  const { call, tables, logs } = memEnv()
  const reg = call('/public/register', 'POST', FORM)
  const tl = reg.data.token
  const admin = call('/login', 'POST', { username: 'admin', password: 'correct-horse' }).data.token
  const sid = reg.data.submissionId

  // Not measured yet: cannot claim. A TL can never claim another TL's video.
  let mine = call('/me/claims', 'GET', undefined, tl).data
  assert.deepEqual([mine[0].id, mine[0].canClaim], [sid, false])
  assert.equal(call('/me/claims', 'POST', { submissionId: sid }, tl).status, 409)
  assert.equal(call('/me/claims', 'POST', { submissionId: 'S0001' }, tl).status, 404)

  // Views measured (Apify or admin): the video counts at once, no approval.
  assert.equal(call(`/admin/submissions/${sid}`, 'PATCH', { status: 'active', verifiedViews: 900000 }, admin).status, 200)
  const row = tables().submissions.find((s) => s['Submission ID'] === sid)!
  assert.deepEqual([row['Verification Status'], row['Verified Views'], row['Reward Eligibility']], ['Active', 900000, 'Yes'])
  assert.equal(tables().leaderboard.find((x) => x['TL Name'] === 'Test TL')!['Total Verified Views'], 900000)

  mine = call('/me/claims', 'GET', undefined, tl).data
  assert.deepEqual([mine[0].canClaim, mine[0].milestone], [true, '500K views'])
  assert.ok(!/amount|₹/.test(JSON.stringify(mine))) // TLs never see amounts
  const claim = call('/me/claims', 'POST', { submissionId: sid }, tl)
  assert.equal(claim.status, 200, JSON.stringify(claim.data))
  assert.equal(call('/me/claims', 'POST', { submissionId: sid }, tl).status, 409) // no double claim
  let reward = tables().rewards.find((x) => x['Submission ID'] === sid)!
  assert.deepEqual([reward['Highest Milestone'], reward['Reward Amount'], reward['Reward Status'], reward['Claimed Views']], ['500K views', 1500, 'Claimed', 900000])
  assert.equal(call(`/admin/rewards/${reward['Reward ID']}/pay`, 'POST', undefined, admin).status, 409) // must verify first

  // Admin sees the checks, verifies fewer views than claimed: paid at the lower milestone.
  const queue = call('/admin/rewards', 'GET', undefined, admin).data.allocations.find((a: any) => a.submissionId === sid)
  assert.deepEqual([queue.checks.viewsNow, queue.checks.meetsMilestone, queue.checks.active], [900000, true, true])
  assert.equal(call(`/admin/rewards/${reward['Reward ID']}/verify`, 'POST', { action: 'approve', verifiedViews: 120000 }, admin).status, 200)
  reward = tables().rewards.find((x) => x['Submission ID'] === sid)!
  assert.deepEqual([reward['Highest Milestone'], reward['Reward Amount'], reward['Reward Status'], reward['Verified Views']], ['100K views', 500, 'Approved', 120000])
  assert.equal(call(`/admin/rewards/${reward['Reward ID']}/pay`, 'POST', undefined, admin).status, 200)
  assert.equal(tables().rewards.find((x) => x['Submission ID'] === sid)!['Reward Status'], 'Paid')
  assert.ok(logs.some((l) => l.operation.startsWith('claim.submitted')) && logs.some((l) => l.operation.startsWith('claim.approved')))
  assert.equal(call('/me/claims', 'GET', undefined, tl).data[0].claim.status, 'paid')
  assert.equal(call(`/admin/rewards/${reward['Reward ID']}/verify`, 'POST', { action: 'approve', verifiedViews: 1 }, tl).status, 403)

  const d = call('/me/dashboard', 'GET', undefined, tl).data
  assert.equal(d.totals.views, 120000)
  assert.equal(d.rank.overall.rank, 1)
  assert.ok(!/amount|₹/.test(JSON.stringify(d)))
})

test('unexpected errors are returned as JSON and logged to SYNC_LOGS', () => {
  const { env, logs } = memEnv()
  env.load = () => { throw new Error('Sheet TL_REGISTRATIONS is missing') }
  const r = handle(env, { path: '/public/meta' })
  assert.equal(r.status, 500)
  assert.match(r.data.error, /TL_REGISTRATIONS/)
  assert.equal(logs.at(-1)!.status, 'error')
  assert.equal(handle(env, { path: '/nope' }).status, 404)
})

test('admin saves the Apify key from the dashboard: checked with Apify, stored server-side, nightly refresh switched on', () => {
  const { env, call } = memEnv()
  const admin = call('/login', 'POST', { username: 'admin', password: 'correct-horse' }).data.token
  const tl = call('/login', 'POST', { username: 'ZYP1001', password: 'aarav.1@example.com' }).data.token
  assert.equal(call('/admin/integrations/apify', 'PUT', { token: 'apify_api_x'.repeat(3) }, tl).status, 403)
  env.http = () => ({ status: 401, text: '' })
  assert.equal(call('/admin/integrations/apify', 'PUT', { token: 'apify_api_wrongwrongwrong1234' }, admin).status, 400)
  assert.equal(env.prop('APIFY_TOKEN'), undefined)
  assert.equal(call('/admin/integrations', 'GET', undefined, admin).data.nightly, false)
  env.http = () => ({ status: 200, text: '{}' })
  const ok = call('/admin/integrations/apify', 'PUT', { token: 'apify_api_rightrightright9876' }, admin)
  assert.equal(ok.status, 200)
  assert.equal(env.prop('APIFY_TOKEN'), 'apify_api_rightrightright9876')
  const info = call('/admin/integrations', 'GET', undefined, admin).data
  assert.deepEqual([info.apify, info.apifyHint, info.nightly], [true, '••••9876', true])
  assert.ok(!JSON.stringify(info).includes('rightright')) // the key itself never goes back to the browser
  assert.equal(call('/admin/integrations/apify', 'PUT', { token: '' }, admin).data.apify, false)
  assert.equal(env.prop('APIFY_TOKEN'), undefined)
})
