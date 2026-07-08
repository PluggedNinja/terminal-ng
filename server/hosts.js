/**
 * hosts.js — saved-host vault, per user, with optional sharing.
 * Hosts are stored in server/data/hosts.json. Passwords are NOT stored by default;
 * the user types the SSH password at connect time (and can opt to store it, encrypted).
 *
 * Compartilhamento (definido pelo dono):
 *  - share: 'private' (só o dono) | 'all' (todos os usuários) | 'users' (lista sharedWith)
 *  - sharedWith: [userId] — quando share === 'users'
 *  - sharePassword: boolean — se a senha salva vai junto para quem recebe
 * Quem recebe um host compartilhado apenas VÊ e CONECTA; não pode editar/excluir/re-compartilhar.
 */
import express from 'express';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { readTable, writeTable } from './store.js';
import { encryptSecret, decryptSecret } from './crypto.js';

function id() {
  return 'h_' + randomUUID();
}

function userNameMap() {
  const m = {};
  for (const u of readTable('users', [])) m[u.id] = u.username;
  return m;
}

// Um host é visível para userId se: ele é o dono, ou está compartilhado com todos,
// ou está na lista sharedWith.
function canSee(h, userId) {
  if (h.ownerId === userId) return true;
  if (h.share === 'all') return true;
  if (h.share === 'users' && Array.isArray(h.sharedWith) && h.sharedWith.includes(userId)) return true;
  return false;
}

// Normaliza os campos de compartilhamento a partir do body (só o dono chama isto).
function normalizeShare(body, prev = {}) {
  let share = body.share;
  if (share === undefined) share = prev.share || 'private';
  if (!['private', 'all', 'users'].includes(share)) share = 'private';
  let sharedWith = [];
  if (share === 'users') {
    const src = body.sharedWith !== undefined ? body.sharedWith : prev.sharedWith;
    sharedWith = Array.isArray(src) ? [...new Set(src.map(String))].slice(0, 200) : [];
  }
  const sharePassword = body.sharePassword !== undefined ? !!body.sharePassword : !!prev.sharePassword;
  return { share, sharedWith, sharePassword };
}

// Serializa um host para o cliente, de acordo com quem está pedindo.
//  - dono: recebe tudo (senha decifrada + config de compartilhamento).
//  - quem recebe: recebe só o essencial; a senha só se o dono marcou sharePassword.
function toClient(h, userId, names) {
  const mine = h.ownerId === userId;
  const base = {
    id: h.id, label: h.label, ip: h.ip, port: h.port, username: h.username,
    color: h.color, group: h.group, createdAt: h.createdAt, lastUsedAt: h.lastUsedAt,
    mine,
  };
  if (mine) {
    return {
      ...base,
      password: h.password ? decryptSecret(h.password) : undefined,
      share: h.share || 'private',
      sharedWith: Array.isArray(h.sharedWith) ? h.sharedWith : [],
      sharePassword: !!h.sharePassword,
    };
  }
  // host compartilhado comigo
  return {
    ...base,
    shared: true,
    ownerName: (names || userNameMap())[h.ownerId] || '',
    password: (h.sharePassword && h.password) ? decryptSecret(h.password) : undefined,
  };
}

