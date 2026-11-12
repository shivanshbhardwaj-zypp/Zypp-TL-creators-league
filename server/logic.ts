// Single source of truth for every number shown on the landing page, TL dashboard, admin dashboard and the LEADERBOARD sheet.
// Runs both in Node (tests) and inside Google Apps Script (bundled into apps-script/Code.js), so: no Node or DOM APIs here.
import type { DB, Filters, LeaderRow, Milestone, Platform, RewardAllocation, Submission } from './types'

export const PLATFORMS: Platform[] = ['instagram', 'youtube', 'facebook']
export const enabledPlatforms = (db: DB) => PLATFORMS.filter((p) => db.settings.platforms[p])

/** Every active video counts with its latest measured views (Apify or admin-entered). Disqualified videos count 0. */
export const counted = (s: Submission) => (s.status === 'active' && s.verifiedViews != null ? s.verifiedViews : 0)

/** Canonical key so the same video can't be submitted twice with different query strings. (Regex, not URL: Apps Script has no URL class.) */
export function videoKey(url: string) {
  const m = url.trim().match(/^[a-z]+:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i)
  if (!m) return url.trim().toLowerCase()
  const v = (m[3] ?? '').match(/[?&]v=([^&]+)/)
  return m[1].replace(/^(www|m)\./i, '').toLowerCase() + m[2].replace(/\/+$/, '') + (v ? `?v=${v[1]}` : '')
}

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0)
const pmap = (db: DB) => new Map(db.participants.map((p) => [p.id, p]))

/** Next sequential id like P001 / S0001 / R0001, robust to deleted or hand-added rows. */
export function nextId(prefix: string, ids: string[], pad: number) {
  const max = ids.reduce((m, id) => Math.max(m, Number(id.slice(prefix.length)) || 0), 0)
  return prefix + String(max + 1).padStart(pad, '0')
}

export function filterSubs(db: DB, f: Filters): Submission[] {
  const ps = pmap(db)
  return db.submissions.filter((s) => {
    const d = s.submittedAt
    if (f.from && d < f.from) return false
    if (f.to && d > f.to) return false
    if (f.city && ps.get(s.participantId)?.city !== f.city) return false
    if (f.platform && s.platform !== f.platform) return false
    if (f.status && s.status !== f.status) return false
    return true
  })
}

export function totals(subs: Submission[]) {
  const approved = subs.filter((s) => s.status === 'active') // 'approved' = active videos (kept name: used across the UI)
  const on = (p: Platform) => sum(subs.filter((s) => s.platform === p), counted)
  return {
    videos: subs.length,
    participants: new Set(subs.map((s) => s.participantId)).size,
    views: sum(subs, counted),
    impressions: sum(approved, (s) => s.impressions ?? 0),
    approved: approved.length,
    pending: approved.filter((s) => s.verifiedViews == null).length, // active, views not measured yet
    rejected: subs.filter((s) => s.status === 'rejected').length,
    instagramViews: on('instagram'),
    youtubeViews: on('youtube'),
    facebookViews: on('facebook'),
  }
}

const earned = (r: RewardAllocation) => r.status === 'approved' || r.status === 'paid'
export const rewardsOf = (db: DB, pid: string) => sum(db.rewards.filter((r) => r.participantId === pid && earned(r)), (r) => r.amount)

/** Ranks by measured views, then active video count. Equal on both = same rank. */
export function leaderboard(db: DB, opts: { city?: string; platform?: Platform } = {}): LeaderRow[] {
  const rows: LeaderRow[] = []
  for (const p of db.participants) {
    if (opts.city && p.city !== opts.city) continue
    const mine = db.submissions.filter((s) => s.participantId === p.id && (!opts.platform || s.platform === opts.platform))
    if (!mine.length) continue // not participating (on this platform)
    const approved = mine.filter((s) => s.status === 'active')
    rows.push({
      rank: 0,
      participantId: p.id,
      name: p.name,
      city: p.city,
      entries: approved.length,
      views: sum(approved, counted),
      platforms: [...new Set(approved.map((s) => s.platform))],
      rewards: rewardsOf(db, p.id),
    })
  }
  rows.sort((a, b) => b.views - a.views || b.entries - a.entries || a.name.localeCompare(b.name))
  rows.forEach((r, i) => {
    const prev = rows[i - 1]
    r.rank = prev && prev.views === r.views && prev.entries === r.entries ? prev.rank : i + 1
  })
  return rows
}

