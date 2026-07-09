/**
 * FileEditor.jsx
 * Editor de texto remoto compartilhado (usado pelo FileBrowser e pelos links do
 * parser de `ls`). Carrega o arquivo via SFTP, edita e SALVA de volta no servidor
 * — sem precisar de vi/nano. Recursos: números de linha, busca, localizar/
 * substituir (um/todos), copiar/recortar/colar e atalhos (Ctrl+S, Ctrl+F, Esc).
 *
 * Props: { api, path, onClose, onSaved }  — api = sftpApi do XTerminal.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { FileText, Save, X, Search, Replace, Loader2, AlertTriangle, ChevronUp, ChevronDown, Copy, Scissors, ClipboardPaste, CheckCheck } from 'lucide-react';
import { basename } from '../../lib/sftpUtil';

export default function FileEditor({ api, path, onClose, onSaved }) {
  const [text, setText] = useState('');
  const [orig, setOrig] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchInfo, setMatchInfo] = useState('');
  const taRef = useRef(null);
  const gutterRef = useRef(null);

  const dirty = text !== orig;
  const lineCount = text.split('\n').length;

  // carrega o arquivo
  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    api.download(path, { asBlob: true })
      .then(({ blob }) => blob.text())
      .then((t) => { if (alive) { setText(t); setOrig(t); } })
      .catch((e) => { if (alive) setError(e.message || 'Falha ao abrir arquivo'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, path]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const file = new File([text], basename(path), { type: 'text/plain' });
      await api.upload(file, path);
      setOrig(text);
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500);
      onSaved?.();
    } catch (e) { setError(e.message || 'Falha ao salvar'); }
    setSaving(false);
  }, [api, path, text, saving, onSaved]);

  // atalhos
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setFindOpen(true); }
      else if (e.key === 'Escape') { if (findOpen) setFindOpen(false); else onClose?.(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, findOpen, onClose]);

  const syncScroll = () => { if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop; };

  // ── busca ──
  const findNext = (backwards = false) => {
    const ta = taRef.current; if (!ta || !query) return;
    const hay = text; const q = query;
    let idx;
    if (backwards) {
      const before = hay.slice(0, Math.max(0, ta.selectionStart - 1));
      idx = before.lastIndexOf(q);
      if (idx < 0) idx = hay.lastIndexOf(q);
    } else {
      idx = hay.indexOf(q, ta.selectionEnd);
      if (idx < 0) idx = hay.indexOf(q); // wrap
    }
    if (idx < 0) { setMatchInfo('sem resultados'); return; }
    ta.focus(); ta.setSelectionRange(idx, idx + q.length);
    // rola até a linha do match
    const line = hay.slice(0, idx).split('\n').length;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    ta.scrollTop = Math.max(0, (line - 3) * lh);
    syncScroll();
    const total = hay.split(q).length - 1;
    setMatchInfo(`${total} ocorrência${total === 1 ? '' : 's'}`);
  };
  const replaceOne = () => {
    const ta = taRef.current; if (!ta || !query) return;
    const sel = text.slice(ta.selectionStart, ta.selectionEnd);
    if (sel === query) {
      const next = text.slice(0, ta.selectionStart) + replacement + text.slice(ta.selectionEnd);
      const at = ta.selectionStart + replacement.length;
      setText(next);
      requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(at, at); findNext(); });
    } else { findNext(); }
  };
  const replaceAll = () => {
    if (!query) return;
    const count = text.split(query).length - 1;
    setText(text.split(query).join(replacement));
    setMatchInfo(`${count} substituída${count === 1 ? '' : 's'}`);
  };

  // ── área de transferência (botões; Ctrl+C/V nativos também funcionam) ──
  const withSel = (fn) => { const ta = taRef.current; if (!ta) return; fn(ta, ta.selectionStart, ta.selectionEnd); };
  const doCopy = () => withSel((ta, a, b) => { try { navigator.clipboard.writeText(text.slice(a, b)); } catch {} });
  const doCut = () => withSel((ta, a, b) => { try { navigator.clipboard.writeText(text.slice(a, b)); } catch {} const next = text.slice(0, a) + text.slice(b); setText(next); requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(a, a); }); });
  const doPaste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      withSel((ta, a, b) => { const next = text.slice(0, a) + clip + text.slice(b); const at = a + clip.length; setText(next); requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(at, at); }); });
    } catch { setMatchInfo('cole com Ctrl+V (permissão de área de transferência negada)'); }
  };

  const body = (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[10010] grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.8)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="glass flex flex-col w-full max-w-4xl" style={{ height: '86vh', borderRadius: 12, background: 'color-mix(in srgb, var(--bg-2) 98%, transparent)', border: '1px solid color-mix(in srgb, var(--cyber-primary) 30%, transparent)' }}
        onClick={(e) => e.stopPropagation()}>

        {/* header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <FileText className="w-4 h-4 text-theme shrink-0" />
          <span className="font-mono text-[12px] text-theme flex-1 truncate" title={path}>{path}{dirty ? ' •' : ''}</span>
          <button onClick={() => setFindOpen((v) => !v)} title="Buscar / substituir (Ctrl+F)" className="p-1 rounded hover:bg-theme-soft" style={{ color: findOpen ? 'var(--cyber-primary)' : 'var(--text-dim)' }}><Search className="w-4 h-4" /></button>
          <div className="w-px h-4 mx-0.5" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <button onClick={doCopy} title="Copiar seleção" className="p-1 rounded hover:bg-theme-soft text-theme-soft"><Copy className="w-3.5 h-3.5" /></button>
          <button onClick={doCut} title="Recortar seleção" className="p-1 rounded hover:bg-theme-soft text-theme-soft"><Scissors className="w-3.5 h-3.5" /></button>
          <button onClick={doPaste} title="Colar" className="p-1 rounded hover:bg-theme-soft text-theme-soft"><ClipboardPaste className="w-3.5 h-3.5" /></button>
          <div className="w-px h-4 mx-0.5" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <button onClick={save} disabled={saving || loading || !dirty} title="Salvar no servidor (Ctrl+S)"
            className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] disabled:opacity-40"
            style={{ background: savedFlash ? 'color-mix(in srgb, var(--cyber-accent) 24%, transparent)' : 'color-mix(in srgb, var(--cyber-accent) 16%, transparent)', color: 'var(--cyber-accent)' }}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : savedFlash ? <CheckCheck className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />} {savedFlash ? 'Salvo' : 'Salvar'}
          </button>
          <button onClick={onClose} title="Fechar (Esc)" className="p-1 rounded hover:bg-theme-soft"><X className="w-4 h-4" style={{ color: 'var(--text-dim)' }} /></button>
        </div>

        {/* find/replace bar */}
        {findOpen && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b flex-wrap" style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
            <Search className="w-3.5 h-3.5" style={{ color: 'var(--text-dim)' }} />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') findNext(e.shiftKey); }}
              placeholder="localizar" className="font-mono text-[12px] px-2 py-0.5 rounded bg-black/40 outline-none" style={{ color: 'var(--text)', border: '1px solid rgba(255,255,255,0.1)', width: 180 }} />
            <button onClick={() => findNext(true)} title="Anterior" className="p-1 rounded hover:bg-theme-soft text-theme-soft"><ChevronUp className="w-3.5 h-3.5" /></button>
            <button onClick={() => findNext(false)} title="Próximo" className="p-1 rounded hover:bg-theme-soft text-theme-soft"><ChevronDown className="w-3.5 h-3.5" /></button>
            <Replace className="w-3.5 h-3.5 ml-2" style={{ color: 'var(--text-dim)' }} />
            <input value={replacement} onChange={(e) => setReplacement(e.target.value)}
              placeholder="substituir por" className="font-mono text-[12px] px-2 py-0.5 rounded bg-black/40 outline-none" style={{ color: 'var(--text)', border: '1px solid rgba(255,255,255,0.1)', width: 180 }} />
            <button onClick={replaceOne} className="px-2 py-0.5 rounded text-[10px]" style={{ background: 'color-mix(in srgb, var(--cyber-primary) 14%, transparent)', color: 'var(--cyber-primary)' }}>Substituir</button>
            <button onClick={replaceAll} className="px-2 py-0.5 rounded text-[10px]" style={{ background: 'color-mix(in srgb, var(--cyber-primary) 14%, transparent)', color: 'var(--cyber-primary)' }}>Todos</button>
            {matchInfo && <span className="font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>{matchInfo}</span>}
          </div>
        )}

        {/* corpo */}
        <div className="flex-1 min-h-0 relative">
          {loading ? (
            <div className="grid place-items-center h-full" style={{ color: 'var(--text-dim)' }}><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (
            <div className="flex h-full">
              <div ref={gutterRef} className="overflow-hidden text-right select-none py-2 pr-2 pl-3" style={{ background: 'rgba(0,0,0,0.25)', color: 'var(--text-dim)', fontFamily: 'monospace', fontSize: 12, lineHeight: '18px', minWidth: 48 }}>
                {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
              </div>
              <textarea ref={taRef} value={text} onChange={(e) => setText(e.target.value)} onScroll={syncScroll}
                spellCheck={false} wrap="off"
                className="flex-1 py-2 px-3 outline-none resize-none"
                style={{ background: 'transparent', color: 'var(--text)', fontFamily: 'monospace', fontSize: 12, lineHeight: '18px', whiteSpace: 'pre', overflowWrap: 'normal' }} />
            </div>
          )}
          {error && (
            <div className="absolute bottom-2 left-2 right-2 rounded-lg px-3 py-2 text-[11px] flex items-center gap-2" style={{ background: 'color-mix(in srgb, var(--cyber-danger) 14%, transparent)', color: 'var(--cyber-danger)' }}>
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}
        </div>

        {/* rodapé */}
        <div className="flex items-center gap-3 px-3 py-1 border-t font-mono text-[10px]" style={{ borderColor: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)' }}>
          <span>{lineCount} linhas</span>
          <span>{text.length} caracteres</span>
          <div className="flex-1" />
          <span>{dirty ? 'modificado' : 'salvo'}</span>
        </div>
      </div>
    </motion.div>
  );
  return createPortal(body, document.body);
}
