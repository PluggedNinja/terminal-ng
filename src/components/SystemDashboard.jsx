import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, RefreshCw, Cpu, MemoryStick, HardDrive, Activity, Server, Users,
  AlertTriangle, Network, Gauge as GaugeIcon, Layers, Clock, Loader2,
} from 'lucide-react';

import { useOverlayCard, CardControls } from './terminal/overlayCard';
/* ── helpers ─────────────────────────────────────────────────────────── */
function fmtBytes(b) {
  if (b == null || isNaN(b)) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0, n = Number(b);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}
function fmtMb(mb) { return fmtBytes((Number(mb) || 0) * 1024 * 1024); }
function fmtUptime(s) {
  if (!s) return '–';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return [d ? `${d}d` : '', h ? `${h}h` : '', `${m}m`].filter(Boolean).join(' ');
}
const pctColor = (p) => (p >= 85 ? 'var(--cyber-danger)' : p >= 60 ? 'var(--cyber-warn)' : 'var(--cyber-accent)');

/* ── radial gauge ────────────────────────────────────────────────────── */
function Ring({ pct, label, sub, icon: Icon }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const R = 30, C = 2 * Math.PI * R;
  const color = pctColor(p);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: 78, height: 78 }}>
        <svg width="78" height="78" className="-rotate-90">
          <circle cx="39" cy="39" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
          <motion.circle cx="39" cy="39" r={R} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - p / 100) }}
            transition={{ duration: 0.9, ease: 'easeOut' }} style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {Icon && <Icon className="w-3 h-3 mb-0.5" style={{ color }} />}
          <span className="font-display font-bold text-sm" style={{ color }}>{Math.round(p)}%</span>
        </div>
      </div>
      <div className="text-center leading-tight">
        <div className="font-display text-[10px] tracking-cyber" style={{ color: 'var(--text)' }}>{label}</div>
        {sub && <div className="text-[9px]" style={{ color: 'var(--text-dim)' }}>{sub}</div>}
      </div>
    </div>
  );
}

function Bar({ pct, color }) {
  const p = Math.max(2, Math.min(100, Number(pct) || 0));
  const c = color || pctColor(p);
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
      <motion.div initial={{ width: 0 }} animate={{ width: `${p}%` }} transition={{ duration: 0.7, ease: 'easeOut' }}
        style={{ height: '100%', background: c, boxShadow: `0 0 6px ${c}` }} />
    </div>
  );
}

