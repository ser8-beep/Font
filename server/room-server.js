// Shared alphabet server for the facilitator laptop.
//
//   npm run build && npm run room            # serves the app + room wall on port 8787
//   PORT=9000 npm run room                   # another port
//   npm run room -- --reset                  # start with an empty alphabet
//   ROOM_DATA=/tmp/wall.json npm run room    # keep the wall in another file (tests use this)
//
// Kids' laptops open http://<facilitator-ip>:8787 ; the projector opens http://<ip>:8787/#room
// Glyphs are stored as SVG path data in server/room-data.json so a restart keeps the wall.
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist');
const DATA = process.env.ROOM_DATA || join(HERE, 'room-data.json');
const PORT = Number(process.env.PORT) || 8787;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

let state = { name: process.env.ROOM_NAME || 'Room Alphabet', alphabet: {}, submissions: 0 };
if (!process.argv.includes('--reset') && existsSync(DATA)) {
  try {
    state = { ...state, ...JSON.parse(readFileSync(DATA, 'utf8')) };
  } catch {
    console.warn('Could not read room-data.json, starting empty.');
  }
}

let saveTimer = null;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeFileSync(DATA, JSON.stringify(state)), 300);
};

// Capitals, small letters (teams that built "play") and digits.
const CHAR = /^[A-Za-z0-9]$/;
const PATH = /^[MLQZ0-9 .\-]*$/;

function validGlyph(g) {
  return (
    g && typeof g.char === 'string' && CHAR.test(g.char) &&
    typeof g.svg === 'string' && g.svg.length < 200_000 && PATH.test(g.svg) &&
    Number.isFinite(g.advance) && g.advance > 0 && g.advance < 10_000
  );
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...cors });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too big'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  if (!existsSync(DIST)) return send(res, 503, 'Run `npm run build` first.', 'text/plain');
  const url = new URL(req.url, 'http://x');
  let p = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!p.startsWith(DIST + sep) && p !== DIST) return send(res, 403, 'no', 'text/plain');
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
  res.writeHead(200, {
    'Content-Type': MIME[extname(p)] || 'application/octet-stream',
    'Cache-Control': p.endsWith('index.html') || p.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600',
  });
  createReadStream(p).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.url === '/api/room' && req.method === 'GET') return send(res, 200, state);
    if (req.url === '/api/submit' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const team = String(body.team || 'A team').replace(/[<>]/g, '').slice(0, 30);
      const glyphs = Array.isArray(body.glyphs) ? body.glyphs.filter(validGlyph).slice(0, 40) : [];
      if (!glyphs.length) return send(res, 400, { error: 'no letters' });
      const at = Date.now();
      for (const g of glyphs) state.alphabet[g.char] = { char: g.char, svg: g.svg, advance: Math.round(g.advance), team, at };
      state.submissions++;
      save();
      broadcast();
      console.log(`${team} sent ${glyphs.map((g) => g.char).join('')}`);
      return send(res, 200, { ok: true });
    }
    if (req.url.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    serveStatic(req, res);
  } catch (e) {
    send(res, 400, { error: String(e.message || e) });
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });
function broadcast() {
  const msg = JSON.stringify({ type: 'state', state });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}
wss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'state', state })));

server.listen(PORT, () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Room wall running on port ${PORT}`);
  for (const ip of ips.length ? ips : ['localhost']) {
    console.log(`  Kids:      http://${ip}:${PORT}/`);
    console.log(`  Projector: http://${ip}:${PORT}/#room`);
  }
});
