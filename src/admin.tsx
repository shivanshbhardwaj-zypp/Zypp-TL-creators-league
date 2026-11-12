import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeft, CheckCircle2, Clock, Clapperboard, Eye, Gift, MapPin, Megaphone, Plus, Trophy, Users, XCircle } from 'lucide-react'
import { COLORS, PLATFORM_LABEL, api, compact, date, inr, num, pct, shortWeek, useApi } from './lib'
import { Async, Badge, Card, DataTable, Drawer, Empty, FilterBar, Kpi, LeaderTable, Podium, Stat, VideoLink, useFilterQuery, type Col } from './ui'
import type { LeaderRow } from '../server/types'

type Summary = any // shape defined by server/logic.ts summary()
export const tick = { fontSize: 11, fill: '#69756D' }
export const tip = { contentStyle: { borderRadius: 10, border: '1px solid #E5EBE7', fontSize: 12 }, formatter: (v: number) => num(v) }

export const PageHead = ({ title, sub }: { title: string; sub?: string }) => (
  <div className="page-head"><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
)

function useSummary() {
  return useApi<Summary>('/admin/summary' + useFilterQuery())
}

// ---------- Reusable dashboard sections ----------
function KpiRow({ s }: { s: Summary }) {
  const { kpis: k, prev, weekly } = s
  const change = (key: string) => pct(k[key], prev?.[key])
  return (
    <div className="grid g4">
      <Kpi label="Total Videos" value={num(k.videos)} icon={<Clapperboard size={16} />} change={change('videos')} spark={weekly.map((w: any) => w.submissions)} />
      <Kpi label="Unique Participants" value={num(k.participants)} icon={<Users size={16} />} change={change('participants')} />
      <Kpi label="Total Views" value={num(k.views)} icon={<Eye size={16} />} change={change('views')} spark={weekly.map((w: any) => w.views)} />
      <Kpi label="Total Impressions" value={num(k.impressions)} icon={<Megaphone size={16} />} change={change('impressions')} hint="Where platform data is available" />
    </div>
  )
}

