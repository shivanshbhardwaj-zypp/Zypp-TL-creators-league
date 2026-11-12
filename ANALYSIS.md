# Zypp Creator League — Analysis & Architecture

## Run it

```
npm install
npm run dev:mock   # http://localhost:5180 — UI over built-in demo data, no Google needed
npm run dev        # http://localhost:5180 — against the real sheet (needs VITE_GAS_URL in .env)
npm test           # builds apps-script/Code.js, then runs every test (logic, handler, bundled script)
npm run build      # static site in dist/
npm run build:gas  # regenerate apps-script/Code.js to paste into Apps Script
```

Deployment and sheet setup: **GOOGLE_APPS_SCRIPT_SETUP.md**.

Mock-mode logins: **admin / admin123** · any TL, e.g. **ZYP1001 / aarav.1@example.com**. Real logins:
- **Admin:** username plus `ADMIN_PASSWORD` from Script Properties.
- **TL:** Employee ID plus registered email.

## Architecture: Google Sheets + Apps Script only

```
Static React site (any host)                 Google Apps Script web app              Google Sheets
  /            public landing + entry form ─┐   doPost(e)                              ZYPP CREATOR LEAGUE – MASTER DATABASE
  /login       TL / Admin sign-in           ├─▶  handle(): auth, validation, routes ─▶  TL_REGISTRATIONS · VIDEO_SUBMISSIONS
  /me …        TL dashboard                 │   server/logic.ts: ranking, rewards      REWARDS · CAMPAIGN_SETTINGS
  /admin …     admin dashboard             ─┘   LockService on every write             LEADERBOARD (derived) · SYNC_LOGS
```

There is no Node server, Express, JSON file or other database. The **only** server-side code is the Apps Script. The frontend sends every call as one `POST text/plain {path, method, body, token}`. `text/plain` keeps it a simple request with no CORS preflight, which Apps Script can't answer. The reply is `{status, data}`.

```
apps-script/
  api.ts         the request handler: routes, auth, validation, rate limits, Apify refresh (platform-free)
  schema.ts      sheet names + exact headers, row ↔ record mapping (by header name), milestone text format
  main.ts        Apps Script glue: SpreadsheetApp / CacheService / LockService / UrlFetchApp, doPost, setup, triggers, menu
  build.mjs      esbuild → Code.js (one file to paste), exposes doPost/setup/... as globals
  Code.js        GENERATED — the complete Apps Script source
  appsscript.json  manifest (Asia/Kolkata, V8, web app access, scopes)
  mock-env.ts    in-memory sheets for tests and `npm run dev:mock`
  api.test.ts    handler end to end over in-memory sheet tables
  bundle.test.ts the built Code.js against a fake SpreadsheetApp (setup, header reads, admin columns kept, Date cells)
server/          (name kept; shared code, not a server)
  logic.ts       ALL calculations: filters, totals, ranking, rewards, weekly series, TL dashboard
  types.ts       data model mirroring the sheets
  apify.ts       live view counts via Apify (synchronous, for UrlFetchApp)
  seed.ts        deterministic test fixture
src/
  lib.ts       api() → Apps Script, useApi (+ refresh events, last-updated), formatters
  landing.tsx  public campaign page: banner · description | form · T&C (wireframe)
  main.tsx     routing, role-based sidebar, login (TL / Admin tabs), refresh control
  ui.tsx, admin.tsx, tl.tsx   existing dashboards, reused
```

**Single source of truth.** Every number comes from `server/logic.ts`, and the same file runs inside Apps Script. So the landing page, the TL dashboard, the admin dashboard and the LEADERBOARD sheet can't disagree. Totals are never stored as inputs: LEADERBOARD and Reward Eligibility are written *from* the calculation on every save.

## Key rules

- **Counted views** = Verified Views of `Approved` submissions only. Pending and rejected count as 0 everywhere.
- **Ranking**: verified views descending, then approved videos descending. A full tie shares the rank. A TL appears on a board once they have at least one submission (on that platform, for platform boards).
- **Rewards (per video, highest milestone, not cumulative)**:
  - Each approved video gets one REWARDS row at the highest active milestone its verified views reach. With the defaults 25K=₹200, 100K=₹500, 500K=₹1,500 and 1M=₹3,000, a 120,000-view video earns ₹500, not ₹700.
  - A *pending* reward moves up in place when the video crosses a higher milestone.
  - A *paid* reward is never changed. There is no top-up or clawback yet (TODO).
  - Sync is idempotent: re-running never duplicates.
- **Registration**: Employee ID identifies a TL (case-insensitive). The first submission creates the TL; later ones reuse it. An existing Employee ID is accepted only with the email it registered with.
- **Duplicates**: a canonical link key (host without www/m, path without trailing slash, plus YouTube `v=`) blocks the same video being submitted twice with different share parameters.
- **Campaign open** = Campaign Status `Active` and today within Start/End Date (if set). Otherwise both forms refuse submissions.
- **Previous-period change** on admin KPIs appears only when a date range is set *and* the previous window has data.

