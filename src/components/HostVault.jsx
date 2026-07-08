import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Server, Zap, Plus, Trash2, Star, KeyRound, Save, Wifi, Pencil, X, Search, Activity, Loader2, Share2, Users as UsersIcon, Globe, Lock, Check } from 'lucide-react';
import { api, pingHost, getDirectory } from '../lib/api.js';
import { sfx } from '../lib/sound.js';
import { useI18n } from '../lib/i18n.js';

const COLORS = ['#00f0ff', '#ff2bd6', '#b6ff00', '#ffb000', '#9b5cff', '#ff6b6b'];

function parseTarget(raw) {
  let s = String(raw || '').trim();
  if (!s) return { ip: '' };
  let username;
  const at = s.lastIndexOf('@');
  if (at >= 0) { username = s.slice(0, at).trim() || undefined; s = s.slice(at + 1).trim(); }
  let ip = s, port;
  const m6 = s.match(/^\[(.+)\](?::(\d+))?$/);
  if (m6) { ip = m6[1]; port = m6[2] ? Number(m6[2]) : undefined; }
  else {
    const colons = (s.match(/:/g) || []).length;
    if (colons === 1) { const [h, p] = s.split(':'); ip = h; if (p && /^\d+$/.test(p)) port = Number(p); }
  }
  return { username, ip: ip.trim(), port };
}

// ── Seletor de compartilhamento reutilizável (privado / todos / usuários) ──
function SharePicker({ value, onChange, dirUsers, meId, canSharePassword }) {
  const share = value.share || 'private';
  const sharedWith = value.sharedWith || [];
  const others = dirUsers.filter((u) => u.id !== meId);
  const toggleUser = (id) => {
    const has = sharedWith.includes(id);
    onChange({ ...value, sharedWith: has ? sharedWith.filter((x) => x !== id) : [...sharedWith, id] });
  };
  const Btn = ({ mode, icon: Icon, label }) => (
    <button type="button" onClick={() => { sfx.toggle(); onChange({ ...value, share: mode }); }}
      className={`btn ${share === mode ? '' : 'btn-ghost'} flex items-center gap-1.5`} style={{ padding: '5px 9px', fontSize: 10 }}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
  return (
    <div className="space-y-2 p-2.5 rounded-lg border border-theme">
      <div className="flex items-center gap-1.5 text-[10px] tracking-cyber" style={{ color: 'var(--text-dim)' }}>
        <Share2 className="w-3.5 h-3.5" /> COMPARTILHAMENTO
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Btn mode="private" icon={Lock} label="Privado" />
        <Btn mode="all" icon={Globe} label="Todos" />
        <Btn mode="users" icon={UsersIcon} label="Escolher" />
      </div>
      {share === 'users' && (
        <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
          {others.length === 0 && <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Nenhum outro usuário no sistema.</p>}
          {others.map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-[12px] cursor-pointer px-1.5 py-1 rounded hover:bg-theme-soft" style={{ color: 'var(--text)' }}>
              <input type="checkbox" checked={sharedWith.includes(u.id)} onChange={() => toggleUser(u.id)} />
              {u.username}
            </label>
          ))}
        </div>
      )}
      {share !== 'private' && canSharePassword && (
        <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: 'var(--cyber-warn)' }}>
          <input type="checkbox" checked={!!value.sharePassword} onChange={(e) => onChange({ ...value, sharePassword: e.target.checked })} />
          Incluir a senha salva para quem receber
        </label>
      )}
    </div>
  );
}