function PlatformPanels({ s }: { s: Summary }) {
  if (!s.platforms.length) return <Empty msg="No platforms enabled" />
  return (
    <div className={`grid g${Math.min(3, s.platforms.length)}`}>
      {s.platforms.map((p: any) => (
        <Card key={p.platform} title={<><i className="dot" style={{ background: COLORS[p.platform as keyof typeof COLORS] }} />{PLATFORM_LABEL[p.platform]}</>} sub="Approved videos only count towards views">
          <div className="stats">
            <Stat label="Videos submitted" value={num(p.videos)} />
            <Stat label="Views" value={num(p.views)} />
            <Stat label="Impressions" value={p.impressions == null ? 'Not available' : num(p.impressions)} />
            <Stat label="Avg views / video" value={num(p.avgViews)} />
          </div>
          <div className="chart-sm">
            <ResponsiveContainer>
              <BarChart data={s.weekly}>
                <XAxis dataKey="week" tickFormatter={shortWeek} tick={tick} axisLine={false} tickLine={false} />
                <Tooltip {...tip} labelFormatter={(l) => `Week of ${shortWeek(l)}`} />
                <Bar dataKey={p.platform} name="Views" fill={COLORS[p.platform as keyof typeof COLORS]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="top-video">
            <span className="muted sm">Top video</span>
            {p.top ? <span>{p.top.name} · <strong>{num(p.top.views)}</strong> views · <VideoLink url={p.top.url} /></span> : <span className="muted">No measured videos yet</span>}
          </div>
        </Card>
      ))}
    </div>
  )
}

function CityCards({ s }: { s: Summary }) {
  const nav = useNavigate()
  return (
    <div className="grid g3">
      {s.cities.map((c: any) => (
        <button key={c.city} className="card city" onClick={() => nav(`/admin/cities/${encodeURIComponent(c.city)}`)}>
          <header className="card-h"><h3><MapPin size={15} /> {c.city}</h3><span className="link sm">Leaderboard →</span></header>
          <div className="stats">
            <Stat label="Participating TLs" value={`${c.tls} / ${c.registered}`} />
            <Stat label="Submitted videos" value={num(c.videos)} />
            <Stat label="Active videos" value={num(c.approved)} />
            <Stat label="Views" value={num(c.views)} />
            <Stat label="Avg views / TL" value={num(c.avgPerParticipant)} />
            <Stat label="Top performer" value={c.top ? c.top.name : '—'} tone="green" />
          </div>
        </button>
      ))}
    </div>
  )
}

const subCols: Col<any>[] = [
  { key: 'name', label: 'TL Name', render: (r) => <strong>{r.name}</strong> },
  { key: 'city', label: 'City' },
  { key: 'employeeId', label: 'Emp. ID' },
  { key: 'submittedAt', label: 'Submitted', render: (r) => date(r.submittedAt) },
  { key: 'email', label: 'Email' },
  { key: 'platform', label: 'Platform', render: (r) => <Badge kind={r.platform} /> },
  { key: 'url', label: 'Video', render: (r) => <VideoLink url={r.url} /> },
  { key: 'submittedViews', label: 'Claimed views', className: 'num', render: (r) => num(r.submittedViews) },
  { key: 'fetchedViews', label: 'Live views', className: 'num', render: (r) => (r.fetchedViews == null ? <span className="muted">—</span> : num(r.fetchedViews)) },
  { key: 'verifiedViews', label: 'Views', className: 'num', render: (r) => (r.verifiedViews == null ? <span className="muted">Not measured</span> : num(r.verifiedViews)) },
  { key: 'status', label: 'Status', render: (r) => <Badge kind={r.status} /> },
  { key: 'rewardEligible', label: 'Claimable', sort: (r) => (r.rewardEligible ? 1 : 0), render: (r) => (r.rewardEligible ? <span className="green">Yes</span> : <span className="muted">No</span>) },
]
const subSearch = (r: any) => `${r.name} ${r.employeeId} ${r.url} ${r.city} ${r.email}`

// ---------- Pages ----------
export function Overview() {
  const q = useSummary()
  return (
    <>
      <PageHead title="Campaign overview" sub="Performance tracking across TLs, platforms and cities" />
      <FilterBar />
      <Async q={q}>{(s) => (
        <>
          <KpiRow s={s} />
          <Card title="Campaign health">
            <div className="stats wide">
              <Stat label="Registered TLs" value={num(s.admin.registered)} />
              <Stat label="Active TLs" value={num(s.admin.active)} />
              <Stat label="Videos submitted" value={num(s.kpis.videos)} />
              <Stat label="Active videos" value={num(s.kpis.approved)} tone="green" />
              <Stat label="Disqualified" value={num(s.kpis.rejected)} tone="red" />
              <Stat label="Awaiting views" value={num(s.kpis.pending)} tone="amber" />
              <Stat label="Claims to verify" value={num(s.admin.claimsOpen)} tone="amber" />
              <Stat label="Total views" value={num(s.kpis.views)} />
              <Stat label="Instagram views" value={num(s.kpis.instagramViews)} />
              <Stat label="YouTube views" value={num(s.kpis.youtubeViews)} />
              <Stat label="Facebook views" value={num(s.kpis.facebookViews)} />
              <Stat label="Rewards unlocked" value={inr(s.admin.rewardsUnlocked)} />
              <Stat label="Approved, not paid" value={inr(s.admin.rewardsPending)} tone="amber" />
              <Stat label="Rewards paid" value={inr(s.admin.rewardsPaid)} tone="green" />
            </div>
          </Card>
          <h2 className="section">Platform performance</h2>
          <PlatformPanels s={s} />
          <h2 className="section">City performance</h2>
          <CityCards s={s} />
          <h2 className="section">Submission records</h2>
          <Card><DataTable rows={s.rows} cols={subCols} search={subSearch} initialSort={{ key: 'submittedAt', dir: -1 }} empty="No submissions match these filters" /></Card>
        </>
      )}</Async>
    </>
  )
}

export function Analytics() {
  const q = useSummary()
  return (
    <>
      <PageHead title="Analytics" sub="All charts follow the filters below" />
      <FilterBar />
      <Async q={q}>{(s) => {
        const statusData = [
          { name: 'Active', value: s.kpis.approved - s.kpis.pending, fill: COLORS.approved },
          { name: 'Awaiting views', value: s.kpis.pending, fill: COLORS.pending },
          { name: 'Rejected', value: s.kpis.rejected, fill: COLORS.rejected },
        ]
        if (!s.rows.length) return <Card><Empty msg="No submissions match these filters" /></Card>
        return (
          <div className="grid g2">
            <Card title="Views over time" sub="Weekly, by submission week">
              <div className="chart"><ResponsiveContainer>
                <LineChart data={s.weekly}><CartesianGrid stroke="#EEF2EF" vertical={false} />
                  <XAxis dataKey="week" tickFormatter={shortWeek} tick={tick} /><YAxis tickFormatter={compact} tick={tick} width={44} />
                  <Tooltip {...tip} labelFormatter={(l) => `Week of ${shortWeek(l)}`} />
                  <Line type="monotone" dataKey="views" name="Views" stroke="#00C853" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart></ResponsiveContainer></div>
            </Card>
            <Card title="Views by platform" sub="Weekly views on Instagram, YouTube and Facebook">
              <div className="chart"><ResponsiveContainer>
                <BarChart data={s.weekly}><CartesianGrid stroke="#EEF2EF" vertical={false} />
                  <XAxis dataKey="week" tickFormatter={shortWeek} tick={tick} /><YAxis tickFormatter={compact} tick={tick} width={44} />
                  <Tooltip {...tip} labelFormatter={(l) => `Week of ${shortWeek(l)}`} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="instagram" name="Instagram" fill={COLORS.instagram} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="youtube" name="YouTube" fill={COLORS.youtube} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="facebook" name="Facebook" fill={COLORS.facebook} radius={[4, 4, 0, 0]} />
                </BarChart></ResponsiveContainer></div>
            </Card>
            <Card title="City-wise participation" sub="Participating vs registered TLs">
              <div className="chart"><ResponsiveContainer>
                <BarChart data={s.cities}><CartesianGrid stroke="#EEF2EF" vertical={false} />
                  <XAxis dataKey="city" tick={tick} /><YAxis allowDecimals={false} tick={tick} width={30} />
                  <Tooltip {...tip} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="registered" name="Registered" fill="#CFE9D9" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="tls" name="Participating" fill="#00A846" radius={[4, 4, 0, 0]} />
                </BarChart></ResponsiveContainer></div>
            </Card>
            <Card title="Submission trend" sub="Weekly submissions and approvals">
              <div className="chart"><ResponsiveContainer>
                <AreaChart data={s.weekly}><CartesianGrid stroke="#EEF2EF" vertical={false} />
                  <XAxis dataKey="week" tickFormatter={shortWeek} tick={tick} /><YAxis allowDecimals={false} tick={tick} width={30} />
                  <Tooltip {...tip} labelFormatter={(l) => `Week of ${shortWeek(l)}`} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="submissions" name="Submitted" stroke="#2F3B35" fill="#2F3B3518" />
                  <Area type="monotone" dataKey="approved" name="Active" stroke="#00C853" fill="#00C85330" />
                </AreaChart></ResponsiveContainer></div>
            </Card>
            <Card title="Verification status">
              <div className="chart donut"><ResponsiveContainer>
                <PieChart><Pie data={statusData} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" paddingAngle={2}>
                  {statusData.map((d) => <Cell key={d.name} fill={d.fill} />)}
                </Pie><Tooltip {...tip} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /></PieChart>
              </ResponsiveContainer><div className="donut-c"><strong>{num(s.kpis.videos)}</strong><span className="muted sm">entries</span></div></div>
            </Card>
            <Card title="Top cities" sub="By views">
              <ol className="rank-list">
                {s.topCities.map((c: any, i: number) => (
                  <li key={c.city}><span className={`rank r${i + 1}`}>{i + 1}</span><span>{c.city}<span className="muted sm"> · {c.tls} TLs · {c.approved} active</span></span><strong>{num(c.views)}</strong></li>
                ))}
              </ol>
            </Card>
            <Card title="Top-performing videos" className="span2">
              {s.topVideos.length ? (
                <ol className="rank-list">
                  {s.topVideos.map((v: any, i: number) => (
                    <li key={v.id}><span className={`rank ${i < 3 ? `r${i + 1}` : ''}`}>{i + 1}</span><span>{v.name} <span className="muted sm">· {v.city} · </span><Badge kind={v.platform} /> <VideoLink url={v.url} /></span><strong>{num(v.views)}</strong></li>
                  ))}
                </ol>
              ) : <Empty msg="No measured videos yet" />}
            </Card>
          </div>
        )
      }}</Async>
    </>
  )
}

export function Submissions() {
  const q = useSummary()
  const [open, setOpen] = useState<any>(null)
  return (
    <>
      <PageHead title="Video submissions" sub="Every submitted video counts. Correct a view count or disqualify a video here; rewards are verified under Claims & Rewards." />
      <SyncPanel onDone={q.reload} />
      <FilterBar />
      <Async q={q}>{(s) => (
        <Card>
          <div className="pill-row">
            <span className="pill g">{s.kpis.approved} active</span><span className="pill a">{s.kpis.pending} awaiting views</span><span className="pill r">{s.kpis.rejected} rejected</span>
            <span className="muted sm">Click a row to review</span>
          </div>
          <DataTable rows={s.rows} cols={subCols} search={subSearch} onRow={setOpen} initialSort={{ key: 'submittedAt', dir: -1 }} empty="No submissions match these filters" />
        </Card>
      )}</Async>
      {open && <ReviewDrawer sub={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); q.reload() }} />}
    </>
  )
}

