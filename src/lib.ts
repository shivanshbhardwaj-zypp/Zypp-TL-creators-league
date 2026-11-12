import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type User = { role: 'admin' | 'tl'; id: string; name: string }
export const AuthCtx = createContext<{ user: User | null; login: (u: string, p: string) => Promise<void>; logout: () => void }>(null!)
export const useAuth = () => useContext(AuthCtx)

const read = () => { try { return localStorage.getItem('zcl_token') } catch { return null } }
let token = read()
export function setToken(t: string | null) {
  token = t
  try { t ? localStorage.setItem('zcl_token', t) : localStorage.removeItem('zcl_token') } catch { /* storage blocked: session-only */ }
}
export const hasToken = () => !!token

// The only server is the Google Apps Script web app. Its URL is public by design; secrets stay in Script Properties.
const GAS_URL = import.meta.env.VITE_GAS_URL as string | undefined

/** Every call is one POST {path, method, body, token} → {status, data}. text/plain keeps it a "simple" request (no CORS preflight, which Apps Script can't answer). */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!GAS_URL) throw new Error('VITE_GAS_URL is not set. Add the Apps Script web app URL to .env (see GOOGLE_APPS_SCRIPT_SETUP.md).')
  let out: { status: number; data: any }
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ path, method: opts.method ?? 'GET', body: opts.body, token }),
    })
    out = await res.json()
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }
  if (out.status === 401 && path !== '/login') { setToken(null); window.dispatchEvent(new Event('zcl:logout')) }
  if (out.status >= 400) throw new Error(out.data?.error ?? `Request failed (${out.status})`)
  return out.data
}

/** Ask every mounted useApi to reload (manual refresh button + auto-refresh timer). */
export const refreshAll = () => window.dispatchEvent(new Event('zcl:refresh'))
let lastUpdated: Date | null = null
export const getLastUpdated = () => lastUpdated

export function useApi<T = any>(path: string | null) {
  const [state, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const load = useCallback(() => {
    if (!path) return
    set((s) => ({ ...s, loading: true }))
    api<T>(path).then((data) => {
      lastUpdated = new Date()
      window.dispatchEvent(new Event('zcl:updated'))
      set({ data, loading: false })
    }, (e) => set((s) => ({ ...s, error: e.message, loading: false })))
  }, [path])
  useEffect(load, [load])
  useEffect(() => {
    window.addEventListener('zcl:refresh', load)
    return () => window.removeEventListener('zcl:refresh', load)
  }, [load])
  return { ...state, reload: load }
}

const nf = new Intl.NumberFormat('en-IN')
const cf = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 })
export const num = (n: number | null | undefined) => (n == null ? '—' : nf.format(n))
export const compact = (n: number | null | undefined) => (n == null ? '—' : cf.format(n))
export const inr = (n: number) => '₹' + nf.format(n)
export const date = (d?: string) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
export const shortWeek = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
export const pct = (cur: number, prev?: number | null) => (prev ? ((cur - prev) / prev) * 100 : null)

export const COLORS = { instagram: '#00A846', youtube: '#2F3B35', facebook: '#1877F2', approved: '#00A846', pending: '#E8A317', rejected: '#D9444B' } as const
export const PLATFORM_LABEL: Record<string, string> = { instagram: 'Instagram', youtube: 'YouTube', facebook: 'Facebook' }
