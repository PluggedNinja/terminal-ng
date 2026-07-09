/**
 * TerminalSidebar.jsx — collapsible vertical rail inside a terminal window.
 *   • Scripts — saved command scripts (user/global). Click to run in the terminal.
 *   • Logs    — saves the whole SSH session to the server + downloads a copy.
 * Ported from msecops and adapted to the local API. Collapse state persisted.
 */
import React, { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  FileCode, ScrollText, ChevronLeft, ChevronRight, Plus, Play, Trash2, X,
  Save, Users, User, Loader2, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { fetchTerminalScripts, createTerminalScript, deleteTerminalScript, saveTerminalSessionLog } from '../../lib/api.js';

const COLLAPSE_KEY = 'tng-term-sidebar-collapsed';

const SidebarItem = ({ icon: Icon, label, onClick, busy, collapsed, cfg }) => (
  <button onMouseDown={(e) => e.stopPropagation()} onClick={onClick} title={label}
    className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-slate-300 hover:text-white transition-colors"
    style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
    onMouseEnter={(e) => { e.currentTarget.style.background = `${cfg.color}14`; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
    {busy ? <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: cfg.accent }} />
          : <Icon className="w-4 h-4 flex-shrink-0" style={{ color: cfg.accent }} />}
    {!collapsed && <span className="text-[12px] font-medium truncate">{label}</span>}
  </button>
);

const ScriptsDropdown = ({ cfg, rect, scripts, onRun, onDelete, onNew, onClose }) => {
  const W = 260;
  let left = rect.right + 6;
  if (left + W > window.innerWidth) left = Math.max(6, rect.left - W - 6);
  const top = Math.min(rect.top, window.innerHeight - 320);
  return createPortal(
    <div className="fixed inset-0 z-[10000]" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.96, x: -4 }} animate={{ opacity: 1, scale: 1, x: 0 }}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute rounded-xl border shadow-2xl py-1.5 max-h-[320px] overflow-y-auto"
        style={{ left, top, width: W, background: 'var(--bg-2)', borderColor: `${cfg.color}35`, boxShadow: `0 12px 40px rgba(0,0,0,0.6), 0 0 24px ${cfg.glow}` }}>
        <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider" style={{ color: cfg.accent, opacity: 0.7 }}>Saved scripts</div>
        {scripts.map((s) => (
          <div key={s.id} className="group flex items-center gap-1.5 px-2 mx-1 rounded-lg hover:bg-white/5" title={s.description || 'No description'}>
            <button onClick={() => onRun(s)} className="min-w-0 flex-1 flex items-center gap-2 py-1.5 text-left">
              <Play className="w-3 h-3 flex-shrink-0" style={{ color: cfg.accent }} />
              <span className="min-w-0">
                <span className="block text-[12px] text-slate-100 truncate">{s.name}</span>
                {s.description && <span className="block text-[9px] text-slate-500 truncate">{s.description}</span>}
              </span>
              <span className="ml-auto flex-shrink-0 text-[8px] px-1 py-0.5 rounded border flex items-center gap-0.5"
                style={s.scope === 'global'
                  ? { color: '#34d399', background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)' }
                  : { color: '#94a3b8', background: 'rgba(100,116,139,0.1)', borderColor: 'rgba(100,116,139,0.3)' }}>
                {s.scope === 'global' ? <Users className="w-2 h-2" /> : <User className="w-2 h-2" />}
                {s.scope === 'global' ? 'All' : (s.mine ? 'Mine' : '')}
              </span>
            </button>
            {(s.mine || s.scope === 'global') && (
              <button onClick={() => onDelete(s)} title="Delete script"
                className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <div className="my-1 mx-2 h-px" style={{ background: `${cfg.color}15` }} />
        <button onClick={onNew} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold hover:bg-white/5" style={{ color: cfg.accent }}>
          <Plus className="w-3.5 h-3.5" /> New script
        </button>
      </motion.div>
    </div>,
    document.body
  );
};

const CreateScriptModal = ({ cfg, onClose, onSaved, notify }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [scope, setScope] = useState('user');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) { notify('Enter a script name.', 'error'); return; }
    if (!code.trim()) { notify('Script is empty.', 'error'); return; }
    setSaving(true);
    try {
      const res = await createTerminalScript({ name: name.trim(), description: description.trim(), code, scope });
      if (!res || !res.success) throw new Error((res && res.error) || 'Save failed');
      notify('Script saved.', 'ok');
      onSaved();
    } catch (e) { notify(e.message || 'Save failed', 'error'); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onMouseDown={onClose}>
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-xl flex flex-col rounded-2xl border shadow-2xl" style={{ background: 'var(--bg-2)', borderColor: `${cfg.color}30`, boxShadow: `0 0 50px ${cfg.glow}` }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${cfg.color}1a`, border: `1px solid ${cfg.color}40` }}>
              <FileCode className="w-4 h-4" style={{ color: cfg.accent }} />
            </div>
            <h3 className="text-sm font-bold text-slate-100">New script</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/5"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Script name" className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-slate-200 outline-none focus:border-cyan-500/50" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (shown as a hint on hover)" className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-slate-200 outline-none focus:border-cyan-500/50" />
          <textarea value={code} onChange={(e) => setCode(e.target.value)} placeholder={'# command or script\nsudo systemctl status nginx'} rows={9} className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-[12px] text-slate-200 outline-none focus:border-cyan-500/50 font-mono resize-y" />
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-slate-500">Save for:</span>
            <button onClick={() => setScope('user')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${scope === 'user' ? 'border-cyan-500/50 text-cyan-300 bg-cyan-500/10' : 'border-white/10 text-slate-400'}`}><User className="w-3 h-3" /> Only me</button>
            <button onClick={() => setScope('global')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${scope === 'global' ? 'border-cyan-500/50 text-cyan-300 bg-cyan-500/10' : 'border-white/10 text-slate-400'}`}><Users className="w-3 h-3" /> Everyone</button>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg border border-white/10 text-sm text-slate-300 hover:bg-white/5">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-black disabled:opacity-50" style={{ background: cfg.color }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
};

const TerminalSidebar = ({ win, cfg, termApi }) => {
  const [collapsed, setCollapsed] = useState(() => { try { const v = localStorage.getItem(COLLAPSE_KEY); return v === null ? true : v === '1'; } catch { return true; } });
  const [menu, setMenu] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loadingScripts, setLoadingScripts] = useState(false);
  const [savingLog, setSavingLog] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const toggle = () => setCollapsed((c) => { const nv = !c; try { localStorage.setItem(COLLAPSE_KEY, nv ? '1' : '0'); } catch {} return nv; });

  const openScripts = useCallback(async (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setLoadingScripts(true);
    try {
      const list = await fetchTerminalScripts();
      if (!list || list.length === 0) { setShowCreate(true); return; }
      setMenu({ rect, scripts: list });
    } catch { setShowCreate(true); }
    finally { setLoadingScripts(false); }
  }, []);

  const runScript = useCallback((s) => {
    if (!termApi || !termApi.isConnected || !termApi.isConnected()) { notify('Terminal is not connected.', 'error'); return; }
    termApi.runScript(s.code);
    notify(`Running "${s.name}"…`, 'ok');
    setMenu(null);
  }, [termApi, notify]);

  const deleteScript = useCallback(async (s) => {
    try {
      const res = await deleteTerminalScript(s.id);
      if (!res || !res.success) throw new Error((res && res.error) || 'Delete failed');
      notify('Script deleted.', 'ok');
      const list = await fetchTerminalScripts();
      if (!list || list.length === 0) setMenu(null);
      else setMenu((m) => (m ? { ...m, scripts: list } : m));
    } catch (e) { notify(e.message || 'Delete failed', 'error'); }
  }, [notify]);

  const saveLog = useCallback(async () => {
    if (!termApi || !termApi.getSessionLog) { notify('Session unavailable.', 'error'); return; }
    const { content, startedAt } = termApi.getSessionLog();
    if (!content || !content.trim()) { notify('Empty session — nothing to save.', 'error'); return; }
    setSavingLog(true);
    try {
      const res = await saveTerminalSessionLog({ host: win.targetHost, ip: win.targetIp, username: win.username, startedAt: startedAt || Date.now(), endedAt: Date.now(), content });
      const fname = (res && res.data && res.data.filename) || 'session.log';
      try {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      } catch {}
      notify(`Log saved: ${fname}`, 'ok');
    } catch (e) { notify(e.message || 'Failed to save log', 'error'); }
    finally { setSavingLog(false); }
  }, [termApi, win, notify]);

  return (
    <>
      <div className="flex-shrink-0 h-full flex flex-col py-2 px-1.5"
        style={{ width: collapsed ? 38 : 112, transition: 'width 0.18s ease', background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-1) 95%, transparent), color-mix(in srgb, var(--bg-2) 95%, transparent))', borderRight: `1px solid ${cfg.color}20` }}>
        <button onClick={toggle} onMouseDown={(e) => e.stopPropagation()} title={collapsed ? 'Expand' : 'Collapse'}
          className="w-full flex items-center mb-2 rounded-lg px-2.5 py-1.5 text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
          style={{ justifyContent: collapsed ? 'center' : 'flex-end' }}>
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
        <div className="space-y-1">
          <SidebarItem icon={FileCode} label="Scripts" onClick={openScripts} busy={loadingScripts} collapsed={collapsed} cfg={cfg} />
          <SidebarItem icon={ScrollText} label="Logs" onClick={saveLog} busy={savingLog} collapsed={collapsed} cfg={cfg} />
        </div>
      </div>

      {menu && (
        <ScriptsDropdown cfg={cfg} rect={menu.rect} scripts={menu.scripts} onRun={runScript} onDelete={deleteScript}
          onNew={() => { setMenu(null); setShowCreate(true); }} onClose={() => setMenu(null)} />
      )}
      {showCreate && (
        <CreateScriptModal cfg={cfg} notify={notify} onClose={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} />
      )}
      {toast && createPortal(
        <div className="fixed bottom-6 right-6 z-[10001] px-3 py-2 rounded-xl border text-[12px] shadow-2xl flex items-center gap-2"
          style={{ background: 'var(--bg-2)', borderColor: toast.kind === 'error' ? 'rgba(239,68,68,0.45)' : toast.kind === 'ok' ? 'rgba(16,185,129,0.45)' : 'rgba(255,255,255,0.12)', color: toast.kind === 'error' ? '#fca5a5' : toast.kind === 'ok' ? '#6ee7b7' : 'var(--text)' }}>
          {toast.kind === 'error' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          {toast.msg}
        </div>,
        document.body
      )}
    </>
  );
};

export default TerminalSidebar;
