import test from 'node:test'
import assert from 'node:assert/strict'
import { seed } from './seed'
import { claimCheck, claimReward, counted, decideClaim, joinSub, leaderboard, milestoneFor, participantViews, position, rewardsOf, summary, tlDashboard, toPublic, videoKey } from './logic'

test('seed has 30 TLs, 3 cities, all statuses and both platforms', () => {
  const db = seed()
  assert.equal(db.participants.length, 30)
  assert.equal(new Set(db.participants.map((p) => p.city)).size, 3)
  for (const st of ['active', 'rejected']) assert.ok(db.submissions.some((s) => s.status === st), st)
  for (const pl of ['instagram', 'youtube']) assert.ok(db.submissions.some((s) => s.platform === pl), pl)
})

test('active videos count (no approval), disqualified ones never; city, platform and participant totals reconcile', () => {
  const db = seed()
  const s = summary(db, {})
  const approvedSum = db.submissions.filter((x) => x.status === 'active').reduce((a, x) => a + (x.verifiedViews ?? 0), 0)
  assert.equal(s.kpis.views, approvedSum)
  assert.equal(s.cities.reduce((a, c) => a + c.views, 0), s.kpis.views)
  assert.equal(s.platforms.reduce((a, p) => a + p.views, 0), s.kpis.views)
  assert.equal(db.participants.reduce((a, p) => a + participantViews(db, p.id), 0), s.kpis.views)
  assert.equal(s.weekly.reduce((a, w) => a + w.views, 0), s.kpis.views)
  assert.equal(s.kpis.approved + s.kpis.rejected, s.kpis.videos)
  assert.ok(s.kpis.pending > 0) // active but not measured yet
  assert.equal(db.submissions.filter((x) => x.status !== 'active').reduce((a, x) => a + counted(x), 0), 0)
})

test('leaderboard is sorted by views then entries, and matches TL dashboard rank', () => {
  const db = seed()
  const lb = leaderboard(db)
  for (let i = 1; i < lb.length; i++) {
    const [a, b] = [lb[i - 1], lb[i]]
    assert.ok(a.views > b.views || (a.views === b.views && a.entries >= b.entries))
    assert.ok(a.rank <= b.rank)
  }
  const pid = lb[4].participantId
  const pos = tlDashboard(db, pid).rank.overall!
  assert.equal(pos.rank, lb[4].rank)
  assert.equal(pos.above?.rank, lb[3].rank)
  assert.equal(pos.need, lb[3].views - lb[4].views + 1) // strictly overtake
  assert.equal(pos.below?.rank, lb[5].rank)
})

test('leader has nobody above; TL-facing rows carry only public fields', () => {
  const db = seed()
  const lb = leaderboard(db)
  const top = position(lb, lb[0].participantId)!
  assert.equal(top.above, null)
  assert.equal(top.need, 0)
  const pub = toPublic(lb, lb[2].participantId)
  for (const r of pub) assert.deepEqual(Object.keys(r).filter((k) => k !== 'isMe').sort(), ['city', 'entries', 'name', 'rank', 'views'])
  assert.equal(pub.filter((r) => r.isMe).length, 1)
  const json = JSON.stringify(tlDashboard(db, lb[2].participantId).top3)
  assert.ok(!/participantId|rewards|phone|employeeId|email/.test(json))
})

test('tie on views is broken by approved entry count; full tie shares rank', () => {
  const db = seed()
  const [a, b] = db.participants
  db.submissions = [
    { ...db.submissions[0], id: 'x1', participantId: a.id, status: 'active', verifiedViews: 1000 },
    { ...db.submissions[0], id: 'x2', participantId: b.id, status: 'active', verifiedViews: 500 },
    { ...db.submissions[0], id: 'x3', participantId: b.id, status: 'active', verifiedViews: 500 },
  ]
  let lb = leaderboard(db)
  assert.equal(lb[0].participantId, b.id)
  assert.deepEqual(lb.map((r) => r.rank), [1, 2])
  db.submissions.pop()
  db.submissions[1].verifiedViews = 1000
  lb = leaderboard(db)
  assert.deepEqual(lb.map((r) => r.rank), [1, 1])
})

const one = (views: number, extra = {}) => {
  const db = seed()
  db.rewards = []
  db.submissions = [{ ...db.submissions[0], id: 'v1', platform: 'instagram', submittedAt: '2026-10-01', status: 'active', verifiedViews: views, ...extra }]
  return db
}

test('claim needs a reached milestone, measured by the campaign (not typed by the TL)', () => {
  const db = one(24999)
  assert.equal(claimCheck(db, db.submissions[0]).ok, false)
  assert.match(claimCheck(db, db.submissions[0]).reason!, /Reach 25,000 views/)
  assert.throws(() => claimReward(db, db.submissions[0], '2026-11-01'))
  db.submissions[0].verifiedViews = null
  assert.equal(claimCheck(db, db.submissions[0]).ok, false) // not measured yet
  db.submissions[0].verifiedViews = 30000
  const r = claimReward(db, db.submissions[0], '2026-11-01')
  assert.deepEqual([r.status, r.milestone, r.amount, r.claimedViews], ['claimed', '25K views', 200, 30000])
  assert.throws(() => claimReward(db, db.submissions[0], '2026-11-01'), /Already claimed/) // no double claim
  assert.equal(rewardsOf(db, db.submissions[0].participantId), 0) // nothing earned until verified
})