/** The only leaderboard shape TLs ever receive: no internal IDs, contact data, links or reward amounts. */
export type PublicRow = Pick<LeaderRow, 'rank' | 'name' | 'city' | 'entries' | 'views'> & { isMe?: true }
export const toPublic = (rows: LeaderRow[], pid?: string): PublicRow[] =>
  rows.map((r) => ({ rank: r.rank, name: r.name, city: r.city, entries: r.entries, views: r.views, ...(pid && r.participantId === pid ? { isMe: true as const } : {}) }))

/** A TL's place on a given board, plus the public neighbours above/below. `need` = views to strictly overtake the next rank up. */
export function position(rows: LeaderRow[], pid: string) {
  const i = rows.findIndex((r) => r.participantId === pid)
  if (i < 0) return null
  const me = rows[i]
  const above = rows.slice(0, i).reverse().find((r) => r.rank < me.rank) ?? null
  const below = rows.slice(i + 1).find((r) => r.rank > me.rank) ?? null
  const pub = (r: LeaderRow | null) => r && { rank: r.rank, name: r.name, city: r.city, views: r.views }
  return { rank: me.rank, of: rows.length, city: me.city, views: me.views, entries: me.entries, above: pub(above), below: pub(below), need: above ? above.views - me.views + 1 : 0 }
}

export const participantViews = (db: DB, pid: string) => sum(db.submissions.filter((s) => s.participantId === pid), counted)

/** Highest active milestone a view count reaches (rewards are not cumulative). */
export const milestoneFor = (db: DB, views: number): Milestone | null =>
  [...db.milestones].filter((m) => m.active && views >= m.views).sort((a, b) => b.views - a.views)[0] ?? null

// ---------- Reward claims: TL claims → admin verifies → paid ----------
// All checks use the views the campaign measured (Apify / admin), never a number the TL types.

const activeMilestones = (db: DB) => db.milestones.filter((m) => m.active).sort((a, b) => a.views - b.views)

/** Can this video be claimed right now? Enforces the T&C: milestone reached, one video per platform per TL, highest milestone only. */
export function claimCheck(db: DB, s: Submission): { ok: boolean; reason?: string; milestone?: Milestone; views: number; upgrade?: boolean } {
  const views = counted(s)
  if (s.status !== 'active') return { ok: false, views, reason: 'This video was disqualified by the campaign team.' }
  const m = milestoneFor(db, views)
  const first = activeMilestones(db)[0]
  if (!m) return { ok: false, views, reason: first ? `Reach ${first.views.toLocaleString('en-IN')} views to claim (now ${views.toLocaleString('en-IN')}).` : 'No reward milestones are active.' }
  const other = db.rewards.find((r) => r.participantId === s.participantId && r.platform === s.platform && r.submissionId !== s.id && r.status !== 'rejected')
  if (other) return { ok: false, views, milestone: m, reason: `You already claimed for another ${s.platform} video (${other.submissionId}). Only one video per platform can earn a reward.` }
  const mine = db.rewards.find((r) => r.submissionId === s.id && r.status !== 'rejected')
  if (mine?.status === 'paid') return { ok: false, views, milestone: m, reason: 'The reward for this video has been paid.' }
  if (mine && m.amount <= mine.amount) return { ok: false, views, milestone: m, reason: `Already claimed at the ${mine.milestone} milestone.` }
  return { ok: true, views, milestone: m, upgrade: !!mine }
}

/** Creates the claim, or moves an open/approved claim up to a higher milestone (it then needs verifying again). */
export function claimReward(db: DB, s: Submission, at: string): RewardAllocation {
  const c = claimCheck(db, s)
  if (!c.ok) throw new Error(c.reason)
  const fields = { milestone: c.milestone!.label, amount: c.milestone!.amount, status: 'claimed' as const, claimedViews: c.views, claimedAt: at, verifiedViews: undefined, decidedAt: undefined, reason: undefined }
  const mine = db.rewards.find((r) => r.submissionId === s.id && r.status !== 'rejected')
  if (mine) return Object.assign(mine, fields)
  const r: RewardAllocation = { id: nextId('R', db.rewards.map((x) => x.id), 4), participantId: s.participantId, submissionId: s.id, platform: s.platform, ...fields }
  db.rewards.push(r)
  return r
}

