# TODO

Legend: [x] implemented **and** tested · [ ] not done

## Architecture: Google Sheets + Apps Script (no backend server)
- [x] Express server, JSON-file store and Google Form CSV import removed; the frontend is a static site
- [x] Apps Script handler (`apps-script/api.ts`) with all routes; shared `server/logic.ts` bundled into `apps-script/Code.js`
- [x] Six sheets with the exact headers; `setup()` creates them (idempotent); rows read by header name, admin-added columns kept (bundle test)
- [x] LockService on every write; Apify fetch outside the lock
- [x] SYNC_LOGS for every write and every unexpected error
- [x] Registration: Employee ID dedupe, email must match for existing IDs, unique P/S/R ids, duplicate-link check (tests)
- [x] Admin auth via `ADMIN_PASSWORD` Script Property + cache sessions; TL auth via Employee ID + email; 401/403 enforced (tests)
- [x] Public form protection: validation, honeypot, per-ID and global rate limits, campaign open/closed (tests)
- [x] Rewards per video at highest milestone, not cumulative; pending reward upgrades in place (tests)
- [x] LEADERBOARD sheet derived on every save; 10-minute recalc trigger + sheet menu for hand edits
- [x] Manual refresh, 2-minute auto-refresh (visible tab), "Updated hh:mm", keep last data on refresh errors
- [x] GOOGLE_APPS_SCRIPT_SETUP.md (12 steps + troubleshooting)
- [ ] **Deploy to a real spreadsheet and run setup steps 9–12** (needs the owner's Google account)
- [ ] First live Apify run with a real token: confirm actor field names and costs
- [ ] Choose a static host for `dist/` (needs SPA rewrite to index.html)

## Landing page
- [x] Wireframe layout: banner · description | form · T&C; stacks on phones (375px, no horizontal scroll)
- [x] Form: Name, Employee ID, Email ID, City (from settings), Platform, Content Link, T&C; confirmation with Submission ID; "submit another"
- [ ] **Campaign description, rewards text, steps, FAQs and T&C text** (waiting for Zypp's copy → `COPY` in src/landing.tsx)

## TL dashboard (competition view)
- [x] Welcome, 4 KPIs, cumulative performance chart, IG vs YT, best video
- [x] Universal leaderboard: chart/table toggle, gold/silver/bronze top 3, "You" highlight, tooltip, scrollable
- [x] Your current position (above / me / below with city and views)
- [x] No reward amounts anywhere for TLs (API + test)
- [x] Mobile layout (375px)
- [ ] Rank-change arrows (needs a rank history snapshot)
- [ ] "Jump to my row" for boards over 50 TLs

## Admin dashboard
- [x] Overview, Analytics, Submissions + review drawer, Participants, Cities, Rewards (+ milestones), Settings + sync log, Leaderboard
- [x] All pages load against the Apps Script handler (mock mode, no console errors)

## Later / options
- [ ] TL login hardening: emailed one-time code (MailApp) instead of Employee ID + email
- [ ] Top-up rows when a paid video later crosses a higher milestone
- [ ] Async Apify runs + webhook if links per platform exceed a few hundred
- [ ] Cache derived leaderboard if sheets grow past ~10k rows
- [ ] Automated browser E2E (Playwright)
