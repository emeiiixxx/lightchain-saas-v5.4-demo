import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

// Serve the OCR runtime and language files from the Demo's own origin.
export function ocrAssets(): Plugin {
  const root = resolve('node_modules');
  const files = new Map<string, string>([
    ['worker.min.js', resolve(root, 'tesseract.js/dist/worker.min.js')],
    ['worker.LICENSE.txt', resolve(root, 'tesseract.js/dist/worker.min.js.LICENSE.txt')],
    ['LICENSE.txt', resolve(root, 'tesseract.js-core/LICENSE')],
    ...['eng', 'chi_sim'].map(lang => [
      `${lang}.traineddata.gz`, resolve(root, `@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`),
    ] as [string, string]),
    ...readdirSync(resolve(root, 'tesseract.js-core'))
      .filter(name => /-lstm\.wasm(?:\.js)?$/.test(name))
      .map(name => [name, resolve(root, 'tesseract.js-core', name)] as [string, string]),
  ]);
  return {
    name: 'local-ocr-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = request.url?.split('?')[0].replace(/^\/assets\/ocr\//, '');
        const file = request.url?.startsWith('/assets/ocr/') && name ? files.get(name) : undefined;
        if (!file) return next();
        response.setHeader('Content-Type', name!.endsWith('.js') ? 'text/javascript' : name!.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        createReadStream(file).on('error', next).pipe(response);
      });
    },
    generateBundle() {
      for (const [name, path] of files) this.emitFile({ type: 'asset', fileName: `assets/ocr/${name}`, source: readFileSync(path) });
    },
  };
}
