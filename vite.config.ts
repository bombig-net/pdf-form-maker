import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import type { Plugin } from 'vite';

/** Escapes U+FFFD in scripts (some hosts reject the raw character in HTML). */
const escapeReplacementChar = (): Plugin => ({
  name: 'escape-fffd',
  enforce: 'post',
  generateBundle(_, bundle) {
    for (const f of Object.values(bundle)) {
      if (f.type === 'chunk') f.code = f.code.replace(/\uFFFD/g, '\\uFFFD');
    }
  },
});

// "npm run build"        -> regular web app (dist/), e.g. for GitHub Pages
// "npm run build:single" -> a single HTML file (dist-single/), e.g. for sharing
export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    target: 'es2020',
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 4000,
  },
  plugins: mode === 'single' ? [escapeReplacementChar(), viteSingleFile()] : [],
  test: { testTimeout: 30000, include: ['test/**/*.test.ts'] },
}));
