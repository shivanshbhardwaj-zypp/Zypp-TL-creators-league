// Deterministic, internally consistent test fixture (tests only; real data lives in Google Sheets).
import type { DB, Participant, Platform, Status, Submission } from './types'
import { claimReward, counted, decideClaim } from './logic'

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAMES = [
  'Aarav Sharma', 'Vivek Malhotra', 'Rohit Yadav', 'Sanjay Kumar', 'Neha Gupta', 'Imran Khan', 'Pooja Verma', 'Deepak Chauhan',
  'Manish Rawat', 'Kavita Singh', 'Arjun Mehta', 'Rahul Tiwari', 'Ankit Saini',
  'Karthik Reddy', 'Suresh Gowda', 'Divya Nair', 'Prakash Shetty', 'Meera Iyer', 'Naveen Kumar', 'Lakshmi Rao', 'Abhishek Hegde', 'Tejas Murthy',
  'Venkat Rao', 'Srinivas Naidu', 'Farhan Ali', 'Swathi Reddy', 'Ravi Teja', 'Anusha Varma', 'Mahesh Goud', 'Sai Kiran',
]
const cityOf = (i: number) => (i < 13 ? 'Delhi NCR' : i < 22 ? 'Bengaluru' : 'Hyderabad')
const REASONS = ['Video is not public', 'Wrong campaign hashtag', 'Duplicate content', 'View count could not be verified']
const DAY = 86400000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

export function seed(): DB {
  const r = rng(42)
  const start = Date.UTC(2026, 8, 15)
  const end = Date.UTC(2026, 10, 10)
  const code = (n: number) => Array.from({ length: n }, () => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(r() * 55)]).join('')

  const participants: Participant[] = NAMES.map((name, i) => ({
    id: `P${String(i + 1).padStart(3, '0')}`,
    name,
    employeeId: `ZYP${1001 + i}`,
    city: cityOf(i),
    email: `${name.split(' ')[0].toLowerCase()}.${i + 1}@example.com`,
    registeredAt: iso(start - Math.floor(r() * 7) * DAY),
    status: 'active',
  }))

  const submissions: Submission[] = []
  participants.forEach((p, i) => {
    if (i % 13 === 12) return // registered but not yet participating
    const n = 1 + Math.floor(r() * 6)
    for (let k = 0; k < n; k++) {
      const t = start + Math.floor(r() * ((end - start) / DAY + 1)) * DAY
      const platform: Platform = r() < 0.6 ? 'instagram' : 'youtube'
      const x = r()
      const status: Status = x < 0.88 ? 'active' : 'rejected'
      const submittedViews = Math.round(200 + r() ** 3 * 60000)
      // Recent videos may not be measured yet (null).
      const verifiedViews = status === 'active' && !(t > Date.UTC(2026, 10, 6) && x < 0.5) ? Math.round(submittedViews * (0.82 + r() * 0.18)) : null
      const impressions = verifiedViews != null && (platform === 'instagram' || r() < 0.5) ? Math.round(verifiedViews * (1.3 + r() * 1.2)) : null
      const date = iso(t)
      const vDate = iso(Math.min(t + 2 * DAY, end))
      const s: Submission = {
        id: `S${String(submissions.length + 1).padStart(4, '0')}`,
        participantId: p.id,
        platform,
        url: platform === 'instagram' ? `https://www.instagram.com/reel/${code(11)}/` : `https://www.youtube.com/shorts/${code(11)}`,
        submittedAt: date,
        submittedViews,
        verifiedViews,
        impressions,
        status,
      }
      if (status === 'rejected') {
        s.verifiedAt = vDate
        if (status === 'rejected') s.rejectionReason = REASONS[Math.floor(r() * REASONS.length)]
      }
      submissions.push(s)
    }
  })

  const db: DB = {
    participants,
    submissions,
    milestones: [
      { id: 'M25000', views: 25000, amount: 200, label: '25K views', active: true },
      { id: 'M100000', views: 100000, amount: 500, label: '100K views', active: true },
      { id: 'M500000', views: 500000, amount: 1500, label: '500K views', active: true },
      { id: 'M1000000', views: 1000000, amount: 3000, label: '1M views', active: true },
    ],
    rewards: [],
    audit: [],
    settings: {
      campaignName: 'Zypp Creator League — TL Season 1',
      campaignStatus: 'Active',
      termsVersion: 'v1',
      platforms: { instagram: true, youtube: true, facebook: false },
      cities: ['Delhi NCR', 'Bengaluru', 'Hyderabad'],
      campaignStart: iso(start),
      campaignEnd: '2026-11-30',
    },
  }
  // TLs claim their first eligible video per platform; the admin approves most claims and pays half of those.
  for (const s of db.submissions) { try { claimReward(db, s, iso(end)) } catch { /* not eligible */ } }
  db.rewards.forEach((rw, i) => {
    if (i % 4 === 3) return // left open for verification
    const s = db.submissions.find((x) => x.id === rw.submissionId)!
    decideClaim(db, rw, 'approve', counted(s), undefined, iso(end))
    if (i % 2 === 0) Object.assign(rw, { status: 'paid', paidAt: iso(end) })
  })
  return db
}
