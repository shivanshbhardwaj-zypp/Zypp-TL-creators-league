import { Fragment, useMemo, useState, type FormEvent } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDown, ArrowUp, Clapperboard, Clock, Eye, Lock, Medal, Plus, Target, Trophy } from 'lucide-react'
import { COLORS, PLATFORM_LABEL, api, compact, date, num, shortWeek, useApi, useAuth } from './lib'
import { Async, Badge, Card, DataTable, Empty, Kpi, LeaderTable, Podium, VideoLink, type BoardRow } from './ui'
import { PageHead, tick, tip } from './admin'

type Nb = { rank: number; name: string; city: string; views: number }
type Pos = { rank: number; of: number; city: string; views: number; entries: number; need: number; above: Nb | null; below: Nb | null } | null

// ---------- Personal performance ----------
type Gran = 'day' | 'week' | 'month'
const bucket = (d: string, g: Gran) => {
  if (g === 'day') return d
  if (g === 'month') return d.slice(0, 7)
  const t = Date.parse(d)
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10)
}
const bucketLabel = (k: string, g: Gran) => (g === 'month' ? new Date(k + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : shortWeek(k))

/** Cumulative measured views from the TL's own active videos, by submission date. */
export function cumulative(videos: { submittedAt: string; status: string; counted: number }[], g: Gran) {
  const m = new Map<string, number>()
  for (const v of videos) if (v.status === 'active') m.set(bucket(v.submittedAt, g), (m.get(bucket(v.submittedAt, g)) ?? 0) + v.counted)
  let run = 0
  return [...m.keys()].sort().map((k) => ({ key: k, added: m.get(k)!, views: (run += m.get(k)!) }))
}

function PerformanceSection({ d }: { d: any }) {
  const [g, setG] = useState<Gran>('week')
  const series = useMemo(() => cumulative(d.videos, g), [d.videos, g])
  const t = d.totals
  const share = (v: number) => (t.views ? Math.round((v / t.views) * 100) : 0)
  return (
    <Card title="My performance" sub="Views are measured by the campaign team" action={
      <div className="tabs sm" role="tablist" aria-label="Chart period">{(['day', 'week', 'month'] as Gran[]).map((k) => (
        <button key={k} role="tab" aria-selected={g === k} className={g === k ? 'on' : ''} onClick={() => setG(k)}>{k === 'day' ? 'Daily' : k === 'week' ? 'Weekly' : 'Monthly'}</button>
      ))}</div>
    }>
      <div className="perf">
        <div className="perf-chart">
          {series.length ? (
            <div className="chart"><ResponsiveContainer>
              <LineChart data={series}><CartesianGrid stroke="#EEF2EF" vertical={false} />
                <XAxis dataKey="key" tickFormatter={(k) => bucketLabel(k, g)} tick={tick} minTickGap={16} /><YAxis tickFormatter={compact} tick={tick} width={40} />
                <Tooltip {...tip} labelFormatter={(k) => (g === 'month' ? bucketLabel(k, g) : g === 'week' ? `Week of ${bucketLabel(k, g)}` : date(k))}
                  formatter={(v: number, n: string) => [num(v), n]} />
                <Line type="monotone" dataKey="views" name="Cumulative views" stroke="#00C853" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="added" name="Added this period" stroke="#B8C4BC" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
              </LineChart></ResponsiveContainer></div>
          ) : <Empty msg="No views measured yet. Your growth chart appears once your videos' views are measured." />}
          <p className="muted sm">Views are counted against the date each video was submitted.</p>
        </div>
        <div className="perf-side">
          <div className="stat"><span className="muted sm">Total views</span><strong className="big">{num(t.views)}</strong></div>
          <div className="split">
            {([['instagram', t.instagramViews], ['youtube', t.youtubeViews], ['facebook', t.facebookViews]] as const).map(([p, v]) => (
              <Fragment key={p}>
                <div><span className="pdot"><i style={{ background: COLORS[p] }} />{PLATFORM_LABEL[p]}</span><strong>{num(v)}</strong></div>
                <div className="split-bar"><span style={{ width: `${share(v)}%`, background: COLORS[p] }} /></div>
              </Fragment>
            ))}
          </div>
          <div className="stat"><span className="muted sm">Videos</span><strong>{num(t.approved)} <span className="muted sm">· {t.pending} awaiting views</span></strong></div>
          <div className="stat"><span className="muted sm">Best video</span>
            {d.best ? <strong className="sm"><Medal size={13} className="green" /> {num(d.best.verifiedViews)} views · {PLATFORM_LABEL[d.best.platform]} · <VideoLink url={d.best.url} /></strong> : <span className="muted sm">No views measured yet</span>}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ---------- Competition: universal graph, my position, podium, table ----------
const BAR = { 1: '#D4A72C', 2: '#A3ADB5', 3: '#C08457' } as Record<number, string>
const barFill = (r: BoardRow) => BAR[r.rank] ?? (r.isMe ? '#008F3D' : '#C9E8D5')

function NameTick({ x, y, payload, rows, narrow }: any) {
  const r: BoardRow | undefined = rows[payload.index]
  if (!r) return null
  const strong = r.rank <= 3 || r.isMe
  const max = narrow ? 11 : 17
  const name = r.name.length > max ? r.name.slice(0, max - 1) + '…' : r.name
  return (
    <text x={x - 8} y={y} dy={4} textAnchor="end" fontSize={narrow ? 11 : 12} fontWeight={strong ? 700 : 400} fill={r.isMe ? '#008F3D' : r.rank <= 3 ? '#17211B' : '#4B5750'}>
      {r.rank === 1 ? '♛ ' : ''}#{r.rank} {name}{r.isMe && !narrow ? ' (You)' : ''}
    </text>
  )
}
function BoardTip({ active, payload }: any) {
  const r: BoardRow | undefined = active && payload?.[0]?.payload
  if (!r) return null
  return <div className="tip"><strong>#{r.rank} {r.name}</strong><span className="muted sm">{r.city}</span><span>{num(r.views)} views</span><span className="muted sm">{r.entries} videos</span></div>
}

/** One chart, every participant. Top three get medal colours and bold names; nobody is hidden. */
export function UniversalChart({ rows }: { rows: BoardRow[] }) {
  if (!rows.length) return <Empty msg="No participants on this board yet" />
  const h = rows.length * 34 + 16
  // shortcut: label width is picked at render, not on live resize; fine since TLs don't resize phones.
  const narrow = window.innerWidth < 520
  return (
    <div className="uchart" role="img" aria-label={`Leaderboard of ${rows.length} participants. Leader: ${rows[0].name} with ${num(rows[0].views)} views.`}>
      <div className="uchart-head"><span>Rank &amp; TL</span><span className="legend"><i style={{ background: BAR[1] }} />Gold <i style={{ background: BAR[2] }} />Silver <i style={{ background: BAR[3] }} />Bronze <i style={{ background: '#008F3D' }} />You</span><span>Verified views</span></div>
      <div className="uchart-body">
        <div style={{ height: h }}>
          <ResponsiveContainer>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: narrow ? 48 : 64, bottom: 4, left: 4 }} barCategoryGap={6}>
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="name" width={narrow ? 128 : 190} interval={0} axisLine={false} tickLine={false} tick={<NameTick rows={rows} narrow={narrow} />} />
              <Tooltip cursor={{ fill: '#F0F5F2' }} content={<BoardTip />} />
              <Bar dataKey="views" radius={[0, 6, 6, 0]} maxBarSize={24} animationDuration={600}>
                {rows.map((r, i) => <Cell key={i} fill={barFill(r)} stroke={r.isMe ? '#006B2D' : undefined} />)}
                <LabelList dataKey="views" position="right" formatter={(v: number) => num(v)} style={{ fontSize: 11, fill: '#17211B', fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function MyPosition({ me, name }: { me: Pos; name: string }) {
  if (!me) return <Card title="Your current position"><Empty msg="You're not on this board yet. Submit a video and get views to enter the ranking." /></Card>
  return (
    <Card title="Your current position" className="mypos">
      <div className="mypos-head">
        <span className={`rank big-rank ${me.rank <= 3 ? `r${me.rank}` : ''}`}>#{me.rank}</span>
        <div><strong>{name}</strong><div className="muted sm">{num(me.views)} views · {me.entries} video{me.entries === 1 ? '' : 's'} · of {me.of}</div></div>
      </div>
      <p className="mypos-msg">{me.above ? <>You need <strong>{num(me.need)}</strong> more views to overtake <strong>Rank #{me.above.rank}</strong>.</> : <>You're currently <strong>#1</strong>. Stay on top!</>}</p>
      <ol className="neighbours">
        <li className="nb-head muted sm"><span /><span>Rank &amp; TL</span><span>City</span><span className="num">Views</span><span className="num">Gap</span></li>
        {me.above && <li><ArrowUp size={14} /><span>#{me.above.rank} {me.above.name}</span><span className="muted">{me.above.city}</span><strong className="num">{num(me.above.views)}</strong><span className="amber sm num">+{num(me.above.views - me.views)} ahead</span></li>}
        <li className="is-me"><Target size={14} /><span>#{me.rank} {name} (You)</span><span>{me.city}</span><strong className="num">{num(me.views)}</strong><span /></li>
        {me.below && <li><ArrowDown size={14} /><span>#{me.below.rank} {me.below.name}</span><span className="muted">{me.below.city}</span><strong className="num">{num(me.below.views)}</strong><span className="green sm num">you lead by {num(me.views - me.below.views)}</span></li>}
      </ol>
    </Card>
  )
}

const TABS = [['overall', 'Overall'], ['city', 'City-wise'], ['instagram', 'Instagram'], ['youtube', 'YouTube'], ['facebook', 'Facebook']] as const

/** Shared by the TL homepage, the Leaderboard page (TL + admin). All ranking comes from the server. */
export function Competition({ myCity, myName }: { myCity?: string; myName?: string }) {
  const meta = useApi<any>('/meta')
  const [tab, setTab] = useState<string>('overall')
  const [city, setCity] = useState('')
  const [tableCity, setTableCity] = useState('')
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const c = city || myCity || meta.data?.cities[0] || ''
  const q = useApi<{ rows: BoardRow[]; me: Pos }>(tab === 'city' ? (c ? `/leaderboard?type=city&city=${encodeURIComponent(c)}` : null) : `/leaderboard?type=${tab}`)
  const tabs = TABS.filter(([k]) => !(k === 'instagram' || k === 'youtube' || k === 'facebook') || meta.data?.platforms.includes(k))
  const isTl = !!myName
  return (
    <>
      {!isTl && <div className="board-filters">
        <div className="tabs" role="tablist" aria-label="Leaderboard">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setTableCity('') }}>{l}</button>)}</div>
        {tab === 'city' && <select value={c} onChange={(e) => setCity(e.target.value)} aria-label="City">{meta.data?.cities.map((x: string) => <option key={x}>{x}</option>)}</select>}
      </div>}
      <Async q={q}>{(d) => {
        const cities = [...new Set(d.rows.map((r) => r.city))].sort()
        const tableRows = tableCity ? d.rows.filter((r) => r.city === tableCity) : d.rows
        return (
          <>
            {isTl ? <MyPosition me={d.me} name={myName!} /> : <Card title="Top three"><Podium rows={d.rows} />{!d.rows.length && <Empty />}</Card>}
            <Card title="Universal leaderboard" sub={`All ${d.rows.length} participants · ranked by views, then number of videos`} action={
              <div className="row">
                {view === 'table' && tab !== 'city' && cities.length > 1 && (
                  <select value={tableCity} onChange={(e) => setTableCity(e.target.value)} aria-label="Filter table by city"><option value="">All cities</option>{cities.map((x) => <option key={x}>{x}</option>)}</select>
                )}
                <div className="tabs" role="tablist" aria-label="Leaderboard view">
                  {(['chart', 'table'] as const).map((v) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v === 'chart' ? 'Chart' : 'Table'}</button>)}
                </div>
              </div>
            }>
              {view === 'chart' ? <UniversalChart rows={d.rows} /> : <LeaderTable rows={tableRows} />}
            </Card>
          </>
        )
      }}</Async>
    </>
  )
}

// ---------- Pages ----------
export function MyDashboard() {
  const q = useApi<any>('/me/dashboard')
  const meta = useApi<any>('/meta')
  const { user } = useAuth()
  return (
    <>
      <div className="page-head welcome">
        <h1>Welcome back, {user?.name}</h1>
        <p className="muted">Your Creator League performance</p>
        {meta.data && <p className="sm"><strong>{meta.data.campaignName}</strong> <span className="muted">· {date(meta.data.campaignStart)} – {date(meta.data.campaignEnd)}</span></p>}
      </div>
      <Async q={q}>{(d) => {
        const r: Pos = d.rank.overall
        return (
          <>
            <div className="grid g4">
              <Kpi label="My Rank" icon={<Trophy size={16} />} value={r ? `#${r.rank}` : '—'} hint={r ? `of ${r.of} · live` : 'Get views on a video to enter'} />
              <Kpi label="My Total Views" icon={<Eye size={16} />} value={num(d.totals.views)} hint="Measured views across all your videos" />
              <Kpi label="My Videos" icon={<Clapperboard size={16} />} value={num(d.totals.approved)} hint={`${d.totals.pending} awaiting views`} />
              <Kpi label="Views to Next Rank" icon={<Target size={16} />}
                value={!r ? '—' : r.above ? num(r.need) : '#1'}
                hint={!r ? 'Not ranked yet' : r.above ? `more to move to Rank #${r.above.rank}` : "You're currently #1. Stay on top!"} />
            </div>
            <PerformanceSection d={d} />
            <h2 className="section">Universal leaderboard</h2>
            <Competition myCity={d.city} myName={d.name} />
          </>
        )
      }}</Async>
    </>
  )
}

export function LeaderboardPage() {
  const { user } = useAuth()
  const dash = useApi<any>(user?.role === 'tl' ? '/me/dashboard' : null)
  return (
    <>
      <PageHead title="Leaderboard" sub="Ranked by views. Ties are broken by number of videos." />
      {user?.role === 'tl' ? <Async q={dash}>{(d) => <Competition myCity={d.city} myName={d.name} />}</Async> : <Competition />}
    </>
  )
}

export function MySubmissions() {
  const q = useApi<any>('/me/dashboard')
  const meta = useApi<any>('/meta')
  const [open, setOpen] = useState(false)
  return (
    <>
      <PageHead title="My submissions" sub="Submit a video link and track its verification." />
      {open ? <Async q={meta}>{(m) => <SubmitForm meta={m} onDone={() => { setOpen(false); q.reload() }} onCancel={() => setOpen(false)} />}</Async>
        : <div><button className="btn primary" onClick={() => setOpen(true)}><Plus size={15} /> Submit a video</button></div>}
      <Async q={q}>{(d) => (
        <Card>
          <DataTable
            rows={d.videos}
            search={(r: any) => `${r.url} ${r.platform} ${r.status}`}
            initialSort={{ key: 'submittedAt', dir: -1 }}
            empty="No submissions yet"
            cols={[
              { key: 'submittedAt', label: 'Submitted', render: (r: any) => date(r.submittedAt) },
              { key: 'platform', label: 'Platform', render: (r: any) => <Badge kind={r.platform} /> },
              { key: 'url', label: 'Video', render: (r: any) => <VideoLink url={r.url} /> },
              { key: 'submittedViews', label: 'Claimed', className: 'num hide-sm', render: (r: any) => num(r.submittedViews) },
              { key: 'verifiedViews', label: 'Views', className: 'num', render: (r: any) => (r.verifiedViews == null ? <span className="muted">Not measured yet</span> : num(r.verifiedViews)) },
              { key: 'status', label: 'Status', render: (r: any) => <><Badge kind={r.status} />{r.rejectionReason && <div className="muted sm">{r.rejectionReason}</div>}</> },
            ]}
          />
        </Card>
      )}</Async>
    </>
  )
}

function SubmitForm({ meta, onDone, onCancel }: { meta: any; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ platform: meta.platforms[0] ?? '', url: '', submittedViews: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try { await api('/me/submissions', { method: 'POST', body: { ...f, submittedViews: f.submittedViews === '' ? null : Number(f.submittedViews) } }); onDone() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Card title="Submit a video">
      <form className="form inline" onSubmit={submit}>
        <label>Platform<select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{meta.platforms.map((p: string) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}</select></label>
        <label className="grow">Video link<input type="url" required placeholder={f.platform === 'youtube' ? 'https://www.youtube.com/shorts/…' : f.platform === 'facebook' ? 'https://www.facebook.com/reel/…' : 'https://www.instagram.com/reel/…'} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
        <label>Current views (optional)<input type="number" min={0} value={f.submittedViews} onChange={(e) => setF({ ...f, submittedViews: e.target.value })} /></label>
        <div className="row"><button className="btn primary" disabled={busy}>Submit</button><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button></div>
        {err && <p className="err-text">{err}</p>}
      </form>
      <p className="muted sm"><Clock size={12} /> Views are measured by the campaign team and update automatically.</p>
    </Card>
  )
}


export function Profile() {
  const q = useApi<any>('/me/profile')
  return (
    <>
      <PageHead title="My profile" />
      <Async q={q}>{(p) => (
        <Card>
          <dl className="dl">
            <dt>Name</dt><dd>{p.name}</dd>
            <dt>Employee ID</dt><dd>{p.employeeId}</dd>
            <dt>City</dt><dd>{p.city}</dd>
            <dt>Email</dt><dd>{p.email}</dd>
            <dt>Registered</dt><dd>{date(p.registeredAt)}</dd>
          </dl>
        </Card>
      )}</Async>
    </>
  )
}

// ---------- Claim rewards ----------
const CLAIM_LABEL: Record<string, string> = { claimed: 'Under review', approved: 'Approved', paid: 'Paid', rejected: 'Not approved' }

/** TL claims. The server decides eligibility from measured views; TLs see milestone names, never amounts. */
export function MyClaims() {
  const q = useApi<any[]>('/me/claims')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const claim = async (id: string) => {
    setBusy(id)
    setMsg({})
    try {
      const r = await api('/me/claims', { method: 'POST', body: { submissionId: id } })
      setMsg({ ok: `Claim sent for the ${r.milestone} milestone. The campaign team will verify your views within 7 days.` })
      q.reload()
    } catch (e: any) { setMsg({ err: e.message }) } finally { setBusy('') }
  }
  return (
    <>
      <PageHead title="Claim rewards" sub="Claim when a video reaches a view milestone. Every video can earn a reward at the highest milestone it reaches; rewards are calculated weekly and subject to the monthly cap." />
      {msg.ok && <p className="green">{msg.ok}</p>}
      {msg.err && <p className="err-text">{msg.err}</p>}
      <Async q={q}>{(rows) => (
        <Card>
          <DataTable
            rows={rows}
            empty="You haven't submitted any videos yet"
            initialSort={{ key: 'submittedAt', dir: -1 }}
            cols={[
              { key: 'submittedAt', label: 'Submitted', render: (r: any) => date(r.submittedAt) },
              { key: 'platform', label: 'Platform', render: (r: any) => <Badge kind={r.platform} /> },
              { key: 'url', label: 'Video', render: (r: any) => <VideoLink url={r.url} /> },
              { key: 'views', label: 'Views', className: 'num', render: (r: any) => (r.measured ? <strong>{num(r.views)}</strong> : <span className="muted">Not measured yet</span>) },
              { key: 'claim', label: 'Reward', render: (r: any) => <ClaimCell r={r} busy={busy === r.id} onClaim={() => claim(r.id)} /> },
            ]}
          />
        </Card>
      )}</Async>
    </>
  )
}

function ClaimCell({ r, busy, onClaim }: { r: any; busy: boolean; onClaim: () => void }) {
  const c = r.claim
  const status = c && <span className={`badge b-${c.status}`}>{CLAIM_LABEL[c.status]}</span>
  if (r.canClaim) return (
    <div className="claim-cell">
      <button className="btn sm primary" disabled={busy} onClick={onClaim}>{busy ? 'Claiming…' : `Claim ${r.milestone}${r.upgrade ? ' (upgrade)' : ''}`}</button>
      {c && c.status !== 'rejected' && <span className="muted sm">Current claim: {c.milestone} · {CLAIM_LABEL[c.status]}</span>}
      {c?.status === 'rejected' && <span className="muted sm">Last claim not approved: {c.reason}</span>}
    </div>
  )
  if (c && c.status !== 'rejected') return <div className="claim-cell">{status}<span className="sm">{c.milestone} · claimed {date(c.claimedAt)}</span></div>
  // Not eligible yet: the button is shown but locked; the server rejects early claims anyway.
  return (
    <div className="claim-cell">
      <button className="btn sm" disabled title={r.reason}><Lock size={13} /> Claim</button>
      <span className="muted sm">{r.reason}</span>
      {c?.status === 'rejected' && <span className="muted sm">{status} {c.reason}</span>}
    </div>
  )
}
