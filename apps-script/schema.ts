// Sheet layout of "ZYPP CREATOR LEAGUE – MASTER DATABASE" and the mapping between sheet rows and the shared data model.
// Rows are read by header name, so admins may reorder columns or add their own (extra columns are preserved on write).
import type { AuditEntry, DB, Milestone, Participant, Platform, RewardAllocation, Settings, Submission } from '../server/types'
import { PLATFORMS, joinSub, leaderboard, totals } from '../server/logic'

export type Cell = string | number | boolean | null
export type Rec = Record<string, Cell>

export const SHEETS = {
  registrations: { name: 'TL_REGISTRATIONS', id: 'Participant ID', headers: ['Participant ID', 'Name', 'Employee ID', 'Email ID', 'City', 'Registration Date', 'Participant Status'] },
  submissions: {
    name: 'VIDEO_SUBMISSIONS', id: 'Submission ID',
    headers: ['Submission ID', 'Participant ID', 'TL Name', 'Employee ID', 'City', 'Platform', 'Content Link', 'Submission Date', 'Verification Status', 'Submitted Views', 'Verified Views', 'Impressions', 'Reward Eligibility', 'Rejection Reason', 'Verification Date', 'Live Views', 'Live Views Fetched At'],
  },
  rewards: { name: 'REWARDS', id: 'Reward ID', headers: ['Reward ID', 'Participant ID', 'TL Name', 'Platform', 'Submission ID', 'Highest Milestone', 'Reward Amount', 'Reward Status', 'Reward Date', 'Claimed Views', 'Claim Date', 'Verified Views', 'Rejection Reason'] },
  settings: { name: 'CAMPAIGN_SETTINGS', id: 'Setting', headers: ['Setting', 'Value'] },
  leaderboard: { name: 'LEADERBOARD', id: 'Participant ID', headers: ['Rank', 'Participant ID', 'TL Name', 'City', 'Videos', 'Instagram Views', 'YouTube Views', 'Facebook Views', 'Total Verified Views', 'Rewards Earned'] },
  logs: { name: 'SYNC_LOGS', id: 'Timestamp', headers: ['Timestamp', 'Operation', 'Status', 'Error Message', 'Related Record ID'] },
} as const

/** Columns that must stay text so Sheets doesn't strip leading zeros or reformat links. */
export const TEXT_COLUMNS = ['Participant ID', 'Employee ID', 'Submission ID', 'Reward ID', 'Content Link', 'Related Record ID', 'Value']

export const DEFAULT_SETTINGS: [string, string][] = [
  ['Campaign Name', 'Zypp Creator League'],
  ['Campaign Status', 'Active'],
  ['Start Date', ''],
  ['End Date', ''],
  ['Eligible Platforms', 'Instagram, YouTube, Facebook'],
  ['Available Cities', 'Delhi NCR, Mumbai, Pune, Bengaluru, Hyderabad, Rohtak, Jaipur'],
  ['Reward Milestones', '25000=200; 100000=500; 500000=1500; 1000000=3000; 10000000=15000'],
  ['Monthly Reward Cap', '15000'],
  ['Terms and Conditions Version', 'v1'],
]

const LABEL: Record<Platform, string> = { instagram: 'Instagram', youtube: 'YouTube', facebook: 'Facebook' }
const s = (v: Cell | undefined) => (v == null ? '' : String(v).trim())
const n = (v: Cell | undefined) => (s(v) === '' || !Number.isFinite(Number(String(v).replace(/,/g, ''))) ? null : Number(String(v).replace(/,/g, '')))
const cap = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : '')
const platformOf = (v: Cell | undefined) => s(v).toLowerCase() as Platform
const list = (v: Cell | undefined) => s(v).split(/[,\n]/).map((x) => x.trim()).filter(Boolean)

const short = (v: number) => (v >= 1e6 && v % 1e5 === 0 ? `${v / 1e6}M` : v >= 1e3 && v % 100 === 0 ? `${v / 1e3}K` : String(v))
export const milestoneLabel = (views: number) => `${short(views)} views`