test('highest milestone only: 120,000 views = Rs 500, and a claim moves up (re-verified) until paid', () => {
  const db = one(120000)
  const r = claimReward(db, db.submissions[0], '2026-11-01')
  assert.deepEqual([r.milestone, r.amount], ['100K views', 500])
  db.submissions[0].verifiedViews = 600000
  claimReward(db, db.submissions[0], '2026-11-02')
  assert.deepEqual([db.rewards.length, r.amount, r.status], [1, 1500, 'claimed'])
  decideClaim(db, r, 'approve', 600000, undefined, '2026-11-03')
  r.status = 'paid'
  db.submissions[0].verifiedViews = 2000000
  assert.match(claimCheck(db, db.submissions[0]).reason!, /paid/)
})

test('admin verification: approval re-derives the milestone from verified views; rejection needs a reason', () => {
  const db = one(120000)
  const r = claimReward(db, db.submissions[0], '2026-11-01')
  assert.throws(() => decideClaim(db, r, 'approve', 20000, undefined, '2026-11-02'), /below the lowest milestone/)
  decideClaim(db, r, 'approve', 40000, undefined, '2026-11-02') // admin found fewer views than claimed
  assert.deepEqual([r.status, r.milestone, r.amount, r.verifiedViews], ['approved', '25K views', 200, 40000])
  assert.equal(db.submissions[0].verifiedViews, 40000)
  assert.equal(rewardsOf(db, db.submissions[0].participantId), 200)
  assert.throws(() => decideClaim(db, r, 'reject', null, 'x', '2026-11-03'), /waiting for verification/)

  const db2 = one(30000)
  const r2 = claimReward(db2, db2.submissions[0], '2026-11-01')
  assert.throws(() => decideClaim(db2, r2, 'reject', null, undefined, '2026-11-02'), /reason/)
  decideClaim(db2, r2, 'reject', null, 'Video is private', '2026-11-02')
  assert.equal(r2.status, 'rejected')
  assert.equal(claimCheck(db2, db2.submissions[0]).ok, true) // may claim again after fixing
})

test('T&C rule 2: one claim per TL per platform; disqualified videos cannot claim', () => {
  const db = seed()
  db.rewards = []
  const base = db.submissions[0]
  db.submissions = [
    { ...base, id: 'a', platform: 'instagram', submittedAt: '2026-10-01', status: 'active', verifiedViews: 30000 },
    { ...base, id: 'b', platform: 'instagram', submittedAt: '2026-10-02', status: 'active', verifiedViews: 600000 },
    { ...base, id: 'c', platform: 'youtube', submittedAt: '2026-10-03', status: 'active', verifiedViews: 120000 },
    { ...base, id: 'd', platform: 'facebook', submittedAt: '2026-10-03', status: 'rejected', verifiedViews: 900000 },
  ]
  claimReward(db, db.submissions[0], '2026-11-01')
  assert.match(claimCheck(db, db.submissions[1]).reason!, /another instagram video/)
  assert.equal(joinSub(db, db.submissions[1]).rewardEligible, false)
  assert.equal(claimCheck(db, db.submissions[2]).ok, true) // other platforms are independent
  assert.match(claimCheck(db, db.submissions[3]).reason!, /disqualified/)
  const r = db.rewards[0]
  decideClaim(db, r, 'reject', null, 'Not a Zypp video', '2026-11-02')
  assert.equal(claimCheck(db, db.submissions[1]).ok, true) // a rejected claim frees the platform
})

test('videoKey ignores share params, www/m and trailing slashes but keeps the YouTube id', () => {
  assert.equal(videoKey('https://www.instagram.com/reel/AbC/?igsh=x'), videoKey('https://instagram.com/reel/AbC'))
  assert.equal(videoKey('https://m.youtube.com/watch?v=abc&t=3'), 'youtube.com/watch?v=abc')
  assert.notEqual(videoKey('https://youtube.com/watch?v=abc'), videoKey('https://youtube.com/watch?v=abd'))
})

test('filters scope KPIs and previous-period comparison only when data exists', () => {
  const db = seed()
  const f = summary(db, { city: 'Bengaluru', platform: 'youtube' })
  assert.ok(f.rows.every((r) => r.city === 'Bengaluru' && r.platform === 'youtube'))
  assert.equal(f.prev, null)
  const w = summary(db, { from: '2026-10-15', to: '2026-11-10' })
  assert.ok(w.prev)
  assert.equal(summary(db, { from: '2026-09-15', to: '2026-09-20' }).prev, null)
})
