import React, { useState, useRef, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react';
import { Activity, ShieldCheck, Loader2, PlugZap, Cpu, MemoryStick, ChevronLeft, ChevronRight, LayoutDashboard, Bot, RotateCw } from 'lucide-react';
import { motion } from 'framer-motion';
import XTerminal from './terminal/XTerminal.jsx';
import SystemDashboard from './SystemDashboard.jsx';
import { terminalWsUrl } from '../lib/api.js';
import { sfx } from '../lib/sound.js';
import * as bus from '../lib/bus.js';

/**
 * TerminalTab — one SSH session. Wraps the ported XTerminal (with all its live
 * parsers/overlays) and adds a status header + listening-services bar.
 */
const TerminalTab = forwardRef(({ session, isVisible, onActivity, onInput, termSettings }, ref) => {
  const [status, setStatus] = useState('connecting');
  const [statusMsg, setStatusMsg] = useState('');
  const [services, setServices] = useState([]);
  const [stats, setStats] = useState({ cpu: null, mem: null });
  const termRef = useRef(null);
  const lastStatusRef = useRef(null);
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;
  const lastActivityRef = useRef(0);
  const svcScrollRef = useRef(null);
  const usersRef = useRef(null);
  const [showDash, setShowDash] = useState(false);
  const [dashData, setDashData] = useState(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [aiControlled, setAiControlled] = useState(false);
  const [reconnectN, setReconnectN] = useState(0);

  // Remount XTerminal to establish a fresh SSH connection after a failure/drop.
  const reconnect = useCallback(() => { sfx.click(); usersRef.current = null; setStatus('connecting'); setStatusMsg('reconnecting…'); setReconnectN((n) => n + 1); }, []);

  // Discreet "AI controlling this terminal" signal (avoid user interference).
  React.useEffect(() => {
    const off = bus.on('tng:ai', ({ sessionId, on }) => { if (sessionId === session.id) setAiControlled(!!on); });
    return off;
  }, [session.id]);

  // Ask the terminal for system info; always settle (timeout) so the panel
  // never spins forever if the backend doesn't answer.
  const requestSys = useCallback(() => {
    setDashLoading(true);
    let settled = false;
    const done = (d) => { if (settled) return; settled = true; setDashData(d); setDashLoading(false); if (d) sfx.success(); };
    const ok = termRef.current?.requestSysinfo?.(done);
    if (ok === false) { done(null); return; }
    setTimeout(() => done(null), 15000);
  }, []);
  const openDash = useCallback(() => {
    if (!termRef.current?.isConnected?.()) return;
    sfx.click();
    setShowDash(true);
    requestSys();
  }, [requestSys]);
  const refreshDash = useCallback(() => { requestSys(); }, [requestSys]);

  useImperativeHandle(ref, () => ({
    getSessionLog: () => termRef.current?.getSessionLog?.() || { content: '', startedAt: null },
    runScript: (code) => termRef.current?.runScript?.(code),
    isConnected: () => !!termRef.current?.isConnected?.(),
    sshFetch: (url) => termRef.current?.sshFetch?.(url),
    sendInput: (data) => termRef.current?.sendInput?.(data),
    focus: () => termRef.current?.focus?.(),
  }), []);

  // STABLE callbacks/URL — recreating these each render retriggers XTerminal's
  // connect effect, which caused an infinite reconnect (and the SFX machine-gun).
  const wsUrl = useMemo(() => terminalWsUrl(), []);

  const onStatus = useCallback((s, msg) => {
    setStatus(s);
    if (msg) setStatusMsg(msg);
    // Only fire a sound on an actual status transition, never repeatedly.
    if (s !== lastStatusRef.current) {
      if (s === 'connected') sfx.success();
      if (s === 'error') sfx.error();
      lastStatusRef.current = s;
    }
  }, []);

  const onServices = useCallback((payload) => {
    // payload = { list, cpu, mem, users }. Replacing the whole list each poll
    // means a port that stopped listening automatically disappears from the bar.
    setServices(Array.isArray(payload?.list) ? payload.list : []);
    setStats({ cpu: payload?.cpu ?? null, mem: payload?.mem ?? null });
    // Watch logged-in users → notify on login/logout (skip the first baseline).
    const users = Array.isArray(payload?.users) ? payload.users : [];
    const key = (u) => `${u.user}@${u.tty}`;
    const now = new Map(users.map((u) => [key(u), u]));
    const prev = usersRef.current;
    if (prev) {
      const host = `#${session.num} ${session.connectionParams.displayName}`;
      for (const [k, u] of now) if (!prev.has(k)) bus.emit('tng:notify', { kind: 'login', text: `${u.user} entrou em ${host}${u.from ? ' (' + u.from + ')' : ''}`, host });
      for (const [k, u] of prev) if (!now.has(k)) bus.emit('tng:notify', { kind: 'logout', text: `${u.user} saiu de ${host}`, host });
    }
    usersRef.current = now;
  }, [session.id, session.num, session.connectionParams.displayName]);

  // Signal background activity (throttled) only when this tab is not visible.
  const handleActivity = useCallback(() => {
    if (isVisibleRef.current) return;
    const now = Date.now();
    if (now - lastActivityRef.current < 300) return;
    lastActivityRef.current = now;
    onActivity?.(session.id);
  }, [onActivity, session.id]);

  const handleCommand = useCallback((payload) => {
    bus.emit('tng:cmd', { sessionId: session.id, ...payload });
  }, [session.id]);

  const dotClass = status === 'connected' ? 'dot-on' : status === 'connecting' ? 'dot-busy' : status === 'error' ? 'dot-err' : 'dot-off';
  const c = session.connectionParams.color || '#00f0ff';

  return (
    <div className="h-full flex flex-col" style={{ display: isVisible ? 'flex' : 'none' }}>
      {/* status header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b" style={{ borderColor: aiControlled ? 'color-mix(in srgb, var(--cyber-secondary) 45%, transparent)' : 'rgba(0,240,255,0.15)' }}>
        <span className={`status-dot ${dotClass}`} style={status === 'connected' ? { background: c, boxShadow: `0 0 10px ${c}` } : undefined} />
        {session.num != null && <span className="font-mono text-[11px] px-1.5 rounded" style={{ background: 'color-mix(in srgb, var(--cyber-primary) 16%, transparent)', color: 'var(--cyber-primary)' }}>#{session.num}</span>}
        <span className="font-display font-bold text-sm" style={{ color: c }}>{session.connectionParams.displayName}</span>
        <span className="font-mono text-[11px]" style={{ color: 'var(--text-dim)' }}>
          {session.credentials.username}@{session.connectionParams.ip}:{session.connectionParams.port}
        </span>
        {aiControlled && (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full" title="Terminal sob controle da IA — evite digitar"
            style={{ background: 'color-mix(in srgb, var(--cyber-secondary) 16%, transparent)', border: '1px solid color-mix(in srgb, var(--cyber-secondary) 45%, transparent)', color: 'var(--cyber-secondary)' }}>
            <Bot className="w-3 h-3" /><motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}>IA</motion.span>
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>
          {status === 'connecting' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {statusMsg || 'linking…'}</>}
          {status === 'connected' && <><ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--cyber-accent)' }} /> secured</>}
          {status === 'error' && <span style={{ color: 'var(--cyber-danger)' }}><PlugZap className="w-3.5 h-3.5 inline" /> {statusMsg || 'link failed'}</span>}
          {status === 'disconnected' && <>offline</>}
        </span>
        {(status === 'error' || status === 'disconnected') && (
          <button onClick={reconnect} title="Reconectar esta sessão"
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] transition-colors hover:bg-theme-soft"
            style={{ borderColor: 'color-mix(in srgb, var(--cyber-accent) 50%, transparent)', color: 'var(--cyber-accent)' }}>
            <RotateCw className="w-3.5 h-3.5" /> reconectar
          </button>
        )}
        <button onClick={openDash} disabled={status !== 'connected'} title="Painel do sistema · CPU, memória, disco, processos, logs"
          className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-theme text-[11px] transition-colors hover:bg-theme-soft disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: c }}>
          <LayoutDashboard className="w-3.5 h-3.5" /> intel
        </button>
      </div>

      <SystemDashboard open={showDash} data={dashData} loading={dashLoading} hostName={session.connectionParams.displayName} color={c}
        onClose={() => { sfx.toggle(); setShowDash(false); }} onRefresh={refreshDash} />

      {/* terminal surface */}
      <div className="flex-1 min-h-0">
        <XTerminal
          key={reconnectN}
          ref={termRef}
          wsUrl={wsUrl}
          connectionParams={session.connectionParams}
          credentials={session.credentials}
          onStatusChange={onStatus}
          onServices={onServices}
          onActivity={handleActivity}
          onCommand={handleCommand}
          onInput={onInput}
          termSettings={termSettings}
          isVisible={isVisible}
          sessionLabel={`${session.num != null ? '#' + session.num + ' ' : ''}${session.connectionParams.displayName}`}
        />
      </div>

      {/* stats + listening services bar */}
      {(services.length > 0 || stats.cpu != null || stats.mem) && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-t overflow-hidden" style={{ borderColor: 'rgba(0,240,255,0.15)' }}>
          {stats.cpu != null && <Gauge icon={Cpu} label="CPU" pct={stats.cpu} text={`${stats.cpu}%`} />}
          {stats.mem && <Gauge icon={MemoryStick} label="MEM" pct={stats.mem.pct} text={`${stats.mem.pct}% · ${fmtMem(stats.mem.usedMb)}/${fmtMem(stats.mem.totalMb)}`} />}
          {(stats.cpu != null || stats.mem) && services.length > 0 && (
            <span className="shrink-0 w-px h-4" style={{ background: 'rgba(0,240,255,0.2)' }} />
          )}
          {services.length > 0 && (
            <>
              <Activity className="w-3.5 h-3.5 shrink-0 text-theme" />
              <button onClick={() => svcScrollRef.current?.scrollBy({ left: -220, behavior: 'smooth' })} className="shrink-0 p-0.5 rounded hover:bg-theme-soft" title="anterior"><ChevronLeft className="w-4 h-4 text-theme-soft" /></button>
              <div ref={svcScrollRef} className="flex gap-1.5 overflow-x-auto no-scrollbar" style={{ scrollBehavior: 'smooth' }}>
                {services.slice(0, 80).map((s) => (
                  <span key={`${s.proto}/${s.port}/${s.process || ''}`}
                    className="shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded border border-theme text-theme-soft"
                    title={`${s.proto} · ${s.process || 'unknown'}`}>
                    {s.port}{s.service ? `·${s.service}` : (s.process ? `·${s.process}` : '')}
                  </span>
                ))}
              </div>
              <button onClick={() => svcScrollRef.current?.scrollBy({ left: 220, behavior: 'smooth' })} className="shrink-0 p-0.5 rounded hover:bg-theme-soft" title="próximo"><ChevronRight className="w-4 h-4 text-theme-soft" /></button>
            </>
          )}
        </div>
      )}
    </div>
  );
});

function fmtMem(mb) {
  if (mb == null) return '?';
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${mb}M`;
}

function Gauge({ icon: Icon, label, pct, text }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const color = p >= 85 ? 'var(--cyber-danger)' : p >= 60 ? 'var(--cyber-warn)' : 'var(--cyber-accent)';
  return (
    <div className="shrink-0 flex items-center gap-1.5" title={`${label} ${text}`}>
      <Icon className="w-3.5 h-3.5" style={{ color }} />
      <span className="font-display text-[10px] tracking-cyber" style={{ color: 'var(--text-dim)' }}>{label}</span>
      <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div style={{ width: `${Math.max(2, p)}%`, height: '100%', background: color, transition: 'width 0.4s ease' }} />
      </div>
      <span className="font-mono text-[10px]" style={{ color }}>{text}</span>
    </div>
  );
}

TerminalTab.displayName = 'TerminalTab';
export default TerminalTab;