/** Admin verdict. Approval re-derives the milestone from the views the admin verified, so a claim can never pay more than the video earned. */
export function decideClaim(db: DB, r: RewardAllocation, action: string, verifiedViews: unknown, reason: string | undefined, at: string) {
  if (r.status !== 'claimed') throw new Error('Only claims waiting for verification can be approved or rejected')
  if (action === 'reject') {
    if (!reason) throw new Error('A reason is required to reject a claim')
    return Object.assign(r, { status: 'rejected' as const, reason, decidedAt: at })
  }
  if (action !== 'approve') throw new Error('Unknown action')
  if (!Number.isInteger(verifiedViews) || (verifiedViews as number) < 0) throw new Error('Enter the verified view count')
  const m = milestoneFor(db, verifiedViews as number)
  if (!m) throw new Error('Verified views are below the lowest milestone. Reject the claim instead.')
  const s = db.submissions.find((x) => x.id === r.submissionId)
  if (!s || s.status !== 'active') throw new Error('The video is disqualified or missing. Reject the claim instead.')
  s.verifiedViews = verifiedViews as number // the admin's check is also the video's latest measured count
  return Object.assign(r, { status: 'approved' as const, verifiedViews: verifiedViews as number, milestone: m.label, amount: m.amount, decidedAt: at, reason: undefined })
}

/** What an admin sees next to each claim. */
export function claimChecks(db: DB, r: RewardAllocation) {
  const s = db.submissions.find((x) => x.id === r.submissionId)
  const viewsNow = s ? counted(s) : 0
  const threshold = db.milestones.find((m) => m.label === r.milestone)?.views ?? 0
  const earlier = s ? db.submissions.filter((x) => x.participantId === s.participantId && x.platform === s.platform && x.id !== s.id && x.submittedAt < s.submittedAt && milestoneFor(db, counted(x))).map((x) => x.id) : []
  return {
    viewsNow,
    meetsMilestone: viewsNow >= threshold,
    active: s?.status === 'active',
    liveViews: s?.fetchedViews ?? null,
    liveAt: s?.fetchedAt ?? null,
    earlierEligibleVideos: earlier, // T&C: the FIRST video on a platform to reach a milestone is the eligible one
  }
}

const DAY = 86400000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
export const weekStart = (d: string) => {
  const t = Date.parse(d)
  return iso(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY)
}

/** Weekly buckets keyed by Monday. Views attributed to submission date. */
export function weekly(subs: Submission[], from?: string, to?: string) {
  if (!subs.length && !(from && to)) return []
  const dates = subs.map((s) => s.submittedAt).sort()
  const start = weekStart(from ?? dates[0])
  const end = to ?? dates[dates.length - 1]
  const out: Record<string, { week: string; views: number; instagram: number; youtube: number; facebook: number; submissions: number; approved: number }> = {}
  for (let t = Date.parse(start); iso(t) <= end; t += 7 * DAY) out[iso(t)] = { week: iso(t), views: 0, instagram: 0, youtube: 0, facebook: 0, submissions: 0, approved: 0 }
  for (const s of subs) {
    const b = out[weekStart(s.submittedAt)]
    if (!b) continue
    b.submissions++
    if (s.status === 'active') b.approved++
    b.views += counted(s)
    if (s.platform === 'instagram') b.instagram += counted(s)
    if (s.platform === 'youtube') b.youtube += counted(s)
    if (s.platform === 'facebook') b.facebook += counted(s)
  }
  return Object.values(out)
}

export function previousWindow(f: Filters): Filters | null {
  if (!f.from || !f.to) return null
  const len = (Date.parse(f.to) - Date.parse(f.from)) / DAY + 1
  const to = iso(Date.parse(f.from) - DAY)
  return { ...f, from: iso(Date.parse(to) - (len - 1) * DAY), to }
}

export function joinSub(db: DB, s: Submission) {
  const p = db.participants.find((x) => x.id === s.participantId)
  return {
    ...s,
    name: p?.name ?? '',
    city: p?.city ?? '',
    employeeId: p?.employeeId ?? '',
    email: p?.email ?? '',
    rewardEligible: claimCheck(db, s).ok || db.rewards.some((r) => r.submissionId === s.id && r.status !== 'rejected'),
  }
}

