import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import type { Plugin } from 'vite';

/** Ersetzt das Zeichen U+FFFD in Skripten durch eine Escape-Sequenz (manche Hosts lehnen es im HTML ab). */
const escapeReplacementChar = (): Plugin => ({
  name: 'escape-fffd',
  enforce: 'post',
  generateBundle(_, bundle) {
    for (const f of Object.values(bundle)) {
      if (f.type === 'chunk') f.code = f.code.replace(/\uFFFD/g, '\\uFFFD');
    }
  },
});

// "npm run build"        -> normale Web-App (dist/), z. B. für GitHub Pages
// "npm run build:single" -> eine einzige HTML-Datei (dist-single/), z. B. zum Weitergeben
export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    target: 'es2020',
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 4000,
  },
  plugins: mode === 'single' ? [escapeReplacementChar(), viteSingleFile()] : [],
  test: { testTimeout: 30000 },
}));
