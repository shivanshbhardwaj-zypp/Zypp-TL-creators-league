// Pulls live view counts for submitted video links via Apify actors (one batch run per platform).
// Runs inside Apps Script: synchronous HTTP (UrlFetchApp) and no URL class, so ids are parsed with regexes.
// The token lives in Script Properties (APIFY_TOKEN) and is never sent to the browser.
import type { Platform, Submission } from './types'

export type HttpFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => { status: number; text: string }
export type Actors = Partial<Record<Platform, string>>

// Actor IDs are swappable via Script Properties: actor output fields differ, so we read every common name.
const DEFAULT_ACTORS: Record<Platform, string> = { instagram: 'apify~instagram-scraper', youtube: 'streamers~youtube-scraper', facebook: 'apify~facebook-posts-scraper' }

const inputFor = (p: Platform, urls: string[]) => ({
  instagram: { directUrls: urls, resultsType: 'posts', resultsLimit: 1, addParentData: false },
  youtube: { startUrls: urls.map((url) => ({ url })), maxResults: 1, maxResultsShorts: 1, maxResultStreams: 0 },
  facebook: { startUrls: urls.map((url) => ({ url })), resultsLimit: 1 },
})[p]

/** Stable per-video id used to match actor output back to a submission: IG shortcode, YT video id, FB video id/path. */
export function videoId(url: string): string | null {
  const m = url.trim().match(/^[a-z]+:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i)
  if (!m) return null
  const [, host, path, query = ''] = m
  const v = query.match(/[?&]v=([^&]+)/)
  if (v) return v[1]
  if (/youtu\.be$/i.test(host)) return path.slice(1).split('/')[0] || null
  const id = path.match(/\/(?:reel|reels|p|shorts|videos|watch|live)\/([\w-]+)/)
  return id ? id[1] : path.replace(/\/+$/, '') || null
}

const first = (it: any, keys: string[]) => keys.map((k) => it?.[k]).find((x) => typeof x === 'number' && Number.isFinite(x)) ?? null
// Instagram's public "views" for reels is the play count; fall back through the other names actors use.
export const viewsOf = (it: any) => first(it, ['videoPlayCount', 'playCount', 'videoViewCount', 'viewCount', 'views', 'video_view_count'])

export function fetchViews(subs: Submission[], token: string, http: HttpFn, actors: Actors = {}) {
  const views = new Map<string, number>()
  const errors: string[] = []
  for (const p of ['instagram', 'youtube', 'facebook'] as Platform[]) {
    const xs = subs.filter((s) => s.platform === p)
    if (!xs.length) continue
    try {
      // shortcut: sync endpoint caps at ~5 min per run (and Apps Script at 6 min per call); switch to async runs beyond a few hundred links per platform.
      const res = http(`https://api.apify.com/v2/acts/${actors[p] || DEFAULT_ACTORS[p]}/run-sync-get-dataset-items?timeout=290`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(inputFor(p, xs.map((s) => s.url))),
      })
      if (res.status < 200 || res.status >= 300) { errors.push(`${p}: Apify returned ${res.status} ${res.text.slice(0, 160)}`); continue }
      const items: any[] = JSON.parse(res.text)
      const byId = new Map<string, any>()
      for (const it of items) {
        for (const u of [it.url, it.inputUrl, it.postUrl, it.facebookUrl, it.topLevelUrl]) {
          const id = typeof u === 'string' ? videoId(u) : null
          if (id) byId.set(id, it)
        }
        for (const id of [it.shortCode, it.id, it.videoId, it.postId]) if (id) byId.set(String(id), it)
      }
      for (const s of xs) {
        const it = byId.get(videoId(s.url) ?? '')
        const v = it ? viewsOf(it) : null
        if (v == null) errors.push(`${s.id}: no view count returned (private, deleted or unsupported link)`)
        else views.set(s.id, v)
      }
    } catch (e: any) {
      errors.push(`${p}: ${e.message}`)
    }
  }
  return { views, errors }
}
