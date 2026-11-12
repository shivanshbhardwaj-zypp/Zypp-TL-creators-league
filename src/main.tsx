import { StrictMode, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { BarChart3, Cog, Film, Gift, LayoutDashboard, LogOut, MapPin, Menu, RefreshCw, Trophy, User as UserIcon, Users, Zap } from 'lucide-react'
import { AuthCtx, api, getLastUpdated, hasToken, refreshAll, setToken, useApi, useAuth, type User } from './lib'
import { Loading } from './ui'
import { Analytics, Cities, Overview, Participants, Rewards, SettingsPage, Submissions } from './admin'
import { LeaderboardPage, MyClaims, MyDashboard, MySubmissions, Profile } from './tl'
import { Landing } from './landing'
import './styles.css'

const NAV = {
  admin: [
    ['/admin', 'Overview', LayoutDashboard], ['/leaderboard', 'Leaderboard', Trophy], ['/admin/submissions', 'Video Submissions', Film],
    ['/admin/participants', 'Participants', Users], ['/admin/cities', 'City Performance', MapPin], ['/admin/rewards', 'Claims & Rewards', Gift],
    ['/admin/analytics', 'Analytics', BarChart3], ['/admin/settings', 'Settings', Cog],
  ],
  tl: [
    ['/me', 'My Dashboard', LayoutDashboard], ['/me/submissions', 'My Submissions', Film], ['/me/claims', 'Claim Rewards', Gift], ['/leaderboard', 'Leaderboard', Trophy],
    ['/me/profile', 'My Profile', UserIcon],
  ],
} as const

const AUTO_REFRESH_MS = 2 * 60_000 // each refresh reads the sheet via Apps Script; 2 min keeps quota use low

/** Manual refresh + auto-refresh while the tab is visible + "Updated hh:mm". */
function RefreshControl() {
  const [, rerender] = useState(0)
  useEffect(() => {
    const on = () => rerender((x) => x + 1)
    window.addEventListener('zcl:updated', on)
    const t = setInterval(() => { if (document.visibilityState === 'visible') refreshAll() }, AUTO_REFRESH_MS)
    return () => { window.removeEventListener('zcl:updated', on); clearInterval(t) }
  }, [])
  const at = getLastUpdated()
  return (
    <span className="refresh">
      {at && <span className="muted sm">Updated {at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
      <button className="icon-btn" onClick={refreshAll} aria-label="Refresh data" title="Refresh data"><RefreshCw size={16} /></button>
    </span>
  )
}

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const meta = useApi<any>('/meta')
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand"><span className="logo"><Zap size={16} /></span><div><strong>Creator League</strong><span className="muted sm">Zypp Electric</span></div></div>
        <nav>
          {NAV[user!.role].map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/admin' || to === '/me'}><Icon size={17} /> {label}</NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who"><strong>{user!.name}</strong><span className="muted sm">{user!.role === 'admin' ? 'Administrator' : 'Team Leader'}</span></div>
          <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="top">
          <button className="icon-btn menu" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <span className="campaign">{meta.data?.campaignName ?? 'Zypp Creator League'}</span>
          {meta.data?.campaignStatus?.toLowerCase() === 'active' && <span className="live"><i /> Live campaign</span>}
          <RefreshControl />
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}

/** TL sign-in at /login. Admins use /admin/login, which nothing links to (access is still enforced by the Apps Script). */
function Login({ admin = false }: { admin?: boolean }) {
  const { login } = useAuth()
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try { await login(u, p) } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  const tl = !admin
  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand"><span className="logo"><Zap size={16} /></span><div><strong>Zypp Creator League</strong><span className="muted sm">{tl ? 'Sign in to your dashboard' : 'Campaign admin'}</span></div></div>
        <label>{tl ? 'Employee ID' : 'Admin username'}<input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" required /></label>
        <label>{tl ? 'Registered email ID' : 'Password'}<input type={tl ? 'email' : 'password'} value={p} onChange={(e) => setP(e.target.value)} autoComplete={tl ? 'email' : 'current-password'} required /></label>
        {tl && <p className="muted sm">Use the Employee ID and email you entered when you submitted your first video.</p>}
        {err && <p className="err-text">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {tl && <Link to="/" className="link sm">← Back to the campaign page</Link>}
      </form>
    </div>
  )
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(!hasToken())
  useEffect(() => {
    if (hasToken()) api<User>('/me').then(setUser, () => setToken(null)).finally(() => setReady(true))
    const out = () => setUser(null)
    window.addEventListener('zcl:logout', out)
    return () => window.removeEventListener('zcl:logout', out)
  }, [])
  const ctx = {
    user,
    login: async (username: string, password: string) => {
      const r = await api<{ token: string; user: User }>('/login', { method: 'POST', body: { username, password } })
      setToken(r.token)
      setUser(r.user)
    },
    logout: () => { api('/logout', { method: 'POST' }).catch(() => {}).finally(() => setToken(null)); setUser(null) },
  }
  if (!ready) return <Loading />
  return (
    <AuthCtx.Provider value={ctx}>
      {!user ? (
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin/*" element={<Login admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Shell>
          <Routes>
            {user.role === 'admin' ? (
              <>
                <Route path="/admin" element={<Overview />} />
                <Route path="/admin/submissions" element={<Submissions />} />
                <Route path="/admin/participants" element={<Participants />} />
                <Route path="/admin/cities" element={<Cities />} />
                <Route path="/admin/cities/:city" element={<Cities />} />
                <Route path="/admin/rewards" element={<Rewards />} />
                <Route path="/admin/analytics" element={<Analytics />} />
                <Route path="/admin/settings" element={<SettingsPage />} />
              </>
            ) : (
              <>
                <Route path="/me" element={<MyDashboard />} />
                <Route path="/me/submissions" element={<MySubmissions />} />
                <Route path="/me/claims" element={<MyClaims />} />
                <Route path="/me/profile" element={<Profile />} />
              </>
            )}
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="*" element={<Navigate to={user.role === 'admin' ? '/admin' : '/me'} replace />} />
          </Routes>
        </Shell>
      )}
    </AuthCtx.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)
