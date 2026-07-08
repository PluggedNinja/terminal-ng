/**
 * sftpUtil.js — helpers puros para o navegador de arquivos SFTP.
 * Caminhos POSIX, formatação de tamanho/permissões/data e conversões de modo.
 */

// ── caminhos POSIX ──
export function pathJoin(dir, name) {
  const d = String(dir || '/').replace(/\/+$/,'') || '';
  if (name === '..') return dirname(d || '/');
  if (name === '.' || name === '') return d || '/';
  if (String(name).startsWith('/')) return normalize(name);
  return normalize(`${d}/${name}`);
}
export function dirname(p) {
  const s = String(p || '/').replace(/\/+$/,'');
  if (!s || s === '/') return '/';
  const i = s.lastIndexOf('/');
  return i <= 0 ? '/' : s.slice(0, i);
}
export function basename(p) {
  const s = String(p || '').replace(/\/+$/,'');
  const i = s.lastIndexOf('/');
  return i < 0 ? s : s.slice(i + 1);
}
export function normalize(p) {
  const abs = String(p || '/').startsWith('/');
  const parts = String(p || '').split('/');
  const out = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (out.length) out.pop(); continue; }
    out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
}
// migalhas (breadcrumbs): [{name, path}]
export function breadcrumbs(p) {
  const norm = normalize(p || '/');
  if (norm === '/') return [{ name: '/', path: '/' }];
  const segs = norm.split('/').filter(Boolean);
  const crumbs = [{ name: '/', path: '/' }];
  let cur = '';
  for (const s of segs) { cur += '/' + s; crumbs.push({ name: s, path: cur }); }
  return crumbs;
}

// ── tamanho legível ──
export function formatSize(bytes) {
  const b = Number(bytes);
  if (!Number.isFinite(b)) return '—';
  if (b < 1024) return `${b} B`;
  const u = ['K', 'M', 'G', 'T', 'P'];
  let i = -1; let v = b;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}B`;
}

// ── data (mtime em segundos) ──
export function formatMtime(sec) {
  if (!sec) return '—';
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── permissões ──
const TYPE_CHAR = (mode) => {
  const t = mode & 0o170000;
  return t === 0o040000 ? 'd' : t === 0o120000 ? 'l' : t === 0o060000 ? 'b' : t === 0o020000 ? 'c' : t === 0o010000 ? 'p' : t === 0o140000 ? 's' : '-';
};
// modo (número) → "drwxr-xr-x"
export function modeToSymbolic(mode) {
  const m = Number(mode) || 0;
  const rwx = (bits, sBit, sChar) => {
    let s = (bits & 4 ? 'r' : '-') + (bits & 2 ? 'w' : '-');
    if (sBit) s += (bits & 1 ? sChar.toLowerCase() : sChar.toUpperCase());
    else s += (bits & 1 ? 'x' : '-');
    return s;
  };
  const u = rwx((m >> 6) & 7, m & 0o4000, 's');
  const g = rwx((m >> 3) & 7, m & 0o2000, 's');
  const o = rwx(m & 7, m & 0o1000, 't');
  return TYPE_CHAR(m) + u + g + o;
}
// modo → "0644" (só os 12 bits de permissão, incluindo setuid/gid/sticky)
export function modeToOctal(mode) {
  const m = (Number(mode) || 0) & 0o7777;
  return m.toString(8).padStart(4, '0');
}
// "644" | "0755" | "rwxr-xr-x" → número octal (perm bits)
export function parseModeInput(input) {
  const s = String(input || '').trim();
  if (/^[0-7]{3,4}$/.test(s)) return parseInt(s, 8) & 0o7777;
  if (/^[rwxsStT-]{9}$/.test(s)) {
    let m = 0;
    const seg = (str, base) => {
      if (str[0] === 'r') m |= 4 << base;
      if (str[1] === 'w') m |= 2 << base;
      if (str[2] === 'x' || str[2] === 's' || str[2] === 't') m |= 1 << base;
    };
    seg(s.slice(0, 3), 6); seg(s.slice(3, 6), 3); seg(s.slice(6, 9), 0);
    if (s[2] === 's' || s[2] === 'S') m |= 0o4000;
    if (s[5] === 's' || s[5] === 'S') m |= 0o2000;
    if (s[8] === 't' || s[8] === 'T') m |= 0o1000;
    return m;
  }
  return null;
}

// ── tipo de arquivo (p/ ícone / preview) ──
const TEXT_EXT = new Set(['txt','log','conf','cfg','ini','yaml','yml','json','xml','sh','bash','py','js','ts','jsx','tsx','c','h','cpp','go','rs','rb','php','pl','sql','md','env','service','socket','timer','toml','properties','cnf','list','rules','repo','service','html','css','csv']);
export function isTextFile(name) {
  const n = String(name || '').toLowerCase();
  if (/^(\.bashrc|\.profile|\.bash_profile|\.gitconfig|\.vimrc|dockerfile|makefile|readme|license|authorized_keys|known_hosts|crontab|fstab|hosts|passwd|group|sudoers)$/.test(n)) return true;
  const ext = n.includes('.') ? n.split('.').pop() : '';
  return TEXT_EXT.has(ext);
}