/** Apify live-view fetch. The token lives in Apps Script Script Properties; this only triggers the job. */
function SyncPanel({ onDone }: { onDone: () => void }) {
  const info = useApi<any>('/admin/integrations')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok?: string; err?: string; list?: string[] }>({})
  const run = async () => {
    setBusy(true)
    setMsg({})
    try {
      const r = await api('/admin/refresh-views', { method: 'POST' })
      setMsg({ ok: `Fetched ${r.fetched} live counts · ${r.approvedUpdated} videos updated.`, list: r.errorCount ? [...r.errors, ...(r.errorCount > r.errors.length ? [`…and ${r.errorCount - r.errors.length} more`] : [])] : [] })
      onDone()
      info.reload()
    } catch (e: any) { setMsg({ err: e.message }) } finally { setBusy(false) }
  }
  const i = info.data
  return (
    <Card title="Live views" sub={`${i?.lastRefresh ? `Last refresh ${new Date(i.lastRefresh.at).toLocaleString('en-IN')} · ` : ''}Refreshes automatically every night around 2 AM`}>
      <div className="row wrap">
        <button className="btn primary" disabled={busy} onClick={run}>{busy ? 'Fetching… (can take a few minutes)' : 'Refresh views now'}</button>
      </div>
      <p className="muted sm">YouTube views are read from each video's public page, with no key needed. {i && !i.apify ? <>Instagram and Facebook block this, so enter their views by hand in the video panel (or add <code>APIFY_TOKEN</code> to fetch them too).</> : 'Instagram and Facebook are fetched through Apify.'}</p>
      {msg.ok && <p className="green sm">{msg.ok}</p>}
      {msg.err && <p className="err-text">{msg.err}</p>}
      {!!msg.list?.length && <details className="sm"><summary>{msg.list.length} links need attention</summary><ul>{msg.list.map((l, k) => <li key={k}>{l}</li>)}</ul></details>}
    </Card>
  )
}

