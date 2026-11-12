import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, Crown, ExternalLink, Inbox, Loader2, Search, TriangleAlert, X } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { COLORS, PLATFORM_LABEL, compact, inr, num, useApi } from './lib'
import type { LeaderRow } from '../server/types'

export function Card({ title, sub, action, children, className = '' }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-h">
          <div>{title && <h3>{title}</h3>}{sub && <p className="muted sm">{sub}</p>}</div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Kpi({ label, value, icon, change, spark, hint }: { label: string; value: ReactNode; icon?: ReactNode; change?: number | null; spark?: number[]; hint?: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="kpi-top"><span className="muted">{label}</span>{icon && <span className="kpi-ic">{icon}</span>}</div>
      <div className="kpi-v">{value}</div>
      <div className="kpi-foot">
        {change != null ? (
          <span className={change >= 0 ? 'up' : 'down'}>
            {change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(change).toFixed(1)}% <span className="muted">vs prev. period</span>
          </span>
        ) : <span className="muted sm">{hint ?? 'No prior period to compare'}</span>}
        {spark && spark.length > 1 && (
          <div className="spark" aria-hidden>
            <ResponsiveContainer><AreaChart data={spark.map((v, i) => ({ i, v }))}><Area dataKey="v" stroke="#00C853" fill="#00C85322" strokeWidth={1.5} isAnimationActive={false} /></AreaChart></ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

export const Stat = ({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) => (
  <div className="stat"><span className="muted sm">{label}</span><strong className={tone}>{value}</strong></div>
)

const STATUS_LABEL: Record<string, string> = { active: 'Active', rejected: 'Disqualified', claimed: 'To verify', approved: 'Approved', paid: 'Paid' }
export const Badge = ({ kind }: { kind: string }) => <span className={`badge b-${kind}`}>{PLATFORM_LABEL[kind] ?? STATUS_LABEL[kind] ?? kind}</span>
export const PlatformDot = ({ p }: { p: string }) => <span className="pdot"><i style={{ background: COLORS[p as keyof typeof COLORS] }} />{PLATFORM_LABEL[p]}</span>
export const VideoLink = ({ url }: { url: string }) => (
  <a href={url} target="_blank" rel="noreferrer noopener" className="link" onClick={(e) => e.stopPropagation()}>Open <ExternalLink size={12} /></a>
)

export const Loading = () => <div className="state"><Loader2 className="spin" size={20} /> Loading…</div>
export const ErrorBox = ({ msg, retry }: { msg: string; retry?: () => void }) => (
  <div className="state err"><TriangleAlert size={18} /> {msg} {retry && <button className="btn sm" onClick={retry}>Retry</button>}</div>
)
export const Empty = ({ msg = 'Nothing here yet' }: { msg?: string }) => <div className="state"><Inbox size={18} /> {msg}</div>

/** Renders loading / error / content for a useApi result. */
export function Async<T>({ q, children }: { q: { data?: T; error?: string; loading: boolean; reload: () => void }; children: (d: T) => ReactNode }) {
  if (q.error && q.data === undefined) return <ErrorBox msg={q.error} retry={q.reload} />
  if (q.data === undefined) return <Loading />
  // A failed background refresh keeps the last good data on screen, with a note.
  return <>{q.error && <p className="err-text sm">Couldn't refresh: {q.error}</p>}{children(q.data)}</>
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <header className="card-h"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        {children}
      </aside>
    </div>
  )
}

// ---------- Data table: search, sort, paginate (client-side) ----------
export interface Col<T> { key: string; label: string; render?: (r: T) => ReactNode; sort?: (r: T) => string | number; className?: string }
// shortcut: client-side paging is fine for a few thousand rows, move to server paging beyond that.
export function DataTable<T extends { id?: string }>({ rows, cols, search, pageSize = 10, onRow, empty, initialSort, rowClass, searchPlaceholder }: {
  rows: T[]; cols: Col<T>[]; search?: (r: T) => string; pageSize?: number; onRow?: (r: T) => void; empty?: string; initialSort?: { key: string; dir: 1 | -1 }
  rowClass?: (r: T) => string; searchPlaceholder?: string
}) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(0)
  const view = useMemo(() => {
    let xs = search && q ? rows.filter((r) => search(r).toLowerCase().includes(q.toLowerCase())) : rows
    const col = sort && cols.find((c) => c.key === sort.key)
    if (col) {
      const f = col.sort ?? ((r: any) => r[col.key] ?? -1)
      xs = [...xs].sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * sort!.dir })
    }
    return xs
  }, [rows, q, sort, cols, search])
  const pages = Math.max(1, Math.ceil(view.length / pageSize))
  const p = Math.min(page, pages - 1)
  return (
    <div>
      {search && (
        <label className="search"><Search size={15} /><input placeholder={searchPlaceholder ?? 'Search name, ID, link…'}value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} /></label>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr>{cols.map((c) => (
            <th key={c.key} className={c.className} onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === -1 ? 1 : -1 }))} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
              {c.label}{sort?.key === c.key && (sort.dir === 1 ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
            </th>
          ))}</tr></thead>
          <tbody>
            {view.slice(p * pageSize, (p + 1) * pageSize).map((r, i) => (
              <tr key={r.id ?? i} onClick={onRow && (() => onRow(r))} className={`${onRow ? 'clickable' : ''} ${rowClass?.(r) ?? ''}`}>
                {cols.map((c) => <td key={c.key} className={c.className}>{c.render ? c.render(r) : (r as any)[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!view.length && <Empty msg={empty ?? (q ? 'No matches for your search' : 'No records')} />}
      </div>
      {view.length > pageSize && (
        <div className="pager">
          <span className="muted sm">{p * pageSize + 1}–{Math.min(view.length, (p + 1) * pageSize)} of {view.length}</span>
          <button className="btn sm" disabled={p === 0} onClick={() => setPage(p - 1)}>Prev</button>
          <button className="btn sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}

// ---------- Global filters (kept in the URL so they persist across Overview / Analytics) ----------
const FILTER_KEYS = ['from', 'to', 'city', 'platform', 'status']
export function useFilterQuery() {
  const [sp] = useSearchParams()
  const q = new URLSearchParams(FILTER_KEYS.filter((k) => sp.get(k)).map((k) => [k, sp.get(k)!])).toString()
  return q ? `?${q}` : ''
}

export function FilterBar() {
  const [sp, setSp] = useSearchParams()
  const meta = useApi('/meta')
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }) }
  const sel = (k: string, label: string, opts: [string, string][]) => (
    <select value={sp.get(k) ?? ''} onChange={(e) => set(k, e.target.value)} aria-label={label}>
      <option value="">{label}</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
  const m = meta.data
  return (
    <div className="filters">
      <label className="date">From <input type="date" value={sp.get('from') ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
      <label className="date">To <input type="date" value={sp.get('to') ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
      {sel('city', 'All cities', (m?.cities ?? []).map((c: string) => [c, c]))}
      {sel('platform', 'All platforms', (m?.platforms ?? []).map((p: string) => [p, PLATFORM_LABEL[p]]))}
      {sel('status', 'All statuses', [['active', 'Active'], ['rejected', 'Disqualified']])}
      {FILTER_KEYS.some((k) => sp.get(k)) && <button className="btn ghost sm" onClick={() => setSp(new URLSearchParams(), { replace: true })}>Clear</button>}
    </div>
  )
}

// ---------- Leaderboard ----------
/** Public leaderboard row (what TLs receive). Admin rows add platforms/rewards/participantId. */
export type BoardRow = { rank: number; name: string; city: string; entries: number; views: number; isMe?: boolean } & Partial<Pick<LeaderRow, 'participantId' | 'platforms' | 'rewards'>>
const MEDAL = ['Gold', 'Silver', 'Bronze']

export function Podium({ rows }: { rows: BoardRow[] }) {
  if (!rows.length) return null
  return (
    <div className="podium">
      {rows.slice(0, 3).map((r, i) => (
        <div key={i} className={`pod pod-${Math.min(r.rank, 3)} ${r.isMe ? 'pod-me' : ''}`}>
          <span className="pod-rank">{r.rank === 1 ? <Crown size={16} aria-label="First place" /> : `#${r.rank}`}</span>
          <span className="muted sm">{MEDAL[Math.min(r.rank, 3) - 1]}</span>
          <strong>{r.name}{r.isMe && <span className="you">You</span>}</strong>
          <span className="muted sm">{r.city}</span>
          <span className="pod-v">{num(r.views)} <span className="muted sm">views</span></span>
          <span className="muted sm">{r.entries} video{r.entries === 1 ? '' : 's'}</span>
        </div>
      ))}
    </div>
  )
}

// shortcut: 50 rows/page keeps the viewer's own row on page 1 for boards up to 50 TLs; add jump-to-my-row beyond that.
export function LeaderTable({ rows, pageSize = 50 }: { rows: BoardRow[]; pageSize?: number }) {
  const admin = rows.some((r) => r.rewards !== undefined)
  const data = rows.map((r, i) => ({ ...r, id: String(i) }))
  const cols: Col<BoardRow & { id: string }>[] = [
    { key: 'rank', label: 'Rank', render: (r) => <span className={`rank ${r.rank <= 3 ? `r${r.rank}` : ''}`}>{r.rank}</span> },
    { key: 'name', label: 'TL Name', render: (r) => <span className={r.isMe || r.rank <= 3 ? 'strong' : ''}>{r.name}{r.isMe && <span className="you">You</span>}</span> },
    { key: 'city', label: 'City' },
    { key: 'entries', label: 'Videos', className: 'num hide-sm' },
    { key: 'views', label: 'Views', className: 'num', render: (r) => <strong>{num(r.views)}</strong> },
  ]
  if (admin) cols.push(
    { key: 'platforms', label: 'Platform', sort: (r) => (r.platforms ?? []).join(), render: (r) => (r.platforms?.length ? r.platforms.map((p) => <Badge key={p} kind={p} />) : <span className="muted">—</span>) },
    { key: 'rewards', label: 'Rewards', className: 'num', render: (r) => inr(r.rewards ?? 0) },
  )
  return (
    <DataTable
      rows={data}
      pageSize={pageSize}
      search={(r) => r.name}
      searchPlaceholder="Search TL name…"
      empty="No participants on this board yet"
      rowClass={(r) => `${r.isMe ? 'mine' : ''} ${r.rank <= 3 ? `top${r.rank}` : ''}`}
      cols={cols}
    />
  )
}
