import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, LogOut, Zap, Server, Search, X, KeyRound, Wifi, Plus, ChevronLeft, Users as UsersIcon } from 'lucide-react';
import { api, logout as apiLogout } from '../lib/api.js';
import { sfx } from '../lib/sound.js';
import { useI18n } from '../lib/i18n.js';
import TerminalTab from './TerminalTab.jsx';

/**
 * MobileApp — layout compacto para telas de celular (largura ≤ 768px).
 * Lista os hosts do usuário (inclui compartilhados), permite conexão rápida e
 * abre uma sessão SSH em tela cheia reutilizando o TerminalTab.
 */
let seq = 0;

export default function MobileApp({ user, onLogout }) {
  const { t } = useI18n();
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [session, setSession] = useState(null); // sessão ativa ou null
  const [form, setForm] = useState({ ip: '', port: 22, username: 'root', password: '' });
  const [termSettings] = useState(() => { try { return JSON.parse(localStorage.getItem('tng_term_settings') || '{}'); } catch { return {}; } });

  const load = async () => { try { setHosts(await api.get('/hosts')); } catch { /* ignore */ } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const logout = () => { sfx.close(); apiLogout(); onLogout(); };

  const startSession = (connectionParams, credentials) => {
    seq += 1;
    setSession({ id: `s${seq}`, num: seq, connectionParams, credentials });
  };

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const connectForm = (e) => {
    e?.preventDefault();
    const ip = String(form.ip || '').trim();
    if (!ip) { sfx.error(); return; }
    sfx.connect();
    startSession(
      { ip, port: Number(form.port) || 22, displayName: ip, color: '#00f0ff' },
      { username: form.username || 'root', password: form.password },
    );
    setShowConnect(false);
  };

  const connectSaved = async (h) => {
    sfx.connect();
    try { await api.post(`/hosts/${h.id}/touch`); } catch {}
    const credentials = { username: h.username };
    if (h.password) credentials.password = h.password;
    else {
      const pw = window.prompt(t('vault.passkey.prompt', { user: h.username, ip: h.ip }), '');
      if (pw === null) return;
      if (pw) credentials.password = pw;
    }
    startSession({ ip: h.ip, port: h.port, displayName: h.label, color: h.color }, credentials);
  };

  // ── Sessão ativa: terminal em tela cheia ──
  if (session) {
    return (
      <div className="relative z-10 h-full w-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0" style={{ borderColor: 'rgba(0,240,255,0.15)', background: 'var(--bg-0)' }}>
          <button onClick={() => { sfx.close(); setSession(null); }} className="btn btn-ghost flex items-center gap-1" style={{ padding: '6px 8px' }}>
            <ChevronLeft className="w-4 h-4" /> <span className="text-[12px]">hosts</span>
          </button>
          <span className="font-display font-bold text-sm truncate" style={{ color: session.connectionParams.color }}>{session.connectionParams.displayName}</span>
          <button onClick={logout} className="ml-auto btn btn-ghost" style={{ padding: 6 }} title={t('header.logout')}><LogOut className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 min-h-0">
          <TerminalTab session={session} isVisible={true} termSettings={termSettings} />
        </div>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? hosts.filter((h) => `${h.label} ${h.username} ${h.ip} ${h.port}`.toLowerCase().includes(q)) : hosts;

  // ── Lista de hosts / conexão ──
  return (
    <div className="relative z-10 h-full w-full flex flex-col">
      <header className="flex items-center gap-2 px-4 py-3 border-b shrink-0" style={{ borderColor: 'rgba(0,240,255,0.18)' }}>
        <div className="grid place-items-center w-8 h-8 rounded-lg border border-theme bg-theme-soft"><Terminal className="w-4 h-4 text-theme" /></div>
        <h1 className="font-display text-sm font-black" style={{ color: 'var(--cyber-primary)' }}>TERMINAL//NG</h1>
        <span className="ml-auto text-[11px] font-mono" style={{ color: 'var(--text-dim)' }}>op://{user.username}</span>
        <button onClick={logout} className="btn btn-ghost" style={{ padding: 6 }} title={t('header.logout')}><LogOut className="w-4 h-4" /></button>
      </header>

      <div className="px-4 py-3 shrink-0">
        <button onClick={() => { sfx.click(); setShowConnect(true); }} className="btn w-full flex items-center justify-center gap-2">
          <Zap className="w-4 h-4" /> {t('vault.quick.title')}
        </button>
      </div>

      <div className="px-4 pb-2 shrink-0">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
          <input className="field w-full font-mono" style={{ paddingLeft: 36 }} placeholder={t('vault.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6 space-y-2">
        {loading && <p className="text-xs" style={{ color: 'var(--text-dim)' }}>{t('vault.loading')}</p>}
        {!loading && hosts.length === 0 && <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>{t('vault.none')}</p>}
        {!loading && filtered.map((h) => (
          <button key={h.id} onClick={() => connectSaved(h)}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-theme text-left active:bg-theme-soft transition-colors">
            <span className="status-dot" style={{ background: h.color, boxShadow: `0 0 8px ${h.color}` }} />
            <div className="min-w-0 flex-1">
              <div className="font-display font-bold text-sm truncate flex items-center gap-1.5" style={{ color: h.color }}>
                <span className="truncate">{h.label}</span>
                {h.shared && <UsersIcon className="w-3 h-3 shrink-0" style={{ color: 'var(--text-dim)' }} />}
              </div>
              <div className="font-mono text-[11px] truncate" style={{ color: 'var(--text-dim)' }}>
                {h.username}@{h.ip}:{h.port}{h.shared && h.ownerName ? ` · ${h.ownerName}` : ''}
              </div>
            </div>
            <Wifi className="w-4 h-4 shrink-0 text-theme" />
          </button>
        ))}
      </div>

      {/* Conexão rápida — bottom sheet */}
      <AnimatePresence>
        {showConnect && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9998] flex flex-col justify-end" style={{ background: 'rgba(2,3,8,0.7)', backdropFilter: 'blur(4px)' }} onClick={() => setShowConnect(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              className="glass rounded-t-3xl p-5 pb-7" style={{ maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-5 h-5 text-theme" />
                <h2 className="font-display font-bold tracking-cyber text-theme flex-1">{t('vault.quick.title')}</h2>
                <button onClick={() => setShowConnect(false)}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
              </div>
              <form onSubmit={connectForm} className="space-y-3">
                <input className="field w-full font-mono" placeholder={t('vault.target.ph')} value={form.ip} onChange={(e) => setF('ip', e.target.value)} autoFocus />
                <div className="flex items-center gap-2">
                  <input className="field flex-1 font-mono" placeholder={t('vault.username')} value={form.username} onChange={(e) => setF('username', e.target.value)} />
                  <input className="field w-24 font-mono" placeholder="22" value={form.port} onChange={(e) => setF('port', e.target.value)} />
                </div>
                <div className="relative">
                  <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
                  <input type="password" className="field w-full font-mono" style={{ paddingLeft: 36 }} placeholder={t('vault.password')} value={form.password} onChange={(e) => setF('password', e.target.value)} />
                </div>
                <button type="submit" className="btn w-full flex items-center justify-center gap-2">
                  <Wifi className="w-4 h-4" /> {t('vault.establish')}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
