import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, LogOut, Volume2, VolumeX, Bot, KeyRound, PanelLeft, Plus, SlidersHorizontal, AppWindow, X, Zap, LayoutGrid, Columns2, Rows3, Copy, Workflow, HelpCircle, Globe, Search, Server, Loader2, Check, Users } from 'lucide-react';
import HostVault from './HostVault.jsx';
import AIPanel from './AIPanel.jsx';
import FloatingWindow from './FloatingWindow.jsx';
import ChangePassword from './ChangePassword.jsx';
import UserManager from './UserManager.jsx';
import TerminalSettings, { TERM_DEFAULTS } from './TerminalSettings.jsx';
import FlowBuilder from './FlowBuilder.jsx';
import HelpMenu from './HelpMenu.jsx';
import WebBrowser from './WebBrowser.jsx';
import TerminalTab from './TerminalTab.jsx';
import { getPrefs, savePrefs, api, logout as apiLogout } from '../lib/api.js';
import { applyTheme } from '../lib/themes.js';
import { sfx, setMuted, isMuted } from '../lib/sound.js';
import * as bus from '../lib/bus.js';
import { LogIn as LogInIcon } from 'lucide-react';
import { useI18n, setLang, LANGS, LANG_LABELS } from '../lib/i18n.js';

let winSeq = 0;
let sessSeq = 0;
let zTop = 10;

// Renamed window titles persist across reloads, keyed by window id.
const TITLES_KEY = 'tng_win_titles';
function loadTitles() { try { return JSON.parse(localStorage.getItem(TITLES_KEY) || '{}'); } catch { return {}; } }
function persistTitles(m) { try { localStorage.setItem(TITLES_KEY, JSON.stringify(m)); } catch {} }

