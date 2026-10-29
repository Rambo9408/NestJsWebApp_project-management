/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { visualizer } from 'rollup-plugin-visualizer';

/**
 * =============================================================================
 * VITE CONFIGURATION
 * =============================================================================
 * ANGULAR BRIDGE: this file is `angular.json` + `proxy.conf.json` + part of
 * `karma.conf.js`, collapsed into one typed module. Vite's philosophy is the
 * opposite of the Angular CLI's: almost nothing is generated or hidden, so
 * everything the build does is visible here.
 * =============================================================================
 */
export default defineConfig({
  plugins: [
    react(),
    /**
     * THE BUNDLE ANALYSER IS OPT-IN, and the reason is a bug this project
     * actually shipped.
     *
     * It writes `stats.html` into `dist/`, and `dist/` is exactly what the
     * Dockerfile copies into nginx. Verified by inspecting the built image:
     * `stats.html` was being SERVED IN PRODUCTION.
     *
     * WHY THAT MATTERS beyond the wasted bytes: the report contains the full
     * module graph - every source file path, every dependency and its size. It
     * is a map of the application handed to anyone who guesses the URL, and it
     * is the kind of thing that turns up in a bug bounty report.
     *
     * `ANALYZE=1 npm run build` when you want it; nothing extra otherwise.
     *
     * THE GENERAL LESSON: a build-time tool that writes into the OUTPUT
     * directory is a deployment artefact whether you meant it to be or not.
     * Check what is in the image, not what you think you put there.
     */
    ...(process.env.ANALYZE
      ? [visualizer({ filename: 'dist/stats.html', gzipSize: true, template: 'raw-data' })]
      : []),
  ],

  resolve: {
    alias: {
      // Must MIRROR the `paths` entry in tsconfig.app.json. tsc resolves types
      // with that one; Vite resolves the actual module graph with this one.
      // They are two independent resolvers and both have to be told.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    /**
     * =========================================================================
     * THE DEV PROXY - the single most important line in this file
     * =========================================================================
     * Every request the app makes to a RELATIVE url starting `/api` is
     * forwarded to the NestJS server on :3000. The browser only ever sees
     * requests to localhost:5173.
     *
     * WHY THIS AND NOT `VITE_API_URL=http://localhost:3000`:
     *
     *   1. NO CORS IN DEVELOPMENT. Same-origin requests are not preflighted at
     *      all. Our backend does allow 5173 via CORS_ORIGINS, so the direct
     *      approach also works - but every request then pays an OPTIONS
     *      round-trip, and any CORS misconfiguration becomes a debugging
     *      session that looks like an auth bug.
     *
     *   2. COOKIES JUST WORK. The backend sets the refresh token as
     *      `httpOnly; sameSite=strict` (auth.controller.ts). A Strict cookie is
     *      only sent on same-SITE requests. localhost:5173 and localhost:3000
     *      happen to be the same site (SameSite ignores the port), so the
     *      direct approach survives locally - and then breaks the moment the
     *      frontend is served from a real, different domain. The proxy makes
     *      dev behave like production instead of accidentally working.
     *
     *   3. IT MIRRORS PRODUCTION. In production nginx serves the static bundle
     *      and reverse-proxies /api to NestJS - exactly this shape. Dev and
     *      prod using the same relative URLs means no environment-specific
     *      base-url branching in the client at all.
     *
     * ANGULAR BRIDGE: this is `proxy.conf.json` and the reasoning is identical.
     * =========================================================================
     */
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // `secure: false` would be needed for a self-signed HTTPS backend.
        // Not needed here; noted because it is the usual next question.
      },
      // The backend EXCLUDES health probes from the /api prefix and from
      // versioning (main.ts) so infrastructure can probe a path that no API
      // version change can break. They therefore sit at the domain root and
      // need their own rule. Forgetting this produces a 404 that reads as
      // "the backend is down" - confusing, given it is the health check.
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  build: {
    // Source maps for production. See the Security phase: these are uploaded to
    // an error tracker, NOT served publicly, because they de-minify your code
    // for anyone who asks.
    sourcemap: true,

    rolldownOptions: {
      output: {
        /**
         * =====================================================================
         * MANUAL VENDOR CHUNKS - a CACHING optimisation, not a size one
         * =====================================================================
         * This does NOT make the first visit smaller. Every byte still ships.
         * What it changes is the SECOND visit and every one after it.
         *
         * With one bundle, changing a single line of our code produces a new
         * content hash for the whole file - so a returning user re-downloads
         * React, MUI and Redux to receive a one-line fix. Those libraries change
         * a few times a year; our code changes daily.
         *
         * Splitting them means an app deploy invalidates ~48 kB instead of
         * ~500 kB, and the vendor chunks stay in the browser cache across
         * deploys.
         *
         * THE TRADE-OFF, honestly: more chunks means more HTTP requests. Under
         * HTTP/2 that is close to free (multiplexed over one connection); under
         * HTTP/1.1 it competes for the six-connection budget. Splitting into
         * three or four coherent groups is the sweet spot - splitting per
         * package is not.
         *
         * MEASURED SHARES that justify these groups (gzip):
         *   @mui/*, emotion, popper   ~210 kB   the dominant cost
         *   react, react-dom, scheduler ~90 kB
         *   redux toolkit + immer      ~34 kB
         *   react-router               ~46 kB
         * =====================================================================
         */
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return undefined;

          // ORDER MATTERS: @mui/* must be tested before the generic react
          // check, because MUI package paths contain "react" in their
          // dependencies and would otherwise be swept into the react chunk.
          if (
            id.includes('@mui') ||
            id.includes('@emotion') ||
            id.includes('@popperjs') ||
            id.includes('stylis')
          ) {
            return 'vendor-mui';
          }
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('@reduxjs') || id.includes('react-redux') || id.includes('immer')) {
            return 'vendor-redux';
          }
          if (id.includes('react-dom') || id.includes('scheduler') || id.includes('/react/')) {
            return 'vendor-react';
          }

          return 'vendor';
        },
      },
    },
  },

  /**
   * VITEST. Deliberately configured HERE rather than in a separate
   * vitest.config.ts, so the test run resolves modules through the exact same
   * alias and plugin pipeline as the app. A separate config file is the most
   * common source of "it imports fine in the app but not in tests".
   */
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      exclude: ['src/test/**', 'src/**/*.d.ts', 'src/main.tsx'],
    },
  },
});
