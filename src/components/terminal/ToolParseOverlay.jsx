/**
 * ToolParseOverlay.jsx
 * Overlay GENÉRICO que renderiza o schema normalizado de commandParsers.js
 * (e também avisos de comando perigoso / dicas de erro / explicação). Um único
 * componente cobre todos os parsers de comando do terminal-ng.
 *
 * data = { title, icon, sections: [...] }  (ver commandParsers.js)
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  Pin, PinOff, X, Trash2, ChevronDown, Sparkles, Loader2,
  Plug, Network, Route, Shield, Cpu, MemoryStick, Gauge, Folder, HardDrive,
  ScrollText, Globe, AlertTriangle, Settings, Terminal, Monitor,
} from 'lucide-react';
import { useOverlayCard, CardControls } from './overlayCard';
import ScreenSessionsSection from './ScreenSessionsSection';

const ICONS = {
  plug: Plug, network: Network, route: Route, shield: Shield, cpu: Cpu, memory: MemoryStick,
  gauge: Gauge, folder: Folder, hardDrive: HardDrive, scroll: ScrollText, globe: Globe,
  alert: AlertTriangle, settings: Settings, terminal: Terminal, screen: Monitor,
};

const toneColor = (t) => ({
  ok: 'var(--cyber-accent)', warn: 'var(--cyber-warn)', danger: 'var(--cyber-danger)',
  info: 'var(--cyber-primary)', accent: 'var(--cyber-primary)', dim: 'var(--text-dim)',
}[t] || 'var(--text)');

function Bar({ pct, tone }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const c = toneColor(tone || (p >= 90 ? 'danger' : p >= 75 ? 'warn' : 'ok'));
  return (
    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
      <div style={{ width: `${Math.max(2, p)}%`, height: '100%', background: c, transition: 'width 0.4s ease', boxShadow: `0 0 8px ${c}` }} />
    </div>
  );
}

function Section({ s, onOpenFile, onRunCommand }) {
  if (!s) return null;
  if (s.type === 'screenSessions') {
    return <ScreenSessionsSection data={s} onRunCommand={onRunCommand} />;
  }
  if (s.type === 'filelist') {
    return (
      <div className="flex flex-wrap gap-1.5">
        {s.items.map((it, i) => {
          const c = toneColor(it.tone);
          const clickable = it.openPath && onOpenFile;
          return (
            <button key={i} disabled={!clickable} onClick={() => clickable && onOpenFile(it.openPath)}
              title={clickable ? 'Editar arquivo' : undefined}
              className="font-mono text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: `color-mix(in srgb, ${c} 12%, transparent)`, color: c, border: `1px solid color-mix(in srgb, ${c} 28%, transparent)`, cursor: clickable ? 'pointer' : 'default', textDecoration: clickable ? 'underline' : 'none' }}>
              {it.text}
            </button>
          );
        })}
      </div>
    );
  }
  if (s.type === 'note') {
    const c = toneColor(s.tone);
    return (
      <div className="rounded-lg px-2.5 py-1.5" style={{ background: `color-mix(in srgb, ${c} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)` }}>
        {s.title && <div className="font-mono text-[11px] font-semibold" style={{ color: c }}>{s.title}</div>}
        {s.text && <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--text)' }}>{s.text}</div>}
      </div>
    );
  }
  if (s.type === 'badges') {
    return (
      <div>
        {s.label && <div className="font-mono text-[9px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>{s.label}</div>}
        <div className="flex flex-wrap gap-1.5">
          {s.items.map((it, i) => {
            const c = toneColor(it.tone);
            return (
              <span key={i} className="font-mono text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"
                style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c, border: `1px solid color-mix(in srgb, ${c} 30%, transparent)` }}>
                {it.text}{it.count != null && <b className="font-bold">{it.count}</b>}
              </span>
            );
          })}
        </div>
      </div>
    );
  }
  if (s.type === 'kv') {
    return (
      <div className="space-y-1">
        {s.items.map((it, i) => (
          <div key={i} className="flex items-center justify-between gap-3 font-mono text-[11px]">
            <span style={{ color: 'var(--text-dim)' }}>{it.k}</span>
            <span style={{ color: toneColor(it.tone) }}>{it.v}</span>
          </div>
        ))}
      </div>
    );
  }
  if (s.type === 'bars') {
    return (
      <div className="space-y-1.5">
        {s.items.map((it, i) => (
          <div key={i} className="grid items-center gap-2" style={{ gridTemplateColumns: '150px 1fr 86px' }}>
            <div className="min-w-0">
              <div className="font-mono text-[11px] truncate" style={{ color: 'var(--text)' }}>{it.label}</div>
              {it.sub && <div className="font-mono text-[9px] truncate" style={{ color: 'var(--text-dim)' }}>{it.sub}</div>}
            </div>
            <Bar pct={it.pct} tone={it.tone} />
            <div className="font-mono text-[10px] text-right" style={{ color: toneColor(it.tone) }}>{it.valueText ?? `${it.pct}%`}</div>
          </div>
        ))}
      </div>
    );
  }
  if (s.type === 'cards') {
    return (
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {s.items.map((it, i) => {
          const c = toneColor(it.tone);
          return (
            <div key={i} className="rounded-lg border border-theme p-2" style={{ background: 'rgba(0,240,255,0.04)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] truncate" style={{ color: 'var(--cyber-primary)' }}>{it.title}</span>
                {it.badge && <span className="text-[8px] px-1 rounded shrink-0" style={{ background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}>{it.badge}</span>}
              </div>
              {it.sub && <div className="font-mono text-[9px] mt-0.5 break-words" style={{ color: 'var(--text-dim)' }}>{it.sub}</div>}
              {it.pct != null && <div className="mt-1.5"><Bar pct={it.pct} tone={it.tone} /></div>}
            </div>
          );
        })}
      </div>
    );
  }
  if (s.type === 'table') {
    const cols = s.columns || [];
    return (
      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={i} className="font-mono text-[9px] uppercase tracking-wider text-left px-1 pb-1"
                  style={{ color: 'var(--text-dim)', textAlign: c.align || 'left', borderBottom: '1px solid rgba(0,240,255,0.15)' }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r, ri) => (
              <tr key={ri} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                {cols.map((c, ci) => {
                  const val = r[c.key];
                  const tone = typeof c.tone === 'function' ? c.tone(r) : c.tone;
                  if (c.bar) {
                    const pct = Number(val) || 0;
                    return (
                      <td key={ci} className="px-1 py-0.5" style={{ minWidth: 70 }}>
                        <div className="flex items-center gap-1">
                          <Bar pct={pct} tone={tone} />
                          <span className="font-mono text-[9px] w-9 text-right" style={{ color: toneColor(tone) }}>{pct}%</span>
                        </div>
                      </td>
                    );
                  }
                  const openTarget = c.link ? r[c.link] : null;
                  if (openTarget && onOpenFile) {
                    return (
                      <td key={ci} className="px-1 py-0.5 text-[10px]" style={{ textAlign: c.align || 'left', maxWidth: 260 }}>
                        <button onClick={() => onOpenFile(openTarget)} title={c.linkTitle || 'Abrir'}
                          className="font-mono truncate hover:opacity-80" style={{ color: toneColor(tone), textDecoration: 'underline', cursor: 'pointer', maxWidth: 250 }}>
                          {val == null || val === '' ? '—' : String(val)}
                        </button>
                      </td>
                    );
                  }
                  return (
                    <td key={ci} className={`px-1 py-0.5 ${c.mono ? 'font-mono' : ''} text-[10px]`}
                      style={{ color: toneColor(tone), textAlign: c.align || 'left', whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {val == null || val === '' ? '—' : String(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (s.type === 'spark') {
    return (
      <div className="space-y-1">
        {s.items.map((it, i) => {
          const max = Math.max(1, ...it.values);
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="font-mono text-[10px] w-16 truncate" style={{ color: 'var(--text-dim)' }}>{it.label}</span>
              <div className="flex-1 flex items-end gap-px h-6">
                {it.values.slice(-60).map((v, j) => (
                  <div key={j} style={{ flex: 1, height: `${Math.max(4, (v / max) * 100)}%`, background: toneColor(it.tone), opacity: 0.7 }} />
                ))}
              </div>
              <span className="font-mono text-[9px] w-12 text-right" style={{ color: toneColor(it.tone) }}>{it.values[it.values.length - 1]}{it.unit || ''}</span>
            </div>
          );
        })}
      </div>
    );
  }
  return null;
}

export default function ToolParseOverlay({
  data, auto, pinned, onTogglePin, onClose, onClear, floating, sessionLabel,
  picker, onPick, aiBusy, onAnalyzeAi, onOpenFile, onRunCommand,
}) {
  const Icon = (data && ICONS[data.icon]) || Terminal;
  const title = (data && data.title) || 'Diagnóstico';
  const card = useOverlayCard(floating);
  const isFloat = card.floating;
  const body = (
    <motion.div ref={card.rootRef} {...card.dragProps} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }}
      className={`${isFloat ? 'fixed right-3 bottom-3 z-[9997]' : 'absolute right-2 bottom-2 z-30'} flex flex-col rounded-xl overflow-hidden`}
      style={{ width: 500, maxWidth: isFloat ? '94vw' : 'calc(100% - 1rem)', maxHeight: isFloat ? '82vh' : '74%', background: 'color-mix(in srgb, var(--bg-2) 96%, transparent)', border: '1px solid color-mix(in srgb, var(--cyber-primary) 30%, transparent)', backdropFilter: 'blur(8px)', boxShadow: '0 16px 50px rgba(0,0,0,0.6), 0 0 24px color-mix(in srgb, var(--cyber-primary) 12%, transparent)', ...card.resizeStyle }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid rgba(0,240,255,0.15)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-3.5 h-3.5 text-theme shrink-0" />
          <span className="font-display text-[11px] tracking-cyber text-theme truncate">{title}</span>
          {isFloat && sessionLabel && <span className="text-[9px] px-1 rounded truncate" style={{ background: 'color-mix(in srgb, var(--cyber-primary) 16%, transparent)', color: 'var(--cyber-primary)' }}>{sessionLabel}</span>}
          {auto && <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(182,255,0,0.12)', color: 'var(--cyber-accent)' }}>auto</span>}
        </div>
        <div className="flex items-center gap-1">
          {onAnalyzeAi && data && (
            <button onClick={() => onAnalyzeAi()} disabled={aiBusy}
              title="Analisar esta saída com IA (sob demanda — nunca automático)"
              className="px-1.5 py-1 rounded flex items-center gap-1 text-[10px]"
              style={{ color: aiBusy ? 'var(--cyber-accent)' : 'var(--text-dim)', background: aiBusy ? 'color-mix(in srgb, var(--cyber-accent) 14%, transparent)' : 'transparent' }}>
              {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} IA
            </button>
          )}
          {picker && (
            <div className="relative group">
              <button className="p-1 rounded hover:bg-theme-soft text-theme-soft flex items-center" title="Escolher parser">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <div className="absolute right-0 top-full mt-1 hidden group-hover:block z-50 rounded-lg border border-theme py-1 max-h-64 overflow-y-auto"
                style={{ background: 'var(--bg-2)', minWidth: 180 }}>
                {picker.map((p) => (
                  <button key={p.kind} onClick={() => onPick?.(p.kind)}
                    className="block w-full text-left px-3 py-1 font-mono text-[10px] hover:bg-theme-soft"
                    style={{ color: 'var(--text)' }}>{p.label}</button>
                ))}
              </div>
            </div>
          )}
          <CardControls card={card} />
          {onTogglePin && <button onClick={onTogglePin} title={pinned ? 'Desafixar' : 'Fixar'} className="p-1 rounded hover:bg-theme-soft text-theme-soft">{pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}</button>}
          {onClear && <button onClick={onClear} title="Limpar" className="p-1 rounded hover:bg-theme-soft text-theme-soft"><Trash2 className="w-3.5 h-3.5" /></button>}
          <button onClick={onClose} title="Fechar" className="p-1 rounded hover:bg-black/40"><X className="w-3.5 h-3.5" style={{ color: 'var(--cyber-danger)' }} /></button>
        </div>
      </div>
      <div className="flex-1 min-h-0 p-3 overflow-y-auto space-y-3">
        {data && data.sections ? data.sections.map((s, i) => <Section key={i} s={s} onOpenFile={onOpenFile} onRunCommand={onRunCommand} />)
          : <div className="font-mono text-[11px] py-6 text-center" style={{ color: 'var(--text-dim)' }}>Rode um comando de diagnóstico (ss, ip, ps, free, journalctl, dmesg…) para ver a análise aqui.</div>}
      </div>
    </motion.div>
  );
  return isFloat ? createPortal(body, document.body) : body;
}
