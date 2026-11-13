// Shared data model. Mirrors the sheets in "ZYPP CREATOR LEAGUE – MASTER DATABASE" (see apps-script/schema.ts).
// Frontend imports these as types only.
export type Platform = 'instagram' | 'youtube' | 'facebook'
/** active = counting (no approval step); rejected = disqualified by an admin */
export type Status = 'active' | 'rejected'
export type Role = 'admin' | 'tl'

/** TL_REGISTRATIONS row */
export interface Participant {
  id: string
  name: string
  employeeId: string
  email: string
  city: string
  registeredAt: string // YYYY-MM-DD
  status: 'active' | 'inactive'
}

/** VIDEO_SUBMISSIONS row (TL name / employee ID / city / reward eligibility are derived when written) */
export interface Submission {
  id: string
  participantId: string
  platform: Platform
  url: string
  submittedAt: string // YYYY-MM-DD
  submittedViews: number | null
  verifiedViews: number | null
  impressions: number | null
  status: Status
  verifiedAt?: string
  rejectionReason?: string
  fetchedViews?: number | null // latest count pulled from Apify
  fetchedAt?: string
}

export interface Milestone { id: string; views: number; amount: number; label: string; active: boolean }

/** REWARDS row = a TL's claim: claimed → approved | rejected (admin verifies the views) → paid. */
export type ClaimStatus = 'claimed' | 'approved' | 'rejected' | 'paid'
export interface RewardAllocation {
  id: string
  participantId: string
  submissionId: string
  platform: Platform
  milestone: string
  amount: number
  status: ClaimStatus
  claimedViews: number // measured views when the TL claimed
  claimedAt: string
  verifiedViews?: number // views the admin confirmed
  decidedAt?: string
  reason?: string // why the claim was rejected
  paidAt?: string
}

/** SYNC_LOGS row */
export interface AuditEntry { at: string; operation: string; status: 'ok' | 'error'; message?: string; recordId?: string }

/** CAMPAIGN_SETTINGS */
export interface Settings {
  campaignName: string
  campaignStatus: string // Active | Paused | Closed
  campaignStart: string
  campaignEnd: string
  platforms: Record<Platform, boolean>
  cities: string[]
  termsVersion: string
  monthlyCap: number | null // max reward per participant per calendar month (T&C 5); null = no cap
}

export interface DB {
  participants: Participant[]
  submissions: Submission[]
  milestones: Milestone[]
  rewards: RewardAllocation[]
  audit: AuditEntry[] // new entries for this request; appended to SYNC_LOGS on save
  settings: Settings
}

export interface Filters {
  from?: string
  to?: string
  city?: string
  platform?: Platform
  status?: Status
}

export interface LeaderRow {
  rank: number
  participantId: string
  name: string
  city: string
  entries: number
  views: number
  platforms: Platform[]
  rewards: number
}
