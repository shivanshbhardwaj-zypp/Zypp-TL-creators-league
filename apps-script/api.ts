// The whole server side: one request handler that the Apps Script web app (doPost) calls.
// Platform-free (Sheets, cache, lock and HTTP come in through Env) so it runs unchanged under Node tests.
import type { AuditEntry, DB, Filters, Platform, Role, Status, Submission } from '../server/types'
import { claimCheck, claimChecks, claimReward, counted, decideClaim, enabledPlatforms, joinSub, leaderboard, nextId, position, rewardsOf, summary, tlDashboard, toPublic, totals, videoKey } from '../server/logic'
import { fetchViews, type HttpFn } from '../server/apify'
import { fetchYouTubeViews } from '../server/youtube'
import { milestoneLabel } from './schema'

export interface Env {
  load(): DB
  /** Writes registrations, submissions, rewards, settings and LEADERBOARD, then appends db.audit to SYNC_LOGS. */
  save(db: DB): void
  appendLog(entries: AuditEntry[]): void
  readLogs(limit: number): AuditEntry[]
  cache: { get(k: string): string | null; put(k: string, v: string, seconds: number): void; remove(k: string): void }
  prop(k: string): string | undefined
  /** Writes (or with null, deletes) a Script Property. Secrets live here, never in the sheet or the browser. */
  setProp(k: string, v: string | null): void
  /** Ensures the nightly 2 AM view refresh (+ 10-minute recalculation) triggers exist. */
  installTriggers(): void
  nightlyOn(): boolean
  lock<T>(fn: () => T): T
  token(): string
  today(): string // YYYY-MM-DD in the script's time zone
  now(): string // ISO timestamp
  http: HttpFn
}
export type Req = { path?: string; method?: string; body?: any; token?: string }
export type Res = { status: number; data: any }
type Session = { role: Role; id: string; name: string }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
const fail = (status: number, msg: string): never => { throw new HttpError(status, msg) }

const SESSION_SECONDS = 6 * 3600 // CacheService maximum
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const EMP_ID = /^[A-Za-z0-9][A-Za-z0-9/_-]{1,29}$/
const URL_RULES: Record<Platform, RegExp> = {
  instagram: /^https:\/\/(www\.)?instagram\.com\/(reel|reels|p)\/[\w-]+\/?(\?.*)?$/i,
  youtube: /^https:\/\/((www|m)\.)?(youtube\.com\/(shorts\/[\w-]+|watch\?v=[\w-]+)|youtu\.be\/[\w-]+)/i,
  facebook: /^https:\/\/(www\.|m\.)?(facebook\.com|fb\.watch)\/.+/i,
}