function ReviewDrawer({ sub, onClose, onSaved }: { sub: any; onClose: () => void; onSaved: () => void }) {
  const [views, setViews] = useState(String(sub.verifiedViews ?? sub.fetchedViews ?? sub.submittedViews ?? ''))
  const [imp, setImp] = useState(sub.impressions == null ? '' : String(sub.impressions))
  const [reason, setReason] = useState(sub.rejectionReason ?? '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const act = async (status: string) => {
    setErr('')
    setBusy(true)
    try {
      await api(`/admin/submissions/${sub.id}`, { method: 'PATCH', body: { status, verifiedViews: views === '' ? null : Number(views), impressions: imp === '' ? null : Number(imp), rejectionReason: reason } })
      onSaved()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Drawer title={`Video ${sub.id}`} onClose={onClose}>
      <dl className="dl">
        <dt>TL</dt><dd>{sub.name} · {sub.employeeId}</dd>
        <dt>City</dt><dd>{sub.city}</dd>
        <dt>Email</dt><dd>{sub.email}</dd>
        <dt>Platform</dt><dd><Badge kind={sub.platform} /></dd>
        <dt>Submitted</dt><dd>{date(sub.submittedAt)}</dd>
        <dt>Live views</dt><dd>{sub.fetchedViews == null ? <span className="muted">Not fetched yet</span> : <>{num(sub.fetchedViews)} <span className="muted sm">· Apify, {new Date(sub.fetchedAt).toLocaleString('en-IN')}</span></>}</dd>
        <dt>Status</dt><dd><Badge kind={sub.status} />{sub.rejectionReason && <span className="muted sm"> · {sub.rejectionReason}</span>}</dd>
        <dt>Video</dt><dd><a className="btn sm" href={sub.url} target="_blank" rel="noreferrer noopener">Open on {PLATFORM_LABEL[sub.platform]} ↗</a></dd>
      </dl>
      <p className="muted sm">Every video counts automatically; there is no approval. Correct the view count if Apify is wrong or not connected, or disqualify a video that breaks the rules (it then counts 0 and can't be claimed).</p>
      <div className="form">
        <label>Views<input type="number" min={0} value={views} onChange={(e) => setViews(e.target.value)} /></label>
        <label>Impressions (optional)<input type="number" min={0} value={imp} onChange={(e) => setImp(e.target.value)} /></label>
        <label>Reason (required to disqualify)<textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {err && <p className="err-text">{err}</p>}
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={() => act('active')}><CheckCircle2 size={15} /> {sub.status === 'rejected' ? 'Reinstate & save' : 'Save views'}</button>
          {sub.status !== 'rejected' && <button className="btn danger" disabled={busy} onClick={() => act('rejected')}><XCircle size={15} /> Disqualify</button>}
        </div>
      </div>
    </Drawer>
  )
}

export function Participants() {
  const q = useApi<any[]>('/admin/participants')
  return (
    <>
      <PageHead title="Participants" sub="All registered TLs and their campaign totals" />
      <Async q={q}>{(rows) => (
        <Card>
          <DataTable
            rows={rows}
            search={(r) => `${r.name} ${r.employeeId} ${r.city} ${r.email}`}
            initialSort={{ key: 'views', dir: -1 }}
            cols={[
              { key: 'rank', label: 'Rank', sort: (r) => -(r.rank ?? 9999), render: (r) => r.rank ?? <span className="muted">—</span> },
              { key: 'name', label: 'Name', render: (r) => <strong>{r.name}</strong> },
              { key: 'employeeId', label: 'Emp. ID' },
              { key: 'city', label: 'City' },
              { key: 'email', label: 'Email' },
              { key: 'registeredAt', label: 'Registered', render: (r) => date(r.registeredAt) },
              { key: 'videos', label: 'Submitted', className: 'num' },
              { key: 'approved', label: 'Active', className: 'num' },
              { key: 'views', label: 'Views', className: 'num', render: (r) => <strong>{num(r.views)}</strong> },
              { key: 'rewards', label: 'Rewards', className: 'num', render: (r) => inr(r.rewards) },
              { key: 'status', label: 'Status', sort: (r) => r.videos, render: (r) => (r.videos ? <Badge kind="active" /> : <Badge kind="registered" />) },
            ]}
          />
        </Card>
      )}</Async>
    </>
  )
}

export function Cities() {
  const { city } = useParams()
  const q = useSummary()
  const lb = useApi<{ rows: LeaderRow[] }>(city ? `/leaderboard?type=city&city=${encodeURIComponent(city)}` : null)
  if (!city) return (
    <>
      <PageHead title="City performance" sub="Click a city for its leaderboard" />
      <FilterBar />
      <Async q={q}>{(s) => <CityCards s={s} />}</Async>
    </>
  )
  return (
    <>
      <Link to="/admin/cities" className="link back"><ArrowLeft size={14} /> All cities</Link>
      <PageHead title={`${city} leaderboard`} sub="Ranked by views" />
      <Async q={lb}>{(d) => <><Podium rows={d.rows} /><Card><LeaderTable rows={d.rows} /></Card></>}</Async>
    </>
  )
}

const CLAIM_TABS = [['claimed', 'To verify'], ['approved', 'Approved, unpaid'], ['paid', 'Paid'], ['rejected', 'Rejected'], ['all', 'All']] as const

export function Rewards() {
  const q = useApi<any>('/admin/rewards')
  const [tab, setTab] = useState<string>('claimed')
  const [open, setOpen] = useState<any>(null)
  const [err, setErr] = useState('')
  const pay = async (id: string) => { setErr(''); try { await api(`/admin/rewards/${id}/pay`, { method: 'POST' }); q.reload() } catch (e: any) { setErr(e.message) } }
  return (
    <>
      <PageHead title="Claims & rewards" sub="TLs claim when a video reaches a milestone. Check the video and its views, approve or reject, then mark it paid." />
      <Async q={q}>{(d) => {
        const al = d.allocations as any[]
        const by = (st: string) => al.filter((a) => a.status === st)
        const total = (xs: any[]) => inr(xs.reduce((a, x) => a + x.amount, 0))
        const shown = tab === 'all' ? al : by(tab)
        return (
          <>
            <div className="grid g3">
              <Kpi label="Claims to verify" value={num(by('claimed').length)} icon={<Clock size={16} />} hint={`${total(by('claimed'))} claimed`} />
              <Kpi label="Approved, not paid" value={total(by('approved'))} icon={<Trophy size={16} />} hint={`${by('approved').length} payouts waiting`} />
              <Kpi label="Paid" value={total(by('paid'))} icon={<CheckCircle2 size={16} />} hint={`${by('paid').length} payments`} />
            </div>
            <Card title="Claims" action={
              <div className="tabs sm">{CLAIM_TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{k !== 'all' ? ` (${by(k).length})` : ''}</button>)}</div>
            }>
              {err && <p className="err-text">{err}</p>}
              <DataTable
                key={tab}
                rows={shown}
                search={(r) => `${r.name} ${r.employeeId} ${r.city} ${r.submissionId} ${r.milestone}`}
                initialSort={{ key: 'claimedAt', dir: -1 }}
                empty={tab === 'claimed' ? 'No claims waiting for verification' : 'Nothing here yet'}
                cols={[
                  { key: 'name', label: 'TL', render: (r) => <><strong>{r.name}</strong><div className="muted sm">{r.employeeId} · {r.city}</div></> },
                  { key: 'submissionId', label: 'Video', render: (r) => <><Badge kind={r.platform} /> <VideoLink url={r.url} /><div className="muted sm">{r.submissionId}</div></> },
                  { key: 'milestone', label: 'Claim', render: (r) => <><strong>{r.milestone}</strong><div className="muted sm">{num(r.claimedViews)} views · {date(r.claimedAt)}</div></> },
                  { key: 'checks', label: 'Checks', render: (r) => <Checks c={r.checks} milestone={r.milestone} /> },
                  { key: 'amount', label: 'Amount', className: 'num', render: (r) => inr(r.amount) },
                  { key: 'status', label: 'Status', render: (r) => <><Badge kind={r.status} />{r.reason && <div className="muted sm">{r.reason}</div>}{r.verifiedViews != null && <div className="muted sm">Verified {num(r.verifiedViews)}</div>}</> },
                  { key: 'act', label: '', render: (r) => r.status === 'claimed' ? <button className="btn sm primary" onClick={() => setOpen(r)}>Verify</button> : r.status === 'approved' ? <button className="btn sm" onClick={() => pay(r.id)}>Mark paid</button> : null },
                ]}
              />
            </Card>
            <Card title="Reward milestones" sub="Saved to CAMPAIGN_SETTINGS. Highest milestone reached counts; one video per platform per TL.">
              <MilestoneEditor milestones={d.milestones} onChange={q.reload} />
            </Card>
            {open && <VerifyDrawer r={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); q.reload() }} />}
          </>
        )
      }}</Async>
    </>
  )
}

