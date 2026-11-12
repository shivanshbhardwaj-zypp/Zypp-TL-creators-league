import test from 'node:test'
import assert from 'node:assert/strict'
import { seed } from './seed'
import { fetchViews, videoId } from './apify'

test('videoId extracts stable ids without the URL class', () => {
  assert.equal(videoId('https://www.instagram.com/reel/AbC123xyz/?igsh=q'), 'AbC123xyz')
  assert.equal(videoId('https://youtu.be/Yt_9kLm-01?si=x'), 'Yt_9kLm-01')
  assert.equal(videoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(videoId('https://www.youtube.com/shorts/Yt_9kLm-01'), 'Yt_9kLm-01')
  assert.equal(videoId('not a link'), null)
})

test('fetchViews maps actor output back to submissions and reports misses (sync, like UrlFetchApp)', () => {
  const db = seed()
  const ig = { ...db.submissions[0], id: 'a', platform: 'instagram' as const, url: 'https://www.instagram.com/reel/AbC123xyz/?igsh=q' }
  const yt = { ...db.submissions[0], id: 'b', platform: 'youtube' as const, url: 'https://youtube.com/shorts/Yt_9kLm-01' }
  const calls: string[] = []
  const http = (url: string) => {
    calls.push(url)
    const items = url.includes('instagram') ? [{ inputUrl: 'https://www.instagram.com/reel/AbC123xyz/', shortCode: 'AbC123xyz', videoPlayCount: 12345 }] : []
    return { status: 200, text: JSON.stringify(items) }
  }
  const r = fetchViews([ig, yt], 'token', http, { youtube: 'me~my-yt-actor' })
  assert.equal(calls.length, 2)
  assert.ok(calls[1].includes('me~my-yt-actor'))
  assert.equal(r.views.get('a'), 12345)
  assert.equal(r.views.has('b'), false)
  assert.equal(r.errors.length, 1)
  assert.match(fetchViews([ig], 't', () => ({ status: 402, text: 'quota' })).errors[0], /402/)
})

import { fetchYouTubeViews, youtubeViewsFromHtml } from './youtube'

test('YouTube views are read keyless from the video\'s own details block, never from a related video', () => {
  const page = '..."viewCount":"999"... "videoDetails":{"videoId":"abc123","title":"x","viewCount":"45678","author":"y"} ..."viewCount":"1"'
  assert.equal(youtubeViewsFromHtml(page, 'abc123'), 45678)
  assert.equal(youtubeViewsFromHtml(page, 'other'), null)
  const db = seed()
  const yt = { ...db.submissions[0], id: 'y1', platform: 'youtube' as const, url: 'https://youtube.com/shorts/abc123' }
  const bad = { ...yt, id: 'y2', url: 'https://youtu.be/gone' }
  const calls: string[] = []
  const r = fetchYouTubeViews([yt, bad], (url) => { calls.push(url); return url.includes('abc123') ? { status: 200, text: page } : { status: 200, text: '<html>unavailable</html>' } })
  assert.ok(calls[0].startsWith('https://www.youtube.com/watch?v=abc123'))
  assert.equal(r.views.get('y1'), 45678)
  assert.equal(r.errors.length, 1)
})
