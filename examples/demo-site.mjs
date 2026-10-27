// A one-page site with typical problems, to try site-audit on:
//
//   node examples/demo-site.mjs              # listens on http://localhost:3456/
//   npx @bydtech/site-audit http://localhost:3456 --no-psi
//
// The page tells search engines not to index it, has no description or link
// preview tags, and links to a page that does not exist. Node built-ins only;
// it listens on 127.0.0.1.
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 3456);

const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Demo</title>
</head><body>
<h1>Demo shop</h1>
<p>See our <a href="/pricing">pricing</a>.</p>
</body></html>`;

createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}).listen(port, '127.0.0.1', () => {
  console.log(`Demo site on http://localhost:${port}/`);
});
