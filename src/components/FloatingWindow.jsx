import React, { useState, useRef, useEffect } from 'react';
import { Minus, Maximize2, Minimize2, X, Download, Terminal, Server, Columns2, Radio } from 'lucide-react';
import TerminalSidebar from './terminal/TerminalSidebar.jsx';
import { sfx } from '../lib/sound.js';
import { useI18n } from '../lib/i18n.js';

/**
 * FloatingWindow — draggable/resizable window holding terminal tabs + a script/log
 * sidebar. The terminal surfaces themselves are rendered by Workspace and portaled
 * into the `surfaceMount` node below, so they survive being dragged between windows.
 */
export default function FloatingWindow({
  win, sessions, focused, activity,
  onFocus, onDrag, onResize, onGeom, onMinimize, onMaximize, onClose,
  onSelectTab, onCloseTab, onSaveLog, getTabApi,
  onMoveTab, onRename, onOpenInWindow, registerSurface,
  onToggleSplit, onToggleBcast, onToggleBcastExclude, onBcastSend,
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(win.title);
  const [dragOver, setDragOver] = useState(false);
  const surfaceRef = useRef(null);

  useEffect(() => { registerSurface(win.id, surfaceRef.current); return () => registerSurface(win.id, null); }, [win.id, registerSurface]);

  const startDrag = (e) => {
    if (win.maximized || e.button !== 0) return;
    onFocus(win.id);
    const sx = e.clientX, sy = e.clientY, ox = win.x, oy = win.y;
    const move = (ev) => onDrag(win.id, Math.max(0, ox + (ev.clientX - sx)), Math.max(0, oy + (ev.clientY - sy)));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const startResize = (dir, e) => {
    e.stopPropagation(); if (win.maximized || e.button !== 0) return;
    onFocus(win.id);
    const sx = e.clientX, sy = e.clientY, ox = win.x, oy = win.y, ow = win.w, oh = win.h;
    const minW = 360, minH = 220;
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let x = ox, y = oy, w = ow, h = oh;
      if (dir.includes('e')) w = Math.max(minW, ow + dx);
      if (dir.includes('s')) h = Math.max(minH, oh + dy);
      if (dir.includes('w')) { w = Math.max(minW, ow - dx); x = ox + (ow - w); }
      if (dir.includes('n')) { h = Math.max(minH, oh - dy); y = oy + (oh - h); }
      x = Math.max(0, x); y = Math.max(0, y);
      (onGeom || ((id, g) => onResize(id, g.w, g.h)))(win.id, { x, y, w, h });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const HANDLES = [
    ['n', { top: 0, left: 10, right: 10, height: 5, cursor: 'ns-resize' }],
    ['s', { bottom: 0, left: 10, right: 10, height: 5, cursor: 'ns-resize' }],
    ['e', { top: 10, bottom: 10, right: 0, width: 5, cursor: 'ew-resize' }],
    ['w', { top: 10, bottom: 10, left: 0, width: 5, cursor: 'ew-resize' }],
    ['ne', { top: 0, right: 0, width: 12, height: 12, cursor: 'nesw-resize' }],
    ['nw', { top: 0, left: 0, width: 12, height: 12, cursor: 'nwse-resize' }],
    ['se', { bottom: 0, right: 0, width: 14, height: 14, cursor: 'nwse-resize' }],
    ['sw', { bottom: 0, left: 0, width: 12, height: 12, cursor: 'nesw-resize' }],
  ];

  const style = win.maximized
    ? { left: 6, top: 6, right: 6, bottom: 6, width: 'auto', height: 'auto' }
    : { left: win.x, top: win.y, width: win.w, height: win.h };

  const active = sessions.find((s) => s.id === win.active) || sessions[0];
  const color = active?.connectionParams?.color || '#00f0ff';
  const cfg = { color, accent: color, glow: `${color}55` };
  const sideWin = { targetHost: active?.connectionParams?.displayName, targetIp: active?.connectionParams?.ip, username: active?.credentials?.username };

  const commitRename = () => { setEditing(false); if (draft.trim() !== win.title) onRename(win.id, draft); };
  const startRename = (e) => { e.stopPropagation(); setDraft(win.title); setEditing(true); };

  // tng-tab drag payloads = a session being moved into this window.
  const hasTabPayload = (e) => Array.from(e.dataTransfer.types || []).includes('text/tng-tab');
  const onWinDragOver = (e) => { if (hasTabPayload(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!dragOver) setDragOver(true); } };
  const onWinDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); };
  const onWinDrop = (e) => {
    if (!hasTabPayload(e)) return;
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
    let d; try { d = JSON.parse(e.dataTransfer.getData('text/tng-tab')); } catch { return; }
    if (d && d.sid) onMoveTab(d.sid, d.from, win.id);
  };

  return (
    <div className="glass absolute flex flex-col overflow-hidden"
      style={{ ...style, zIndex: win.z, display: win.minimized ? 'none' : 'flex',
        boxShadow: dragOver ? '0 0 0 2px var(--cyber-accent), 0 18px 60px rgba(0,0,0,0.6)' : focused ? '0 0 0 1px var(--cyber-primary), 0 18px 60px rgba(0,0,0,0.6)' : '0 10px 40px rgba(0,0,0,0.5)' }}
      onMouseDown={() => onFocus(win.id)} onDragOver={onWinDragOver} onDragLeave={onWinDragLeave} onDrop={onWinDrop}>

      {/* title bar */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b cursor-move select-none"
        style={{ borderColor: 'rgba(0,240,255,0.15)', background: 'rgba(4,6,14,0.55)' }}
        onMouseDown={startDrag} onDoubleClick={() => onMaximize(win.id)}>
        <Terminal className="w-3.5 h-3.5 text-theme shrink-0" />
        {editing ? (
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setEditing(false); setDraft(win.title); } }}
            onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
            className="font-display text-[11px] tracking-cyber flex-1 bg-transparent border-b outline-none"
            style={{ color: 'var(--cyber-primary)', borderColor: 'color-mix(in srgb, var(--cyber-primary) 50%, transparent)' }} />
        ) : (
          <span className="font-display text-[11px] tracking-cyber text-theme-soft truncate flex-1 cursor-text" title={t('win.rename.hint')}
            onDoubleClick={startRename}>{win.title}</span>
        )}
        {sessions.length > 1 && (
          <>
            <button title={win.split ? t('win.split.off') : t('win.split.on')}
              onClick={(e) => { e.stopPropagation(); onToggleSplit(win.id); }}
              className="p-1 rounded hover:bg-theme-soft" style={{ color: win.split ? 'var(--cyber-primary)' : 'var(--text-dim)' }}>
              <Columns2 className="w-3.5 h-3.5" />
            </button>
            <button title={win.bcast ? t('win.bcast.off') : t('win.bcast.on')}
              onClick={(e) => { e.stopPropagation(); onToggleBcast(win.id); }}
              className="p-1 rounded hover:bg-theme-soft" style={{ color: win.bcast ? 'var(--cyber-danger)' : 'var(--text-dim)' }}>
              <Radio className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        <button title={t('win.savelog')} onClick={(e) => { e.stopPropagation(); sfx.click(); onSaveLog(win.active); }} className="p-1 rounded hover:bg-theme-soft"><Download className="w-3.5 h-3.5 text-theme-soft" /></button>
        <button title={t('win.minimize')} onClick={(e) => { e.stopPropagation(); sfx.toggle(); onMinimize(win.id); }} className="p-1 rounded hover:bg-theme-soft"><Minus className="w-3.5 h-3.5 text-theme-soft" /></button>
        <button title={win.maximized ? t('win.restore') : t('win.maximize')} onClick={(e) => { e.stopPropagation(); sfx.toggle(); onMaximize(win.id); }} className="p-1 rounded hover:bg-theme-soft">{win.maximized ? <Minimize2 className="w-3.5 h-3.5 text-theme-soft" /> : <Maximize2 className="w-3.5 h-3.5 text-theme-soft" />}</button>
        <button title={t('win.close')} onClick={(e) => { e.stopPropagation(); onClose(win.id); }} className="p-1 rounded hover:bg-black/40"><X className="w-3.5 h-3.5" style={{ color: 'var(--cyber-danger)' }} /></button>
      </div>

      {/* body: scripts/logs sidebar + terminal area */}
      <div className="flex-1 min-h-0 flex">
        {sessions.length > 0 && <TerminalSidebar win={sideWin} cfg={cfg} termApi={getTabApi(win.active)} />}

        <div className="flex-1 min-w-0 flex flex-col">
          {/* tab strip */}
          <div className="flex items-center gap-1 px-2 pt-1 border-b overflow-x-auto" style={{ borderColor: 'rgba(0,240,255,0.12)' }}>
            {sessions.map((s) => (
              <button key={s.id} onClick={() => onSelectTab(win.id, s.id)}
                draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/tng-tab', JSON.stringify({ sid: s.id, from: win.id })); }}
                title={t('win.dragtab')}
                className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-md text-xs font-display font-bold whitespace-nowrap transition-colors cursor-grab active:cursor-grabbing"
                style={{
                  background: win.active === s.id ? 'rgba(0,240,255,0.12)' : 'transparent',
                  color: win.active === s.id ? (s.connectionParams.color || '#00f0ff') : 'var(--text-dim)',
                  borderBottom: win.active === s.id ? `2px solid ${s.connectionParams.color || '#00f0ff'}` : '2px solid transparent',
                }}>
                <span className="status-dot" style={{ background: s.connectionParams.color, boxShadow: `0 0 6px ${s.connectionParams.color}` }} />
                {s.num != null && <span className="opacity-70">#{s.num}</span>} {s.connectionParams.displayName}
                {win.bcast && sessions.length > 1 && !(win.bcastExclude || []).includes(s.id) && (
                  <Radio className="w-3 h-3" title={t('win.bcast.label')} style={{ color: 'var(--cyber-danger)' }} />
                )}
                {activity[s.id] && win.active !== s.id && (<span className="status-dot pulse-ring" title="•" style={{ background: 'var(--cyber-accent)', boxShadow: '0 0 8px var(--cyber-accent)' }} />)}
                <X className="w-3 h-3 opacity-50 hover:opacity-100" onClick={(e) => { e.stopPropagation(); onCloseTab(win.id, s.id); }} />
              </button>
            ))}
            {sessions.length === 0 && <span className="px-2 py-1.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>{t('win.empty.tab')}</span>}
          </div>

          {/* broadcast bar: espelha o que é digitado na aba ativa para as demais.
              Cada chip liga/desliga o recebimento de uma aba (seletor simples). */}
          {win.bcast && sessions.length > 1 && (
            <div className="flex items-center gap-1.5 px-2 py-1 border-b overflow-x-auto"
              style={{ borderColor: 'rgba(0,240,255,0.12)', background: 'color-mix(in srgb, var(--cyber-danger) 8%, transparent)' }}>
              <Radio className="w-3 h-3 shrink-0" style={{ color: 'var(--cyber-danger)' }} />
              <span className="shrink-0 text-[10px] font-display tracking-cyber" style={{ color: 'var(--cyber-danger)' }}>{t('win.bcast.label')}</span>
              {sessions.map((s) => {
                const excluded = (win.bcastExclude || []).includes(s.id);
                return (
                  <button key={s.id} onClick={(e) => { e.stopPropagation(); sfx.toggle(); onToggleBcastExclude(win.id, s.id); }}
                    title={excluded ? t('win.bcast.include') : t('win.bcast.exclude')}
                    className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-display border transition-colors"
                    style={{
                      borderColor: excluded ? 'rgba(255,255,255,0.12)' : 'color-mix(in srgb, var(--cyber-accent) 45%, transparent)',
                      background: excluded ? 'transparent' : 'color-mix(in srgb, var(--cyber-accent) 14%, transparent)',
                      color: excluded ? 'var(--text-dim)' : 'var(--cyber-accent)',
                      textDecoration: excluded ? 'line-through' : 'none', opacity: excluded ? 0.6 : 1,
                    }}>
                    <span className="status-dot" style={{ background: s.connectionParams.color }} />
                    {s.num != null ? `#${s.num}` : s.connectionParams.displayName}
                  </button>
                );
              })}
              {/* comando único → todas as abas incluídas (Enter envia) */}
              <input
                className="flex-1 bg-transparent border rounded px-2 py-0.5 font-mono text-[11px] outline-none"
                style={{ minWidth: 140, borderColor: 'color-mix(in srgb, var(--cyber-danger) 35%, transparent)', color: 'var(--text)' }}
                placeholder={t('win.bcast.send')}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') { onBcastSend?.(win.id, e.currentTarget.value); e.currentTarget.value = ''; }
                  if (e.key === 'Escape') e.currentTarget.blur();
                }}
              />
            </div>
          )}

          {/* surfaces: a dedicated, empty mount node (terminals are portaled in by
              Workspace) plus an overlay shown when the window has no session. */}
          <div className="flex-1 min-h-0 relative">
            <div ref={surfaceRef} className="absolute inset-0" />
            {sessions.length === 0 && (
              <div className="absolute inset-0 grid place-items-center p-4 pointer-events-none">
                <div className="text-center pointer-events-auto">
                  <Terminal className="w-12 h-12 mx-auto mb-3 text-theme" style={{ opacity: 0.45 }} />
                  <p className="font-display tracking-cyber text-sm" style={{ color: 'var(--text)' }}>{t('win.empty.body')}</p>
                  <p className="text-[11px] mt-1 mb-4" style={{ color: 'var(--text-dim)' }}>{t('win.empty.pick')}</p>
                  <button className="btn inline-flex items-center gap-1.5" onClick={(e) => { e.stopPropagation(); onOpenInWindow(win.id); }} onMouseEnter={() => sfx.hover()}>
                    <Server className="w-4 h-4" /> {t('win.empty.open')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {!win.maximized && HANDLES.map(([dir, st]) => (
        <div key={dir} onMouseDown={(e) => startResize(dir, e)} title="resize" className="absolute" style={{ ...st, zIndex: 5 }} />
      ))}
      {!win.maximized && (<div className="absolute bottom-0 right-0 w-3.5 h-3.5 pointer-events-none" style={{ background: 'linear-gradient(135deg, transparent 50%, var(--cyber-primary) 50%)', opacity: 0.55 }} />)}
    </div>
  );
}
