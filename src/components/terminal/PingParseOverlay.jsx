/**
 * PingParseOverlay.jsx
 * Overlay flutuante do "Modo Ping" — lê a saída do comando ping no terminal
 * SSH e mostra estatísticas ao vivo (enviados/recebidos/perda), latência
 * (atual/min/médio/máx/jitter), um mini-gráfico das respostas e a
 * classificação de qualidade (ótimo/bom/aceitável/instável/ruim).
 * Inclui disparo manual de ping numa conexão SSH paralela (terminal livre).
 */
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Activity, Radio, Pin, Trash2, X, ArrowDownUp, Play, Square } from 'lucide-react';
import { classifyLatency, classifyQuality } from '../../utils/pingLineParse';
import { useOverlayCard, CardControls } from './overlayCard';

const PingParseOverlay = ({ samples = [], auto, pinned, onClose, onClear, onTogglePin, onRun, onStop, running, stoppable, floating, sessionLabel }) => {
  const [host, setHost] = useState('');
  const canRun = !!host.trim() && !running && typeof onRun === 'function';
  const fire = () => { if (canRun) { onRun(host.trim()); setHost(''); } };
  const s = useMemo(() => {
    const replies = samples.filter((x) => x.kind === 'reply' && typeof x.time === 'number');
    const losses = samples.filter((x) => x.kind === 'loss');
    const sums = samples.filter((x) => x.kind === 'summary');
    // mescla os campos dos resumos (linhas de pacotes e de rtt são separadas)
    const sum = {};
    for (const z of sums) for (const k of ['transmitted', 'received', 'lossPct', 'min', 'avg', 'max', 'mdev']) if (z[k] != null) sum[k] = z[k];

    const times = replies.map((r) => r.time);
    const recv = sum.received != null ? sum.received : replies.length;
    const sent = sum.transmitted != null ? sum.transmitted : replies.length + losses.length;
    const lossPct = sum.lossPct != null ? sum.lossPct : (sent ? (100 * (sent - recv)) / sent : 0);
    const min = sum.min != null ? sum.min : (times.length ? Math.min(...times) : null);
    const max = sum.max != null ? sum.max : (times.length ? Math.max(...times) : null);
    const avg = sum.avg != null ? sum.avg : (times.length ? times.reduce((a, b) => a + b, 0) / times.length : null);
    // jitter: mdev do resumo, senão desvio médio das diferenças consecutivas
    let jitter = sum.mdev;
    if (jitter == null && times.length > 1) {
      let acc = 0; for (let i = 1; i < times.length; i++) acc += Math.abs(times[i] - times[i - 1]);
      jitter = acc / (times.length - 1);
    }
    const current = times.length ? times[times.length - 1] : null;
    const quality = classifyQuality({ lossPct, avg });
    // série p/ o gráfico: respostas e perdas na ordem (últimas 48)
    const series = samples.filter((x) => x.kind === 'reply' || x.kind === 'loss').slice(-48);
    const scaleMax = Math.max(10, ...times);
    return { sent, recv, lossPct, min, max, avg, jitter, current, quality, series, scaleMax, host: (samples.find((x) => x.host) || {}).host || null };
  }, [samples]);

  const fmt = (v, u = '') => (v == null ? '—' : `${v.toFixed(v < 10 ? 1 : 0)}${u}`);
  const card = useOverlayCard(floating);
  const isFloat = card.floating;

  const body = (
    <motion.div {...card.dragProps}
      initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}
      className={`${isFloat ? 'fixed top-3 right-3 bottom-3 z-[9997]' : 'absolute top-2 right-2 bottom-2 z-30'} flex flex-col rounded-xl border shadow-2xl backdrop-blur-sm`}
      style={{ width: isFloat ? 360 : 'min(360px, 48%)', borderColor: 'color-mix(in srgb, var(--cyber-primary) 25%, transparent)', background: 'color-mix(in srgb, var(--bg-2) 93%, transparent)' }}>
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'color-mix(in srgb, var(--cyber-primary) 15%, transparent)' }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <Activity className="w-4 h-4 text-theme shrink-0" />
          <span className="text-[12px] font-bold text-theme">Modo Ping</span>
          {isFloat && sessionLabel && <span className="text-[9px] px-1 rounded truncate" style={{ background: 'color-mix(in srgb, var(--cyber-primary) 16%, transparent)', color: 'var(--cyber-primary)' }}>{sessionLabel}</span>}
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'rgba(52,211,153,0.15)', color: '#6ee7b7' }}>
            <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}><Radio className="w-2.5 h-2.5" /></motion.span>
            {pinned ? 'fixado' : (auto ? 'auto' : 'ao vivo')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <CardControls card={card} />
          <button onClick={onTogglePin} title={pinned ? 'Desafixar' : 'Fixar painel'} className="p-1 rounded transition-colors"
            style={pinned ? { color: 'var(--cyber-primary)', background: 'color-mix(in srgb, var(--cyber-primary) 15%, transparent)' } : { color: '#64748b' }}>
            <Pin className="w-3.5 h-3.5" style={{ fill: pinned ? 'currentColor' : 'none' }} />
          </button>
          <button onClick={onClear} title="Limpar" className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-white/5"><Trash2 className="w-3.5 h-3.5" /></button>
          <button onClick={onClose} title="Fechar" className="p-1 rounded text-slate-500 hover:text-red-300 hover:bg-white/5"><X className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {s.host && <div className="text-[11px] text-slate-400">destino <span className="font-mono text-slate-200">{s.host}</span></div>}

        {/* qualidade */}
        <div className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: `${s.quality.color}40`, background: `${s.quality.color}12` }}>
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Qualidade</span>
          <span className="text-sm font-bold" style={{ color: s.quality.color }}>{s.quality.label}</span>
        </div>

        {/* pacotes */}
        <div className="grid grid-cols-3 gap-2">
          <Box label="Enviados" value={s.sent} color="#38bdf8" />
          <Box label="Recebidos" value={s.recv} color="#34d399" />
          <Box label="Perda" value={`${(s.lossPct || 0).toFixed(0)}%`} color={s.lossPct > 0 ? '#fb7185' : '#34d399'} />
        </div>

        {/* gráfico de respostas */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Respostas (ms)</span>
            <span className="text-[10px] font-mono" style={{ color: classifyLatency(s.current).color }}>
              {s.current != null ? `${fmt(s.current)} ms · ${classifyLatency(s.current).label}` : '—'}
            </span>
          </div>
          <Spark series={s.series} scaleMax={s.scaleMax} />
        </div>

        {/* latências */}
        <div className="grid grid-cols-4 gap-2">
          <Box label="mín" value={fmt(s.min)} small color={classifyLatency(s.min).color} />
          <Box label="médio" value={fmt(s.avg)} small color={classifyLatency(s.avg).color} />
          <Box label="máx" value={fmt(s.max)} small color={classifyLatency(s.max).color} />
          <Box label="jitter" value={fmt(s.jitter)} small color="#94a3b8" />
        </div>

        {/* legenda de faixas */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 pt-1 border-t border-white/5">
          <Key c="#34d399" t="< 30 rápido" /><Key c="#22d3ee" t="30–80 médio" /><Key c="#fbbf24" t="80–150 aceitável" /><Key c="#fb923c" t="150–300 lento" /><Key c="#f87171" t="> 300" />
        </div>

        {/* disparo manual de ping (libera o terminal — roda em 2º plano) */}
        {typeof onRun === 'function' && (
          <div className="pt-2 border-t border-white/5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Disparar ping manual</div>
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
                  title="Parar o ping em execução"
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors"
                  style={{ background: 'rgba(248,113,113,0.16)', color: '#fca5a5', border: '1px solid rgba(248,113,113,0.4)' }}>
                  <Square className="w-3 h-3" /> parar
                </button>
              ) : (
                <button onClick={fire} disabled={!canRun}
                  title="Inicia o ping numa conexão paralela — o terminal continua livre"
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'color-mix(in srgb, var(--cyber-primary) 18%, transparent)', color: 'var(--cyber-primary)', border: '1px solid color-mix(in srgb, var(--cyber-primary) 35%, transparent)' }}>
                  <Play className="w-3 h-3" /> {running ? 'em execução' : 'iniciar'}
                </button>
              )}
            </div>
            {stoppable ? (
              <div className="text-[9px] text-emerald-400/80 mt-1">Ping rodando em conexão paralela — o terminal está livre.</div>
            ) : running ? (
              <div className="text-[9px] text-amber-400/80 mt-1">Já existe um ping em execução.</div>
            ) : (
              <div className="text-[9px] text-slate-500 mt-1">Roda numa conexão SSH paralela — o terminal fica livre, sem poluir a tela.</div>
            )}
          </div>
        )}

        {s.series.length === 0 && (
          <div className="text-center text-slate-600 text-[11px] py-3">
            Digite um IP/host acima e clique <span className="text-slate-400">iniciar</span>, ou rode <span className="font-mono text-slate-400">ping &lt;host&gt;</span> no terminal.
          </div>
        )}
      </div>
    </motion.div>
  );
  return isFloat ? createPortal(body, document.body) : body;
};