/** "25000=200; 100000=500 (off)" → milestones. "(off)" keeps a milestone defined but inactive. */
export function parseMilestones(text: string): Milestone[] {
  return text.split(/[;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(/^([\d,]+)\s*=\s*₹?\s*([\d,.]+)\s*(\(off\))?$/i)
    if (!m) throw new Error(`CAMPAIGN_SETTINGS › Reward Milestones: can't read "${x}". Use the form 25000=200; 100000=500`)
    const views = Number(m[1].replace(/,/g, ''))
    return { id: `M${views}`, views, amount: Number(m[2].replace(/,/g, '')), label: milestoneLabel(views), active: !m[3] }
  }).sort((a, b) => a.views - b.views)
}
export const formatMilestones = (ms: Milestone[]) => [...ms].sort((a, b) => a.views - b.views).map((m) => `${m.views}=${m.amount}${m.active ? '' : ' (off)'}`).join('; ')

export type Tables = { registrations: Rec[]; submissions: Rec[]; rewards: Rec[]; settings: Rec[] }

export function fromTables(t: Tables): DB {
  const set = new Map(t.settings.map((r) => [s(r.Setting).toLowerCase(), r.Value]))
  const get = (k: string) => set.get(k.toLowerCase()) ?? null
  // Blank setting = every platform on (Instagram, YouTube and Facebook are all on by default).
  const listed = list(get('Eligible Platforms')).map((x) => x.toLowerCase())
  const eligible = listed.length ? listed : [...PLATFORMS]
  const settings: Settings = {
    campaignName: s(get('Campaign Name')) || 'Zypp Creator League',
    campaignStatus: s(get('Campaign Status')) || 'Active',
    campaignStart: s(get('Start Date')),
    campaignEnd: s(get('End Date')),
    platforms: Object.fromEntries(PLATFORMS.map((p) => [p, eligible.includes(p)])) as Record<Platform, boolean>,
    cities: list(get('Available Cities')),
    termsVersion: s(get('Terms and Conditions Version')),
    // Missing row = the T&C default of ₹15,000; 0 = no cap.
    monthlyCap: get('Monthly Reward Cap') == null ? 15000 : n(get('Monthly Reward Cap')) || null,
  }
  const participants: Participant[] = t.registrations.filter((r) => s(r['Participant ID'])).map((r) => ({
    id: s(r['Participant ID']),
    name: s(r.Name),
    employeeId: s(r['Employee ID']),
    email: s(r['Email ID']).toLowerCase(),
    city: s(r.City),
    registeredAt: s(r['Registration Date']),
    status: s(r['Participant Status']).toLowerCase() === 'inactive' ? 'inactive' : 'active',
  }))
  const submissions: Submission[] = t.submissions.filter((r) => s(r['Submission ID'])).map((r) => ({
    id: s(r['Submission ID']),
    participantId: s(r['Participant ID']),
    platform: platformOf(r.Platform),
    url: s(r['Content Link']),
    submittedAt: s(r['Submission Date']),
    submittedViews: n(r['Submitted Views']),
    verifiedViews: n(r['Verified Views']),
    impressions: n(r.Impressions),
    // No approval step any more: everything counts unless an admin marked it Rejected (older Pending/Approved rows read as active).
    status: s(r['Verification Status']).toLowerCase() === 'rejected' ? 'rejected' : 'active',
    verifiedAt: s(r['Verification Date']) || undefined,
    rejectionReason: s(r['Rejection Reason']) || undefined,
    fetchedViews: n(r['Live Views']),
    fetchedAt: s(r['Live Views Fetched At']) || undefined,
  }))
  const rewards: RewardAllocation[] = t.rewards.filter((r) => s(r['Reward ID'])).map((r) => {
    const raw = s(r['Reward Status']).toLowerCase()
    const status = (['approved', 'rejected', 'paid'].includes(raw) ? raw : 'claimed') as RewardAllocation['status']
    const date = s(r['Reward Date'])
    return {
      id: s(r['Reward ID']),
      participantId: s(r['Participant ID']),
      submissionId: s(r['Submission ID']),
      platform: platformOf(r.Platform),
      milestone: s(r['Highest Milestone']),
      amount: n(r['Reward Amount']) ?? 0,
      status,
      claimedViews: n(r['Claimed Views']) ?? 0,
      claimedAt: s(r['Claim Date']) || date,
      verifiedViews: n(r['Verified Views']) ?? undefined,
      decidedAt: status === 'approved' || status === 'rejected' ? date : undefined,
      reason: s(r['Rejection Reason']) || undefined,
      paidAt: status === 'paid' ? date : undefined,
    }
  })
  return { participants, submissions, rewards, milestones: parseMilestones(s(get('Reward Milestones'))), audit: [], settings }
}

