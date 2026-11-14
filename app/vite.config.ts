// Written with AI assistance, directed and reviewed by the team.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
        const filePath = resolve(bundleRoot, site, 'bundle', filename);
        if (!filePath.startsWith(resolve(bundleRoot, site, 'bundle')) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          res.statusCode = 404;
          res.end('Bundle file not found');
          return;
        }

        const { size } = statSync(filePath);
        const type = contentTypes[extname(filename)] ?? 'application/octet-stream';
        res.setHeader('Content-Type', type);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');

        const range = req.headers.range;
        if (range) {
          const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!parsed) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${size}`);
            res.end();
            return;
          }
          const start = parsed[1] ? Number(parsed[1]) : Math.max(0, size - Number(parsed[2]));
          const end = parsed[2] ? Math.min(Number(parsed[2]), size - 1) : size - 1;
          if (start > end || start >= size) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${size}`);
            res.end();
            return;
          }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          res.setHeader('Content-Length', String(end - start + 1));
          if (req.method === 'HEAD') res.end();
          else createReadStream(filePath, { start, end }).pipe(res);
          return;
        }

        res.setHeader('Content-Length', String(size));
        if (req.method === 'HEAD') res.end();
        else createReadStream(filePath).pipe(res);
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), localBundles()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