const Box = ({ label, value, color, small }) => (
  <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-center">
    <div className={`${small ? 'text-sm' : 'text-lg'} font-bold tabular-nums leading-none`} style={{ color }}>{value}</div>
    <div className="text-[8px] uppercase tracking-wide text-slate-500 mt-0.5">{label}</div>
  </div>
);

const Key = ({ c, t }) => (<span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: c }} /> {t}</span>);

// mini-gráfico de barras das respostas (perda = barra vermelha cheia)
const Spark = ({ series, scaleMax }) => {
  const W = 320, H = 56, n = Math.max(series.length, 1), bw = W / Math.max(n, 24);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none">
      <line x1="0" y1={H - 1} x2={W} y2={H - 1} stroke="rgba(148,163,184,0.2)" strokeWidth="1" />
      {series.map((x, i) => {
        const px = i * bw + bw * 0.15, w = bw * 0.7;
        if (x.kind === 'loss') {
          return <rect key={i} x={px} y={2} width={w} height={H - 3} fill="rgba(248,113,113,0.28)" rx="1" />;
        }
        const c = classifyLatency(x.time).color;
        const h = Math.max(2, (Math.min(x.time, scaleMax) / scaleMax) * (H - 6));
        return <rect key={i} x={px} y={H - 1 - h} width={w} height={h} fill={c} rx="1" />;
      })}
    </svg>
  );
};

export default PingParseOverlay;