const Check = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => <div className={`chk ${ok ? 'ok' : 'bad'}`}>{ok ? '✓' : '!'} {children}</div>
function Checks({ c, milestone }: { c: any; milestone: string }) {
  return (
    <div className="chks">
      <Check ok={c.active}>{c.active ? 'Video active' : 'Video disqualified'}</Check>
      <Check ok={c.meetsMilestone}>Views now {num(c.viewsNow)} {c.meetsMilestone ? `≥ ${milestone}` : `< ${milestone}`}</Check>
      <Check ok={!c.earlierEligibleVideos.length}>{c.earlierEligibleVideos.length ? `Earlier video also eligible: ${c.earlierEligibleVideos.join(', ')}` : 'First eligible video on platform'}</Check>
    </div>
  )
}

function VerifyDrawer({ r, onClose, onSaved }: { r: any; onClose: () => void; onSaved: () => void }) {
  const [views, setViews] = useState(String(r.checks.liveViews ?? r.checks.viewsNow ?? r.claimedViews))
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const act = async (action: string) => {
    setErr('')
    setBusy(true)
    try { await api(`/admin/rewards/${r.id}/verify`, { method: 'POST', body: { action, verifiedViews: views === '' ? null : Number(views), reason } }); onSaved() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Drawer title={`Verify claim ${r.id}`} onClose={onClose}>
      <dl className="dl">
        <dt>TL</dt><dd>{r.name} · {r.employeeId} · {r.city}</dd>
        <dt>Video</dt><dd><Badge kind={r.platform} /> {r.submissionId} · <a className="btn sm" href={r.url} target="_blank" rel="noreferrer noopener">Open ↗</a></dd>
        <dt>Claimed</dt><dd><strong>{r.milestone}</strong> · {inr(r.amount)} · {num(r.claimedViews)} views on {date(r.claimedAt)}</dd>
        <dt>Views now</dt><dd>{num(r.checks.viewsNow)}</dd>
        <dt>Live (Apify)</dt><dd>{r.checks.liveViews == null ? <span className="muted">Not fetched</span> : <>{num(r.checks.liveViews)} <span className="muted sm">· {new Date(r.checks.liveAt).toLocaleString('en-IN')}</span></>}</dd>
      </dl>
      <Checks c={r.checks} milestone={r.milestone} />
      <p className="muted sm">Open the video, confirm it is a genuine Zypp campaign video by this TL, and check its view count. The reward is recalculated from the views you enter (highest milestone reached), so it can be lower than claimed.</p>
      <div className="form">
        <label>Verified views<input type="number" min={0} value={views} onChange={(e) => setViews(e.target.value)} /></label>
        <label>Reason (required to reject)<textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Video is private, not a Zypp video" /></label>
        {err && <p className="err-text">{err}</p>}
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={() => act('approve')}><CheckCircle2 size={15} /> Approve</button>
          <button className="btn danger" disabled={busy} onClick={() => act('reject')}><XCircle size={15} /> Reject</button>
        </div>
      </div>
    </Drawer>
  )
}

function MilestoneEditor({ milestones, onChange }: { milestones: any[]; onChange: () => void }) {
  const [edit, setEdit] = useState<any>(null) // null | {id?, views, amount, label, active}
  const [err, setErr] = useState('')
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    try {
      await api(edit.id ? `/admin/milestones/${edit.id}` : '/admin/milestones', { method: edit.id ? 'PUT' : 'POST', body: { ...edit, views: Number(edit.views), amount: Number(edit.amount) } })
      setEdit(null)
      onChange()
    } catch (e: any) { setErr(e.message) }
  }
  const toggle = async (m: any) => { setErr(''); try { await api(`/admin/milestones/${m.id}`, { method: 'PUT', body: { ...m, active: !m.active } }); onChange() } catch (e: any) { setErr(e.message) } }
  return (
    <>
      <div className="table-wrap"><table>
        <thead><tr><th>Milestone</th><th className="num">Verified views</th><th className="num">Reward</th><th>Status</th><th /></tr></thead>
        <tbody>{milestones.map((m) => (
          <tr key={m.id}>
            <td><strong>{m.label}</strong></td><td className="num">{num(m.views)}</td><td className="num">{inr(m.amount)}</td>
            <td><label className="switch"><input type="checkbox" checked={m.active} onChange={() => toggle(m)} /> {m.active ? 'Active' : 'Inactive'}</label></td>
            <td><button className="btn sm ghost" onClick={() => setEdit({ ...m })}>Edit</button></td>
          </tr>
        ))}</tbody>
      </table></div>
      {err && <p className="err-text">{err}</p>}
      {edit ? (
        <form className="form inline" onSubmit={save}>
          <label>Views threshold<input type="number" min={1} value={edit.views} onChange={(e) => setEdit({ ...edit, views: e.target.value })} required /></label>
          <label>Reward (₹)<input type="number" min={0} value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} required /></label>
          <div className="row"><button className="btn primary">{edit.id ? 'Save' : 'Add milestone'}</button><button type="button" className="btn ghost" onClick={() => { setEdit(null); setErr('') }}>Cancel</button></div>
        </form>
      ) : <button className="btn" onClick={() => setEdit({ views: '', amount: '', active: true })}><Plus size={14} /> Add milestone</button>}
    </>
  )
}

