/**
 * index.js — Terminal-NG backend entry point (ESM).
 * Express REST API (auth, hosts, AI) + WebSocket SSH terminal on one HTTP server.
 * Also serves the built frontend (dist/) so everything can run on ONE origin/port,
 * which avoids all dev-proxy / cross-port / IPv6 WebSocket headaches.
 */
import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { seedAdmin, authRouter, requireAuth } from './auth.js';
import { hostsRouter } from './hosts.js';
import { aiRouter } from './ai.js';
import { terminalRouter } from './terminal.js';
import { prefsRouter } from './prefs.js';
import { flowsRouter, startFlowScheduler } from './flows.js';
import { browseRouter } from './browse.js';
import { attachTerminalWebSocket } from './terminalService.js';

let __dirname;
try { __dirname = path.dirname(fileURLToPath(import.meta.url)); } catch { __dirname = process.cwd(); }
const PORT = parseInt(process.env.PORT, 10) || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const IS_PROD = process.env.NODE_ENV === 'production';
const INSECURE_SECRETS = ['dev-insecure-secret-change-me', 'change-me-to-a-long-random-string'];

// Em produção, recusa subir com segredos fracos/ausentes — evita tokens forjáveis
// e a conta admin/admin serem publicados por engano.
if (IS_PROD) {
  const problems = [];
  if (!process.env.JWT_SECRET || INSECURE_SECRETS.includes(process.env.JWT_SECRET) || process.env.JWT_SECRET.length < 32)
    problems.push('JWT_SECRET ausente, padrão ou com menos de 32 caracteres');
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'admin' || process.env.ADMIN_PASSWORD.length < 12)
    problems.push('ADMIN_PASSWORD ausente, "admin" ou com menos de 12 caracteres');
  if (!process.env.TNG_ENC_KEY || process.env.TNG_ENC_KEY.length < 32)
    problems.push('TNG_ENC_KEY ausente ou com menos de 32 caracteres (cifragem de segredos em repouso)');
  if (problems.length) {
    console.error('[FATAL] Configuração insegura para produção:\n  - ' + problems.join('\n  - ') + '\nDefina essas variáveis no .env e reinicie.');
    process.exit(1);
  }
} else if (INSECURE_SECRETS.includes(JWT_SECRET)) {
  console.warn('[WARN] Usando JWT_SECRET padrão. Defina JWT_SECRET no .env antes de publicar.');
}

seedAdmin();

const app = express();
app.disable('x-powered-by');
// CSP explícita (antes era desligada). 'unsafe-inline' cobre estilos do xterm;
// ajuste conforme necessário. connect-src libera a API + WebSocket na mesma origem.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
// CORS restrito. Defina TNG_ALLOWED_ORIGINS (lista separada por vírgula) em produção.
// Sem a variável: apenas localhost (dev / uso single-origin).
const allowedOrigins = (process.env.TNG_ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    // requisições same-origin/curl (sem header Origin) são permitidas
    if (!origin) return cb(null, true);
    if (allowedOrigins.length ? allowedOrigins.includes(origin) : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      return cb(null, true);
    return cb(new Error('Origem não permitida pelo CORS'));
  },
}));
app.use(express.json({ limit: '1mb' }));

const auth = requireAuth(JWT_SECRET);

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'terminal-ng', time: new Date().toISOString() }));
app.use('/api/auth', authRouter(JWT_SECRET));
app.use('/api/hosts', hostsRouter(auth));
app.use('/api/ai', aiRouter(auth));
app.use('/api/terminal', terminalRouter(auth));
app.use('/api/prefs', prefsRouter(auth));
app.use('/api/flows', flowsRouter(auth));
app.use('/api/browse', browseRouter(JWT_SECRET));

// ── Serve the built SPA (if present) so the whole app runs single-origin on :PORT ──
// Resolve dist/ for both normal runs and a packaged SEA executable (next to the exe).
const distCandidates = [
  path.join(__dirname, '..', 'dist'),
  path.join(path.dirname(process.execPath), 'dist'),
  path.join(process.cwd(), 'dist'),
];
const DIST = distCandidates.find((d) => { try { return fs.existsSync(path.join(d, 'index.html')); } catch { return false; } }) || distCandidates[0];
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  // SPA fallback for any non-API GET route.
  app.get(/^(?!\/api|\/ws).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
  console.log('[Static] Serving built frontend from dist/');
} else {
  console.log('[Static] No dist/ build found — run "npm run build" to serve the UI from this port.');
}

const server = http.createServer(app);
attachTerminalWebSocket(server, JWT_SECRET);
startFlowScheduler();

// Bind explicitly to IPv4 (0.0.0.0). The frontend connects the terminal over IPv4
// (127.0.0.1), so this guarantees a matched IPv4 pair — no IPv6/::1 ambiguity.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ╦ ╦ Terminal-NG backend online`);
  console.log(`  ╠═╣ Open the app : http://localhost:${PORT}   (after npm run build)`);
  console.log(`  ╠═╣ REST API     : http://localhost:${PORT}/api`);
  console.log(`  ╩ ╩ Terminal     : ws://localhost:${PORT}/ws/terminal\n`);
});