export function toTables(db: DB) {
  const ps = new Map(db.participants.map((p) => [p.id, p]))
  const st = db.settings
  return {
    registrations: db.participants.map((p): Rec => ({
      'Participant ID': p.id, Name: p.name, 'Employee ID': p.employeeId, 'Email ID': p.email, City: p.city,
      'Registration Date': p.registeredAt, 'Participant Status': cap(p.status),
    })),
    submissions: db.submissions.map((x): Rec => {
      const j = joinSub(db, x)
      return {
        'Submission ID': x.id, 'Participant ID': x.participantId, 'TL Name': j.name, 'Employee ID': j.employeeId, City: j.city,
        Platform: LABEL[x.platform] ?? x.platform, 'Content Link': x.url, 'Submission Date': x.submittedAt, 'Verification Status': x.status === 'rejected' ? 'Rejected' : 'Active',
        'Submitted Views': x.submittedViews, 'Verified Views': x.verifiedViews, Impressions: x.impressions, 'Reward Eligibility': j.rewardEligible ? 'Yes' : 'No',
        'Rejection Reason': x.rejectionReason ?? '', 'Verification Date': x.verifiedAt ?? '', 'Live Views': x.fetchedViews ?? null, 'Live Views Fetched At': x.fetchedAt ?? '',
      }
    }),
    rewards: db.rewards.map((r): Rec => ({
      'Reward ID': r.id, 'Participant ID': r.participantId, 'TL Name': ps.get(r.participantId)?.name ?? '', Platform: LABEL[r.platform] ?? r.platform,
      'Submission ID': r.submissionId, 'Highest Milestone': r.milestone, 'Reward Amount': r.amount, 'Reward Status': cap(r.status),
      'Reward Date': r.paidAt ?? r.decidedAt ?? r.claimedAt, 'Claimed Views': r.claimedViews, 'Claim Date': r.claimedAt,
      'Verified Views': r.verifiedViews ?? null, 'Rejection Reason': r.reason ?? '',
    })),
    settings: ([
      ['Campaign Name', st.campaignName], ['Campaign Status', st.campaignStatus], ['Start Date', st.campaignStart], ['End Date', st.campaignEnd],
      ['Eligible Platforms', PLATFORMS.filter((p) => st.platforms[p]).map((p) => LABEL[p]).join(', ')], ['Available Cities', st.cities.join(', ')],
      ['Reward Milestones', formatMilestones(db.milestones)], ['Monthly Reward Cap', st.monthlyCap == null ? '0' : String(st.monthlyCap)], ['Terms and Conditions Version', st.termsVersion],
    ] as [string, string][]).map(([k, v]): Rec => ({ Setting: k, Value: v })),
    leaderboard: leaderboard(db).map((r): Rec => {
      const t = totals(db.submissions.filter((x) => x.participantId === r.participantId))
      return {
        Rank: r.rank, 'Participant ID': r.participantId, 'TL Name': r.name, City: r.city, Videos: r.entries,
        'Instagram Views': t.instagramViews, 'YouTube Views': t.youtubeViews, 'Facebook Views': t.facebookViews, 'Total Verified Views': r.views, 'Rewards Earned': r.rewards,
      }
    }),
  }
}

export const logToRec = (e: AuditEntry): Rec => ({ Timestamp: e.at, Operation: e.operation, Status: e.status === 'ok' ? 'Success' : 'Failed', 'Error Message': e.message ?? '', 'Related Record ID': e.recordId ?? '' })
export const recToLog = (r: Rec): AuditEntry => ({ at: s(r.Timestamp), operation: s(r.Operation), status: s(r.Status) === 'Failed' ? 'error' : 'ok', message: s(r['Error Message']) || undefined, recordId: s(r['Related Record ID']) || undefined })
