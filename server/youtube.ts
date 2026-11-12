// Keyless YouTube view counts: read the public watch page, the same page anyone sees. No API key, no Apify.
// shortcut: depends on YouTube's page layout ("videoDetails" → "viewCount"); if YouTube changes it, update youtubeViewsFromHtml.
import type { Submission } from './types'
import { videoId, type HttpFn } from './apify'

/** The view count from the video's own details block, so a related/recommended video's count can never be picked up. */
export function youtubeViewsFromHtml(html: string, id: string): number | null {
  const i = html.indexOf(`"videoDetails":{"videoId":"${id}"`)
  if (i < 0) return null
  const m = html.slice(i, i + 30000).match(/"viewCount":"(\d+)"/)
  return m ? Number(m[1]) : null
}

export function fetchYouTubeViews(subs: Submission[], http: HttpFn) {
  const views = new Map<string, number>()
  const errors: string[] = []
  // shortcut: one page per video, sequential; Apps Script allows ~6 min per run, so roughly 250+ YouTube links per night.
  for (const s of subs) {
    const id = videoId(s.url)
    if (!id) { errors.push(`${s.id}: not a recognisable YouTube link`); continue }
    try {
      const res = http(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en`, { method: 'get', headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0' }, body: '' })
      const v = res.status === 200 ? youtubeViewsFromHtml(res.text, id) : null
      if (v == null) errors.push(`${s.id}: YouTube returned no view count (private, deleted or age-restricted video)`)
      else views.set(s.id, v)
    } catch (e: any) {
      errors.push(`${s.id}: ${e.message}`)
    }
  }
  return { views, errors }
}
