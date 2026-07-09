/**
 * storageParse.js
 * Parsers para comandos de armazenamento Linux, transformando a saída textual
 * em estruturas para visualização: df, lsblk, fdisk -l, blkid e LVM
 * (pvs/vgs/lvs e pvdisplay/vgdisplay/lvdisplay/pvscan/vgscan/lvscan).
 */

// Converte "20G", "1.5T", "512M", "2.0G", "<99.00g", "99.00 GiB" → bytes.
export function toBytes(s) {
  if (s == null) return null;
  const str = String(s).replace(/[<>]/g, '').replace(/i?b$/i, '').trim();
  const m = str.match(/^([\d.]+)\s*([kmgtp])?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || '').toLowerCase();
  const mult = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4, p: 1024 ** 5 }[unit] || 1;
  return n * mult;
}

export function fmtBytes(b) {
  if (b == null || !Number.isFinite(b)) return '—';
  const u = ['B', 'K', 'M', 'G', 'T', 'P'];
  let i = 0; let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)}${u[i]}`;
}

// Mapeia um comando para o "kind" de parser (ou null se não for de storage).
export function storageKindForCmd(cmd) {
  const c = String(cmd || '').replace(/^sudo\s+(?:-\S+\s+)*/, '').trim();
  if (/^df\b/.test(c)) return 'df';
  if (/^lsblk\b/.test(c)) return 'lsblk';
  if (/^fdisk\s+-l\b/.test(c) || /^sfdisk\s+-l\b/.test(c)) return 'fdisk';
  if (/^pv(s|scan|display)\b/.test(c)) return 'pvs';
  if (/^vg(s|scan|display)\b/.test(c)) return 'vgs';
  if (/^lv(s|scan|display)\b/.test(c)) return 'lvs';
  if (/^blkid\b/.test(c)) return 'blkid';
  if (/^lsblk\b/.test(c)) return 'lsblk';
  return null;
}

// ─── df ────────────────────────────────────────────────────────────────────
function parseDf(lines) {
  const rows = [];
  // Plain `df` reports 1K-blocks (unitless numbers); `df -h` already has suffixes.
  const toB = (v) => (/^[\d.]+$/.test(v) ? parseFloat(v) * 1024 : toBytes(v));
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line || /^Filesystem|^Sist\.|^S\.arq/i.test(line)) continue;
    // Filesystem Size Used Avail Use% Mounted
    const m = line.match(/^(.+?)\s+([\d.]+[KMGTP]?)\s+([\d.]+[KMGTP]?)\s+([\d.]+[KMGTP]?)\s+(\d+)%\s+(\/.*)$/i);
    if (!m) continue;
    const sizeB = toB(m[2]); const usedB = toB(m[3]); const availB = toB(m[4]);
    rows.push({ fs: m[1].trim(), size: fmtBytes(sizeB), used: fmtBytes(usedB), avail: fmtBytes(availB), usePct: parseInt(m[5], 10), mount: m[6].trim(), bytes: sizeB });
  }
  rows.sort((a, b) => b.usePct - a.usePct);
  return rows.length ? { kind: 'df', rows } : null;
}

// ─── lsblk (árvore) ──────────────────────────────────────────────────────────
function parseLsblk(lines) {
  const out = [];
  for (const raw of lines) {
    if (!raw || /^NAME\b/i.test(raw)) continue;
    // profundidade pelos glifos de árvore
    const mIndent = raw.match(/^([│\s├└─]*)([A-Za-z0-9].*)$/);
    if (!mIndent) continue;
    const prefix = mIndent[1];
    const depth = (prefix.match(/[├└]/) ? 1 : 0) + (prefix.match(/│/g) || []).length;
    const rest = mIndent[2].replace(/[─]+/g, '').trim();
    const tokens = rest.split(/\s+/);
    const name = tokens[0];
    if (!name) continue;
    // tokens: [NAME, MAJ:MIN, RM, SIZE, RO, TYPE, MOUNTPOINT...]
    const size = tokens[3] || '';
    const type = tokens[5] || '';
    const mount = tokens.slice(6).join(' ') || '';
    out.push({ name, depth, size, type, mount, bytes: toBytes(size) });
  }
  return out.length ? { kind: 'lsblk', items: out } : null;
}

// ─── fdisk -l ────────────────────────────────────────────────────────────────
function parseFdisk(lines) {
  const disks = [];
  let cur = null;
  let inParts = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const md = line.match(/^Disk\s+(\/dev\/\S+):\s+(.+?),\s+(\d+)\s+bytes/i);
    if (md) { cur = { name: md[1], sizeText: md[2], bytes: parseInt(md[3], 10), parts: [] }; disks.push(cur); inParts = false; continue; }
    if (/^Device\b/i.test(line)) { inParts = true; continue; }
    if (inParts && cur) {
      // /dev/sda1 * 2048 209... 99G Linux filesystem   (colunas variam)
      const mp = line.match(/^(\/dev\/\S+)\s+(.*)$/);
      if (mp) {
        const cols = mp[2].trim().split(/\s+/);
        // procura a coluna de tamanho (termina com letra de unidade)
        const sizeTok = cols.find((t) => /^[\d.]+[KMGTPEB]i?B?$|^[\d.]+[KMGTP]$/i.test(t));
        const typeIdx = cols.findIndex((t) => /^[A-Za-z]/.test(t) && t !== '*');
        const type = typeIdx >= 0 ? cols.slice(typeIdx).join(' ') : '';
        cur.parts.push({ device: mp[1], size: sizeTok || '', type, bytes: toBytes(sizeTok) });
      } else if (!line.trim()) { inParts = false; }
    }
  }
  return disks.length ? { kind: 'fdisk', disks } : null;
}

// ─── LVM ─────────────────────────────────────────────────────────────────────
function parsePvs(lines) {
  const items = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^PV\s+VG/i.test(line)) continue;
    // tabular: /dev/sda2 vg0 lvm2 a-- <99.00g 0
    let m = line.match(/^(\/dev\/\S+)\s+(\S+)?\s+lvm2\s+\S+\s+(\S+)\s+(\S+)/i);
    if (m) { items.push({ pv: m[1], vg: m[2] && m[2] !== '' ? m[2] : '(none)', size: m[3], free: m[4], bytes: toBytes(m[3]) }); continue; }
    // pvscan: PV /dev/sda2   VG vg0   lvm2 [<99.00 GiB / 0 free]
    m = line.match(/^PV\s+(\/dev\/\S+)\s+VG\s+(\S+).*\[([^/\]]+?)\s*\/\s*([^\]]+?)\s*free/i);
    if (m) { items.push({ pv: m[1], vg: m[2], size: m[3].trim(), free: m[4].trim(), bytes: toBytes(m[3]) }); continue; }
  }
  // pvdisplay (blocos chave-valor)
  if (!items.length) {
    const blocks = String(lines.join('\n')).split(/---\s*Physical volume\s*---/i).slice(1);
    for (const b of blocks) {
      const pv = (b.match(/PV Name\s+(\S+)/i) || [])[1];
      const vg = (b.match(/VG Name\s+(\S+)/i) || [])[1] || '(none)';
      const size = (b.match(/PV Size\s+([\d.]+\s*\w+)/i) || [])[1];
      if (pv) items.push({ pv, vg, size: size || '', free: '', bytes: toBytes(size) });
    }
  }
  return items.length ? { kind: 'pvs', items } : null;
}

function parseVgs(lines) {
  const items = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^VG\s+#PV/i.test(line)) continue;
    // vg0 1 2 0 wz--n- <99.00g 0
    let m = line.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\S+\s+(\S+)\s+(\S+)/);
    if (m) { items.push({ vg: m[1], pv: +m[2], lv: +m[3], size: m[5], free: m[6], bytes: toBytes(m[5]) }); continue; }
  }
  if (!items.length) {
    const blocks = String(lines.join('\n')).split(/---\s*Volume group\s*---/i).slice(1);
    for (const b of blocks) {
      const vg = (b.match(/VG Name\s+(\S+)/i) || [])[1];
      const size = (b.match(/VG Size\s+([\d.]+\s*\w+)/i) || [])[1];
      const free = (b.match(/Free\s+PE.*\/\s*([\d.]+\s*\w+)/i) || [])[1] || '';
      const pv = (b.match(/Cur PV\s+(\d+)/i) || [])[1];
      const lv = (b.match(/Cur LV\s+(\d+)/i) || [])[1];
      if (vg) items.push({ vg, pv: pv ? +pv : '?', lv: lv ? +lv : '?', size: size || '', free, bytes: toBytes(size) });
    }
  }
  return items.length ? { kind: 'vgs', items } : null;
}

function parseLvs(lines) {
  const items = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^LV\s+VG/i.test(line)) continue;
    // root vg0 -wi-ao---- 90.00g
    let m = line.match(/^(\S+)\s+(\S+)\s+(\S{6,})\s+(\S+)/);
    if (m && /^[-mvtswpr]/i.test(m[3])) { items.push({ lv: m[1], vg: m[2], attr: m[3], size: m[4], bytes: toBytes(m[4]) }); continue; }
    // lvscan: ACTIVE '/dev/vg0/root' [90.00 GiB] inherit
    m = line.match(/'(\/dev\/[^']+)'\s*\[([^\]]+)\]/);
    if (m) { const parts = m[1].split('/'); items.push({ lv: parts[parts.length - 1], vg: parts[parts.length - 2] || '', attr: (line.match(/^(\w+)/) || [])[1] || '', size: m[2].trim(), bytes: toBytes(m[2]) }); continue; }
  }
  if (!items.length) {
    const blocks = String(lines.join('\n')).split(/---\s*Logical volume\s*---/i).slice(1);
    for (const b of blocks) {
      const path = (b.match(/LV Path\s+(\S+)/i) || [])[1] || (b.match(/LV Name\s+(\S+)/i) || [])[1];
      const vg = (b.match(/VG Name\s+(\S+)/i) || [])[1] || '';
      const size = (b.match(/LV Size\s+([\d.]+\s*\w+)/i) || [])[1];
      if (path) { const p = path.split('/'); items.push({ lv: p[p.length - 1], vg, attr: '', size: size || '', bytes: toBytes(size) }); }
    }
  }
  return items.length ? { kind: 'lvs', items } : null;
}

// ─── blkid ───────────────────────────────────────────────────────────────────
function parseBlkid(lines) {
  const items = [];
  for (const raw of lines) {
    const line = raw.trim();
    const md = line.match(/^(\/dev\/\S+):\s*(.*)$/);
    if (!md) continue;
    const dev = md[1];
    const type = (md[2].match(/TYPE="([^"]+)"/) || [])[1] || '';
    const label = (md[2].match(/LABEL="([^"]+)"/) || [])[1] || '';
    const uuid = (md[2].match(/UUID="([^"]+)"/) || [])[1] || '';
    items.push({ dev, type, label, uuid });
  }
  return items.length ? { kind: 'blkid', items } : null;
}

export function parseStorage(kind, lines) {
  try {
    switch (kind) {
      case 'df': return parseDf(lines);
      case 'lsblk': return parseLsblk(lines);
      case 'fdisk': return parseFdisk(lines);
      case 'pvs': return parsePvs(lines);
      case 'vgs': return parseVgs(lines);
      case 'lvs': return parseLvs(lines);
      case 'blkid': return parseBlkid(lines);
      default: return null;
    }
  } catch { return null; }
}
