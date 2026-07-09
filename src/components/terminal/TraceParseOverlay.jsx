/**
 * TraceParseOverlay.jsx
 * "Modo Traceroute" — em vez de espelhar o CLI, mostra a rota como uma linha do
 * tempo visual: origem → saltos → destino, com cor por latência, agrupando
 * saltos sem resposta (ICMP filtrado) e destacando o gargalo + um resumo
 * didático com evidências.
 */
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Route, Pin, Trash2, X, MapPin, Server, Flag, EyeOff, Zap, CheckCircle2, AlertTriangle, Gauge, Play, Square } from 'lucide-react';
import { useOverlayCard, CardControls } from './overlayCard';

const rttColor = (ms) => {
  if (ms == null) return '#64748b';
  if (ms < 20) return '#22c55e';
  if (ms < 60) return '#84cc16';
  if (ms < 120) return '#eab308';
  if (ms < 250) return '#f97316';
  return '#ef4444';
};
const best = (times) => (times && times.length ? Math.min(...times.filter((t) => typeof t === 'number')) : null);

const TraceParseOverlay = ({ dest, hops = [], auto, pinned, onClose, onClear, onTogglePin, onRun, onStop, running, stoppable, floating, sessionLabel }) => {
  const [host, setHost] = useState('');
  const canRun = !!host.trim() && !running && typeof onRun === 'function';
  const fire = () => { if (canRun) { onRun(host.trim()); setHost(''); } };
  // Collapse consecutive no-response hops into a single "gap" group.
  const view = useMemo(() => {
    const out = []; let i = 0;
    while (i < hops.length) {
      if (hops[i].timeout) { let j = i; while (j < hops.length && hops[j].timeout) j++; out.push({ kind: 'gap', from: hops[i].hop, to: hops[j - 1].hop, count: j - i }); i = j; }
      else { out.push({ kind: 'hop', h: hops[i] }); i++; }
    }
    return out;
  }, [hops]);

  const stats = useMemo(() => {
    const resp = hops.filter((h) => !h.timeout && best(h.times) != null).map((h) => ({ hop: h.hop, b: best(h.times), host: h.host || h.ip }));
    const maxLat = resp.reduce((m, r) => Math.max(m, r.b), 0);
    let bn = null;
    for (let k = 1; k < resp.length; k++) { const d = resp[k].b - resp[k - 1].b; if (d > 0 && (!bn || d > bn.delta)) bn = { delta: d, from: resp[k - 1].hop, to: resp[k].hop, host: resp[k].host }; }
    const timeouts = hops.filter((h) => h.timeout).length;
    const last = hops[hops.length - 1];
    const reached = !!(last && !last.timeout);
    return { maxLat, bn, timeouts, reached, respCount: resp.length };
  }, [hops]);

  const scaleMax = Math.max(50, stats.maxLat);
  const card = useOverlayCard(floating);
  const isFloat = card.floating;

  const body = (
    <motion.div {...card.dragProps}
      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      className={`${isFloat ? 'fixed top-3 right-3 bottom-3 z-[9997]' : 'absolute top-2 right-2 bottom-2 z-30'} w-[340px] flex flex-col rounded-xl overflow-hidden`}
      style={{ background: 'color-mix(in srgb, var(--bg-2) 92%, transparent)', border: '1px solid color-mix(in srgb, var(--cyber-primary) 25%, transparent)', backdropFilter: 'blur(6px)' }}
    >
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <Route className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          {isFloat && sessionLabel && <span className="text-[9px] px-1 rounded truncate shrink-0" style={{ background: 'color-mix(in srgb, var(--cyber-primary) 16%, transparent)', color: 'var(--cyber-primary)' }}>{sessionLabel}</span>}
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-white leading-tight">Rota de rede{auto ? ' (auto)' : ''}</p>
            {dest && <p className="text-[9px] text-slate-400 truncate flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> {dest.host}{dest.ip && dest.ip !== dest.host ? ` (${dest.ip})` : ''}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <CardControls card={card} />
          <button onClick={onTogglePin} title={pinned ? 'Desafixar' : 'Fixar'} className="p-1 rounded hover:bg-white/10" style={{ color: pinned ? '#38bdf8' : '#64748b' }}><Pin className="w-3.5 h-3.5" /></button>
          <button onClick={onClear} title="Limpar" className="p-1 rounded hover:bg-white/10 text-slate-400"><Trash2 className="w-3.5 h-3.5" /></button>
          <button onClick={onClose} title="Fechar" className="p-1 rounded hover:bg-red-500/20 text-slate-400"><X className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* disparo manual de traceroute (roda em 2º plano — terminal livre) */}
      {typeof onRun === 'function' && (
        <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(148,163,184,0.1)' }}>
          <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-1.5">Disparar traceroute manual</div>
          <div className="flex items-center gap-1.5">
            <input
              value={host} onChange={(e) => setHost(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fire(); }}
              disabled={running}
              placeholder="IP ou host (ex.: 8.8.8.8)"
              className="flex-1 min-w-0 rounded-md border px-2 py-1 text-[11px] font-mono text-slate-200 bg-black/40 outline-none disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderColor: 'color-mix(in srgb, var(--cyber-primary) 25%, transparent)' }} />
            {stoppable ? (
              <button onClick={onStop}
                title="Parar o traceroute em execução"
                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors"
                style={{ background: 'rgba(248,113,113,0.16)', color: '#fca5a5', border: '1px solid rgba(248,113,113,0.4)' }}>
                <Square className="w-3 h-3" /> parar
              </button>
            ) : (
              <button onClick={fire} disabled={!canRun}
                title="Inicia o traceroute numa conexão paralela — o terminal continua livre"
                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'color-mix(in srgb, var(--cyber-primary) 18%, transparent)', color: 'var(--cyber-primary)', border: '1px solid color-mix(in srgb, var(--cyber-primary) 35%, transparent)' }}>
                <Play className="w-3 h-3" /> {running ? 'rodando' : 'iniciar'}
              </button>
            )}
          </div>
          {stoppable && <div className="text-[9px] text-emerald-400/80 mt-1">Rodando em conexão paralela — o terminal está livre.</div>}
        </div>
      )}

      {/* resumo */}
      {hops.length > 0 && (
        <div className="px-3 py-2 grid grid-cols-3 gap-1.5" style={{ borderBottom: '1px solid rgba(148,163,184,0.1)' }}>
          <Stat icon={stats.reached ? CheckCircle2 : AlertTriangle} color={stats.reached ? '#22c55e' : '#fbbf24'} label={stats.reached ? 'alcançado' : 'sem resp. final'} value={`${stats.respCount}/${hops.length}`} />
          <Stat icon={Gauge} color={rttColor(stats.maxLat)} label="latência máx" value={`${stats.maxLat ? stats.maxLat.toFixed(0) : '—'}ms`} />
          <Stat icon={EyeOff} color={stats.timeouts ? '#fbbf24' : '#64748b'} label="sem resposta" value={`${stats.timeouts}`} />
        </div>
      )}

      {/* insights */}
      {hops.length > 0 && (
        <div className="px-3 py-1.5 space-y-1" style={{ borderBottom: '1px solid rgba(148,163,184,0.1)' }}>
          {stats.bn && stats.bn.delta >= 40 && (
            <Insight icon={Zap} color="#f97316" text={`Maior salto de latência: hop ${stats.bn.from}→${stats.bn.to} (+${stats.bn.delta.toFixed(0)}ms). Provável gargalo a partir daqui.`} />
          )}
          {stats.timeouts > 0 && (
            <Insight icon={EyeOff} color="#fbbf24" text={`${stats.timeouts} salto(s) não responderam ao ICMP. Normal — muitos roteadores ignoram traceroute; não significa falha.`} />
          )}
          {!stats.reached && hops.length > 2 && (
            <Insight icon={AlertTriangle} color="#fbbf24" text={'O destino não respondeu no último salto. Ele pode filtrar ICMP, ou a rota parou antes de chegar.'} />
          )}
          {stats.reached && (!stats.bn || stats.bn.delta < 40) && stats.timeouts === 0 && (
            <Insight icon={CheckCircle2} color="#22c55e" text={'Rota saudável: destino alcançado, sem buracos e sem gargalos evidentes.'} />
          )}
        </div>
      )}

      {/* timeline */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {hops.length === 0 ? (
          <p className="text-[10px] text-slate-500 text-center mt-4">Rode <span className="font-mono text-slate-400">traceroute {'<host>'}</span> que eu desenho a rota aqui.</p>
        ) : (
          <div className="relative pl-5">
            <div className="absolute left-[7px] top-1 bottom-1 w-px" style={{ background: 'rgba(148,163,184,0.25)' }} />
            <Node icon={Server} color="var(--cyber-primary)" title="ORIGEM" sub="este servidor" />
            {view.map((item, idx) => item.kind === 'gap' ? (
              <GapNode key={`g${idx}`} count={item.count} from={item.from} to={item.to} />
            ) : (
              <HopNode key={item.h.hop} h={item.h} scaleMax={scaleMax} isBn={stats.bn && stats.bn.to === item.h.hop} />
            ))}
            <Node icon={Flag} color={stats.reached ? '#22c55e' : '#fbbf24'} title="DESTINO" sub={dest ? (dest.host || dest.ip) : ''} ok={stats.reached} />
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 text-[8px] text-slate-500 flex items-center gap-2 flex-wrap" style={{ borderTop: '1px solid rgba(148,163,184,0.15)' }}>
        <Legend c="#22c55e" t="<20ms" /><Legend c="#84cc16" t="<60ms" /><Legend c="#eab308" t="<120ms" /><Legend c="#f97316" t="<250ms" /><Legend c="#ef4444" t="alto" />
      </div>
    </motion.div>
  );
  return isFloat ? createPortal(body, document.body) : body;
};

function Stat({ icon: Icon, color, label, value }) {
  return (
    <div className="rounded-lg px-2 py-1 text-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <Icon className="w-3.5 h-3.5 mx-auto mb-0.5" style={{ color }} />
      <div className="text-[11px] font-bold leading-none" style={{ color }}>{value}</div>
      <div className="text-[7px] uppercase tracking-wide text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
function Insight({ icon: Icon, color, text }) {
  return (
    <div className="flex gap-1.5 text-[9px] leading-snug" style={{ color: 'var(--text-dim)' }}>
      <Icon className="w-3 h-3 mt-0.5 shrink-0" style={{ color }} /><span>{text}</span>
    </div>
  );
}
function Node({ icon: Icon, color, title, sub, ok }) {
  return (
    <div className="relative mb-2">
      <span className="absolute -left-5 top-0.5 grid place-items-center rounded-full" style={{ width: 16, height: 16, background: 'var(--bg-2)', border: `2px solid ${color}` }}>
        <Icon className="w-2.5 h-2.5" style={{ color }} />
      </span>
      <div className="rounded-lg px-2 py-1" style={{ background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)` }}>
        <div className="flex items-center gap-1.5">
          <span className="font-display text-[9px] tracking-cyber" style={{ color }}>{title}</span>
          {ok !== undefined && <span className="text-[8px]" style={{ color }}>{ok ? '✓ respondeu' : '✗ sem resposta'}</span>}
        </div>
        {sub && <div className="text-[10px] font-mono text-white truncate">{sub}</div>}
      </div>
    </div>
  );
}
function GapNode({ count, from, to }) {
  return (
    <div className="relative mb-2">
      <span className="absolute -left-5 top-1 grid place-items-center rounded-full" style={{ width: 16, height: 16, background: 'var(--bg-2)', border: '2px dashed #fbbf24' }}>
        <EyeOff className="w-2.5 h-2.5" style={{ color: '#fbbf24' }} />
      </span>
      <div className="rounded-lg px-2 py-1 border border-dashed" style={{ borderColor: 'rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.06)' }}>
        <div className="text-[10px] font-bold" style={{ color: '#fbbf24' }}>{count} salto{count > 1 ? 's' : ''} sem resposta</div>
        <div className="text-[8px] text-slate-400">hops {from}{to !== from ? `–${to}` : ''} · ICMP filtrado (geralmente normal)</div>
      </div>
    </div>
  );
}
function HopNode({ h, scaleMax, isBn }) {
  const b = best(h.times);
  const pct = b != null ? Math.max(4, Math.min(100, (b / scaleMax) * 100)) : 0;
  const c = rttColor(b);
  return (
    <div className="relative mb-2">
      <span className="absolute -left-5 top-1.5 rounded-full" style={{ width: 10, height: 10, background: c, boxShadow: `0 0 6px ${c}`, marginLeft: 3 }} />
      <div className="rounded-lg px-2 py-1.5" style={{ background: isBn ? 'rgba(249,115,22,0.1)' : 'rgba(30,41,59,0.4)', border: isBn ? '1px solid rgba(249,115,22,0.45)' : '1px solid transparent' }}>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-slate-500 w-4 text-right">{h.hop}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-white font-mono truncate">{h.host || h.ip || '?'}</p>
            {h.ip && h.host && h.ip !== h.host && <p className="text-[8px] text-slate-500 font-mono truncate">{h.ip}</p>}
          </div>
          {isBn && <Zap className="w-3 h-3 shrink-0" style={{ color: '#f97316' }} />}
          <span className="text-[10px] font-mono font-bold shrink-0" style={{ color: c }}>{b != null ? `${b.toFixed(1)}ms` : '—'}</span>
        </div>
        <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(148,163,184,0.12)' }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c }} />
        </div>
      </div>
    </div>
  );
}
function Legend({ c, t }) {
  return <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: c }} /> {t}</span>;
}

export default TraceParseOverlay;
