import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distRoot = join(root, 'dist');
const port = Number(process.env.TAVERN_DEV_PORT || 5500);
const webpackBin = join(root, 'node_modules', 'webpack', 'bin', 'webpack.js');

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const server = createServer((request, response) => {
  const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
  const relative = pathname === '/' ? '/src/fish/index.html' : pathname;
  const candidate = normalize(join(distRoot, relative));
  if (!candidate.startsWith(distRoot) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': mimeTypes[extname(candidate).toLowerCase()] || 'application/octet-stream',
  });
  createReadStream(candidate).pipe(response);
});

const webpack = spawn(process.execPath, [webpackBin, '--mode', 'development', '--watch', '--progress'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});

const shutdown = () => {
  server.close();
  webpack.kill();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
webpack.on('exit', code => {
  if (code && code !== 0) process.exitCode = code;
  server.close();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[tavern-dev] static files: http://127.0.0.1:${port}/src/fish/index.html`);
  console.log('[tavern-dev] websocket listener: http://127.0.0.1:6621');
});
