import { defineConfig, type Plugin } from 'vite'
import { createHash } from 'node:crypto'

// ─── Rapier WASM out of the JS bundle ─────────────────────────────────────────
// @dimforge/rapier3d-compat inlines its ~3 MB WebAssembly binary as a 4.1 MB
// base64 string (80 % of the bundle) and decodes it at init.  This plugin cuts
// that string out of the module and serves the bytes as a real, content-hashed
// .wasm file instead: it downloads compressed, compiles while streaming
// (wasm-bindgen's init uses instantiateStreaming for URLs), caches immutably,
// and the JS bundle no longer has to parse a 4 MB string.  Same package, same
// API — only the argument to its internal init changes.
const RAPIER_ID = /@dimforge[\\/]rapier3d-compat[\\/]dist[\\/]rapier\.mjs$/
const DEV_URL   = '/@rapier/rapier3d.wasm'

function rapierWasm(): Plugin {
  let isBuild = false
  let devBytes: Buffer | null = null
  return {
    name: 'nolegs:rapier-wasm',
    enforce: 'pre',
    configResolved(c) { isBuild = c.command === 'build' },
    transform(code, id) {
      if (!RAPIER_ID.test(id.split('?')[0])) return null   // dev ids carry ?v=hash
      // init is  …({module_or_path: <decoder>.toByteArray("<base64>").buffer})
      const m = /\{module_or_path:([A-Za-z_$][\w$]*)\.toByteArray\("([A-Za-z0-9+/=]{100000,})"\)\.buffer\}/.exec(code)
      if (!m) { this.warn('rapier-wasm: inline wasm not found — leaving the module as-is'); return null }
      const bytes = Buffer.from(m[2], 'base64')
      let url = DEV_URL
      if (isBuild) {
        const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10)
        const fileName = `assets/rapier3d-${hash}.wasm`
        this.emitFile({ type: 'asset', fileName, source: bytes })
        url = `/${fileName}`
      } else {
        devBytes = bytes
      }
      const replacement = `{module_or_path:new URL(${JSON.stringify(url)}, self.location.origin)}`
      return { code: code.slice(0, m.index) + replacement + code.slice(m.index + m[0].length), map: null }
    },
    configureServer(server) {
      server.middlewares.use(DEV_URL, (_req, res) => {
        if (!devBytes) { res.statusCode = 503; res.end(); return }
        res.setHeader('Content-Type', 'application/wasm')
        res.end(devBytes)
      })
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [rapierWasm()],
  // Pre-bundled deps skip plugin transforms — let Rapier go through the plugin in dev too
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 3000
  }
})
