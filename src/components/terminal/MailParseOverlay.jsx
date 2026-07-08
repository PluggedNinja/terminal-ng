/**
 * MailParseOverlay.jsx
 * Overlay flutuante do "Modo Parse" — exibe linhas do mail.log do Postfix
 * formatadas de forma amigável (para leigo), com contadores ao vivo.
 *
 * Interações:
 *  • Clicar nos contadores (ENTREGUE/ADIADO/REJEITADO/CONEXÕES) filtra a lista.
 *  • Clicar num card abre o histórico completo daquele e-mail (mesma fila).
 *  • Botão de "fixar" no header mantém o painel aberto (não auto-esconde).
 */
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, Clock, XCircle, ShieldX, Undo2, Plug, AlertTriangle,
  CircleDot, Mail, X, Trash2, Radio, Pin, ChevronLeft, ListFilter, Ban, Play, Square,
} from 'lucide-react';
import { kindMeta } from '../../utils/postfixLogParse';
import { useOverlayCard, CardControls } from './overlayCard';

// Extract the first IPv4/IPv6 address from a postfix origin field like
// "unknown[203.0.113.5]" or "mail.foo.com[2001:db8::1]".
function extractIp(s) {
  if (!s) return null;
  const v4 = String(s).match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  if (v4) return v4[0];
  const v6 = String(s).match(/\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/i);
  return v6 ? v6[0] : null;
}

const ICONS = {
  check: CheckCircle2, clock: Clock, x: XCircle, shield: ShieldX, undo: Undo2,
  plug: Plug, alert: AlertTriangle, dot: CircleDot,
};

// Contadores -> categorias de filtro (cada um cobre 1+ kinds do parser)
const CATS = [
  { id: 'sent', label: 'entregue', color: '#34d399', kinds: ['sent'] },
  { id: 'deferred', label: 'adiado', color: '#fbbf24', kinds: ['deferred'] },
  { id: 'rejeitado', label: 'rejeitado', color: '#f87171', kinds: ['bounced', 'reject', 'bounce'] },
  { id: 'connect', label: 'conexões', color: '#38bdf8', kinds: ['connect'] },
];

function timeShort(ts) {
  if (!ts) return '';
  const m = String(ts).match(/(\d{1,2}:\d{2}:\d{2})/);
  return m ? m[1] : '';
}

const EventCard = ({ ev, onClick, onBlock }) => {
  const meta = kindMeta(ev.kind);
  const Icon = ICONS[meta.icon] || CircleDot;
  const ip = extractIp(ev.client || ev.host2);
  return (
    <motion.div layout initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
      onClick={onClick}
      className="rounded-lg border px-2.5 py-2 mb-1.5 cursor-pointer hover:brightness-125 transition-all"
      style={{ borderColor: `${meta.color}40`, background: `${meta.color}10` }}
      title="Ver histórico completo deste e-mail">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: meta.color }} />
          <span className="text-[10px] font-bold tracking-wide" style={{ color: meta.color }}>{meta.label}</span>
          {ev.code && <span className="text-[9px] font-mono px-1 rounded bg-black/30 text-slate-400">{ev.code}</span>}
        </div>
        <span className="text-[9px] font-mono text-slate-500 flex-shrink-0">{timeShort(ev.ts)}</span>
      </div>
      <div className="mt-1 text-[11px] leading-snug text-slate-200 space-y-0.5">
        {(ev.client || ev.host2) && (
          <div className="flex items-center gap-1.5">
            <div className="truncate flex-1"><span className="text-slate-500">origem </span><span className="font-mono text-[10px] text-slate-300">{ev.client || ev.host2}</span></div>
            {ip && onBlock && (
              <button onClick={(e) => { e.stopPropagation(); onBlock(ip); }} title={`Bloquear ${ip} (firewall / rota nula)`}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold transition-colors hover:bg-red-500/15 flex-shrink-0"
                style={{ borderColor: 'color-mix(in srgb, var(--cyber-danger) 50%, transparent)', color: 'var(--cyber-danger)' }}>
                <Ban className="w-3 h-3" /> bloquear
              </button>
            )}
          </div>
        )}
        {ev.from && (
          <div className="truncate"><span className="text-slate-500">de </span><span className="font-medium">{ev.from}</span></div>
        )}
        {ev.to && (
          <div className="truncate"><span className="text-slate-500">para </span><span className="font-medium">{ev.to}</span></div>
        )}
        {ev.reason && (
          <div className="text-[10px] leading-snug" style={{ color: meta.color }}>↳ {ev.reason}</div>
        )}
        {ev.relay && ev.kind !== 'sent' && (
          <div className="truncate font-mono text-[9px] text-slate-500">via {ev.relay}</div>
        )}
      </div>
      {ev.queueId && (
        <div className="mt-1 text-[8px] font-mono text-slate-600">fila {ev.queueId}</div>
      )}
    </motion.div>
  );
};