export function summary(db: DB, f: Filters) {
  const ps = pmap(db)
  const subs = filterSubs(db, f)
  const cur = totals(subs)
  const prevF = previousWindow(f)
  const prevSubs = prevF ? filterSubs(db, prevF) : null
  // Only compare when the previous window actually has data; never invent a baseline.
  const prev = prevSubs && prevSubs.length ? totals(prevSubs) : null
  const top = (xs: Submission[]) => {
    const s = xs.filter((x) => x.status === 'active').sort((a, b) => counted(b) - counted(a))[0]
    return s ? { id: s.id, url: s.url, views: counted(s), name: ps.get(s.participantId)?.name ?? '' } : null
  }

  const platforms = enabledPlatforms(db).map((platform) => {
    const xs = subs.filter((s) => s.platform === platform)
    const approved = xs.filter((s) => s.status === 'active')
    const views = sum(xs, counted)
    const withImp = approved.filter((s) => s.impressions != null)
    return {
      platform,
      videos: xs.length,
      approved: approved.length,
      views,
      impressions: withImp.length ? sum(withImp, (s) => s.impressions!) : null,
      impressionsCoverage: approved.length ? withImp.length / approved.length : 0,
      avgViews: approved.length ? Math.round(views / approved.length) : 0,
      top: top(xs),
    }
  })

  const cityNames = f.city ? [f.city] : db.settings.cities
  const cities = cityNames.map((city) => {
    const xs = subs.filter((s) => ps.get(s.participantId)?.city === city)
    const byP = new Map<string, number>()
    for (const s of xs) byP.set(s.participantId, (byP.get(s.participantId) ?? 0) + counted(s))
    const best = [...byP].sort((a, b) => b[1] - a[1])[0]
    const views = sum(xs, counted)
    return {
      city,
      tls: byP.size,
      registered: db.participants.filter((p) => p.city === city).length,
      videos: xs.length,
      approved: xs.filter((s) => s.status === 'active').length,
      views,
      avgPerParticipant: byP.size ? Math.round(views / byP.size) : 0,
      top: best && best[1] > 0 ? { name: ps.get(best[0])!.name, views: best[1] } : null,
    }
  })

  const scopedRewards = db.rewards.filter((r) => !f.city || ps.get(r.participantId)?.city === f.city)
  return {
    kpis: cur,
    prev,
    admin: {
      registered: db.participants.filter((p) => !f.city || p.city === f.city).length,
      active: cur.participants,
      rewardsUnlocked: sum(scopedRewards.filter(earned), (r) => r.amount),
      rewardsPending: sum(scopedRewards.filter((r) => r.status === 'approved'), (r) => r.amount), // approved, not paid yet
      claimsOpen: scopedRewards.filter((r) => r.status === 'claimed').length,
      rewardsPaid: sum(scopedRewards.filter((r) => r.status === 'paid'), (r) => r.amount),
    },
    platforms,
    cities,
    weekly: weekly(subs, f.from, f.to),
    topVideos: subs
      .filter((s) => s.status === 'active')
      .sort((a, b) => counted(b) - counted(a))
      .slice(0, 10)
      .map((s) => ({ id: s.id, url: s.url, platform: s.platform, views: counted(s), name: ps.get(s.participantId)?.name ?? '', city: ps.get(s.participantId)?.city ?? '' })),
    topCities: [...cities].sort((a, b) => b.views - a.views),
    rows: subs.map((s) => joinSub(db, s)),
  }
}

/** Everything a TL's own dashboard shows. Contains only their own videos plus public leaderboard positions; no reward amounts. */
export function tlDashboard(db: DB, pid: string) {
  const subs = db.submissions.filter((s) => s.participantId === pid)
  const p = db.participants.find((x) => x.id === pid)!
  const overall = leaderboard(db)
  return {
    name: p.name,
    city: p.city,
    totals: totals(subs),
    weekly: weekly(subs),
    videos: subs.map((s) => ({ ...s, counted: counted(s) })).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    best: subs.filter((s) => s.status === 'active' && counted(s) > 0).sort((a, b) => counted(b) - counted(a))[0] ?? null,
    rank: { overall: position(overall, pid), city: position(leaderboard(db, { city: p.city }), pid) },
    top3: toPublic(overall.slice(0, 3), pid),
  }
}