## Security / roles (enforced in Apps Script)

| | Public | TL | Admin |
|---|---|---|---|
| How | — | Employee ID + registered email | `ADMIN_USERNAME` + `ADMIN_PASSWORD` (Script Properties) |
| Session | — | random 64-hex token in CacheService, 6 h | same |
| Reads | campaign name/dates/status, cities, platforms, T&C version | own dashboard/profile/submissions; leaderboard as `rank, name, city, entries, views` only | everything |
| Writes | landing form (register + submit) | own submissions | approve/reject/views/impressions, rewards paid, milestones, settings, Apify refresh |

- TL tokens never receive other TLs' employee IDs, emails, links, rejection reasons or reward amounts, nor any milestones/amounts at all, nor settings or analytics. A unit test asserts the public row's exact key set and that TL payloads contain no amounts.
- Brute force: 5 failed logins per ID give a 15-minute lockout.
- Public form protection:
  - full server-side validation;
  - a honeypot field;
  - 10 submissions per Employee ID per hour, and 120 per minute globally;
  - duplicate-link check.
- Writes hold `LockService.getScriptLock()`. The Apify fetch runs *outside* the lock and only the short write is locked, so registrations aren't blocked while Apify runs.
- Unexpected errors return JSON and are appended to SYNC_LOGS as `Failed`.
- No credential is in the frontend. `VITE_GAS_URL` is a public endpoint. The spreadsheet stays private (the script runs as the owner).
- **Known weakness, by Zypp's choice:** TL login has no password. Anyone knowing a colleague's Employee ID *and* email can open that colleague's own dashboard. Options to harden it are an emailed one-time code (MailApp) or a password column.

## Sync & refresh

- Google Sheets is the only store. Every request reads the sheets fresh, so all three modules always agree.
- Dashboards have a **⟳ refresh** button and **auto-refresh every 2 minutes** while the tab is visible, and show **"Updated hh:mm"**.
- A failed background refresh keeps the last good data on screen with a note. A failed first load shows an error with Retry.
- **Hand edits in the sheet** (e.g. an admin types Verified Views):
  - The dashboards see them on their next read.
  - REWARDS and LEADERBOARD catch up on the next write, via the sheet menu **Creator League → Recalculate**, or within 10 minutes via the `installTriggers` job.

## Landing page

Layout from the wireframe: campaign banner; description (left) and form (right); T&C across the bottom. On phones it stacks in that order.
- **Form fields:** Name, Employee ID, Email ID, City (from CAMPAIGN_SETTINGS), Content Platform (eligible platforms), Content Link, T&C acceptance.
- **After submitting:** a confirmation with the Submission ID and "Submit another video".
- **The campaign description, rewards text, steps, FAQs and T&C text are placeholders.** The text isn't in this project yet; drop it into `COPY` at the top of `src/landing.tsx`.

## Apify (live view counts)

| Platform | Default actor | View field read |
|---|---|---|
| Instagram Reels | `apify/instagram-scraper` (directUrls) | `videoPlayCount` → `videoViewCount` |
| YouTube / Shorts | `streamers/youtube-scraper` | `viewCount` |
| Facebook Reels | `apify/facebook-posts-scraper` | `viewCount` / `playCount` (unverified) |

- **How a refresh works:**
  1. Admin presses **Fetch live views**, or the optional `REFRESH_HOURS` trigger fires.
  2. Every non-rejected link gets a Live Views count.
  3. Approved videos get Verified Views updated, and rank and rewards follow.
  4. Pending videos show the count pre-filled in the review panel.
- **Status:** not yet run against real Apify. Only the mapping is unit-tested.

## Known shortcuts

| Shortcut | Upgrade when |
|---|---|
| Each request reads whole sheets | beyond about 10k submissions, or when pages get slow: cache the derived leaderboard in CacheService, or move to a database |
| Each save rewrites the data rows of the sheets it owns | fine at campaign scale. Row-level writes once sheets get large |
| Paid rewards are never topped up when a video later crosses a higher milestone | add a top-up row if Zypp wants that |
| Apify via the synchronous endpoint (≈5 min cap, 6 min Apps Script cap) | async runs + webhook beyond a few hundred links per platform |
| TL login without a password | emailed one-time code if dashboards must be strictly private |

## Assumptions

- Rewards are per video (REWARDS has Submission ID and Platform columns, and VIDEO_SUBMISSIONS has Reward Eligibility). "Highest milestone, not cumulative" is applied per video.
- Reward Eligibility is computed (approved, and views ≥ the lowest active milestone) rather than edited by hand, so it can't drift from the rule.
- The old "campaign / ad name" field is gone, because neither the new form nor the sheets have it.
- Views are attributed to the date the video was submitted.