export default function Workspace({ user, onLogout }) {
  const { t, lang } = useI18n();
  const [windows, setWindows] = useState([]);
  const [sessionsById, setSessionsById] = useState({});
  const [focusedWin, setFocusedWin] = useState(null);
  const [activity, setActivity] = useState({});
  const [surfaceMounts, setSurfaceMounts] = useState({}); // winId -> DOM node for terminal portals
  const [aiOpen, setAiOpen] = useState(() => { const v = localStorage.getItem('tng_ai_open'); return v === null ? true : v === '1'; });
  const [vaultOpen, setVaultOpen] = useState(() => { const v = localStorage.getItem('tng_vault_open'); return v === null ? true : v === '1'; });
  const [muted, setMutedState] = useState(isMuted());
  const [showPw, setShowPw] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [showLang, setShowLang] = useState(false);
  const [langPos, setLangPos] = useState({ x: 0, y: 0 });
  const [pendingConn, setPendingConn] = useState(null);
  const [pickWin, setPickWin] = useState(null); // window id awaiting a saved-host pick
  const [showQuick, setShowQuick] = useState(false);
  const [showFlows, setShowFlows] = useState(false);
  const [workspaceCard, setWorkspaceCard] = useState(() => { try { return localStorage.getItem('tng_workspace_card') !== '0'; } catch { return true; } });
  const [toasts, setToasts] = useState([]);
  const [termSettings, setTermSettings] = useState(() => { try { return JSON.parse(localStorage.getItem('tng_term_settings') || '{}'); } catch { return {}; } });

  const tabRefs = useRef({});
  const mainRef = useRef(null);
  const [showLayout, setShowLayout] = useState(false);
  const [layoutPos, setLayoutPos] = useState({ x: 0, y: 0 });
  // Auto-hide do cabeçalho: visível ao carregar, esconde após alguns segundos;
  // reaparece ao encostar o mouse no topo da tela.
  const [headerShown, setHeaderShown] = useState(true);
  useEffect(() => { const id = setTimeout(() => setHeaderShown(false), 2500); return () => clearTimeout(id); }, []);
  const windowsRef = useRef(windows); windowsRef.current = windows;
  const focusedWinRef = useRef(focusedWin); focusedWinRef.current = focusedWin;
  const winTitlesRef = useRef(loadTitles());

  // Load per-user prefs once.
  useEffect(() => { getPrefs().then((p) => { if (p && p.terminal) setTermSettings((s) => ({ ...s, ...p.terminal })); if (p && p.theme) applyTheme(p.theme); if (p && p.lang) setLang(p.lang); if (p && p.aiLang) { try { localStorage.setItem('tng_ai_lang', p.aiLang); } catch {} } if (p && p.workspaceCard != null) { setWorkspaceCard(!!p.workspaceCard); try { localStorage.setItem('tng_workspace_card', p.workspaceCard ? '1' : '0'); } catch {} } if (p && p.termBlack != null) { try { localStorage.setItem('tng_term_black', p.termBlack ? '1' : '0'); } catch {} } if (p && p.overlayFloat != null) { try { localStorage.setItem('tng_overlay_float', p.overlayFloat ? '1' : '0'); } catch {} } try { window.dispatchEvent(new Event('tng:theme')); } catch {} }).catch(() => {}); }, []);
  // Live-react to the workspace-card toggle from settings.
  useEffect(() => {
    const onWs = () => { try { setWorkspaceCard(localStorage.getItem('tng_workspace_card') !== '0'); } catch {} };
    window.addEventListener('tng:workspace', onWs);
    return () => window.removeEventListener('tng:workspace', onWs);
  }, []);

  // Login/logout notifications from the per-session user watcher.
  useEffect(() => {
    const off = bus.on('tng:notify', (n) => {
      const id = Date.now() + Math.random();
      if (n.kind === 'login') sfx.success?.(); else sfx.toggle?.();
      setToasts((t2) => [...t2, { id, ...n }].slice(-5));
      setTimeout(() => setToasts((t2) => t2.filter((x) => x.id !== id)), 7000);
    });
    return off;
  }, []);

  // When the work area changes size (a side panel opens/closes), rescale the
  // floating windows proportionally so they always occupy the available space.
  const prevMainRef = useRef(null);
  useEffect(() => {
    const el = mainRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const W = rect.width, H = rect.height;
      if (W < 50 || H < 50) return;
      const prev = prevMainRef.current;
      prevMainRef.current = { W, H };
      if (!prev || (prev.W === W && prev.H === H)) return;
      const sx = W / prev.W, sy = H / prev.H;
      setWindows((ws) => {
        let changed = false;
        const next = ws.map((w) => {
          if (w.minimized || w.maximized) return w;
          const minW = 360, minH = 220;
          let ww = Math.round(Math.max(minW, Math.min(w.w * sx, W - 8)));
          let h = Math.round(Math.max(minH, Math.min(w.h * sy, H - 8)));
          let x = Math.round(Math.max(0, Math.min(w.x * sx, W - ww - 4)));
          let y = Math.round(Math.max(0, Math.min(w.y * sy, H - h - 4)));
          if (x !== w.x || y !== w.y || ww !== w.w || h !== w.h) { changed = true; return { ...w, x, y, w: ww, h }; }
          return w;
        });
        return changed ? next : ws;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const updateTermSettings = useCallback((patch) => {
    setTermSettings((s) => {
      const n = { ...s, ...patch };
      try { localStorage.setItem('tng_term_settings', JSON.stringify(n)); } catch {}
      savePrefs({ terminal: n }).catch(() => {});
      return n;
    });
  }, []);

  const titleFor = (id) => winTitlesRef.current[id] || `SESSION ${id.replace(/^w/, '')}`;

  const makeWindow = (tabs, count, geom) => {
    const off = (count % 6) * 26;
    winSeq += 1;
    const id = `w${winSeq}`;
    return { id, title: titleFor(id), x: 30 + off, y: 24 + off, w: 860, h: 520, z: ++zTop, minimized: false, maximized: false, tabs, active: tabs[0] || null, ...(geom || {}) };
  };

  const clearActivity = (sid) => setActivity((a) => { if (!a[sid]) return a; const n = { ...a }; delete n[sid]; return n; });
  const handleActivity = useCallback((sid) => setActivity((a) => (a[sid] ? a : { ...a, [sid]: true })), []);
  const registerTabRef = useCallback((sid, r) => { if (r) tabRefs.current[sid] = r; else delete tabRefs.current[sid]; }, []);
  const getTabApi = useCallback((sid) => tabRefs.current[sid], []);
  const focusTab = (sid) => { requestAnimationFrame(() => setTimeout(() => { try { tabRefs.current[sid]?.focus?.(); } catch {} }, 60)); };

  // Register/unregister the DOM node each window exposes as its terminal-surface
  // mount point. Terminals are portaled into these so they survive tab moves.
  const registerSurface = useCallback((winId, el) => {
    setSurfaceMounts((m) => {
      if (el) { if (m[winId] === el) return m; return { ...m, [winId]: el }; }
      if (!(winId in m)) return m;
      const n = { ...m }; delete n[winId]; return n;
    });
  }, []);

  // Place a new session either in a chosen window or a brand-new one.
  const placeSession = (payload, target) => {
    sessSeq += 1;
    const sid = `s${sessSeq}`;
    setSessionsById((m) => {
      const used = new Set(Object.values(m).map((s) => s.num).filter(Boolean));
      let num = 1; while (used.has(num)) num++;
      return { ...m, [sid]: { id: sid, num, ...payload } };
    });
    if (target.mode === 'window') {
      setWindows((p) => p.map((w) => w.id === target.id ? { ...w, tabs: [...w.tabs, sid], active: sid, minimized: false, z: ++zTop } : w));
      setFocusedWin(target.id);
    } else {
      const nw = makeWindow([sid], windowsRef.current.length);
      setWindows((p) => [...p, nw]);
      setFocusedWin(nw.id);
    }
    focusTab(sid);
  };

  // From the vault: if windows exist, ask where to open; otherwise open a new window.
  const openSession = (payload) => {
    if (windowsRef.current.length === 0) placeSession(payload, { mode: 'new' });
    else setPendingConn(payload);
  };

  const createWindow = () => { sfx.open(); const nw = makeWindow([], windowsRef.current.length); setWindows((p) => [...p, nw]); setFocusedWin(nw.id); };

  // Move a live tab from one window into another (terminal stays connected).
  const moveTab = (sid, fromWinId, toWinId) => {
    if (!sid || fromWinId === toWinId) return;
    sfx.toggle();
    setWindows((ws) => {
      let next = ws.map((w) => {
        if (w.id === fromWinId) { const tabs = w.tabs.filter((tt) => tt !== sid); return { ...w, tabs, active: w.active === sid ? (tabs[tabs.length - 1] || null) : w.active }; }
        if (w.id === toWinId) return { ...w, tabs: [...w.tabs, sid], active: sid, minimized: false, z: ++zTop };
        return w;
      });
      // Drop the source window if dragging its last tab away emptied it.
      next = next.filter((w) => !(w.id === fromWinId && w.tabs.length === 0));
      return next;
    });
    setFocusedWin(toWinId);
    focusTab(sid);
  };

  // Drop a tab on empty workspace space → spin it into a brand-new window.
  const moveTabToNew = (sid, fromWinId, x, y) => {
    if (!sid) return;
    sfx.open();
    winSeq += 1;
    const id = `w${winSeq}`;
    const nw = { id, title: titleFor(id), x, y, w: 860, h: 520, z: ++zTop, minimized: false, maximized: false, tabs: [sid], active: sid };
    setWindows((ws) => {
      let next = ws.map((w) => w.id === fromWinId ? { ...w, tabs: w.tabs.filter((tt) => tt !== sid), active: w.active === sid ? (w.tabs.filter((tt) => tt !== sid).slice(-1)[0] || null) : w.active } : w);
      next = next.filter((w) => !(w.id === fromWinId && w.tabs.length === 0));
      return [...next, nw];
    });
    setFocusedWin(id);
    focusTab(sid);
  };

  const renameWindow = (id, title) => {
    const clean = (title || '').trim();
    setWindows((ws) => ws.map((w) => w.id === id ? { ...w, title: clean || w.title } : w));
    const map = { ...winTitlesRef.current };
    if (clean) map[id] = clean; else delete map[id];
    winTitlesRef.current = map;
    persistTitles(map);
  };

  // Tile non-minimized windows into a grid that fills the workspace area.
  const tileWindows = (forceCols) => {
    sfx.toggle(); setShowLayout(false);
    const el = mainRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const open = windowsRef.current.filter((w) => !w.minimized);
    const n = open.length; if (!n) return;
    const cols = Math.max(1, Math.min(forceCols || Math.ceil(Math.sqrt(n)), n));
    const rows = Math.ceil(n / cols);
    const cw = Math.floor((rect.width - pad * (cols + 1)) / cols);
    const ch = Math.floor((rect.height - pad * (rows + 1)) / rows);
    setWindows((ws) => ws.map((w) => {
      const i = open.findIndex((x) => x.id === w.id);
      if (i < 0) return w;
      const r = Math.floor(i / cols), c = i % cols;
      return { ...w, x: pad + c * (cw + pad), y: pad + r * (ch + pad), w: cw, h: ch, maximized: false, minimized: false, z: ++zTop };
    }));
  };
  const cascadeWindows = () => {
    sfx.toggle(); setShowLayout(false);
    setWindows((ws) => { let i = -1; return ws.map((w) => { if (w.minimized) return w; i++; return { ...w, x: 24 + i * 30, y: 18 + i * 30, w: 860, h: 520, maximized: false, z: ++zTop }; }); });
  };

  const focusWindow = (id) => { if (focusedWinRef.current === id) return; setFocusedWin(id); setWindows((ws) => ws.map((w) => w.id === id ? { ...w, z: ++zTop } : w)); };
  const dragWindow = (id, x, y) => setWindows((ws) => ws.map((w) => w.id === id ? { ...w, x, y } : w));
  const resizeWindow = (id, w2, h2) => setWindows((ws) => ws.map((w) => w.id === id ? { ...w, w: w2, h: h2 } : w));
  const setWindowGeom = (id, g) => setWindows((ws) => ws.map((w) => w.id === id ? { ...w, ...g } : w));
  const minimizeWindow = (id) => setWindows((ws) => ws.map((w) => w.id === id ? { ...w, minimized: true } : w));
  const restoreWindow = (id) => { sfx.toggle(); setWindows((ws) => ws.map((w) => w.id === id ? { ...w, minimized: false, z: ++zTop } : w)); setFocusedWin(id); };
  const maximizeWindow = (id) => setWindows((ws) => ws.map((w) => w.id === id ? { ...w, maximized: !w.maximized, z: ++zTop } : w));

  const closeWindow = (id) => {
    sfx.close();
    const w = windowsRef.current.find((x) => x.id === id);
    if (w) {
      w.tabs.forEach((sid) => delete tabRefs.current[sid]);
      setSessionsById((m) => { const n = { ...m }; w.tabs.forEach((sid) => delete n[sid]); return n; });
      setActivity((a) => { const n = { ...a }; w.tabs.forEach((sid) => delete n[sid]); return n; });
    }
    setWindows((ws) => ws.filter((x) => x.id !== id));
  };

  const selectTab = (winId, sid) => { sfx.click(); setWindows((ws) => ws.map((w) => w.id === winId ? { ...w, active: sid } : w)); clearActivity(sid); setFocusedWin(winId); focusTab(sid); };

  // ── Split view + input broadcast (multi-comando simultâneo) ──
  const fitTerminals = () => { for (let i = 0; i < 4; i++) setTimeout(() => { try { window.dispatchEvent(new Event('resize')); } catch {} }, 60 + i * 120); };
  const toggleSplit = (winId) => { sfx.toggle(); setWindows((ws) => ws.map((w) => w.id === winId ? { ...w, split: !w.split } : w)); fitTerminals(); };
  const toggleBcast = (winId) => { sfx.toggle(); setWindows((ws) => ws.map((w) => w.id === winId ? { ...w, bcast: !w.bcast } : w)); };
  const toggleBcastExclude = (winId, sid) => setWindows((ws) => ws.map((w) => {
    if (w.id !== winId) return w;
    const ex = new Set(w.bcastExclude || []);
    if (ex.has(sid)) ex.delete(sid); else ex.add(sid);
    return { ...w, bcastExclude: [...ex] };
  }));
  // Espelha cada tecla da aba de origem para as demais abas da MESMA janela que
  // não estejam excluídas. sendInput escreve direto no PTY (não passa por
  // term.onData), então não há eco/loop de broadcast.
  const handleInput = useCallback((srcSid, data) => {
    const win = windowsRef.current.find((w) => w.tabs.includes(srcSid));
    if (!win || !win.bcast || win.tabs.length < 2) return;
    const ex = new Set(win.bcastExclude || []);
    if (ex.has(srcSid)) return; // aba excluída não transmite
    for (const tid of win.tabs) {
      if (tid === srcSid || ex.has(tid)) continue;
      try { tabRefs.current[tid]?.sendInput?.(data); } catch {}
    }
  }, []);

  // Executa um comando (via caixa da barra de broadcast) em todas as abas
  // incluídas da janela — independe de qual aba está focada.
  const bcastSend = useCallback((winId, cmd) => {
    const win = windowsRef.current.find((w) => w.id === winId);
    const text = String(cmd || '');
    if (!win || !text.trim()) return;
    const ex = new Set(win.bcastExclude || []);
    for (const tid of win.tabs) {
      if (ex.has(tid)) continue;
      try { tabRefs.current[tid]?.sendInput?.(text + '\n'); } catch {}
    }
    sfx.click();
  }, []);

  const closeTab = (winId, sid) => {
    sfx.close();
    delete tabRefs.current[sid];
    setSessionsById((m) => { const n = { ...m }; delete n[sid]; return n; });
    clearActivity(sid);
    setWindows((ws) => ws.map((w) => {
      if (w.id !== winId) return w;
      const tabs = w.tabs.filter((tt) => tt !== sid);
      // Keep the window open even when empty — it shows the "open saved connection" prompt.
      return { ...w, tabs, active: w.active === sid ? (tabs[tabs.length - 1] || null) : w.active };
    }));
  };

  const saveLog = (sid) => {
    if (!sid) { sfx.error(); return; }
    const log = tabRefs.current[sid]?.getSessionLog?.();
    const content = log?.content || '';
    if (!content.trim()) { sfx.error(); return; }
    const sess = sessionsById[sid];
    const name = (sess?.connectionParams?.displayName || 'session').replace(/[^\w.-]/g, '_');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}_${stamp}.log`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    sfx.success();
  };

  const toggleMute = () => { const m = !muted; setMuted(m); setMutedState(m); if (!m) sfx.toggle(); };
  const toggleAi = () => { sfx.toggle(); setAiOpen((v) => { const n = !v; localStorage.setItem('tng_ai_open', n ? '1' : '0'); return n; }); };
  const toggleVault = () => { sfx.toggle(); setVaultOpen((v) => { const n = !v; localStorage.setItem('tng_vault_open', n ? '1' : '0'); return n; }); };
  const logout = () => { sfx.close(); apiLogout(); onLogout(); };
  const changeLang = (l) => { sfx.click(); setLang(l); savePrefs({ lang: l }).catch(() => {}); setShowLang(false); };
  const getActiveContext = () => { const w = windowsRef.current.find((x) => x.id === focusedWinRef.current); return (w && tabRefs.current[w.active]?.getSessionLog?.()?.content) || ''; };
  const runInActive = useCallback((cmd) => {
    const w = windowsRef.current.find((x) => x.id === focusedWinRef.current);
    const sid = w?.active;
    if (sid && tabRefs.current[sid]?.runScript) { tabRefs.current[sid].runScript(cmd); sfx.click(); }
  }, []);
  const runInSession = useCallback((sid, cmd) => {
    if (sid && tabRefs.current[sid]?.runScript) { tabRefs.current[sid].runScript(cmd); }
  }, []);
  const activeWin = windows.find((x) => x.id === focusedWin);
  const activeSessionId = activeWin ? activeWin.active : null;
  const aiSessions = Object.values(sessionsById).map((s) => ({ id: s.id, name: `#${s.num} ${s.connectionParams?.displayName || s.connectionParams?.ip || s.id}` }));
  const activeHostName = activeSessionId && sessionsById[activeSessionId]
    ? `#${sessionsById[activeSessionId].num} ${sessionsById[activeSessionId].connectionParams?.displayName || sessionsById[activeSessionId].connectionParams?.ip || ''}`
    : '';

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey && e.altKey)) return;
      const w = windowsRef.current.find((x) => x.id === focusedWinRef.current);
      // Ctrl+Alt+S → split view · Ctrl+Alt+B → broadcast, na janela em foco.
      if (e.key === 's' || e.key === 'S') { if (w && w.tabs.length > 1) { e.preventDefault(); e.stopPropagation(); toggleSplit(w.id); } return; }
      if (e.key === 'b' || e.key === 'B') { if (w && w.tabs.length > 1) { e.preventDefault(); e.stopPropagation(); toggleBcast(w.id); } return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (!w || w.tabs.length < 2) return;
      e.preventDefault(); e.stopPropagation();
      const idx = w.tabs.indexOf(w.active);
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const sid = w.tabs[(((idx < 0 ? 0 : idx) + dir) % w.tabs.length + w.tabs.length) % w.tabs.length];
      selectTab(w.id, sid);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Drop a tab onto the bare workspace background → new window at that point.
  const onMainDrop = (e) => {
    const raw = e.dataTransfer.getData('text/tng-tab');
    if (!raw) return;
    e.preventDefault();
    let d; try { d = JSON.parse(raw); } catch { return; }
    const rect = mainRef.current?.getBoundingClientRect();
    const x = rect ? Math.max(0, Math.min(e.clientX - rect.left - 80, rect.width - 200)) : 40;
    const y = rect ? Math.max(0, Math.min(e.clientY - rect.top - 14, rect.height - 140)) : 30;
    moveTabToNew(d.sid, d.from, x, y);
  };
  const onMainDragOver = (e) => { if (Array.from(e.dataTransfer.types || []).includes('text/tng-tab')) e.preventDefault(); };

  return (
    <div className="relative z-10 h-full w-full flex flex-col overflow-hidden">
      {/* Zona quente: encostar o mouse no topo revela o cabeçalho auto-oculto. */}
      <div className="absolute top-0 left-0 right-0" style={{ height: 10, zIndex: 100009 }} onMouseEnter={() => setHeaderShown(true)} />
      <header
        onMouseEnter={() => setHeaderShown(true)}
        onMouseLeave={() => { if (!showLayout && !showLang) setHeaderShown(false); }}
        className="absolute top-0 left-0 right-0 flex items-center gap-3 px-4 py-1.5 border-b"
        style={{
          borderColor: 'color-mix(in srgb, var(--cyber-primary) 18%, transparent)',
          background: 'color-mix(in srgb, var(--bg-0) 92%, transparent)',
          backdropFilter: 'blur(10px)',
          zIndex: 100010,
          transform: headerShown ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform .25s ease',
          pointerEvents: headerShown ? 'auto' : 'none',
        }}>
        <div className="grid place-items-center w-7 h-7 rounded-lg border border-theme bg-theme-soft"><Terminal className="w-4 h-4 text-theme" /></div>
        <h1 className="font-display text-base font-black glitch" style={{ color: 'var(--cyber-primary)' }} data-text="TERMINAL//NG">TERMINAL//NG</h1>
        <span className="text-[10px] tracking-cyber px-2 py-0.5 rounded border border-theme text-theme-soft">{t('app.tag')}</span>
        <button className="btn flex items-center gap-1.5" style={{ padding: '4px 10px' }} title={t('header.new.title')} onClick={createWindow} onMouseEnter={() => sfx.hover()}><Plus className="w-4 h-4" /> {t('header.new')}</button>
        <button className="btn btn-ghost flex items-center gap-1.5" style={{ padding: '4px 10px' }} title={t('header.session.title')} onClick={() => { sfx.click(); setShowQuick(true); }} onMouseEnter={() => sfx.hover()}><Zap className="w-4 h-4" /> {t('header.session')}</button>
        <button className="btn btn-ghost flex items-center gap-1.5" style={{ padding: '6px' }} title={t('header.layout.title')} onClick={(e) => { sfx.click(); const r = e.currentTarget.getBoundingClientRect(); setLayoutPos({ x: r.left, y: r.bottom + 4 }); setShowLayout((v) => !v); }} onMouseEnter={() => sfx.hover()}><LayoutGrid className="w-4 h-4" /></button>
        {showLayout && createPortal(
          <>
            <div className="fixed inset-0" style={{ zIndex: 100000 }} onClick={() => setShowLayout(false)} />
            <div className="fixed rounded-lg border p-1 flex flex-col gap-0.5 shadow-2xl" style={{ left: layoutPos.x, top: layoutPos.y, zIndex: 100001, background: 'var(--bg-2)', borderColor: 'color-mix(in srgb, var(--cyber-primary) 30%, transparent)', minWidth: 168 }}>
              <span className="px-2 py-1 text-[9px] tracking-cyber" style={{ color: 'var(--text-dim)' }}>{t('layout.title')}</span>
              <button onClick={() => tileWindows()} className="flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-left hover:bg-theme-soft" style={{ color: 'var(--text)' }}><LayoutGrid className="w-3.5 h-3.5 text-theme" /> {t('layout.autogrid')}</button>
              <button onClick={() => tileWindows(2)} className="flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-left hover:bg-theme-soft" style={{ color: 'var(--text)' }}><Columns2 className="w-3.5 h-3.5 text-theme" /> {t('layout.cols2')}</button>
              <button onClick={() => tileWindows(3)} className="flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-left hover:bg-theme-soft" style={{ color: 'var(--text)' }}><LayoutGrid className="w-3.5 h-3.5 text-theme" /> {t('layout.cols3')}</button>
              <button onClick={() => tileWindows(1)} className="flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-left hover:bg-theme-soft" style={{ color: 'var(--text)' }}><Rows3 className="w-3.5 h-3.5 text-theme" /> {t('layout.stacked')}</button>
              <button onClick={cascadeWindows} className="flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-left hover:bg-theme-soft" style={{ color: 'var(--text)' }}><Copy className="w-3.5 h-3.5 text-theme" /> {t('layout.cascade')}</button>
            </div>
          </>, document.body)}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs font-mono" style={{ color: 'var(--text-dim)' }}>op://{user.username}</span>
          {/* language selector */}
          <button className="btn btn-ghost flex items-center gap-1" style={{ padding: '6px 8px' }} title={t('header.language')} onClick={(e) => { sfx.click(); const r = e.currentTarget.getBoundingClientRect(); setLangPos({ x: r.right - 150, y: r.bottom + 4 }); setShowLang((v) => !v); }} onMouseEnter={() => sfx.hover()}><Globe className="w-4 h-4" /><span className="text-[11px] font-display tracking-cyber">{lang.toUpperCase()}</span></button>
          {showLang && createPortal(
            <>
              <div className="fixed inset-0" style={{ zIndex: 100000 }} onClick={() => setShowLang(false)} />
              <div className="fixed rounded-lg border p-1 flex flex-col gap-0.5 shadow-2xl" style={{ left: langPos.x, top: langPos.y, zIndex: 100001, background: 'var(--bg-2)', borderColor: 'color-mix(in srgb, var(--cyber-primary) 30%, transparent)', minWidth: 150 }}>
                {LANGS.map((l) => (
                  <button key={l} onClick={() => changeLang(l)} className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[12px] text-left hover:bg-theme-soft" style={{ color: lang === l ? 'var(--cyber-primary)' : 'var(--text)' }}>
                    {lang === l ? <Check className="w-3.5 h-3.5 text-theme" /> : <span className="w-3.5 h-3.5" />} {LANG_LABELS[l]}
                  </button>
                ))}
              </div>
            </>, document.body)}
          <button className={`btn ${vaultOpen ? '' : 'btn-ghost'}`} style={{ padding: 6 }} title={vaultOpen ? t('header.vault.hide') : t('header.vault.show')} onClick={toggleVault} onMouseEnter={() => sfx.hover()}><PanelLeft className="w-4 h-4" /></button>
          <button className="btn btn-ghost" style={{ padding: 6 }} title={t('header.settings')} onClick={() => { sfx.click(); setShowSettings(true); }}><SlidersHorizontal className="w-4 h-4" /></button>
          <button className="btn btn-ghost" style={{ padding: 6 }} title={t('header.browser')} onClick={() => { sfx.click(); setShowBrowser(true); }} onMouseEnter={() => sfx.hover()}><Globe className="w-4 h-4" /></button>
          <button className="btn btn-ghost" style={{ padding: 6 }} title={t('header.flows')} onClick={() => { sfx.click(); setShowFlows(true); }}><Workflow className="w-4 h-4" /></button>
          <button className="btn btn-ghost" style={{ padding: 6 }} title={t('header.password')} onClick={() => { sfx.click(); setShowPw(true); }}><KeyRound className="w-4 h-4" /></button>
          {user.role === 'admin' && (
            <button className="btn btn-ghost" style={{ padding: 6 }} title="Usuários" onClick={() => { sfx.click(); setShowUsers(true); }}><Users className="w-4 h-4" /></button>
          )}
          <button className="btn btn-ghost" style={{ padding: 6 }} title={t('header.help')} onClick={() => { sfx.click(); setShowHelp(true); }} onMouseEnter={() => sfx.hover()}><HelpCircle className="w-4 h-4" /></button>
          <button className="btn btn-ghost" style={{ padding: 6 }} title={muted ? t('header.unmute') : t('header.mute')} onClick={toggleMute} onMouseEnter={() => sfx.hover()}>{muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}</button>
          <button className={`btn ${aiOpen ? 'btn-pink' : 'btn-ghost'}`} style={{ padding: 6 }} title={aiOpen ? t('header.ai.hide') : t('header.ai.show')} onClick={toggleAi}><Bot className="w-4 h-4" /></button>
          <button className="btn btn-ghost" style={{ padding: 6 }} title={t('header.logout')} onClick={logout}><LogOut className="w-4 h-4" /></button>
        </div>
      </header>

      <div className="flex-1 min-h-0 min-w-0 flex gap-3 p-3 overflow-hidden">
        <HostVault onConnect={openSession} collapsed={!vaultOpen} quickOpen={showQuick} onCloseQuick={() => setShowQuick(false)} />

        <main ref={mainRef} onDragOver={onMainDragOver} onDrop={onMainDrop} className={`flex-1 min-w-0 min-h-0 relative overflow-hidden ${workspaceCard ? 'glass' : ''}`}>
          {windows.length === 0 && <EmptyState onNew={createWindow} />}
          {windows.map((w) => (
            <FloatingWindow key={w.id} win={w} sessions={w.tabs.map((id) => sessionsById[id]).filter(Boolean)} focused={focusedWin === w.id} activity={activity}
              onFocus={focusWindow} onDrag={dragWindow} onResize={resizeWindow} onGeom={setWindowGeom} onMinimize={minimizeWindow} onMaximize={maximizeWindow} onClose={closeWindow}
              onSelectTab={selectTab} onCloseTab={closeTab} onSaveLog={saveLog} getTabApi={getTabApi}
              onMoveTab={moveTab} onRename={renameWindow} onOpenInWindow={(id) => { sfx.click(); setPickWin(id); setFocusedWin(id); }} registerSurface={registerSurface}
              onToggleSplit={toggleSplit} onToggleBcast={toggleBcast} onToggleBcastExclude={toggleBcastExclude} onBcastSend={bcastSend} />
          ))}
          {windows.some((w) => w.minimized) && (
            <div className="absolute left-2 bottom-2 flex flex-wrap gap-2" style={{ zIndex: 99999 }}>
              {windows.filter((w) => w.minimized).map((w) => (
                <button key={w.id} onClick={() => restoreWindow(w.id)} onMouseEnter={() => sfx.hover()} className="glass px-3 py-1.5 text-[11px] font-display tracking-cyber text-theme-soft flex items-center gap-2 hover:bg-theme-soft transition-colors">
                  <Terminal className="w-3.5 h-3.5" /> {w.title}
                  {w.tabs.some((id) => activity[id]) && <span className="status-dot pulse-ring" style={{ background: 'var(--cyber-accent)' }} />}
                </button>
              ))}
            </div>
          )}

          {/* Terminal surfaces live here (stable parent) and are portaled into each
              window's mount node, so moving a tab between windows keeps it connected. */}
          {Object.values(sessionsById).map((s) => {
            const win = windows.find((w) => w.tabs.includes(s.id));
            if (!win) return null;
            const mount = surfaceMounts[win.id];
            if (!mount) return null;
            const splitOn = !!win.split && win.tabs.length > 1;
            // Split: TODAS as abas ficam visíveis, dispostas em grade. Normal: só a ativa.
            const visible = !win.minimized && (splitOn ? true : win.active === s.id);
            let cellStyle = { position: 'absolute', inset: 0 };
            if (splitOn) {
              const n = win.tabs.length;
              const cols = Math.ceil(Math.sqrt(n));
              const rows = Math.ceil(n / cols);
              const i = win.tabs.indexOf(s.id);
              const col = i % cols, row = Math.floor(i / cols);
              const isActive = win.active === s.id;
              cellStyle = {
                position: 'absolute',
                left: `${(col / cols) * 100}%`, top: `${(row / rows) * 100}%`,
                width: `${100 / cols}%`, height: `${100 / rows}%`,
                padding: 2, boxSizing: 'border-box',
                outline: isActive ? '2px solid var(--cyber-primary)' : '1px solid rgba(0,240,255,0.12)',
                outlineOffset: -2,
              };
            }
            return createPortal(
              <div style={cellStyle} onMouseDown={splitOn ? () => selectTab(win.id, s.id) : undefined}>
                <TerminalTab ref={(r) => registerTabRef(s.id, r)} session={s} isVisible={visible} onActivity={handleActivity} onInput={handleInput} termSettings={termSettings} />
              </div>, mount, s.id);
          })}
        </main>

        <motion.aside initial={false} animate={{ width: aiOpen ? 320 : 0 }} transition={{ duration: 0.25 }} className="shrink-0 min-h-0 overflow-hidden">
          <div style={{ width: 320 }} className="h-full"><AIPanel getContext={getActiveContext} onCollapse={toggleAi} activeSessionId={activeSessionId} runInActive={runInActive} runInSession={runInSession} sessions={aiSessions} activeHost={activeHostName} /></div>
        </motion.aside>
      </div>

      <AnimatePresence>{showPw && <ChangePassword onClose={() => setShowPw(false)} />}</AnimatePresence>
      <AnimatePresence>{showUsers && <UserManager me={user} onClose={() => setShowUsers(false)} />}</AnimatePresence>
      <AnimatePresence>{showSettings && <TerminalSettings value={termSettings} onChange={updateTermSettings} onClose={() => setShowSettings(false)} />}</AnimatePresence>
      <AnimatePresence>{showFlows && <FlowBuilder onClose={() => setShowFlows(false)} />}</AnimatePresence>
      <AnimatePresence>{showHelp && <HelpMenu onClose={() => setShowHelp(false)} />}</AnimatePresence>
      <AnimatePresence>{showBrowser && <WebBrowser onClose={() => setShowBrowser(false)}
        sshSessions={aiSessions.filter((s) => tabRefs.current[s.id]?.isConnected?.()).map((s) => ({ sid: s.id, label: s.name, fetch: (url) => tabRefs.current[s.id].sshFetch(url) }))}
        defaultSid={activeSessionId} />}</AnimatePresence>

      {/* login/logout toasts */}
      <div className="fixed bottom-4 right-4 z-[10002] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t2) => {
            const c = t2.kind === 'login' ? 'var(--cyber-accent)' : 'var(--cyber-warn)';
            return (
              <motion.div key={t2.id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border shadow-2xl" style={{ background: 'var(--bg-2)', borderColor: `color-mix(in srgb, ${c} 50%, transparent)`, maxWidth: 320 }}>
                {t2.kind === 'login' ? <LogInIcon className="w-4 h-4 shrink-0" style={{ color: c }} /> : <LogOut className="w-4 h-4 shrink-0" style={{ color: c }} />}
                <span className="text-[12px]" style={{ color: 'var(--text)' }}>{t2.text}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {pendingConn && (
          <ConnectTarget windows={windows} sessionsById={sessionsById}
            onPick={(target) => { placeSession(pendingConn, target); setPendingConn(null); }}
            onClose={() => setPendingConn(null)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {pickWin && (
          <SavedHostPicker
            onPick={(payload) => { placeSession(payload, { mode: 'window', id: pickWin }); setPickWin(null); }}
            onClose={() => setPickWin(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function ConnectTarget({ windows, sessionsById, onPick, onClose }) {
  const { t } = useI18n();
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} className="glass clip-cyber w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <AppWindow className="w-5 h-5 text-theme" />
          <h2 className="font-display font-bold tracking-cyber text-theme flex-1">{t('connect.title')}</h2>
          <button onClick={onClose}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
        </div>
        <button onClick={() => onPick({ mode: 'new' })} className="btn w-full flex items-center justify-center gap-2 mb-3"><Plus className="w-4 h-4" /> {t('connect.newwin')}</button>
        <div className="text-[10px] tracking-cyber mb-2" style={{ color: 'var(--text-dim)' }}>{t('connect.oradd')}</div>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {windows.map((w) => {
            const c = sessionsById[w.active]?.connectionParams?.color || '#00f0ff';
            return (
              <button key={w.id} onClick={() => onPick({ mode: 'window', id: w.id })}
                className="w-full flex items-center gap-2.5 p-2.5 rounded-lg border border-theme hover:bg-theme-soft transition-colors text-left">
                <span className="status-dot" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                <span className="font-display font-bold text-sm flex-1" style={{ color: c }}>{w.title}</span>
                <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{t(w.tabs.length === 1 ? 'connect.tabs' : 'connect.tabs.plural', { n: w.tabs.length })}</span>
              </button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

// Picker shown when opening a saved connection inside a specific (empty) window.
function SavedHostPicker({ onPick, onClose }) {
  const { t } = useI18n();
  const [hosts, setHosts] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/hosts').then((h) => setHosts(Array.isArray(h) ? h : [])).catch(() => {}).finally(() => setLoading(false)); }, []);
  const query = q.trim().toLowerCase();
  const filtered = query ? hosts.filter((h) => `${h.label} ${h.username} ${h.ip} ${h.port}`.toLowerCase().includes(query)) : hosts;

  const choose = async (h) => {
    sfx.connect();
    try { await api.post(`/hosts/${h.id}/touch`); } catch {}
    const credentials = { username: h.username };
    if (h.password) credentials.password = h.password;
    else {
      const pw = window.prompt(t('vault.passkey.prompt', { user: h.username, ip: h.ip }), '');
      if (pw === null) return;
      if (pw) credentials.password = pw;
    }
    onPick({ connectionParams: { ip: h.ip, port: h.port, displayName: h.label, color: h.color }, credentials });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} className="glass clip-cyber w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Server className="w-5 h-5 text-theme" />
          <h2 className="font-display font-bold tracking-cyber text-theme flex-1">{t('pick.title')}</h2>
          <button onClick={onClose}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
        </div>
        {hosts.length > 0 && (
          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
            <input className="field w-full font-mono" style={{ padding: '6px 8px 6px 30px', fontSize: 12 }} placeholder={t('pick.search')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
        )}
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {loading && <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('vault.loading')}</p>}
          {!loading && hosts.length === 0 && <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>{t('pick.empty')}</p>}
          {!loading && filtered.map((h) => (
            <button key={h.id} onClick={() => choose(h)} onMouseEnter={() => sfx.hover()}
              className="w-full flex items-center gap-2.5 p-2.5 rounded-lg border border-theme hover:bg-theme-soft transition-colors text-left">
              <span className="status-dot" style={{ background: h.color, boxShadow: `0 0 8px ${h.color}` }} />
              <div className="min-w-0 flex-1">
                <div className="font-display font-bold text-sm truncate" style={{ color: h.color }}>{h.label}</div>
                <div className="font-mono text-[11px] truncate" style={{ color: 'var(--text-dim)' }}>{h.username}@{h.ip}:{h.port}</div>
              </div>
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

function EmptyState({ onNew }) {
  const { t } = useI18n();
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="text-center floaty">
        <Terminal className="w-16 h-16 mx-auto mb-4 text-theme" style={{ opacity: 0.5 }} />
        <p className="font-display tracking-cyber neon text-lg">{t('empty.title')}</p>
        <p className="text-sm mt-2" style={{ color: 'var(--text-dim)' }}>{t('empty.desc')}</p>
        <button className="btn mt-4 inline-flex items-center gap-1.5" onClick={onNew}><Plus className="w-4 h-4" /> {t('empty.new')}</button>
      </div>
    </div>
  );
}