function Panel({ icon: Icon, title, accent, children, className = '' }) {
  const c = accent || 'var(--cyber-primary)';
  return (
    <div className={`rounded-xl border overflow-hidden ${className}`} style={{ borderColor: `${c}33`, background: 'rgba(8,11,22,0.55)' }}>
      <div className="flex items-center gap-1.5 px-3 py-1.5" style={{ borderBottom: `1px solid ${c}22`, background: `${c}10` }}>
        <Icon className="w-3.5 h-3.5" style={{ color: c }} />
        <span className="font-display text-[10px] tracking-cyber" style={{ color: c }}>{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

/* ── dashboard ───────────────────────────────────────────────────────── */
export default function SystemDashboard({ open, data, loading, onClose, onRefresh, hostName, color, floating = true }) {
  const accent = color || 'var(--cyber-primary)';
  const cpu = data ? (data.cpuPct ?? data.loadPct ?? 0) : 0;
  const card = useOverlayCard(floating);
  const isFloat = card.floating;
  const body = (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={`${isFloat ? 'fixed' : 'absolute pointer-events-none'} inset-0 z-[9998] grid place-items-center p-4`}
          style={isFloat ? { background: 'rgba(2,3,8,0.78)', backdropFilter: 'blur(6px)' } : undefined} onClick={isFloat ? onClose : undefined}>
          <motion.div ref={card.rootRef} {...card.dragProps} initial={{ scale: 0.94, y: 14, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
            className="glass clip-cyber pointer-events-auto" style={{ width: isFloat ? 'min(920px, calc(100vw - 2rem))' : 'min(920px, calc(100% - 2rem))', maxWidth: 'calc(100% - 2rem)', maxHeight: 'calc(100% - 2rem)', overflow: 'auto', ...card.resizeStyle }}
            onClick={(e) => e.stopPropagation()}>
            {/* header */}
            <div className="flex items-center gap-3 px-5 py-3 sticky top-0 z-10" style={{ borderBottom: `1px solid ${accent}33`, background: 'rgba(6,9,18,0.92)', backdropFilter: 'blur(8px)' }}>
              <Server className="w-5 h-5" style={{ color: accent }} />
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold tracking-cyber truncate" style={{ color: accent }}>
                  {data?.hostname || hostName || 'SYSTEM'} <span className="text-[10px] font-normal" style={{ color: 'var(--text-dim)' }}>· INTEL</span>
                </div>
                <div className="text-[10px] font-mono truncate" style={{ color: 'var(--text-dim)' }}>
                  {data ? `${data.os || ''}${data.kernel ? ' · ' + data.kernel : ''}` : 'coletando…'}
                </div>
              </div>
              <button onClick={onRefresh} title="atualizar" className="p-1.5 rounded hover:bg-theme-soft">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} style={{ color: 'var(--text-dim)' }} />
              </button>
              <CardControls card={card} />
              <button onClick={onClose}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
            </div>

            {loading && !data ? (
              <div className="grid place-items-center py-24 gap-3">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: accent }} />
                <span className="font-display tracking-cyber text-sm" style={{ color: 'var(--text-dim)' }}>SCANNING HOST…</span>
              </div>
            ) : !data ? (
              <div className="py-20 text-center text-sm" style={{ color: 'var(--text-dim)' }}>Sem dados — o terminal precisa estar conectado.</div>
            ) : (
              <div className="p-4 space-y-3">
                {/* top gauges */}
                <div className="rounded-xl border p-4" style={{ borderColor: `${accent}33`, background: 'rgba(8,11,22,0.55)' }}>
                  <div className="flex flex-wrap items-center justify-around gap-4">
                    <Ring pct={cpu} label="CPU" icon={Cpu} sub={data.cores ? `${data.cores} cores` : ''} />
                    <Ring pct={data.mem?.pct} label="MEM" icon={MemoryStick} sub={data.mem ? `${fmtMb(data.mem.usedMb)} / ${fmtMb(data.mem.totalMb)}` : ''} />
                    {data.swap && <Ring pct={data.swap.pct} label="SWAP" icon={Layers} sub={`${fmtMb(data.swap.usedMb)} / ${fmtMb(data.swap.totalMb)}`} />}
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="flex items-end gap-1.5" style={{ height: 78 }}>
                        {(data.load || [0, 0, 0]).map((l, i) => (
                          <div key={i} className="flex flex-col items-center justify-end">
                            <span className="font-display font-bold text-xs" style={{ color: pctColor(data.cores ? (l / data.cores) * 100 : l * 25) }}>{Number(l).toFixed(2)}</span>
                            <div className="w-2 rounded-full mt-1" style={{ height: Math.max(4, Math.min(54, (data.cores ? (l / data.cores) * 54 : l * 14))), background: pctColor(data.cores ? (l / data.cores) * 100 : l * 25), boxShadow: `0 0 5px ${pctColor(data.cores ? (l / data.cores) * 100 : l * 25)}` }} />
                            <span className="text-[8px] mt-0.5" style={{ color: 'var(--text-dim)' }}>{['1m', '5m', '15m'][i]}</span>
                          </div>
                        ))}
                      </div>
                      <div className="font-display text-[10px] tracking-cyber" style={{ color: 'var(--text)' }}>LOAD</div>
                    </div>
                    <div className="flex flex-col items-center gap-1 px-2">
                      <Clock className="w-4 h-4" style={{ color: accent }} />
                      <span className="font-display font-bold text-sm" style={{ color: 'var(--text)' }}>{fmtUptime(data.uptimeSec)}</span>
                      <span className="text-[9px]" style={{ color: 'var(--text-dim)' }}>uptime</span>
                      {data.procCount != null && <span className="text-[9px]" style={{ color: 'var(--text-dim)' }}>{data.procCount} processos</span>}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                  {/* hardware */}
                  <Panel icon={GaugeIcon} title="HARDWARE">
                    <div className="space-y-1 text-[11px]">
                      <Row k="CPU" v={data.cpuModel || '—'} />
                      <Row k="Cores" v={data.cores ?? '—'} />
                      <Row k="Arch" v={data.arch || '—'} />
                      <Row k="Kernel" v={data.kernel || '—'} />
                      <Row k="OS" v={data.os || '—'} />
                    </div>
                  </Panel>

                  {/* disks */}
                  <Panel icon={HardDrive} title="ARMAZENAMENTO" accent="var(--cyber-secondary)">
                    <div className="space-y-2">
                      {data.disks?.length ? data.disks.map((d, i) => (
                        <div key={i}>
                          <div className="flex items-center justify-between text-[10px] mb-0.5">
                            <span className="font-mono truncate" style={{ color: 'var(--text)' }}>{d.mount}</span>
                            <span style={{ color: 'var(--text-dim)' }}>{fmtBytes(d.usedB)} / {fmtBytes(d.sizeB)}</span>
                          </div>
                          <Bar pct={d.pct} />
                        </div>
                      )) : <Empty />}
                    </div>
                  </Panel>

                  {/* processes */}
                  <Panel icon={Activity} title="TOP PROCESSOS" accent="var(--cyber-accent)">
                    <div className="space-y-1">
                      {data.procs?.length ? data.procs.slice(0, 8).map((p, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px]">
                          <span className="font-mono w-10 shrink-0" style={{ color: 'var(--text-dim)' }}>{p.pid}</span>
                          <span className="font-mono truncate flex-1" style={{ color: 'var(--text)' }}>{p.name}</span>
                          <span className="w-20 shrink-0"><Bar pct={p.cpu} /></span>
                          <span className="font-mono w-9 text-right shrink-0" style={{ color: pctColor(p.cpu) }}>{p.cpu.toFixed(0)}%</span>
                        </div>
                      )) : <Empty />}
                    </div>
                  </Panel>

                  {/* users */}
                  <Panel icon={Users} title="USUÁRIOS">
                    <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: 'var(--cyber-accent)' }}>online agora</div>
                    <div className="space-y-1 text-[11px]">
                      {data.users?.length ? data.users.map((u, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="status-dot dot-on" style={{ width: 6, height: 6 }} />
                          <span className="font-mono" style={{ color: 'var(--cyber-accent)' }}>{u.user}</span>
                          <span className="font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>{u.tty}</span>
                          {u.from && <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>{u.from}</span>}
                        </div>
                      )) : <Empty msg="nenhum" />}
                    </div>
                    <div className="h-px my-2" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>últimos logins</div>
                    <div className="space-y-1 text-[11px]">
                      {data.lastUsers?.length ? data.lastUsers.map((u, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="status-dot" style={{ width: 6, height: 6, background: u.still ? 'var(--cyber-accent)' : 'var(--text-dim)' }} />
                          <span className="font-mono" style={{ color: 'var(--text)' }}>{u.user}</span>
                          <span className="font-mono text-[10px] truncate" style={{ color: 'var(--text-dim)' }}>{u.from || u.tty}</span>
                          <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>{u.still ? 'online' : u.when}</span>
                        </div>
                      )) : <Empty msg="sem histórico" />}
                    </div>
                  </Panel>

                  {/* network */}
                  <Panel icon={Network} title="REDE" accent="var(--cyber-secondary)">
                    <div className="space-y-1 text-[11px]">
                      {data.nets?.length ? data.nets.map((n, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <span className="font-mono" style={{ color: 'var(--text)' }}>{n.iface}</span>
                          <span className="font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>{n.addr}</span>
                        </div>
                      )) : <Empty />}
                    </div>
                  </Panel>

                  {/* logs */}
                  <Panel icon={AlertTriangle} title="ÚLTIMOS ERROS NO LOG" accent="var(--cyber-warn)" className="md:col-span-2" >
                    <div className="space-y-0.5 font-mono text-[10px] max-h-44 overflow-auto no-scrollbar">
                      {data.logs?.length ? data.logs.map((l, i) => (
                        <div key={i} className="flex gap-1.5 leading-snug">
                          <span style={{ color: l.sev === 'error' ? 'var(--cyber-danger)' : l.sev === 'warn' ? 'var(--cyber-warn)' : 'var(--text-dim)' }}>▸</span>
                          <span style={{ color: l.sev === 'error' ? 'var(--text)' : 'var(--text-dim)' }}>{l.text}</span>
                        </div>
                      )) : <Empty msg="sem erros recentes" />}
                    </div>
                  </Panel>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
  return isFloat ? createPortal(body, document.body) : body;
}

function Row({ k, v }) {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 w-14" style={{ color: 'var(--text-dim)' }}>{k}</span>
      <span className="font-mono text-right flex-1 break-words" style={{ color: 'var(--text)' }}>{String(v)}</span>
    </div>
  );
}
function Empty({ msg = 'indisponível' }) {
  return <div className="text-[10px] italic" style={{ color: 'var(--text-dim)' }}>{msg}</div>;
}
