import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = path.join(process.cwd(), 'public', urlPath.replace(/^\//, ''));
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found: ' + urlPath);
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(8787, '127.0.0.1', async () => {
  console.log('Static test server listening on http://127.0.0.1:8787/');
  
  const run = (script) => new Promise((resolve) => {
    console.log('\n========================================');
    console.log('RUNNING: ' + script);
    console.log('========================================');
    const child = spawn(process.execPath, [script, 'http://127.0.0.1:8787/'], {
      stdio: 'inherit'
    });
    child.on('exit', (code) => {
      console.log(`>>> ${script} finished with exit code: ${code}`);
      resolve(code || 0);
    });
  });

  const c1 = await run('scripts/webmcp-test.mjs');
  const c2 = await run('scripts/dash-test.mjs');
  const c3 = await run('scripts/offline-test.mjs');

  server.close(() => {
    console.log('\n========================================');
    console.log(`TEST SUMMARY: webmcp=${c1 === 0 ? 'PASSED' : 'FAILED'}, dash=${c2 === 0 ? 'PASSED' : 'FAILED'}, offline=${c3 === 0 ? 'PASSED' : 'FAILED'}`);
    console.log('========================================');
    process.exit(c1 || c2 || c3 || 0);
  });
});