/** View fetching: YouTube is automatic; paste the Apify key here to add Instagram/Facebook. Saving starts a fetch right away. */
function ViewFetching({ onChange }: { onChange: () => void }) {
  const info = useApi<any>('/admin/integrations')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const refreshNow = async () => {
    setBusy('Fetching views… this can take a few minutes')
    const r = await api('/admin/refresh-views', { method: 'POST' })
    setMsg({ ok: `Fetched ${r.fetched} view counts · ${r.approvedUpdated} videos updated${r.errorCount ? ` · ${r.errorCount} links need attention (see Video Submissions)` : ''}.` })
  }
  const run = async (fn: () => Promise<void>) => {
    setMsg({})
    try { await fn() } catch (e: any) { setMsg({ err: e.message }) } finally { setBusy(''); info.reload(); onChange() }
  }
  const save = () => run(async () => {
    setBusy('Checking the key with Apify…')
    await api('/admin/integrations/apify', { method: 'PUT', body: { token } })
    setToken('')
    await refreshNow()
  })
  const i = info.data
  return (
    <Card title="View fetching" sub={i?.lastRefresh ? `Last refresh ${new Date(i.lastRefresh.at).toLocaleString('en-IN')}` : 'Views refresh automatically every night around 2 AM'}>
      <ul className="vf">
        <li className="ok"><CheckCircle2 size={15} /> <strong>YouTube</strong> · read from each video's public page, no key needed</li>
        <li className={i?.apify ? 'ok' : 'off'}>{i?.apify ? <CheckCircle2 size={15} /> : <XCircle size={15} />} <strong>Instagram &amp; Facebook</strong> · {i?.apify ? <>Apify connected ({i.apifyHint})</> : 'not connected: add your Apify key below, or enter views by hand'}</li>
        <li className={i?.nightly ? 'ok' : 'off'}>{i?.nightly ? <CheckCircle2 size={15} /> : <XCircle size={15} />} <strong>Nightly refresh at 2 AM</strong> · {i?.nightly ? 'on' : 'off'}
          {i && !i.nightly && <button className="btn sm" disabled={!!busy} onClick={() => run(async () => { await api('/admin/integrations/nightly', { method: 'POST' }) })}>Turn on</button>}</li>
      </ul>
      <form className="form inline" onSubmit={(e) => { e.preventDefault(); save() }}>
        <label className="grow">Apify API key<input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={i?.apify ? 'Paste a new key to replace the current one' : 'apify_api_…'} /></label>
        <div className="row">
          <button className="btn primary" disabled={!!busy || !token.trim()}>{i?.apify ? 'Replace key & fetch' : 'Save key & start fetching'}</button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => run(refreshNow)}>Refresh views now</button>
          {i?.apify && <button type="button" className="btn ghost" disabled={!!busy} onClick={() => run(async () => { await api('/admin/integrations/apify', { method: 'PUT', body: { token: '' } }) })}>Remove key</button>}
        </div>
      </form>
      <p className="muted sm">Find the key in Apify Console → Settings → API &amp; Integrations. It is checked with Apify, then stored in the Apps Script's private settings; it is never shown again or saved in the sheet.</p>
      {busy && <p className="sm"><Clock size={13} /> {busy}</p>}
      {msg.ok && <p className="green sm">{msg.ok}</p>}
      {msg.err && <p className="err-text">{msg.err}</p>}
    </Card>
  )
}

