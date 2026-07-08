import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, X, Plus, Trash2, KeyRound, Shield, ShieldOff, Loader2, Check } from 'lucide-react';
import { listUsers, createUser, deleteUser, resetUserPassword, setUserRole } from '../lib/api.js';
import { sfx } from '../lib/sound.js';

/**
 * UserManager — painel de administração de contas (somente admin).
 * Lista, cria, remove, redefine senha e alterna o papel (admin/usuário).
 */
export default function UserManager({ me, onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'user' });
  const [busy, setBusy] = useState(false);

  const load = async () => { setUsers(await listUsers()); setLoading(false); };
  useEffect(() => { load(); }, []);

  const flash = (ok, text) => { setMsg({ ok, text }); if (ok) setTimeout(() => setMsg(null), 2500); };

  const add = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await createUser({ username: form.username.trim(), password: form.password, role: form.role });
      sfx.success(); setForm({ username: '', password: '', role: 'user' }); flash(true, 'Usuário criado.');
      await load();
    } catch (err) { sfx.error(); flash(false, err.message); }
    finally { setBusy(false); }
  };

  const remove = async (u) => {
    if (!window.confirm(`Excluir o usuário "${u.username}"? Os servidores dele não serão apagados, mas ele perde o acesso.`)) return;
    sfx.close();
    try { await deleteUser(u.id); flash(true, 'Usuário removido.'); await load(); }
    catch (err) { sfx.error(); flash(false, err.message); }
  };

  const resetPw = async (u) => {
    const pw = window.prompt(`Nova senha para "${u.username}" (mín. 12 caracteres):`, '');
    if (pw == null) return;
    try { await resetUserPassword(u.id, pw); sfx.success(); flash(true, 'Senha redefinida.'); }
    catch (err) { sfx.error(); flash(false, err.message); }
  };

  const toggleRole = async (u) => {
    const role = u.role === 'admin' ? 'user' : 'admin';
    try { await setUserRole(u.id, role); sfx.toggle(); await load(); }
    catch (err) { sfx.error(); flash(false, err.message); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.72)', backdropFilter: 'blur(5px)' }}
      onClick={onClose}>
      <motion.div initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} className="glass clip-cyber w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-theme" />
          <h2 className="font-display font-bold tracking-cyber text-theme flex-1">Usuários do sistema</h2>
          <button onClick={onClose}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
        </div>

        {/* Criar novo usuário */}
        <form onSubmit={add} className="flex flex-wrap items-center gap-2 mb-4">
          <input className="field font-mono flex-1 min-w-[120px]" placeholder="usuário" value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
          <input type="password" className="field font-mono flex-1 min-w-[120px]" placeholder="senha (≥12)" value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
          <button type="button" onClick={() => setForm((f) => ({ ...f, role: f.role === 'admin' ? 'user' : 'admin' }))}
            className={`btn ${form.role === 'admin' ? '' : 'btn-ghost'}`} style={{ padding: '6px 10px', fontSize: 11 }}
            title="Alternar admin">{form.role === 'admin' ? 'admin' : 'usuário'}</button>
          <button type="submit" disabled={busy} className="btn flex items-center gap-1.5" style={{ padding: '6px 12px' }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} criar
          </button>
        </form>
        {msg && <p className="text-sm mb-3" style={{ color: msg.ok ? 'var(--cyber-accent)' : 'var(--cyber-danger)' }}>{msg.text}</p>}

        {/* Lista */}
        <div className="space-y-1.5 max-h-[46vh] overflow-y-auto pr-1">
          {loading && <p className="text-xs" style={{ color: 'var(--text-dim)' }}>carregando…</p>}
          {!loading && users.map((u) => (
            <div key={u.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-theme">
              <div className="min-w-0 flex-1">
                <div className="font-display font-bold text-sm truncate flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
                  {u.username}
                  {u.role === 'admin' && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--theme-soft)', color: 'var(--cyber-primary)' }}>ADMIN</span>}
                  {u.id === me?.id && <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>(você)</span>}
                </div>
                <div className="font-mono text-[11px] truncate" style={{ color: 'var(--text-dim)' }}>{new Date(u.createdAt).toLocaleDateString()}</div>
              </div>
              <button onClick={() => toggleRole(u)} className="p-1.5 rounded hover:bg-theme-soft" title={u.role === 'admin' ? 'Rebaixar para usuário' : 'Promover a admin'}>
                {u.role === 'admin' ? <ShieldOff className="w-4 h-4" style={{ color: 'var(--text-dim)' }} /> : <Shield className="w-4 h-4 text-theme" />}
              </button>
              <button onClick={() => resetPw(u)} className="p-1.5 rounded hover:bg-theme-soft" title="Redefinir senha">
                <KeyRound className="w-4 h-4 text-theme" />
              </button>
              {u.id !== me?.id && (
                <button onClick={() => remove(u)} className="p-1.5 rounded hover:bg-black/40" title="Excluir usuário">
                  <Trash2 className="w-4 h-4" style={{ color: 'var(--cyber-danger)' }} />
                </button>
              )}
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
