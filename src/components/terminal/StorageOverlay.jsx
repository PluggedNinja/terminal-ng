/**
 * StorageOverlay.jsx
 * Visualização para comandos de armazenamento: df (barras de uso), lsblk
 * (árvore de dispositivos), fdisk -l (discos/partições), LVM (PV/VG/LV) e blkid.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { HardDrive, Pin, PinOff, X, Trash2, Database, Layers, Box, Cpu } from 'lucide-react';
import { fmtBytes } from '../../utils/storageParse';
import { useOverlayCard, CardControls } from './overlayCard';

const KIND_TITLE = {
  df: 'Filesystems · df', lsblk: 'Block devices · lsblk', fdisk: 'Disks · fdisk -l',
  pvs: 'LVM · Physical Volumes', vgs: 'LVM · Volume Groups', lvs: 'LVM · Logical Volumes', blkid: 'blkid',
};
const KIND_ICON = { df: HardDrive, lsblk: Layers, fdisk: HardDrive, pvs: Box, vgs: Database, lvs: Database, blkid: Cpu };

const barColor = (pct) => (pct >= 90 ? 'var(--cyber-danger)' : pct >= 75 ? 'var(--cyber-warn)' : 'var(--cyber-accent)');

function UsageBar({ pct, label }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div style={{ width: `${Math.max(2, p)}%`, height: '100%', background: barColor(p), transition: 'width 0.4s ease', boxShadow: `0 0 8px ${barColor(p)}` }} />
      </div>
      <span className="font-mono text-[10px] w-10 text-right" style={{ color: barColor(p) }}>{label ?? `${p}%`}</span>
    </div>
  );
}

function Body({ data }) {
  if (!data) return null;
  if (data.kind === 'df') {
    return (
      <div className="space-y-1.5">
        {data.rows.map((r, i) => (
          <div key={i} className="grid items-center gap-2" style={{ gridTemplateColumns: '160px 1fr 96px' }}>
            <div className="min-w-0">
              <div className="font-mono text-[11px] truncate" style={{ color: 'var(--text)' }}>{r.mount}</div>
              <div className="font-mono text-[9px] truncate" style={{ color: 'var(--text-dim)' }}>{r.fs}</div>
            </div>
            <UsageBar pct={r.usePct} />
            <div className="font-mono text-[10px] text-right" style={{ color: 'var(--text-dim)' }}>{r.used}/{r.size}</div>
          </div>
        ))}
      </div>
    );
  }
  if (data.kind === 'lsblk') {
    const max = Math.max(1, ...data.items.map((x) => x.bytes || 0));
    return (
      <div className="space-y-0.5">
        {data.items.map((x, i) => (
          <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
            <span style={{ paddingLeft: x.depth * 14, color: x.type === 'disk' ? 'var(--cyber-primary)' : 'var(--text)' }}>
              {x.depth > 0 && <span style={{ color: 'var(--text-dim)' }}>└ </span>}{x.name}
            </span>
            {x.type && <span className="text-[8px] px-1 rounded" style={{ background: 'rgba(0,240,255,0.1)', color: 'var(--cyber-primary)' }}>{x.type}</span>}
            {x.mount && <span className="text-[9px] truncate" style={{ color: 'var(--cyber-accent)' }}>{x.mount}</span>}
            <div className="flex-1" />
            <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div style={{ width: `${Math.max(3, ((x.bytes || 0) / max) * 100)}%`, height: '100%', background: 'var(--cyber-primary)', opacity: 0.6 }} />
            </div>
            <span className="w-12 text-right" style={{ color: 'var(--text-dim)' }}>{x.size}</span>
          </div>
        ))}
      </div>
    );
  }
  if (data.kind === 'fdisk') {
    return (
      <div className="space-y-3">
        {data.disks.map((d, i) => {
          const total = d.bytes || d.parts.reduce((a, p) => a + (p.bytes || 0), 0) || 1;
          return (
            <div key={i}>
              <div className="flex items-center gap-2 mb-1">
                <HardDrive className="w-3.5 h-3.5 text-theme" />
                <span className="font-mono text-[11px] text-theme">{d.name}</span>
                <span className="font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>{d.sizeText || fmtBytes(d.bytes)}</span>
              </div>
              {/* barra de partições proporcional */}
              <div className="flex h-4 rounded overflow-hidden mb-1" style={{ background: 'rgba(255,255,255,0.05)' }}>
                {d.parts.map((p, j) => (
                  <div key={j} title={`${p.device} · ${p.size} · ${p.type}`} className="h-full"
                    style={{ width: `${Math.max(2, ((p.bytes || 0) / total) * 100)}%`, background: `hsl(${(j * 57) % 360} 80% 55%)`, borderRight: '1px solid rgba(0,0,0,0.4)' }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {d.parts.map((p, j) => (
                  <span key={j} className="font-mono text-[9px]" style={{ color: 'var(--text-dim)' }}>
                    <span style={{ color: `hsl(${(j * 57) % 360} 80% 60%)` }}>■</span> {p.device.replace('/dev/', '')} {p.size} {p.type}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  if (data.kind === 'pvs' || data.kind === 'vgs' || data.kind === 'lvs') {
    const items = data.items;
    return (
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {items.map((it, i) => {
          const name = it.pv || it.vg || it.lv;
          const totalB = it.bytes; const freeB = it.free ? require_free(it.free) : null;
          const usedPct = totalB && freeB != null ? Math.round(((totalB - freeB) / totalB) * 100) : null;
          return (
            <div key={i} className="rounded-lg border border-theme p-2" style={{ background: 'rgba(0,240,255,0.04)' }}>
              <div className="font-mono text-[11px] truncate" style={{ color: 'var(--cyber-primary)' }}>{name}</div>
              <div className="font-mono text-[9px] truncate" style={{ color: 'var(--text-dim)' }}>
                {it.vg && data.kind !== 'vgs' ? `vg: ${it.vg}` : ''}{data.kind === 'vgs' ? `${it.pv} PV · ${it.lv} LV` : ''}{it.attr ? ` ${it.attr}` : ''}
              </div>
              <div className="mt-1.5">{usedPct != null ? <UsageBar pct={usedPct} /> : <div className="font-mono text-[10px]" style={{ color: 'var(--cyber-accent)' }}>{it.size}</div>}</div>
              <div className="font-mono text-[9px] mt-0.5" style={{ color: 'var(--text-dim)' }}>{it.size}{it.free ? ` · free ${it.free}` : ''}</div>
            </div>
          );
        })}
      </div>
    );
  }
  if (data.kind === 'blkid') {
    return (
      <div className="space-y-1">
        {data.items.map((it, i) => (
          <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
            <span className="text-theme">{it.dev}</span>
            {it.type && <span className="text-[8px] px-1 rounded" style={{ background: 'rgba(182,255,0,0.12)', color: 'var(--cyber-accent)' }}>{it.type}</span>}
            {it.label && <span style={{ color: 'var(--text)' }}>{it.label}</span>}
            <span className="text-[9px] truncate" style={{ color: 'var(--text-dim)' }}>{it.uuid}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

// parse de "0", "12.00g", "<99.00 GiB" para bytes (free do LVM)
function require_free(s) {
  const str = String(s).replace(/[<>]/g, '').replace(/i?b$/i, '').trim();
  const m = str.match(/^([\d.]+)\s*([kmgtp])?/i);
  if (!m) return null;
  const mult = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4, p: 1024 ** 5 }[(m[2] || '').toLowerCase()] || 1;
  return parseFloat(m[1]) * mult;
}

export default function StorageOverlay({ data, auto, pinned, onTogglePin, onClose, onClear, floating, sessionLabel }) {
  const Icon = (data && KIND_ICON[data.kind]) || HardDrive;
  const title = (data && KIND_TITLE[data.kind]) || 'Storage';
  const card = useOverlayCard(floating);
  const isFloat = card.floating;
  const body = (
    <motion.div {...card.dragProps} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }}
      className={`${isFloat ? 'fixed right-3 bottom-3 z-[9997]' : 'absolute right-2 bottom-2 z-30'} rounded-xl overflow-hidden`}
      style={{ width: 460, maxWidth: isFloat ? '92vw' : 'calc(100% - 1rem)', maxHeight: isFloat ? '80vh' : '70%', background: 'color-mix(in srgb, var(--bg-2) 96%, transparent)', border: '1px solid color-mix(in srgb, var(--cyber-primary) 30%, transparent)', backdropFilter: 'blur(8px)', boxShadow: '0 16px 50px rgba(0,0,0,0.6), 0 0 24px color-mix(in srgb, var(--cyber-primary) 12%, transparent)' }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid rgba(0,240,255,0.15)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-3.5 h-3.5 text-theme shrink-0" />
          <span className="font-display text-[11px] tracking-cyber text-theme">{title}</span>
          {isFloat && sessionLabel && <span className="text-[9px] px-1 rounded truncate" style={{ background: 'color-mix(in srgb, var(--cyber-primary) 16%, transparent)', color: 'var(--cyber-primary)' }}>{sessionLabel}</span>}
          {auto && <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(182,255,0,0.12)', color: 'var(--cyber-accent)' }}>auto</span>}
        </div>
        <div className="flex items-center gap-1">
          <CardControls card={card} />
          <button onClick={onTogglePin} title={pinned ? 'Unpin' : 'Pin'} className="p-1 rounded hover:bg-theme-soft text-theme-soft">{pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}</button>
          {onClear && <button onClick={onClear} title="Clear" className="p-1 rounded hover:bg-theme-soft text-theme-soft"><Trash2 className="w-3.5 h-3.5" /></button>}
          <button onClick={onClose} title="Close" className="p-1 rounded hover:bg-black/40"><X className="w-3.5 h-3.5" style={{ color: 'var(--cyber-danger)' }} /></button>
        </div>
      </div>
      <div className="p-3 overflow-y-auto" style={{ maxHeight: 'calc(70vh - 40px)' }}>
        <Body data={data} />
      </div>
    </motion.div>
  );
  return isFloat ? createPortal(body, document.body) : body;
}