const Counter = ({ label, value, color, active, dimmed, onClick }) => (
  <button onClick={onClick}
    className="flex-1 text-center rounded-md py-0.5 transition-all"
    style={{
      background: active ? `${color}1f` : 'transparent',
      border: `1px solid ${active ? `${color}66` : 'transparent'}`,
      opacity: dimmed ? 0.4 : 1,
    }}
    title={`Filtrar: ${label}`}>
    <div className="text-base font-bold tabular-nums leading-none" style={{ color }}>{value}</div>
    <div className="text-[8px] uppercase tracking-wide text-slate-500 mt-0.5">{label}</div>
  </button>
);

// Linha do histórico (detalhe de um e-mail)
const HistoryRow = ({ ev }) => {
  const meta = kindMeta(ev.kind);
  const Icon = ICONS[meta.icon] || CircleDot;
  return (
    <div className="flex gap-2 px-2 py-1.5 rounded-lg border" style={{ borderColor: `${meta.color}30`, background: `${meta.color}0d` }}>
      <div className="flex flex-col items-center pt-0.5">
        <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold" style={{ color: meta.color }}>{meta.label}{ev.code ? ` · ${ev.code}` : ''}</span>
          <span className="text-[9px] font-mono text-slate-500">{timeShort(ev.ts)}</span>
        </div>
        <div className="text-[10px] text-slate-300 space-y-0.5 mt-0.5">
          {(ev.client || ev.host2) && <div className="truncate font-mono text-[9px] text-slate-400">origem {ev.client || ev.host2}</div>}
          {ev.from && <div className="truncate"><span className="text-slate-500">de </span>{ev.from}</div>}
          {ev.to && <div className="truncate"><span className="text-slate-500">para </span>{ev.to}</div>}
          {ev.relay && <div className="truncate font-mono text-[9px] text-slate-500">via {ev.relay}</div>}
          {ev.reason && <div className="text-[10px]" style={{ color: meta.color }}>↳ {ev.reason}</div>}
        </div>
      </div>
    </div>
  );
};

