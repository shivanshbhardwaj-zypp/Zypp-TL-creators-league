# Zypp Creator League

Campaign site for Zypp Team Leaders: a public landing page with the video entry form, a TL dashboard
(rank, universal leaderboard, reward claims) and an admin dashboard (submissions, claim verification, analytics).

There is no backend server or database: **Google Sheets** stores everything and a **Google Apps Script**
web app is the only server-side code (`apps-script/`). The frontend is a static React + Vite site.

- Setup and deployment: [GOOGLE_APPS_SCRIPT_SETUP.md](GOOGLE_APPS_SCRIPT_SETUP.md)
- Architecture, rules and security: [ANALYSIS.md](ANALYSIS.md)
- Status: [TODO.md](TODO.md)

```bash
npm install
npm run dev:mock   # preview with built-in demo data, no Google needed
npm run dev        # against the real sheet (set VITE_GAS_URL in .env, see .env.example)
npm test           # builds apps-script/Code.js and runs all tests
npm run build      # static site in dist/
```

Secrets (admin password, Apify key) live only in Apps Script → Script Properties, never in this repository.
