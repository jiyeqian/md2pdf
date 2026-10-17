import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.txt':'text/plain' };

export async function startStaticServer({ directory, port }) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const actualPort = server.address().port;
      if (![ `127.0.0.1:${actualPort}`, `localhost:${actualPort}` ].includes(req.headers.host)) {
        res.writeHead(403); res.end('仅允许本机访问'); return;
      }
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let target = path.resolve(directory, '.' + pathname);
      if (!target.startsWith(directory + path.sep) && target !== directory) { res.writeHead(403); res.end(); return; }
      if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
      const body = await readFile(target);
      res.writeHead(200, { 'Content-Type':types[path.extname(target)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      res.writeHead(['ENOENT','ENOTDIR','EISDIR'].includes(error.code) ? 404 : error instanceof URIError ? 400 : 500);
      res.end('无法读取静态资源');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`md2pdf 静态 WebApp：http://127.0.0.1:${server.address().port}/`);
  console.log(`网站目录：${directory}；修改源码后请重新启动。`);
  return server;
}
