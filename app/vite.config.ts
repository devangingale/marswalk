// Written with AI assistance, directed and reviewed by the team.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseByteRange } from './src/devRange';

const bundleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sites');
const contentTypes: Record<string, string> = {
  '.json': 'application/json',
  '.pmtiles': 'application/vnd.pmtiles',
  '.bin': 'application/octet-stream',
};

function localBundles() {
  return {
    name: 'local-site-bundles',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/local-bundles', (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD');
          res.end();
          return;
        }
        const match = /^\/(gale|jezero)\/([\w.-]+)$/.exec(req.url?.split('?')[0] ?? '');
        if (!match) {
          next();
          return;
        }

        const [, site, filename] = match;
        const dir = resolve(bundleRoot, site, 'bundle');
        const filePath = resolve(dir, filename);
        if (!existsSync(filePath)) {
          res.statusCode = 404;
          res.end('Bundle file not found');
          return;
        }
        const realDir = realpathSync(dir);
        const realFilePath = realpathSync(filePath);
        if (!realFilePath.startsWith(`${realDir}/`) && !realFilePath.startsWith(`${realDir}\\`)) { res.statusCode = 404; res.end('Bundle file not found'); return; }
        if (!statSync(realFilePath).isFile()) { res.statusCode = 404; res.end('Bundle file not found'); return; }

        const { size } = statSync(realFilePath);
        const type = contentTypes[extname(filename)] ?? 'application/octet-stream';
        res.setHeader('Content-Type', type);
        res.setHeader('Accept-Ranges', 'bytes');

        const range = req.headers.range;
        if (range) {
          let parsed;
          try { parsed = parseByteRange(range, size); } catch {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${size}`);
            res.end();
            return;
          }
          const { start, end } = parsed!;
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          res.setHeader('Content-Length', String(end - start + 1));
          if (req.method === 'HEAD') res.end();
          else { const stream = createReadStream(realFilePath, { start, end }); stream.on('error', () => { if (!res.headersSent) res.statusCode = 500; res.end(); }); stream.pipe(res); }
          return;
        }

        res.setHeader('Content-Length', String(size));
        if (req.method === 'HEAD') res.end();
        else { const stream = createReadStream(realFilePath); stream.on('error', () => { if (!res.headersSent) res.statusCode = 500; res.end(); }); stream.pipe(res); }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    localBundles(),
    viteStaticCopy({
      targets: ['Workers', 'Assets', 'ThirdParty', 'Widgets'].map((dir) => ({
        src: `node_modules/cesium/Build/Cesium/${dir}`,
        dest: 'cesium',
        rename: { stripBase: 4 },
      })),
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