export function hostsRouter(requireAuthMw) {
  const router = express.Router();
  router.use(requireAuthMw);

  // Lista os hosts que o usuário pode ver: os dele + os compartilhados com ele.
  router.get('/', (req, res) => {
    const all = readTable('hosts', []);
    const names = userNameMap();
    const visible = all.filter((h) => canSee(h, req.user.id));
    // ordena: os meus primeiro, depois compartilhados
    visible.sort((a, b) => (a.ownerId === req.user.id ? 0 : 1) - (b.ownerId === req.user.id ? 0 : 1));
    res.json(visible.map((h) => toClient(h, req.user.id, names)));
  });

  // Cria um host (do usuário atual).
  router.post('/', (req, res) => {
    const { label, ip, port, username, color, group, savePassword, password } = req.body || {};
    if (!ip || !username) return res.status(400).json({ error: 'ip and username are required' });
    const all = readTable('hosts', []);
    const sh = normalizeShare(req.body || {});
    const host = {
      id: id(),
      ownerId: req.user.id,
      label: label || ip,
      ip,
      port: parseInt(port, 10) || 22,
      username,
      color: color || '#00f0ff',
      group: group || 'default',
      // Senha opcional, cifrada em repouso (AES-256-GCM) — ver crypto.js.
      password: savePassword ? encryptSecret(String(password || '')) : undefined,
      share: sh.share,
      sharedWith: sh.sharedWith,
      sharePassword: sh.sharePassword,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    all.push(host);
    writeTable('hosts', all);
    res.json(toClient(host, req.user.id));
  });

  // Atualiza um host — SOMENTE o dono.
  router.put('/:id', (req, res) => {
    const all = readTable('hosts', []);
    const idx = all.findIndex((h) => h.id === req.params.id && h.ownerId === req.user.id);
    if (idx < 0) return res.status(404).json({ error: 'Host not found' });
    const { label, ip, port, username, color, group, savePassword, password } = req.body || {};
    const h = all[idx];
    if (label !== undefined) h.label = label;
    if (ip !== undefined) h.ip = ip;
    if (port !== undefined) h.port = parseInt(port, 10) || 22;
    if (username !== undefined) h.username = username;
    if (color !== undefined) h.color = color;
    if (group !== undefined) h.group = group;
    if (savePassword !== undefined) {
      if (!savePassword) h.password = undefined;
      // troca a senha só se enviada; senão mantém a existente (já cifrada)
      else if (password != null && String(password) !== '') h.password = encryptSecret(String(password));
      else if (!h.password) h.password = undefined;
    }
    // Campos de compartilhamento (se algum veio no body)
    if (req.body && (req.body.share !== undefined || req.body.sharedWith !== undefined || req.body.sharePassword !== undefined)) {
      const sh = normalizeShare(req.body, h);
      h.share = sh.share; h.sharedWith = sh.sharedWith; h.sharePassword = sh.sharePassword;
    }
    writeTable('hosts', all);
    res.json(toClient(h, req.user.id));
  });

  // Marca como usado (bumps lastUsedAt) — qualquer um que veja o host, mas só o
  // registro do dono é atualizado.
  router.post('/:id/touch', (req, res) => {
    const all = readTable('hosts', []);
    const idx = all.findIndex((h) => h.id === req.params.id && canSee(h, req.user.id));
    if (idx < 0) return res.status(404).json({ error: 'Host not found' });
    all[idx].lastUsedAt = new Date().toISOString();
    writeTable('hosts', all);
    res.json({ ok: true });
  });

  // Health check: conecta na porta SSH e mede latência — qualquer um que veja o host.
  router.post('/:id/ping', (req, res) => {
    const all = readTable('hosts', []);
    const h = all.find((x) => x.id === req.params.id && canSee(x, req.user.id));
    if (!h) return res.status(404).json({ error: 'Host not found' });
    const port = parseInt(h.port, 10) || 22;
    const start = Date.now();
    let done = false;
    const sock = new net.Socket();
    const finish = (o) => { if (!done) { done = true; try { sock.destroy(); } catch {} res.json(o); } };
    sock.setTimeout(5000);
    sock.once('connect', () => finish({ ok: true, ms: Date.now() - start, port }));
    sock.once('timeout', () => finish({ ok: false, error: 'timeout', port }));
    sock.once('error', (e) => finish({ ok: false, error: e.code || e.message, port }));
    try { sock.connect(port, h.ip); } catch (e) { finish({ ok: false, error: String(e.message || e), port }); }
  });

  // Exclui um host — SOMENTE o dono.
  router.delete('/:id', (req, res) => {
    let all = readTable('hosts', []);
    const before = all.length;
    all = all.filter((h) => !(h.id === req.params.id && h.ownerId === req.user.id));
    if (all.length === before) return res.status(404).json({ error: 'Host not found' });
    writeTable('hosts', all);
    res.json({ ok: true });
  });

  return router;
}