function parseQuery(qs: string) {
  const q: Record<string, string> = {}
  for (const part of qs.split('&')) {
    if (!part) continue
    const [k, v = ''] = part.split('=')
    q[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '))
  }
  return q
}

type Ctx = { env: Env; body: any; query: Record<string, string>; params: string[]; user: Session; token?: string }
type Route = { method: string; re: RegExp; role: Role | 'any' | 'public'; write?: boolean; fn: (c: Ctx) => unknown }

const log = (db: DB, env: Env, operation: string, recordId?: string, message?: string) =>
  db.audit.push({ at: env.now(), operation, status: 'ok', recordId, message })

const isOpen = (db: DB, today: string) =>
  db.settings.campaignStatus.toLowerCase() === 'active' && (!db.settings.campaignStart || today >= db.settings.campaignStart) && (!db.settings.campaignEnd || today <= db.settings.campaignEnd)

function rateLimit(env: Env, key: string, max: number, seconds: number, msg: string) {
  const n = Number(env.cache.get(key) ?? 0)
  if (n >= max) fail(429, msg)
  env.cache.put(key, String(n + 1), seconds)
}

/** Shared by the public landing form and the TL dashboard form. */
function addSubmission(env: Env, db: DB, pid: string, platformIn: unknown, urlIn: unknown, views: number | null, by: string): Submission {
  const platform = str(platformIn)?.toLowerCase() as Platform
  const url = str(urlIn)
  if (!platform || !db.settings.platforms[platform]) fail(400, 'Choose a platform that is open for this campaign')
  if (!url || url.length > 500 || !URL_RULES[platform].test(url)) fail(400, `Enter a valid ${platform === 'youtube' ? 'YouTube' : platform === 'facebook' ? 'Facebook' : 'Instagram'} video link`)
  const key = videoKey(url!)
  if (db.submissions.some((s) => videoKey(s.url) === key)) fail(409, 'This video has already been submitted')
  const s: Submission = {
    id: nextId('S', db.submissions.map((x) => x.id), 4),
    participantId: pid, platform, url: url!, submittedAt: env.today(), submittedViews: views,
    verifiedViews: null, impressions: null, status: 'active', // no approval step: counts as soon as views are measured
  }
  db.submissions.push(s)
  log(db, env, `submission.created (${by})`, s.id)
  return s
}

function readFilters(q: Record<string, string>): Filters {
  const f: Filters = { from: q.from || undefined, to: q.to || undefined, city: q.city || undefined, platform: (q.platform || undefined) as Platform, status: (q.status || undefined) as Status }
  for (const d of [f.from, f.to]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(400, 'Dates must be YYYY-MM-DD')
  return f
}

function milestoneInput(b: any) {
  const views = Number(b?.views), amount = Number(b?.amount)
  if (!Number.isInteger(views) || views <= 0) fail(400, 'Threshold must be a positive whole number')
  if (!Number.isFinite(amount) || amount < 0) fail(400, 'Amount must be 0 or more')
  return { id: `M${views}`, views, amount, label: milestoneLabel(views), active: b?.active !== false }
}

const ROUTES: Route[] = [
  // ---------- auth ----------
  {
    method: 'POST', re: /^\/login$/, role: 'public', fn: ({ env, body }) => {
      const username = str(body.username)
      const secret = typeof body.password === 'string' ? body.password.trim() : ''
      if (!username || !secret) fail(401, 'Invalid credentials')
      const failKey = `fail_${username!.toLowerCase()}`
      if (Number(env.cache.get(failKey) ?? 0) >= 5) fail(429, 'Too many attempts. Try again in 15 minutes.')
      let s: Session | null = null
      const adminUser = (env.prop('ADMIN_USERNAME') ?? 'admin').toLowerCase()
      if (username!.toLowerCase() === adminUser) {
        const pw = env.prop('ADMIN_PASSWORD')
        if (!pw) fail(503, 'Admin login is not configured yet (set ADMIN_PASSWORD in Script Properties)')
        if (secret === pw) s = { role: 'admin', id: adminUser, name: env.prop('ADMIN_NAME') ?? 'Campaign Admin' }
      } else {
        // TL login = Employee ID + registered email (chosen by Zypp; there is no TL password).
        const p = env.load().participants.find((x) => x.employeeId.toLowerCase() === username!.toLowerCase())
        if (p && p.status === 'active' && p.email && p.email === secret.toLowerCase()) s = { role: 'tl', id: p.id, name: p.name }
      }
      if (!s) {
        env.cache.put(failKey, String(Number(env.cache.get(failKey) ?? 0) + 1), 900)
        fail(401, 'Invalid credentials')
      }
      env.cache.remove(failKey)
      return startSession(env, s!)
    },
  },
  { method: 'POST', re: /^\/logout$/, role: 'any', fn: ({ env, token }) => { env.cache.remove(`sess_${token}`); return { ok: true } } },
  { method: 'GET', re: /^\/me$/, role: 'any', fn: ({ user }) => user },

  // ---------- public (landing page) ----------
  {
    method: 'GET', re: /^\/public\/meta$/, role: 'public', fn: ({ env }) => {
      const db = env.load()
      const { campaignName, campaignStatus, campaignStart, campaignEnd, cities, termsVersion } = db.settings
      // Milestones are public campaign terms (shown on the landing page); TL dashboards still never get amounts.
      const milestones = db.milestones.filter((m) => m.active).map((m) => ({ views: m.views, amount: m.amount }))
      return { campaignName, campaignStatus, campaignStart, campaignEnd, cities, termsVersion, platforms: enabledPlatforms(db), open: isOpen(db, env.today()), milestones }
    },
  },
  {
    method: 'POST', re: /^\/public\/register$/, role: 'public', write: true, fn: ({ env, body }) => {
      if (str(body.website)) return { ok: true } // honeypot field: bots fill it, people never see it
      const name = str(body.name), employeeId = str(body.employeeId), email = str(body.email)?.toLowerCase(), city = str(body.city)
      if (!name || name.length > 80) fail(400, 'Enter your full name')
      if (!employeeId || !EMP_ID.test(employeeId)) fail(400, 'Enter a valid Employee ID')
      if (!email || email.length > 120 || !EMAIL.test(email)) fail(400, 'Enter a valid email ID')
      if (body.terms !== true) fail(400, 'Please accept the Terms and Conditions')
      rateLimit(env, `reg_all_${env.now().slice(0, 16)}`, 120, 120, 'The form is busy right now. Please try again in a minute.')
      rateLimit(env, `reg_${employeeId!.toLowerCase()}`, 10, 3600, 'Too many submissions for this Employee ID. Please try again in an hour.')
      const db = env.load()
      if (!isOpen(db, env.today())) fail(403, 'Submissions are closed for this campaign')
      if (!city || !db.settings.cities.includes(city)) fail(400, 'Choose your city')
      let p = db.participants.find((x) => x.employeeId.toLowerCase() === employeeId!.toLowerCase())
      const isNew = !p
      if (p) {
        if (p.email !== email) fail(409, 'This Employee ID is already registered with a different email ID. Use the email you registered with, or contact the campaign team.')
        if (p.status !== 'active') fail(403, 'This TL registration is inactive. Please contact the campaign team.')
      } else {
        p = { id: nextId('P', db.participants.map((x) => x.id), 3), name: name!, employeeId: employeeId!, email: email!, city: city!, registeredAt: env.today(), status: 'active' }
        db.participants.push(p)
      }
      const s = addSubmission(env, db, p!.id, body.platform, body.url, null, 'landing form')
      if (isNew) log(db, env, 'tl.registered (landing form)', p!.id)
      env.save(db)
      // Same proof as the TL login (Employee ID + matching email), so the confirmation can open the dashboard directly.
      return { submissionId: s.id, newParticipant: isNew, name: p!.name, ...startSession(env, { role: 'tl', id: p!.id, name: p!.name }) }
    },
  },

  // ---------- shared, signed in ----------
  {
    method: 'GET', re: /^\/meta$/, role: 'any', fn: ({ env, user }) => {
      const db = env.load()
      const { campaignName, campaignStatus, cities, campaignStart, campaignEnd } = db.settings
      // Reward amounts are admin-only: TLs never receive milestones.
      return { campaignName, campaignStatus, cities, campaignStart, campaignEnd, platforms: enabledPlatforms(db), ...(user.role === 'admin' ? { milestones: db.milestones.filter((m) => m.active) } : {}) }
    },
  },
  {
    method: 'GET', re: /^\/leaderboard$/, role: 'any', fn: ({ env, query, user }) => {
      const type = query.type || 'overall'
      const rows = leaderboard(env.load(), { city: type === 'city' ? query.city : undefined, platform: ['instagram', 'youtube', 'facebook'].includes(type) ? (type as Platform) : undefined })
      // TLs get the sanitized public view only; admins get full rows.
      return user.role === 'tl' ? { rows: toPublic(rows, user.id), me: position(rows, user.id) } : { rows, me: null }
    },
  },

  // ---------- TL ----------
  { method: 'GET', re: /^\/me\/dashboard$/, role: 'tl', fn: ({ env, user }) => tlDashboard(env.load(), user.id) },
  {
    method: 'GET', re: /^\/me\/profile$/, role: 'tl', fn: ({ env, user }) => {
      const p = env.load().participants.find((x) => x.id === user.id)
      if (!p) fail(404, 'Not found')
      return { name: p!.name, employeeId: p!.employeeId, email: p!.email, city: p!.city, registeredAt: p!.registeredAt }
    },
  },
  {
    method: 'POST', re: /^\/me\/submissions$/, role: 'tl', write: true, fn: ({ env, body, user }) => {
      const raw = body.submittedViews
      const views = raw === '' || raw == null ? null : Number(raw)
      if (views != null && (!Number.isInteger(views) || views < 0 || views > 1e9)) fail(400, 'Views must be a whole number')
      const db = env.load()
      if (!isOpen(db, env.today())) fail(403, 'Submissions are closed for this campaign')
      const s = addSubmission(env, db, user.id, body.platform, body.url, views, user.name)
      env.save(db)
      return s
    },
  },

  {
    // The TL's own videos with what they can claim. Milestone names only: amounts stay admin-side.
    method: 'GET', re: /^\/me\/claims$/, role: 'tl', fn: ({ env, user }) => {
      const db = env.load()
      return db.submissions.filter((s) => s.participantId === user.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).map((s) => {
        const c = claimCheck(db, s)
        const r = db.rewards.filter((x) => x.submissionId === s.id).sort((a, b) => b.claimedAt.localeCompare(a.claimedAt))[0]
        return {
          id: s.id, platform: s.platform, url: s.url, submittedAt: s.submittedAt, views: counted(s), measured: s.verifiedViews != null, status: s.status,
          canClaim: c.ok, upgrade: !!c.upgrade, milestone: c.milestone?.label ?? null, reason: c.ok ? null : c.reason,
          claim: r ? { id: r.id, status: r.status, milestone: r.milestone, claimedAt: r.claimedAt, reason: r.reason ?? null } : null,
        }
      })
    },
  },
  {
    method: 'POST', re: /^\/me\/claims$/, role: 'tl', write: true, fn: ({ env, body, user }) => {
      const db = env.load()
      const s = db.submissions.find((x) => x.id === str(body.submissionId) && x.participantId === user.id) // only your own videos
      if (!s) fail(404, 'Video not found')
      let r
      try { r = claimReward(db, s!, env.today()) } catch (e: any) { fail(409, e.message) }
      log(db, env, `claim.submitted (${user.name})`, r!.id, `${s!.id}: ${r!.milestone} at ${r!.claimedViews} views`)
      env.save(db)
      return { id: r!.id, status: r!.status, milestone: r!.milestone, claimedAt: r!.claimedAt }
    },
  },

  // ---------- admin ----------
  {
    method: 'POST', re: /^\/admin\/rewards\/([\w-]+)\/verify$/, role: 'admin', write: true, fn: ({ env, body, params, user }) => {
      const db = env.load()
      const r = db.rewards.find((x) => x.id === params[0])
      if (!r) fail(404, 'Not found')
      try { decideClaim(db, r!, str(body.action) ?? '', body.verifiedViews, str(body.reason), env.today()) } catch (e: any) { fail(400, e.message) }
      log(db, env, `claim.${r!.status} (${user.name})`, r!.id, r!.status === 'approved' ? `${r!.verifiedViews} views → ${r!.milestone}, ₹${r!.amount}` : r!.reason)
      env.save(db)
      return r
    },
  },
  { method: 'GET', re: /^\/admin\/summary$/, role: 'admin', fn: ({ env, query }) => summary(env.load(), readFilters(query)) },
  {
    method: 'PATCH', re: /^\/admin\/submissions\/([\w-]+)$/, role: 'admin', write: true, fn: ({ env, body, params, user }) => {
      const db = env.load()
      const s = db.submissions.find((x) => x.id === params[0])
      if (!s) fail(404, 'Not found')
      // No approval: admins only correct the measured views/impressions, or disqualify (and reinstate) a video.
      const status = str(body.status) as Status
      if (!['active', 'rejected'].includes(status)) fail(400, 'Invalid status')
      const views = body.verifiedViews, imp = body.impressions
      if (views != null && !(Number.isInteger(views) && views >= 0)) fail(400, 'Views must be a whole number')
      if (imp != null && !(Number.isInteger(imp) && imp >= 0)) fail(400, 'Impressions must be a whole number')
      const reason = str(body.rejectionReason)
      if (status === 'rejected' && !reason) fail(400, 'A reason is required to disqualify a video')
      Object.assign(s!, {
        status,
        verifiedViews: views ?? s!.verifiedViews,
        impressions: imp ?? s!.impressions,
        rejectionReason: status === 'rejected' ? reason : undefined,
        verifiedAt: env.today(),
      })
      log(db, env, `submission.${status === 'rejected' ? 'disqualified' : 'updated'} (${user.name})`, s!.id, status === 'rejected' ? reason : `${views ?? '—'} views`)
      env.save(db)
      return { submission: joinSub(db, s!) }
    },
  },
  {
    method: 'GET', re: /^\/admin\/participants$/, role: 'admin', fn: ({ env }) => {
      const db = env.load()
      const ranks = new Map(leaderboard(db).map((r) => [r.participantId, r.rank]))
      return db.participants.map((p) => ({ ...p, ...totals(db.submissions.filter((s) => s.participantId === p.id)), rank: ranks.get(p.id) ?? null, rewards: rewardsOf(db, p.id) }))
    },
  },
  {
    method: 'GET', re: /^\/admin\/rewards$/, role: 'admin', fn: ({ env }) => {
      const db = env.load()
      const ps = new Map(db.participants.map((p) => [p.id, p]))
      const subs = new Map(db.submissions.map((s) => [s.id, s]))
      return {
        milestones: db.milestones,
        allocations: db.rewards.map((r) => ({
          ...r, name: ps.get(r.participantId)?.name, city: ps.get(r.participantId)?.city, employeeId: ps.get(r.participantId)?.employeeId,
          url: subs.get(r.submissionId)?.url, checks: claimChecks(db, r),
        })),
      }
    },
  },
  {
    method: 'POST', re: /^\/admin\/milestones$/, role: 'admin', write: true, fn: ({ env, body, user }) => {
      const db = env.load()
      const m = milestoneInput(body)
      if (db.milestones.some((x) => x.views === m.views)) fail(409, 'A milestone with this threshold exists')
      db.milestones.push(m)
      log(db, env, `milestone.created (${user.name})`, m.id, `${m.views} views → ₹${m.amount}`)
      env.save(db)
      return m
    },
  },
  {
    method: 'PUT', re: /^\/admin\/milestones\/([\w-]+)$/, role: 'admin', write: true, fn: ({ env, body, params, user }) => {
      const db = env.load()
      const i = db.milestones.findIndex((x) => x.id === params[0])
      if (i < 0) fail(404, 'Not found')
      const m = milestoneInput(body)
      if (db.milestones.some((x, j) => j !== i && x.views === m.views)) fail(409, 'A milestone with this threshold exists')
      db.milestones[i] = m
      log(db, env, `milestone.updated (${user.name})`, m.id, `${m.views} views → ₹${m.amount}${m.active ? '' : ' (off)'}`)
      env.save(db)
      return m
    },
  },
  {
    method: 'POST', re: /^\/admin\/rewards\/([\w-]+)\/pay$/, role: 'admin', write: true, fn: ({ env, params, user }) => {
      const db = env.load()
      const r = db.rewards.find((x) => x.id === params[0])
      if (!r) fail(404, 'Not found')
      if (r!.status === 'paid') fail(409, 'Already paid')
      if (r!.status !== 'approved') fail(409, 'Verify and approve the claim before marking it paid')
      Object.assign(r!, { status: 'paid', paidAt: env.today() })
      log(db, env, `reward.paid (${user.name})`, r!.id, `₹${r!.amount}`)
      env.save(db)
      return r
    },
  },
  { method: 'GET', re: /^\/admin\/settings$/, role: 'admin', fn: ({ env }) => env.load().settings },
  {
    method: 'PUT', re: /^\/admin\/settings$/, role: 'admin', write: true, fn: ({ env, body, user }) => {
      const db = env.load()
      const name = str(body.campaignName)
      if (!name) fail(400, 'Campaign name is required')
      const platforms = { ...db.settings.platforms }
      for (const p of Object.keys(platforms) as Platform[]) if (typeof body.platforms?.[p] === 'boolean') platforms[p] = body.platforms[p]
      if (!Object.values(platforms).some(Boolean)) fail(400, 'Enable at least one platform')
      Object.assign(db.settings, { campaignName: name, platforms })
      log(db, env, `settings.updated (${user.name})`, 'CAMPAIGN_SETTINGS')
      env.save(db)
      return db.settings
    },
  },
  {
    method: 'GET', re: /^\/admin\/integrations$/, role: 'admin', fn: ({ env }) =>
      ({ apify: !!env.prop('APIFY_TOKEN'), apifyHint: env.prop('APIFY_TOKEN') ? `••••${env.prop('APIFY_TOKEN')!.slice(-4)}` : null, nightly: env.nightlyOn(), lastRefresh: JSON.parse(env.cache.get('last_refresh') ?? 'null') }),
  },
  {
    // Save the Apify key from the admin page. Checked with Apify first, so a wrong key is never stored. Empty = remove.
    method: 'PUT', re: /^\/admin\/integrations\/apify$/, role: 'admin', fn: ({ env, body, user }) => {
      const token = typeof body.token === 'string' ? body.token.trim() : ''
      if (!token) {
        env.setProp('APIFY_TOKEN', null)
        env.appendLog([{ at: env.now(), operation: `integration.apify.removed (${user.name})`, status: 'ok' }])
        return { apify: false }
      }
      if (!/^[\w-]{20,200}$/.test(token)) fail(400, 'That does not look like an Apify API token (Apify Console → Settings → API & Integrations)')
      const res = env.http('https://api.apify.com/v2/users/me', { method: 'get', headers: { Authorization: `Bearer ${token}` }, body: '' })
      if (res.status === 401 || res.status === 403) fail(400, 'Apify rejected this token. Copy it again from Apify Console → Settings → API & Integrations.')
      if (res.status !== 200) fail(502, `Could not reach Apify to check the token (status ${res.status}). Try again in a minute.`)
      env.setProp('APIFY_TOKEN', token)
      env.installTriggers()
      env.appendLog([{ at: env.now(), operation: `integration.apify.connected (${user.name})`, status: 'ok', message: 'Nightly 2 AM refresh on' }])
      return { apify: true, apifyHint: `••••${token.slice(-4)}`, nightly: true }
    },
  },
  {
    method: 'POST', re: /^\/admin\/integrations\/nightly$/, role: 'admin', fn: ({ env, user }) => {
      env.installTriggers()
      env.appendLog([{ at: env.now(), operation: `integration.nightly.on (${user.name})`, status: 'ok' }])
      return { nightly: true }
    },
  },
  { method: 'POST', re: /^\/admin\/refresh-views$/, role: 'admin', fn: ({ env, user }) => refreshViews(env, user.name) },
  { method: 'GET', re: /^\/admin\/audit$/, role: 'admin', fn: ({ env }) => env.readLogs(300) },
]

function startSession(env: Env, s: Session) {
  const token = env.token()
  env.cache.put(`sess_${token}`, JSON.stringify(s), SESSION_SECONDS)
  return { token, user: s }
}

function session(env: Env, token?: string): Session | null {
  if (!token || typeof token !== 'string') return null
  const raw = env.cache.get(`sess_${token}`)
  return raw ? JSON.parse(raw) : null
}

export function handle(env: Env, req: Req): Res {
  const [pathname, qs = ''] = String(req.path ?? '').split('?')
  const method = String(req.method ?? 'GET').toUpperCase()
  try {
    for (const r of ROUTES) {
      if (r.method !== method) continue
      const m = pathname.match(r.re)
      if (!m) continue
      let user: Session | null = null
      if (r.role !== 'public') {
        user = session(env, req.token)
        if (!user) fail(401, 'Not signed in')
        if (r.role !== 'any' && user!.role !== r.role) fail(403, 'Forbidden')
      }
      const ctx: Ctx = { env, body: req.body ?? {}, query: parseQuery(qs), params: m.slice(1), user: user!, token: req.token }
      return { status: 200, data: r.write ? env.lock(() => r.fn(ctx)) : r.fn(ctx) }
    }
    return { status: 404, data: { error: 'Unknown endpoint' } }
  } catch (e: any) {
    if (e instanceof HttpError) return { status: e.status, data: { error: e.message } }
    try { env.appendLog([{ at: env.now(), operation: `${method} ${pathname}`, status: 'error', message: String(e?.message ?? e).slice(0, 500) }]) } catch { /* logging must never hide the real error */ }
    return { status: 500, data: { error: String(e?.message ?? 'Something went wrong. Please try again.') } }
  }
}

/**
 * Refresh view counts for the submitted links only. YouTube: read from the public page (no key).
 * Instagram/Facebook: via Apify only if APIFY_TOKEN is set (they block keyless fetching from Google's servers); otherwise left as entered.
 * The slow fetch runs outside the lock; only the short write is locked.
 */
export function refreshViews(env: Env, actor: string) {
  const token = env.prop('APIFY_TOKEN')
  if (env.cache.get('refreshing')) fail(409, 'A refresh is already running')
  env.cache.put('refreshing', '1', 600)
  try {
    const snapshot = env.load()
    // Only links that can still matter: active, platform on, and no reward already paid for them.
    const paid = new Set(snapshot.rewards.filter((r) => r.status === 'paid').map((r) => r.submissionId))
    const subs = snapshot.submissions.filter((s) => s.status === 'active' && snapshot.settings.platforms[s.platform] && !paid.has(s.id))
    const yt = fetchYouTubeViews(subs.filter((s) => s.platform === 'youtube'), env.http)
    const others = subs.filter((s) => s.platform !== 'youtube')
    const ap = token && others.length
      ? fetchViews(others, token, env.http, { instagram: env.prop('APIFY_INSTAGRAM_ACTOR'), facebook: env.prop('APIFY_FACEBOOK_ACTOR') })
      : { views: new Map<string, number>(), errors: others.length ? [`${others.length} Instagram/Facebook links not refreshed: these platforms need Apify (APIFY_TOKEN). Enter their views by hand until then.`] : [] }
    const views = new Map([...yt.views, ...ap.views])
    const errors = [...yt.errors, ...ap.errors]
    return env.lock(() => {
      const db = env.load() // re-read: admins may have approved/rejected while Apify was running
      const at = env.now()
      let changed = 0
      for (const s of db.submissions) {
        const v = views.get(s.id)
        if (v == null) continue
        s.fetchedViews = v
        s.fetchedAt = at
        if (s.status === 'active' && s.verifiedViews !== v) { s.verifiedViews = v; changed++ }
      }
      log(db, env, `views.refreshed (${actor})`, undefined, `${views.size} fetched, ${changed} videos updated, ${errors.length} errors`)
      env.save(db)
      env.cache.put('last_refresh', JSON.stringify({ at, updated: views.size, errors: errors.length }), SESSION_SECONDS)
      return { fetched: views.size, approvedUpdated: changed, errors: errors.slice(0, 25), errorCount: errors.length }
    })
  } finally {
    env.cache.remove('refreshing')
  }
}

/** Rewrite the derived LEADERBOARD sheet and Reward Eligibility after someone edits the sheets by hand (menu item + 10-minute trigger). */
export function recalculate(env: Env) {
  return env.lock(() => {
    const db = env.load()
    env.save(db)
    return db.submissions.length
  })
}