export default function HostVault({ onConnect, collapsed = false, quickOpen = false, onCloseQuick }) {
  const { t } = useI18n();
  const [hosts, setHosts] = useState([]);
  const [form, setForm] = useState({ ip: '', port: 22, username: 'root', password: '', keyPath: '', passphrase: '', label: '', color: COLORS[0], save: false, savePassword: false, share: 'private', sharedWith: [], sharePassword: false });
  const [useKey, setUseKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [pings, setPings] = useState({});
  const [dirUsers, setDirUsers] = useState([]);
  const [meId, setMeId] = useState('');
  const [shareHost, setShareHost] = useState(null); // host sendo compartilhado (edição)

  const doPing = async (h) => {
    sfx.click();
    setPings((p) => ({ ...p, [h.id]: { state: 'checking' } }));
    try {
      const r = await pingHost(h.id);
      setPings((p) => ({ ...p, [h.id]: r.ok ? { state: 'ok', ms: r.ms } : { state: 'fail', error: r.error } }));
      if (r.ok) sfx.success(); else sfx.error();
    } catch { setPings((p) => ({ ...p, [h.id]: { state: 'fail' } })); sfx.error(); }
  };

  const load = async () => {
    try { setHosts(await api.get('/hosts')); } catch { /* ignore */ } finally { setLoading(false); }
  };
  useEffect(() => {
    load();
    (async () => {
      try {
        const [dir, me] = await Promise.all([getDirectory(), api.get('/auth/me')]);
        setDirUsers(dir); setMeId(me?.user?.id || '');
      } catch { /* ignore */ }
    })();
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const resolved = () => {
    const t = parseTarget(form.ip);
    return { ip: t.ip, port: t.port || Number(form.port) || 22, username: t.username || form.username };
  };

  const saveHost = async () => {
    const r = resolved();
    if (!r.ip || !r.username) { sfx.error(); return null; }
    sfx.toggle();
    try {
      const saved = await api.post('/hosts', {
        label: form.label || r.ip, ip: r.ip, port: r.port, username: r.username,
        color: form.color, savePassword: form.savePassword, password: form.password,
        share: form.share, sharedWith: form.sharedWith, sharePassword: form.savePassword ? form.sharePassword : false,
      });
      setHosts((h) => [...h, saved]);
      return saved;
    } catch { sfx.error(); return null; }
  };

  const connectNow = async (e) => {
    e?.preventDefault();
    const r = resolved();
    if (!r.ip || !r.username) { sfx.error(); return; }
    sfx.connect();
    if (form.save) await saveHost();
    onConnect({
      connectionParams: { ip: r.ip, port: r.port, displayName: form.label || r.ip, color: form.color },
      credentials: useKey
        ? { username: r.username, keyPath: form.keyPath, passphrase: form.passphrase }
        : { username: r.username, password: form.password },
    });
    onCloseQuick?.();
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
    onConnect({ connectionParams: { ip: h.ip, port: h.port, displayName: h.label, color: h.color }, credentials });
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? hosts.filter((h) => `${h.label} ${h.username} ${h.ip} ${h.port}`.toLowerCase().includes(q))
    : hosts;

  const remove = async (h) => {
    if (!window.confirm(t('vault.delete.confirm', { label: h.label }))) return;
    sfx.close();
    try { await api.del(`/hosts/${h.id}`); setHosts((arr) => arr.filter((x) => x.id !== h.id)); } catch {}
  };

  // Aplica a nova config de compartilhamento (edição de um host existente do dono).
  const applyShare = async (host, cfg) => {
    try {
      const updated = await api.put(`/hosts/${host.id}`, { share: cfg.share, sharedWith: cfg.sharedWith, sharePassword: host.password ? cfg.sharePassword : false });
      setHosts((arr) => arr.map((x) => (x.id === host.id ? updated : x)));
      sfx.success(); setShareHost(null);
    } catch { sfx.error(); }
  };

  const shareLabel = (h) => h.share === 'all' ? 'Compartilhado com todos' : (h.share === 'users' && (h.sharedWith || []).length) ? `Compartilhado (${h.sharedWith.length})` : '';

  return (
    <>
      {/* Quick connect — modal */}
      {createPortal(
        <AnimatePresence>
          {quickOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9998] grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.72)', backdropFilter: 'blur(5px)' }} onClick={() => onCloseQuick?.()}>
              <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
                className="glass clip-cyber w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-5 h-5 text-theme" />
                  <h2 className="font-display font-bold tracking-cyber text-theme flex-1">{t('vault.quick.title')}</h2>
                  <button onClick={() => onCloseQuick?.()}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
                </div>
        <form onSubmit={connectNow} className="space-y-2.5">
          <div className="space-y-1.5">
            <span className="text-[10px] tracking-cyber" style={{ color: 'var(--text-dim)' }}>{t('vault.target.hint')}</span>
            <input className="field w-full font-mono" placeholder={t('vault.target.ph')}
              value={form.ip} onChange={(e) => set('ip', e.target.value)} autoFocus />
            <div className="flex items-center gap-2">
              <span className="text-[10px] tracking-cyber shrink-0" style={{ color: 'var(--text-dim)' }}>{t('vault.port')}</span>
              <input className="field w-24 font-mono" placeholder="22" title={t('vault.port.title')}
                value={form.port} onChange={(e) => set('port', e.target.value)} />
            </div>
          </div>
          <input className="field font-mono" placeholder={t('vault.username')} value={form.username} onChange={(e) => set('username', e.target.value)} />

          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>
            <button type="button" onClick={() => { setUseKey(false); sfx.toggle(); }}
              className={`btn ${useKey ? 'btn-ghost' : ''}`} style={{ padding: '5px 10px', fontSize: 10 }}>{t('vault.auth.password')}</button>
            <button type="button" onClick={() => { setUseKey(true); sfx.toggle(); }}
              className={`btn ${useKey ? '' : 'btn-ghost'}`} style={{ padding: '5px 10px', fontSize: 10 }}>{t('vault.auth.key')}</button>
          </div>

          {!useKey ? (
            <input type="password" className="field font-mono" placeholder={t('vault.password')} value={form.password} onChange={(e) => set('password', e.target.value)} />
          ) : (
            <>
              <div className="relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
                <input className="field font-mono" style={{ paddingLeft: 36 }} placeholder={t('vault.keypath')} value={form.keyPath} onChange={(e) => set('keyPath', e.target.value)} />
              </div>
              <input type="password" className="field font-mono" placeholder={t('vault.passphrase')} value={form.passphrase} onChange={(e) => set('passphrase', e.target.value)} />
            </>
          )}

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: 'var(--text-dim)' }}>
              <input type="checkbox" checked={form.save} onChange={(e) => set('save', e.target.checked)} />
              <Save className="w-3.5 h-3.5" /> {t('vault.savehost')}
            </label>
            {form.save && (
              <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: 'var(--cyber-warn)' }}>
                <input type="checkbox" checked={form.savePassword} onChange={(e) => set('savePassword', e.target.checked)} /> {t('vault.storepw')}
              </label>
            )}
          </div>
          {form.save && (
            <div className="flex items-center gap-2">
              <input className="field flex-1 font-mono" placeholder={t('vault.label')} value={form.label} onChange={(e) => set('label', e.target.value)} />
              <div className="flex gap-1">
                {COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => set('color', c)}
                    className="w-5 h-5 rounded-full" style={{ background: c, outline: form.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />
                ))}
              </div>
            </div>
          )}
          {form.save && (
            <SharePicker value={{ share: form.share, sharedWith: form.sharedWith, sharePassword: form.sharePassword }}
              onChange={(v) => setForm((f) => ({ ...f, ...v }))} dirUsers={dirUsers} meId={meId} canSharePassword={form.savePassword} />
          )}

          <div className="flex gap-2">
            <button type="submit" className="btn flex-1 flex items-center justify-center gap-2" onMouseEnter={() => sfx.hover()}>
              <Wifi className="w-4 h-4" /> {t('vault.establish')}
            </button>
            <button type="button" onClick={saveHost} className="btn btn-ghost flex items-center justify-center gap-1.5"
              title={t('vault.save.title')} onMouseEnter={() => sfx.hover()}>
              <Save className="w-4 h-4" /> {t('vault.save')}
            </button>
          </div>
        </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>, document.body)}

      {/* Diálogo de compartilhamento de um host salvo (só o dono) */}
      {createPortal(
        <AnimatePresence>
          {shareHost && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9999] grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.72)', backdropFilter: 'blur(5px)' }} onClick={() => setShareHost(null)}>
              <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
                className="glass clip-cyber w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-3">
                  <Share2 className="w-5 h-5 text-theme" />
                  <h2 className="font-display font-bold tracking-cyber text-theme flex-1 truncate">Compartilhar “{shareHost.label}”</h2>
                  <button onClick={() => setShareHost(null)}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
                </div>
                <SharePicker value={shareHost._draft} onChange={(v) => setShareHost((s) => ({ ...s, _draft: { ...s._draft, ...v } }))}
                  dirUsers={dirUsers} meId={meId} canSharePassword={!!shareHost.password} />
                <button onClick={() => applyShare(shareHost, shareHost._draft)} className="btn w-full flex items-center justify-center gap-2 mt-3">
                  <Check className="w-4 h-4" /> Salvar
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>, document.body)}

      {/* Saved hosts — collapsible sidebar */}
      <AnimatePresence>
        {!collapsed && (
          <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width: 300, opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="shrink-0 min-h-0 overflow-hidden h-full">
            <div style={{ width: 300 }} className="h-full overflow-y-auto overflow-x-hidden">
      <div className="glass p-4 h-full flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <Star className="w-4 h-4" style={{ color: 'var(--cyber-secondary)' }} />
          <h2 className="font-display font-bold text-sm tracking-cyber neon-pink">{t('vault.saved.title')}</h2>
          <span className="ml-auto text-[11px]" style={{ color: 'var(--text-dim)' }}>{q ? `${filtered.length}/${hosts.length}` : hosts.length}</span>
        </div>
        {hosts.length > 0 && (
          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
            <input className="field w-full font-mono" style={{ padding: '6px 8px 6px 30px', fontSize: 12 }} placeholder={t('vault.search')}
              value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-theme-soft" title={t('vault.search.clear')}><X className="w-3.5 h-3.5" style={{ color: 'var(--text-dim)' }} /></button>}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          {loading && <p className="text-xs" style={{ color: 'var(--text-dim)' }}>{t('vault.loading')}</p>}
          {!loading && hosts.length === 0 && (
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>{t('vault.none')}</p>
          )}
          {!loading && hosts.length > 0 && filtered.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>{t('vault.nomatch', { q: query })}</p>
          )}
          <AnimatePresence>
            {filtered.map((h) => (
              <motion.div key={h.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
                className="group flex items-center gap-3 p-2.5 rounded-lg border border-theme hover:bg-theme-soft transition-colors cursor-pointer"
                onClick={() => connectSaved(h)} onMouseEnter={() => sfx.hover()}>
                <span className="status-dot" style={{ background: h.color, boxShadow: `0 0 10px ${h.color}` }} />
                <div className="min-w-0 flex-1">
                  <div className="font-display font-bold text-sm truncate flex items-center gap-1.5" style={{ color: h.color }}>
                    <span className="truncate">{h.label}</span>
                    {h.shared && <span title={`Compartilhado por ${h.ownerName || 'outro usuário'}`}><UsersIcon className="w-3 h-3 shrink-0" style={{ color: 'var(--text-dim)' }} /></span>}
                    {h.mine && h.share && h.share !== 'private' && <span title={shareLabel(h)}><Share2 className="w-3 h-3 shrink-0" style={{ color: 'var(--cyber-accent)' }} /></span>}
                  </div>
                  <div className="font-mono text-[11px] truncate flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}>
                    <span className="truncate">{h.username}@{h.ip}:{h.port}{h.password ? ' · pw' : ''}{h.shared ? ` · ${h.ownerName || 'compart.'}` : ''}</span>
                    {pings[h.id] && (
                      pings[h.id].state === 'checking'
                        ? <span className="shrink-0 flex items-center gap-0.5" style={{ color: 'var(--cyber-primary)' }}><Loader2 className="w-3 h-3 animate-spin" /></span>
                        : pings[h.id].state === 'ok'
                          ? <span className="shrink-0" style={{ color: 'var(--cyber-accent)' }}>● {pings[h.id].ms}ms</span>
                          : <span className="shrink-0" style={{ color: 'var(--cyber-danger)' }}>● {pings[h.id].error || t('vault.ping.fail')}</span>
                    )}
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); doPing(h); }}
                  className="opacity-60 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-theme-soft" title={t('vault.ping.title')}>
                  <Activity className="w-3.5 h-3.5 text-theme" />
                </button>
                {h.mine && (
                  <button onClick={(e) => { e.stopPropagation(); sfx.click(); setShareHost({ ...h, _draft: { share: h.share || 'private', sharedWith: h.sharedWith || [], sharePassword: !!h.sharePassword } }); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-theme-soft" title="Compartilhar">
                    <Share2 className="w-3.5 h-3.5 text-theme" />
                  </button>
                )}
                {h.mine && (
                  <button onClick={(e) => { e.stopPropagation(); remove(h); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-black/40" title={t('vault.delete')}>
                    <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--cyber-danger)' }} />
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
