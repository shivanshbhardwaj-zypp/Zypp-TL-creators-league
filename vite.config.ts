import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Dev-only preview without Google: `npm run dev:mock` answers the frontend's calls with the real Apps Script handler
 * (apps-script/api.ts) over in-memory demo data. Not part of `vite build`; real data always comes from Google Sheets.
 * Demo logins: admin / admin123 · any TL e.g. ZYP1001 / aarav.1@example.com
 */
function mockGas(): Plugin {
  return {
    name: 'mock-gas',
    apply: 'serve',
    configureServer(server) {
      if (server.config.mode !== 'mock') return
      let mem: any
      server.middlewares.use('/__mock-gas', async (req, res) => {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const { memEnv } = await server.ssrLoadModule('/apps-script/mock-env.ts')
        mem ??= memEnv(undefined, { ADMIN_PASSWORD: 'admin123' }, new Date().toISOString().slice(0, 10))
        const { path, method, body, token } = JSON.parse(raw || '{}')
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(mem.call(path, method, body, token)))
      })
    },
  }
}

export default defineConfig({ plugins: [react(), mockGas()] })
