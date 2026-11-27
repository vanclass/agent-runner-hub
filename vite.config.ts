import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vite';

const pdfPackage = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
// PDF.js resolves these resources by filename at runtime, inside its worker.
const pdfAssets = ['legacy/build/pdf.worker.min.mjs', 'LICENSE',
  ...['cmaps', 'standard_fonts', 'iccs', 'wasm'].flatMap(directory =>
    readdirSync(join(pdfPackage, directory)).map(file => `${directory}/${file}`))];

export default defineConfig({
  plugins: [{
    name: 'bundle-pdf-assets',
    generateBundle() {
      for (const file of pdfAssets) {
        this.emitFile({ type: 'asset', fileName: `pdfjs/${file}`, source: readFileSync(join(pdfPackage, file)) });
      }
    },
    configureServer(server) {
      const routes = new Map(pdfAssets.map(file => [`/pdfjs/${file}`, file]));
      server.middlewares.use((request, response, next) => {
        const file = request.method === 'GET' && routes.get(request.url ?? '');
        if (!file) return next();
        const script = file.endsWith('.mjs') || file.endsWith('.js');
        response.setHeader('Content-Type', script ? 'text/javascript'
          : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        response.end(readFileSync(join(pdfPackage, file)));
      });
    },
  }],
  server: { host: '127.0.0.1', watch: { ignored: ['**/temp/**', '**/test-results/**', '**/src-tauri/target/**', '**/local/hub-native/target/**', '**/local/native-probe/target/**', '**/.project-config/managed/**/cache/**', '**/.project-config/tools/web_app_build_system/local/**', '**/.project-config/tools/web_app_build_system/output/**'] } },
  preview: { host: '127.0.0.1' },
});