export function SettingsPage() {
  const q = useApi<any>('/admin/settings')
  const log = useApi<any[]>('/admin/audit')
  return (
    <>
      <PageHead title="Settings" sub="Campaign configuration and audit trail" />
      <ViewFetching onChange={log.reload} />
      <Async q={q}>{(s) => <SettingsForm initial={s} onSaved={() => { q.reload(); log.reload() }} />}</Async>
      <Card title="Sync log" sub="Latest 300 rows of the SYNC_LOGS sheet">
        <Async q={log}>{(rows) => (
          <DataTable rows={rows.map((r, i) => ({ ...r, id: String(i) }))} search={(r) => `${r.operation} ${r.recordId ?? ''} ${r.message ?? ''}`} cols={[
            { key: 'at', label: 'When', render: (r) => (r.at ? new Date(r.at).toLocaleString('en-IN') : '—') },
            { key: 'operation', label: 'Operation', render: (r) => <code>{r.operation}</code> },
            { key: 'status', label: 'Status', render: (r) => (r.status === 'error' ? <span className="err-text">Failed</span> : <span className="green">Success</span>) },
            { key: 'recordId', label: 'Record' },
            { key: 'message', label: 'Message', render: (r) => <span className="muted">{r.message}</span> },
          ]} />
        )}</Async>
      </Card>
    </>
  )
}

