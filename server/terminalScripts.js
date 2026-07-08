/**
 * terminalScripts.js — saved terminal scripts + SSH session logs.
 * Ported from msecops (PostgreSQL) and adapted to the local JSON store.
 *
 * Scripts: scope 'global' (everyone sees) or 'user' (owner only).
 * Session logs: saved to server/data/session-logs/<app>_<sshuser>_<server>_<day>_<hi-hf>.log
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTable, writeTable } from './store.js';

let dataBase;
try { dataBase = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data'); }
catch { const home = process.env.TNG_DATA_DIR || process.env.APPDATA || process.env.HOME || process.env.USERPROFILE || process.cwd(); dataBase = path.join(home, 'terminal-ng', 'data'); }
const LOG_DIR = process.env.TERMINAL_LOG_DIR || path.join(dataBase, 'session-logs');

function nextId() {
  const all = readTable('scripts', []);
  return all.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0) + 1;
}

export function listForUser(userId) {
  const all = readTable('scripts', []);
  return all
    .filter((s) => s.scope === 'global' || String(s.ownerId) === String(userId))
    .sort((a, b) => (a.scope === b.scope ? String(a.name).localeCompare(String(b.name)) : (a.scope === 'global' ? -1 : 1)))
    .map((s) => ({ ...s, mine: String(s.ownerId) === String(userId) }));
}

export function createScript({ name, description, code, scope, userId, userName }) {
  const nm = String(name || '').trim();
  const cd = String(code || '');
  if (!nm) throw new Error('Script name is required.');
  if (!cd.trim()) throw new Error('Script code cannot be empty.');
  const all = readTable('scripts', []);
  const script = {
    id: nextId(),
    name: nm.slice(0, 120),
    description: String(description || '').trim().slice(0, 300),
    code: cd,
    scope: scope === 'global' ? 'global' : 'user',
    ownerId: String(userId == null ? '' : userId),
    ownerName: userName || null,
    createdAt: new Date().toISOString(),
  };
  all.push(script);
  writeTable('scripts', all);
  return script;
}

export function removeScript(id, user) {
  const all = readTable('scripts', []);
  const idx = all.findIndex((s) => String(s.id) === String(id));
  if (idx < 0) return { ok: false, error: 'Script not found.' };
  const row = all[idx];
  const isOwner = String(row.ownerId) === String(user && user.id);
  // Owner can always delete; global scripts can be deleted by any authenticated user (no role system here).
  if (!isOwner && row.scope !== 'global') return { ok: false, error: 'No permission to delete this script.' };
  all.splice(idx, 1);
  writeTable('scripts', all);
  return { ok: true };
}

// ─── Session logs ──────────────────────────────────────────────────────────
function sanitize(p) {
  return String(p || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'na';
}
const p2 = (n) => String(n).padStart(2, '0');

export function buildFilename({ appUser, username, host, ip, startedAt, endedAt }) {
  const s = startedAt ? new Date(startedAt) : new Date();
  const e = endedAt ? new Date(endedAt) : new Date();
  const day = `${s.getFullYear()}-${p2(s.getMonth() + 1)}-${p2(s.getDate())}`;
  const hi = `${p2(s.getHours())}h${p2(s.getMinutes())}`;
  const hf = `${p2(e.getHours())}h${p2(e.getMinutes())}`;
  const server = sanitize(host && host !== ip ? host : ip || host);
  const who = appUser ? `${sanitize(appUser)}_` : '';
  return `${who}${sanitize(username)}_${server}_${day}_${hi}-${hf}.log`;
}

export function saveSessionLog({ appUser, username, host, ip, startedAt, endedAt, content }) {
  const filename = buildFilename({ appUser, username, host, ip, startedAt, endedAt });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const header = [
    `# Terminal-NG — SSH session log`,
    `# App user: ${appUser || '-'}`,
    `# SSH user: ${username || '-'}`,
    `# Server: ${host || '-'} (${ip || '-'})`,
    `# Start: ${startedAt ? new Date(startedAt).toLocaleString() : '-'}`,
    `# End:   ${endedAt ? new Date(endedAt).toLocaleString() : '-'}`,
    `# ${'='.repeat(60)}`,
    '',
  ].join('\n');
  const full = path.join(LOG_DIR, filename);
  fs.writeFileSync(full, header + String(content || ''), 'utf8');
  return { filename, bytes: Buffer.byteLength(header + String(content || '')), dir: LOG_DIR };
}