const MailParseOverlay = ({ events, counts, auto, pinned, onClose, onClear, onTogglePin, onBlock, onRunTail, onStopTail, running, stoppable, defaultFile, floating, sessionLabel }) => {
  const [activeCats, setActiveCats] = useState(() => new Set());
  const [detailEv, setDetailEv] = useState(null);
  const [file, setFile] = useState(defaultFile || '/var/log/mail.log');
  const canTail = !!file.trim() && !running && typeof onRunTail === 'function';
  const fireTail = () => { if (canTail) onRunTail(file.trim()); };

  const toggleCat = (id) => {
    setActiveCats(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const activeKinds = useMemo(() => {
    if (activeCats.size === 0) return null;
    const s = new Set();
    CATS.forEach(c => { if (activeCats.has(c.id)) c.kinds.forEach(k => s.add(k)); });
    return s;
  }, [activeCats]);

  const filtered = useMemo(() => {
    const list = activeKinds ? events.filter(e => activeKinds.has(e.kind)) : events;
    return list.slice(0, 60);
  }, [events, activeKinds]);

  // Histórico do e-mail selecionado: todos os eventos da mesma fila (queueId).
  const history = useMemo(() => {
    if (!detailEv) return [];
    if (detailEv.queueId) {
      return events.filter(e => e.queueId && e.queueId === detailEv.queueId)
        .slice().sort((a, b) => (a._id || 0) - (b._id || 0));
    }
    return [detailEv];
  }, [detailEv, events]);

  const catValue = (id) => {
    if (id === 'sent') return counts.sent || 0;
    if (id === 'deferred') return counts.deferred || 0;
    if (id === 'rejeitado') return (counts.bounced || 0) + (counts.reject || 0);
    if (id === 'connect') return counts.connect || 0;
    return 0;
  };

  const card = useOverlayCard(floating);
  const isFloat = card.floating;

  const body = (
    <motion.div {...card.dragProps}
      initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}
      className={`${isFloat ? 'fixed top-3 right-3 bottom-3 z-[9997]' : 'absolute top-2 right-2 bottom-2 z-30'} flex flex-col rounded-xl border shadow-2xl backdrop-blur-sm`}
      style={{ width: isFloat ? 360 : 'min(360px, 46%)', borderColor: 'color-mix(in srgb, var(--cyber-primary) 25%, transparent)', background: 'color-mix(in srgb, var(--bg-2) 92%, transparent)' }}>
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'color-mix(in srgb, var(--cyber-primary) 15%, transparent)' }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <Mail className="w-4 h-4 text-theme shrink-0" />
          <span className="text-[12px] font-bold text-theme">Modo Parse</span>
          {isFloat && sessionLabel && <span className="text-[9px] px-1 rounded truncate" style={{ background: 'color-mix(in srgb, var(--cyber-primary) 16%, transparent)', color: 'var(--cyber-primary)' }}>{sessionLabel}</span>}
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-1"
            style={{ background: 'rgba(52,211,153,0.15)', color: '#6ee7b7' }}>
            <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}>
              <Radio className="w-2.5 h-2.5" />
            </motion.span>
            {pinned ? 'fixado' : (auto ? 'auto' : 'ao vivo')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <CardControls card={card} />
          <button onClick={onTogglePin} title={pinned ? 'Desafixar (volta a esconder sozinho)' : 'Fixar painel (não esconder)'}
            className="p-1 rounded transition-colors"
            style={pinned
              ? { color: 'var(--cyber-primary)', background: 'color-mix(in srgb, var(--cyber-primary) 15%, transparent)' }
              : { color: '#64748b' }}>
            <Pin className="w-3.5 h-3.5" style={{ fill: pinned ? 'currentColor' : 'none' }} />
          </button>
          <button onClick={onClear} title="Limpar" className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-white/5">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClose} title="Fechar parse" className="p-1 rounded text-slate-500 hover:text-red-300 hover:bg-white/5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* counters / filtros */}
      <div className="flex items-stretch gap-1 px-3 py-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        {CATS.map((c, i) => (
          <React.Fragment key={c.id}>
            {i > 0 && <div className="w-px bg-white/5" />}
            <Counter label={c.label} value={catValue(c.id)} color={c.color}
              active={activeCats.has(c.id)} dimmed={activeCats.size > 0 && !activeCats.has(c.id)}
              onClick={() => toggleCat(c.id)} />
          </React.Fragment>
        ))}
      </div>

      {/* escolher arquivo de log para dar tail (roda em 2º plano — terminal livre) */}
      {typeof onRunTail === 'function' && !detailEv && (
        <div className="px-3 py-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-1.5">Acompanhar arquivo de log</div>
          <div className="flex items-center gap-1.5">
            <input
              value={file} onChange={(e) => setFile(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fireTail(); }}
              disabled={running}
              placeholder="/var/log/mail.log"
              className="flex-1 min-w-0 rounded-md border px-2 py-1 text-[11px] font-mono text-slate-200 bg-black/40 outline-none disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderColor: 'color-mix(in srgb, var(--cyber-primary) 25%, transparent)' }} />
            {stoppable ? (
              <button onClick={onStopTail}
                title="Parar o acompanhamento do log"
                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors"
                style={{ background: 'rgba(248,113,113,0.16)', color: '#fca5a5', border: '1px solid rgba(248,113,113,0.4)' }}>
                <Square className="w-3 h-3" /> parar
              </button>
            ) : (
              <button onClick={fireTail} disabled={!canTail}
                title="Roda tail -f numa conexão paralela — o terminal continua livre"
                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'color-mix(in srgb, var(--cyber-primary) 18%, transparent)', color: 'var(--cyber-primary)', border: '1px solid color-mix(in srgb, var(--cyber-primary) 35%, transparent)' }}>
                <Play className="w-3 h-3" /> {running ? 'rodando' : 'tail'}
              </button>
            )}
          </div>
          {stoppable ? (
            <div className="text-[9px] text-emerald-400/80 mt-1">Acompanhando o log em conexão paralela — o terminal está livre.</div>
          ) : (
            <div className="text-[9px] text-slate-500 mt-1">Roda <span className="font-mono">tail -f</span> numa conexão SSH paralela, sem poluir o terminal.</div>
          )}
        </div>
      )}

      {activeCats.size > 0 && !detailEv && (
        <button onClick={() => setActiveCats(new Set())}
          className="mx-3 mt-2 -mb-1 self-start flex items-center gap-1 text-[9px] text-slate-400 hover:text-slate-200">
          <ListFilter className="w-3 h-3" /> limpar filtro
        </button>
      )}

      {/* corpo: lista OU histórico do e-mail */}
      {detailEv ? (
        <div className="flex-1 overflow-auto px-2.5 py-2">
          <button onClick={() => setDetailEv(null)} className="flex items-center gap-1 text-[10px] text-theme hover:brightness-125 mb-2">
            <ChevronLeft className="w-3.5 h-3.5" /> voltar à lista
          </button>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2 mb-2">
            <div className="text-[10px] text-slate-400">Histórico do e-mail</div>
            {detailEv.queueId
              ? <div className="text-[11px] font-mono text-theme">fila {detailEv.queueId}</div>
              : <div className="text-[10px] text-slate-500">sem ID de fila — mostrando apenas este evento</div>}
            {(detailEv.from || detailEv.to) && (
              <div className="text-[10px] text-slate-300 mt-1">
                {detailEv.from && <div className="truncate">de {detailEv.from}</div>}
                {detailEv.to && <div className="truncate">para {detailEv.to}</div>}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            {history.map((e, idx) => <HistoryRow key={e._id || idx} ev={e} />)}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-2.5 py-2">
          {filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 px-4">
              <Mail className="w-7 h-7 mb-2 opacity-40" />
              <p className="text-[12px]">{activeKinds ? 'Nenhum evento para o filtro selecionado.' : 'Aguardando linhas do mail.log…'}</p>
              {!activeKinds && <p className="text-[10px] mt-1 text-slate-600">Rode <span className="font-mono text-slate-400">tail -f /var/log/mail.log</span> que eu formato aqui.</p>}
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {filtered.map(ev => <EventCard key={ev._id} ev={ev} onClick={() => setDetailEv(ev)} onBlock={onBlock} />)}
            </AnimatePresence>
          )}
        </div>
      )}
    </motion.div>
  );
  return isFloat ? createPortal(body, document.body) : body;
};

export default MailParseOverlay;