function SettingsForm({ initial, onSaved }: { initial: any; onSaved: () => void }) {
  const [s, setS] = useState(initial)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const save = async (e: FormEvent) => {
    e.preventDefault()
    try { setS(await api('/admin/settings', { method: 'PUT', body: s })); setMsg({ ok: 'Saved' }); onSaved() } catch (e: any) { setMsg({ err: e.message }) }
  }
  return (
    <Card title="Campaign">
      <form className="form" onSubmit={save}>
        <label>Campaign name<input value={s.campaignName} onChange={(e) => setS({ ...s, campaignName: e.target.value })} /></label>
        <fieldset><legend>Active platforms</legend>
          {Object.keys(s.platforms).map((p) => (
            <label key={p} className="switch"><input type="checkbox" checked={s.platforms[p]} onChange={(e) => setS({ ...s, platforms: { ...s.platforms, [p]: e.target.checked } })} /> {PLATFORM_LABEL[p]}</label>
          ))}
        </fieldset>
        <p className="muted sm">Campaign window: {date(s.campaignStart)} – {date(s.campaignEnd)} · Status: {s.campaignStatus}. Dates, status, cities and the T&amp;C version are edited in the CAMPAIGN_SETTINGS sheet.</p>
        <div className="row"><button className="btn primary">Save settings</button>{msg.ok && <span className="green">{msg.ok}</span>}{msg.err && <span className="err-text">{msg.err}</span>}</div>
      </form>
    </Card>
  )
}
