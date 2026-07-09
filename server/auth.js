/**
 * auth.js — local JWT authentication.
 * Users are stored hashed (bcrypt) in server/data/users.json.
 * An initial admin account is seeded on first boot from env vars.
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { readTable, writeTable } from './store.js';

// ── Rate-limit simples em memória (sem dependência externa) ──
// Janela deslizante por chave (IP). Bloqueia força bruta no login.
function rateLimiter({ windowMs, max, message }) {
  const hits = new Map(); // key -> { count, resetAt }
  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let e = hits.get(key);
    if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + windowMs }; hits.set(key, e); }
    e.count++;
    if (e.count > max) {
      const retry = Math.ceil((e.resetAt - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: message || 'Muitas tentativas. Tente mais tarde.', retryAfter: retry });
    }
    // limpeza oportunista
    if (hits.size > 5000) for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    next();
  };
}

const MIN_PASSWORD_LEN = 12;

// ── Cookie de sessão (HttpOnly) ──
// Guardar o JWT num cookie HttpOnly impede que um XSS o roube (JS não lê o cookie)
// e evita o token na URL. res.cookie é nativo do Express; a leitura é manual abaixo.
export const COOKIE_NAME = 'tng_token';
const COOKIE_MAX_AGE = 12 * 60 * 60 * 1000; // 12h, igual ao expiresIn do JWT

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

// Extrai o JWT de: header Authorization: Bearer, ou cookie HttpOnly.
export function tokenFromRequest(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  const c = parseCookies(req.headers.cookie);
  return c[COOKIE_NAME] || null;
}

function setAuthCookie(req, res, token) {
  const secure = !!(req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https'));
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: COOKIE_MAX_AGE, path: '/' });
}

export function seedAdmin() {
  const users = readTable('users', []);
  if (users.length === 0) {
    const username = process.env.ADMIN_USER || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin';
    users.push({
      id: cryptoId(),
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'admin',
      createdAt: new Date().toISOString(),
    });
    writeTable('users', users);
    console.log(`[Auth] Seeded initial admin user "${username}" (change the password after first login).`);
    return;
  }
  // Migração: se nenhum usuário tem papel de admin, promove o primeiro (evita ficar
  // sem administrador ao atualizar de uma versão sem papéis).
  if (!users.some((u) => u.role === 'admin')) {
    users[0].role = 'admin';
    for (const u of users) if (!u.role) u.role = 'user';
    writeTable('users', users);
    console.log(`[Auth] No admin found — promoted "${users[0].username}" to admin.`);
  }
}

function cryptoId() {
  return 'u_' + randomUUID();
}

function sign(user, secret) {
  return jwt.sign({ id: user.id, username: user.username }, secret, { expiresIn: '12h' });
}

// Papel efetivo do usuário (lê da tabela, não do JWT — mudanças valem na hora).
function roleOf(userId) {
  const u = readTable('users', []).find((x) => x.id === userId);
  return u?.role || 'user';
}

/** Middleware: exige que o usuário autenticado seja admin. */
export function requireAdmin(secret) {
  const auth = requireAuth(secret);
  return (req, res, next) => auth(req, res, () => {
    if (roleOf(req.user.id) !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
    next();
  });
}

function safeUser(u) {
  return { id: u.id, username: u.username, role: u.role || 'user', createdAt: u.createdAt };
}

/** Express middleware: requires a valid JWT (Bearer header OR HttpOnly cookie). */
export function requireAuth(secret) {
  return (req, res, next) => {
    const token = tokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Missing token' });
    try {
      req.user = jwt.verify(token, secret);
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

export function authRouter(secret) {
  const router = express.Router();

  // Máx. 10 tentativas de login por IP a cada 15 min.
  const loginLimiter = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, message: 'Muitas tentativas de login. Aguarde alguns minutos.' });

  router.post('/login', loginLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const users = readTable('users', []);
    const user = users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = sign(user, secret);
    setAuthCookie(req, res, token);
    // O token também vai no corpo (compat. + fallback do WebSocket em dev cross-origin).
    res.json({ token, user: { id: user.id, username: user.username, role: user.role || 'user' } });
  });

  router.get('/me', requireAuth(secret), (req, res) => {
    res.json({ user: { id: req.user.id, username: req.user.username, role: roleOf(req.user.id) } });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  // ── Diretório: id+username de todos (para o seletor de compartilhamento) ──
  // Qualquer usuário autenticado pode ler (só nomes, nada sensível).
  router.get('/directory', requireAuth(secret), (req, res) => {
    const users = readTable('users', []);
    res.json(users.map((u) => ({ id: u.id, username: u.username })));
  });

  // ── Gestão de usuários (somente admin) ──
  const admin = requireAdmin(secret);

  router.get('/users', admin, (req, res) => {
    res.json(readTable('users', []).map(safeUser));
  });

  router.post('/users', admin, (req, res) => {
    const { username, password, role } = req.body || {};
    const uname = String(username || '').trim();
    if (!uname || !/^[A-Za-z0-9._-]{2,32}$/.test(uname)) return res.status(400).json({ error: 'Usuário inválido (2-32 caracteres: letras, números, . _ -).' });
    if (!password || String(password).length < MIN_PASSWORD_LEN) return res.status(400).json({ error: `A senha precisa ter ao menos ${MIN_PASSWORD_LEN} caracteres.` });
    const users = readTable('users', []);
    if (users.some((u) => u.username.toLowerCase() === uname.toLowerCase())) return res.status(409).json({ error: 'Já existe um usuário com esse nome.' });
    const user = { id: cryptoId(), username: uname, passwordHash: bcrypt.hashSync(String(password), 10), role: role === 'admin' ? 'admin' : 'user', createdAt: new Date().toISOString() };
    users.push(user); writeTable('users', users);
    res.json(safeUser(user));
  });

  router.delete('/users/:id', admin, (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Você não pode excluir a própria conta.' });
    const users = readTable('users', []);
    const target = users.find((u) => u.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (target.role === 'admin' && users.filter((u) => u.role === 'admin').length <= 1) return res.status(400).json({ error: 'Não é possível excluir o único administrador.' });
    writeTable('users', users.filter((u) => u.id !== req.params.id));
    res.json({ ok: true });
  });

  // Admin redefine a senha de um usuário (sem exigir a senha atual).
  router.post('/users/:id/password', admin, (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < MIN_PASSWORD_LEN) return res.status(400).json({ error: `A senha precisa ter ao menos ${MIN_PASSWORD_LEN} caracteres.` });
    const users = readTable('users', []);
    const idx = users.findIndex((u) => u.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    users[idx].passwordHash = bcrypt.hashSync(String(newPassword), 10);
    writeTable('users', users);
    res.json({ ok: true });
  });

  // Admin muda o papel (admin/user), garantindo que sobre ao menos 1 admin.
  router.put('/users/:id/role', admin, (req, res) => {
    const role = req.body?.role === 'admin' ? 'admin' : 'user';
    const users = readTable('users', []);
    const idx = users.findIndex((u) => u.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (users[idx].role === 'admin' && role !== 'admin' && users.filter((u) => u.role === 'admin').length <= 1)
      return res.status(400).json({ error: 'Precisa haver ao menos um administrador.' });
    users[idx].role = role; writeTable('users', users);
    res.json(safeUser(users[idx]));
  });

  router.post('/change-password', requireAuth(secret), (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < MIN_PASSWORD_LEN) return res.status(400).json({ error: `A nova senha precisa ter ao menos ${MIN_PASSWORD_LEN} caracteres.` });
    const users = readTable('users', []);
    const idx = users.findIndex((u) => u.id === req.user.id);
    if (idx < 0) return res.status(404).json({ error: 'User not found' });
    if (!bcrypt.compareSync(currentPassword || '', users[idx].passwordHash)) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }
    users[idx].passwordHash = bcrypt.hashSync(newPassword, 10);
    writeTable('users', users);
    // renova o cookie (sessão continua válida após a troca)
    setAuthCookie(req, res, sign(users[idx], secret));
    res.json({ ok: true });
  });

  return router;
}
