# Zypp Creator League

Campaign site for Zypp Team Leaders: a public landing page with the video entry form, a TL dashboard
(rank, universal leaderboard, reward claims) and an admin dashboard (submissions, claim verification, analytics).

There is no backend server or database: **Google Sheets** stores everything and a **Google Apps Script**
web app is the only server-side code (`apps-script/`). The frontend is a static React + Vite site.

- Setup and deployment: [GOOGLE_APPS_SCRIPT_SETUP.md](GOOGLE_APPS_SCRIPT_SETUP.md)
- Architecture, rules and security: [ANALYSIS.md](ANALYSIS.md)
- Status: [TODO.md](TODO.md)

## Run it

**Real data (what you want):** the site needs the link to the Google Apps Script web app. It is not in this repository (`.env` is never committed).

```bash
npm install
cp .env.example .env    # then set VITE_GAS_URL to the Apps Script web app link
npm run dev             # http://localhost:5180, live data from the Google Sheet
```

Without `VITE_GAS_URL` the site shows a "not connected" setup screen instead of data.

```bash
npm test           # builds apps-script/Code.js and runs all tests (test-only sample records, never shown by the site)
npm run build      # static site in dist/
```

Secrets (admin password, Apify key) live only in Apps Script → Script Properties, never in this repository.
