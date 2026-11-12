# Google Sheets + Apps Script setup

The whole Creator League runs on one Google Spreadsheet and one Apps Script web app. There is no other server or database.

```
Landing page ─┐
TL dashboard ─┼─ POST {path, method, body, token} ─▶ Apps Script web app (doPost) ─▶ ZYPP CREATOR LEAGUE – MASTER DATABASE
Admin pages ──┘                                       Code.js: validation, auth, ranking, rewards, LockService
```

**Source code.**
- The complete Apps Script is **`apps-script/Code.js`**, plus the manifest **`apps-script/appsscript.json`**.
- `Code.js` is generated. Its source is `apps-script/*.ts` and `server/logic.ts`; the latter is the same ranking and reward code the tests check.
- After changing any of those files, run `npm run build:gas` and paste the new `Code.js` into Apps Script again.

**Before you deploy:** sign in to Google with the Zypp account that should own the data, for example a campaign account rather than a personal one. The web app runs as that account.

---

## 1. Create the master spreadsheet

1. Go to [sheets.new](https://sheets.new).
2. Rename it **ZYPP CREATOR LEAGUE – MASTER DATABASE**.
3. Keep sharing **Restricted**. Only the admins who edit it by hand need access. The website reaches it only through the script, so it must **not** be shared with "Anyone with the link".

## 2. Create the worksheets

You don't need to create them by hand: `setup()` in step 4 creates all six sheets with the exact headers. If you'd rather create them yourself, the headers must match exactly. Column order doesn't matter, and you may add your own extra columns, which are kept on every write.

| Sheet | Columns |
|---|---|
| TL_REGISTRATIONS | Participant ID · Name · Employee ID · Email ID · City · Registration Date · Participant Status |
| VIDEO_SUBMISSIONS | Submission ID · Participant ID · TL Name · Employee ID · City · Platform · Content Link · Submission Date · Verification Status · Submitted Views · Verified Views · Impressions · Reward Eligibility · Rejection Reason · Verification Date · Live Views · Live Views Fetched At |
| REWARDS | Reward ID · Participant ID · TL Name · Platform · Submission ID · Highest Milestone · Reward Amount · Reward Status · Reward Date |
| CAMPAIGN_SETTINGS | Setting · Value |
| LEADERBOARD | Rank · Participant ID · TL Name · City · Approved Videos · Instagram Views · YouTube Views · Facebook Views · Total Verified Views · Rewards Earned |
| SYNC_LOGS | Timestamp · Operation · Status · Error Message · Related Record ID |

"Live Views" and "Live Views Fetched At" are two extra columns on VIDEO_SUBMISSIONS. They hold the latest Apify count, which the reviewer sees before approving.

**CAMPAIGN_SETTINGS** has one row per setting (column A is the name, column B the value):

| Setting | Example value | Notes |
|---|---|---|
| Campaign Name | Zypp Creator League — TL Season 1 | Shown on the landing page |
| Campaign Status | Active | `Active` = form open. `Paused` / `Closed` = form shows "closed" |
| Start Date | 2026-11-15 | Optional. Form opens on this date |
| End Date | 2026-12-31 | Optional. Form closes after this date |
| Eligible Platforms | Instagram, YouTube | Any of Instagram, YouTube, Facebook |
| Available Cities | Delhi NCR, Bengaluru, Hyderabad | Comma-separated. The form's city list, exactly as written here |
| Reward Milestones | 25000=200; 100000=500; 500000=1500; 1000000=3000 | `views=₹amount`. Add ` (off)` after one to disable it |
| Terms and Conditions Version | v1 | Shown next to the T&C. Bump it when the T&C text changes |

**Who edits what in the sheets:**
- **Admins may edit:** Verification Status, Verified Views, Impressions and Rejection Reason, Participant Status (`Inactive` blocks a TL), Reward Status, and every CAMPAIGN_SETTINGS value.
- **Leave these to the script** (it rewrites them on every save): the ID columns, TL Name/Employee ID/City on VIDEO_SUBMISSIONS, Reward Eligibility, and the whole LEADERBOARD sheet.

## 3. Open Apps Script

In the spreadsheet, go to **Extensions → Apps Script**. This creates a script bound to this spreadsheet.

## 4. Connect the script to the spreadsheet

1. In the editor, delete everything in `Code.gs`.
2. Paste the whole of **`apps-script/Code.js`** from this project and save (Ctrl+S).
3. Show the manifest: click **Project Settings** (gear icon) and tick **Show "appsscript.json" manifest file in editor**. Back in the Editor, replace `appsscript.json` with **`apps-script/appsscript.json`** and save. This sets the time zone to Asia/Kolkata and the web app access.
4. In the toolbar's function dropdown pick **`setup`** and press **Run**. Approve the permissions (step 8). The six sheets appear with headers and default settings.
5. Fill **CAMPAIGN_SETTINGS**: dates, **Available Cities** (from your form) and platforms.
6. Optional: pick **`installTriggers`** and press **Run**. This adds:
   - a 10-minute job that re-calculates rewards and the LEADERBOARD sheet after anyone edits the sheets by hand;
   - a nightly view refresh around 2 AM (YouTube read from public pages; Instagram/Facebook via Apify if `APIFY_TOKEN` is set).

The script is bound to this spreadsheet. If you ever use a standalone script instead, add the Script Property `SPREADSHEET_ID` with the ID from the sheet's URL.

## 5. Deploy as a web app

1. Click **Deploy → New deployment**, then the gear icon → **Web app**.
2. Set:
   - **Execute as:** *Me*. The script reads and writes the sheet as you, so visitors never need access to it.
   - **Who has access:** *Anyone*. The landing page is public and TLs don't sign in with Google. Every admin and TL action is still checked by the script's own login (step 7).
3. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.

After pasting a new `Code.js` later, use **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same. Creating a *new* deployment would give a new URL.

## 6. Put the web app URL in the frontend

In the project folder:

```
cp .env.example .env
# edit .env:
VITE_GAS_URL=https://script.google.com/macros/s/XXXXXXXX/exec
npm install
npm run dev        # http://localhost:5180 against the real sheet
npm run build      # static site in dist/ — host it anywhere (Netlify, Firebase Hosting, Vercel …)
```

**Hosting the built site:**
- The host must send unknown paths (`/login`, `/me`, `/admin/…`) to `index.html`. On Netlify, add a `_redirects` file containing `/* /index.html 200`. Firebase and Vercel have the same "rewrite to index.html" setting.
- The web app URL is public by design. It is not a secret, and nothing else goes in `.env`.

To preview the UI without Google, run `npm run dev:mock`. It runs the same script logic over built-in demo data and never touches the sheet. Demo logins: `admin / admin123` and `ZYP1001 / aarav.1@example.com`.

## 7. Permissions and access control

Set these under Apps Script → **Project Settings → Script Properties**. They stay on Google's side and never reach the browser:

| Property | Required | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | **yes** | Admin login password. Use a long random one. Admin login is disabled until it's set |
| `ADMIN_USERNAME` | no (default `admin`) | Admin login name |
| `ADMIN_NAME` | no | Name shown in the logs, e.g. "Campaign Admin" |
| `APIFY_TOKEN` | for live views | Apify API token |
| (none) | — | Views refresh every night around 2 AM once you run `installTriggers`. YouTube needs no key; Instagram/Facebook need `APIFY_TOKEN` or manual entry |
| `APIFY_INSTAGRAM_ACTOR` / `APIFY_YOUTUBE_ACTOR` / `APIFY_FACEBOOK_ACTOR` | no | Swap Apify actors (`user~actor-name`) |
| `SPREADSHEET_ID` | only for a standalone script | Which spreadsheet to use |

**How access is enforced** (all inside the script, not by hiding pages):

- **Admin:** username plus `ADMIN_PASSWORD`. A successful login returns a random 64-character session token, held in the script cache for 6 hours. Every `/admin/*` operation checks it server-side.
- **TL:** Employee ID plus the email they registered with (Zypp's choice; there is no TL password). This is weaker than a password: anyone who knows a colleague's Employee ID *and* email can see that colleague's own dashboard. Nothing else is exposed.
- **TL data limits:** TL tokens get only their own data, plus a leaderboard limited to rank, name, city, approved videos and views. They never receive employee IDs, emails, links, admin notes, rejection reasons, reward amounts or settings.
- **Brute force:** 5 wrong logins for the same ID lock that ID out for 15 minutes.
- **Public form abuse protection:**
  - server-side validation of every field;
  - a hidden honeypot field for bots;
  - at most 10 submissions per Employee ID per hour, and 120 per minute overall;
  - duplicate links refused;
  - an existing Employee ID only accepted with the email it registered with.
- **Concurrency:** every write takes `LockService.getScriptLock()`, so two submissions at once can't create duplicate IDs or overwrite each other.

## 8. Authorize Google Sheets access

The first time you run `setup` (or deploy), Google asks for permission:

1. **Review permissions** → choose the owner account.
2. If you see "Google hasn't verified this app": **Advanced → Go to (project name) (unsafe)**. This is your own script.
3. **Allow**. The scopes are:
   - Sheets: read and write this spreadsheet;
   - external requests: Apify;
   - triggers: the scheduled recalculation;
   - spreadsheet UI: the "Creator League" menu.

Re-authorize the same way if Google asks again after you paste a new version.

## 9. Test registration

1. Open the site's landing page and submit the form with a test name, Employee ID and email, a city from your list, and a real public reel link. Tick the T&C box.
2. Expected:
   - **Website:** a confirmation like "Submission ID S0001 · you are now registered".
   - **TL_REGISTRATIONS:** a row `P001 … Active`.
   - **VIDEO_SUBMISSIONS:** a row `S0001 … Pending`.
   - **SYNC_LOGS:** `tl.registered` and `submission.created`.
3. Submit the **same link** again: "This video has already been submitted".
4. Submit with the same Employee ID but **another email**: refused.

## 10. Test video submission

1. On the landing page, submit a **second** link with the same Employee ID and email. The confirmation shows no "now registered", and TL_REGISTRATIONS still has one row for that TL.
2. Click **Open my dashboard** in the confirmation dialog (or **My dashboard** on the landing page → Employee ID + email). Go to **My Submissions → Submit a video** and add a third link. It appears as Pending, and a new row appears in VIDEO_SUBMISSIONS.

## 11. Test Admin Dashboard updates

1. Open **`yourdomain/admin`** (not linked from the site; bookmark it) and sign in with the `ADMIN_PASSWORD` you set.
2. **Video Submissions** → click the test row, then enter Verified views `30000` and Impressions (optional). Click **Approve**.
3. Expected in the sheet:
   - **VIDEO_SUBMISSIONS:** that row shows `Approved`, `30000`, Reward Eligibility `Yes` and today's Verification Date.
   - **REWARDS:** a row `R0001 … 25K views · 200 · Pending`.
   - **LEADERBOARD:** the TL ranked with 30000 Total Verified Views.
   - **SYNC_LOGS:** `submission.approved (…)` and `reward.unlocked`.
4. **Rewards** → **Mark paid**. REWARDS shows `Paid` with today's date.
5. Reject another video without a reason: refused. With a reason: the row shows `Rejected` plus the reason.
6. Edit a Verified Views cell directly in the sheet, then use the sheet menu **Creator League → Recalculate leaderboard & rewards**, or wait for the 10-minute trigger. LEADERBOARD and REWARDS follow.

## 12. Test TL Dashboard data retrieval

1. Sign in as the test TL. **My Dashboard** shows:
   - rank, total verified views, approved videos and views to next rank;
   - Instagram and YouTube split, and best video;
   - the universal leaderboard chart (top 3 in gold, silver and bronze);
   - "Your current position".
   There are no reward amounts.
2. Approve one more of their videos as admin. On the TL dashboard press **⟳** (top bar), or wait up to 2 minutes for the auto-refresh. The numbers update and "Updated hh:mm" changes.
3. Privacy check: in the browser's DevTools → Network, open any response from `script.google.com`. TL responses contain no other TL's email, employee ID, links or reward amounts.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "VITE_GAS_URL is not set" | Step 6, then restart `npm run dev` |
| "Could not reach the server" | Wrong URL, or the deployment isn't *Anyone*. Open the URL in a browser: it should show `{"status":200,"data":{"ok":true,…}}` |
| "Sheet … is missing. Run setup()" | Run `setup` (step 4) |
| "Admin login is not configured yet" | Add `ADMIN_PASSWORD` (step 7) |
| City list empty on the form | Fill **Available Cities** in CAMPAIGN_SETTINGS |
| "Reward Milestones: can't read …" | Use the form `25000=200; 100000=500` |
| Changes to Code.js not live | Deploy → Manage deployments → New version (step 5) |
| Errors | SYNC_LOGS rows with Status `Failed`, and Apps Script → **Executions** |

**Limits to know:**
- **Apps Script quotas:**
  - at most 30 simultaneous executions; each page load makes a few calls, and dashboards auto-refresh every 2 minutes only while the tab is visible;
  - time-driven triggers have a daily runtime cap (90 min on a free Gmail account, 6 h on Google Workspace);
  - outgoing fetches to Apify are capped per day.
  Check current numbers at developers.google.com/apps-script/guides/services/quotas.
- **Sheet size:** every call reads the whole sheet. That is fine for a few thousand submissions; beyond about 10,000 rows, move to a database.
