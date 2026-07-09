/**
 * FileBrowser.jsx
 * Navegador de arquivos SFTP do terminal-ng: navega no host remoto e transfere
 * arquivos entre o servidor e a máquina local (upload/download), com mkdir,
 * renomear, excluir, chmod (editor visual) e edição de texto inline.
 * Recebe `api` (sftpApi do XTerminal) com métodos promissores.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  FolderTree, Folder, File as FileIcon, FileText, Link2, X, ChevronRight, ArrowUp, RefreshCw,
  FolderPlus, Upload, Download, Trash2, Pencil, Shield, Eye, EyeOff, Loader2, HardDriveDownload,
  HardDriveUpload, Save, AlertTriangle, Home, ArrowDownAZ,
} from 'lucide-react';
import {
  pathJoin, dirname, basename, breadcrumbs, formatSize, formatMtime,
  modeToSymbolic, modeToOctal, parseModeInput, isTextFile,
} from '../../lib/sftpUtil';
import FileEditor from './FileEditor';

let xferSeq = 0;

export default function FileBrowser({ api, sessionLabel, onClose }) {
  const [cwd, setCwd] = useState('/');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [sel, setSel] = useState(() => new Set());
  const [transfers, setTransfers] = useState([]); // {id,name,dir,loaded,total,status}
  const [dragOver, setDragOver] = useState(false);
  const [rename, setRename] = useState(null);   // { name, value }
  const [chmod, setChmod] = useState(null);      // { name, mode }
  const [editPath, setEditPath] = useState(null); // caminho do arquivo aberto no editor
  const [busyMsg, setBusyMsg] = useState('');
  const fileInputRef = useRef(null);
  const initRef = useRef(false); // garante que o load inicial (home) rode só 1x por abertura

  const updXfer = (id, patch) => setTransfers((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const addXfer = (x) => { const id = ++xferSeq; setTransfers((t) => [{ id, loaded: 0, total: 0, status: 'run', ...x }, ...t].slice(0, 12)); return id; };

  const load = useCallback(async (path) => {
    setLoading(true); setError(''); setSel(new Set());
    try {
      const r = await api.list(path);
      setCwd(r.path); setEntries(r.entries);
    } catch (e) { setError(e.message || 'Falha ao listar'); }
    setLoading(false);
  }, [api]);

  // inicial: resolve o home (~) e lista — apenas 1x por abertura. Sem o guard,
  // qualquer re-render do pai que recrie `api` re-disparava este efeito e
  // "teleportava" o usuário de volta ao diretório inicial durante a navegação.
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    let alive = true;
    (async () => {
      try { const home = await api.realpath('.'); if (alive) await load(home || '/'); }
      catch { if (alive) await load('/'); }
    })();
    return () => { alive = false; };
  }, [api, load]);

  // Esc fecha (a não ser que um modal/editor esteja aberto)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { if (editPath) { /* editor trata seu próprio Esc */ } else if (rename) setRename(null); else if (chmod) setChmod(null); else onClose?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editPath, rename, chmod, onClose]);

  const visible = entries
    .filter((e) => showHidden || !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // dirs primeiro
      const k = sort.key;
      let cmp = 0;
      if (k === 'name') cmp = a.name.localeCompare(b.name);
      else if (k === 'size') cmp = (a.size || 0) - (b.size || 0);
      else if (k === 'mtime') cmp = (a.mtime || 0) - (b.mtime || 0);
      return cmp * sort.dir;
    });
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));

  // ── transferências ──
  const doUpload = useCallback(async (files) => {
    for (const file of files) {
      const dest = pathJoin(cwd, file.name);
      const id = addXfer({ name: file.name, dir: 'up', total: file.size });
      try {
        await api.upload(file, dest, { onProgress: (loaded, total) => updXfer(id, { loaded, total }) });
        updXfer(id, { status: 'done', loaded: file.size });
      } catch (e) { updXfer(id, { status: 'err', err: e.message }); }
    }
    load(cwd);
  }, [api, cwd, load]);

  const doDownload = async (entry) => {
    const p = pathJoin(cwd, entry.name);
    const id = addXfer({ name: entry.name, dir: 'down', total: entry.size });
    try {
      await api.download(p, { onProgress: (loaded, total) => updXfer(id, { loaded, total: total || entry.size }) });
      updXfer(id, { status: 'done', loaded: entry.size });
    } catch (e) { updXfer(id, { status: 'err', err: e.message }); }
  };

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); const fs = Array.from(e.dataTransfer.files || []); if (fs.length) doUpload(fs); };

  // ── ações ──
  const doMkdir = async () => {
    const name = window.prompt('Nome da nova pasta:');
    if (!name) return;
    try { await api.mkdir(pathJoin(cwd, name)); load(cwd); } catch (e) { alert('Erro: ' + e.message); }
  };
  const doRename = async () => {
    if (!rename || !rename.value || rename.value === rename.name) { setRename(null); return; }
    try { await api.rename(pathJoin(cwd, rename.name), pathJoin(cwd, rename.value)); setRename(null); load(cwd); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  const doDelete = async (entry) => {
    const recursive = entry.isDir && window.confirm(`"${entry.name}" é uma pasta. Excluir RECURSIVAMENTE (rm -rf) todo o conteúdo?`);
    if (!entry.isDir && !window.confirm(`Excluir "${entry.name}"?`)) return;
    if (entry.isDir && !recursive && !window.confirm(`Excluir a pasta vazia "${entry.name}"?`)) return;
    try { await api.remove(pathJoin(cwd, entry.name), { isDir: entry.isDir, recursive }); load(cwd); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  const applyChmod = async () => {
    if (!chmod) return;
    try { await api.chmod(pathJoin(cwd, chmod.name), modeToOctal(chmod.mode)); setChmod(null); load(cwd); }
    catch (e) { alert('Erro: ' + e.message); }
  };
  const openEditor = (entry) => {
    if (entry.size > 2 * 1024 * 1024) { if (!window.confirm('Arquivo > 2MB. Abrir mesmo assim?')) return; }
    setEditPath(pathJoin(cwd, entry.name)); // o FileEditor carrega/salva sozinho
  };

  const iconFor = (e) => (e.isLink ? Link2 : e.isDir ? Folder : isTextFile(e.name) ? FileText : FileIcon);
  const crumbs = breadcrumbs(cwd);

  const body = (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[10006] grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.74)', backdropFilter: 'blur(5px)' }}
      onClick={onClose}>
      <motion.div initial={{ scale: 0.97, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }}
        className="glass clip-cyber w-full max-w-5xl flex flex-col" style={{ maxHeight: '88vh', height: '88vh', background: 'color-mix(in srgb, var(--bg-2) 97%, transparent)', border: '1px solid color-mix(in srgb, var(--cyber-primary) 28%, transparent)', borderRadius: 14 }}
        onClick={(e) => e.stopPropagation()}>

        {/* header */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-b" style={{ borderColor: 'color-mix(in srgb, var(--cyber-primary) 18%, transparent)' }}>
          <FolderTree className="w-5 h-5 text-theme" />
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold tracking-cyber text-theme leading-tight text-[14px]">Arquivos · SFTP</div>
            <div className="text-[10px] truncate" style={{ color: 'var(--text-dim)' }}>{sessionLabel ? `${sessionLabel} · ` : ''}transfira arquivos entre o servidor e sua máquina</div>
          </div>
          <button onClick={onClose} title="Fechar" className="p-1 rounded hover:bg-theme-soft"><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
        </div>

        {/* toolbar */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b flex-wrap" style={{ borderColor: 'color-mix(in srgb, var(--cyber-primary) 12%, transparent)' }}>
          <TbBtn icon={ArrowUp} title="Pasta acima" onClick={() => load(dirname(cwd))} />
          <TbBtn icon={Home} title="Home" onClick={async () => { try { load(await api.realpath('.')); } catch { load('/'); } }} />
          <TbBtn icon={RefreshCw} title="Atualizar" onClick={() => load(cwd)} spin={loading} />
          <TbBtn icon={FolderPlus} title="Nova pasta" onClick={doMkdir} />
          <TbBtn icon={Upload} title="Enviar arquivos (upload)" onClick={() => fileInputRef.current?.click()} accent />
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) doUpload(fs); e.target.value = ''; }} />
          <TbBtn icon={showHidden ? Eye : EyeOff} title={showHidden ? 'Ocultar arquivos ocultos' : 'Mostrar ocultos'} onClick={() => setShowHidden((v) => !v)} active={showHidden} />
          <div className="flex-1" />
          <span className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>{visible.length} itens</span>
        </div>

        {/* breadcrumb */}
        <div className="flex items-center gap-0.5 px-3 py-1.5 overflow-x-auto border-b" style={{ borderColor: 'color-mix(in srgb, var(--cyber-primary) 8%, transparent)' }}>
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-0.5 shrink-0">
              {i > 0 && <ChevronRight className="w-3 h-3" style={{ color: 'var(--text-dim)' }} />}
              <button onClick={() => load(c.path)} className="font-mono text-[11px] px-1 rounded hover:bg-theme-soft"
                style={{ color: i === crumbs.length - 1 ? 'var(--cyber-primary)' : 'var(--text)' }}>{c.name}</button>
            </span>
          ))}
        </div>

        {/* listagem + dropzone */}
        <div className="flex-1 min-h-0 overflow-auto relative"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
          {dragOver && (
            <div className="absolute inset-0 z-20 grid place-items-center pointer-events-none"
              style={{ background: 'color-mix(in srgb, var(--cyber-primary) 12%, transparent)', border: '2px dashed var(--cyber-primary)' }}>
              <div className="flex flex-col items-center gap-2" style={{ color: 'var(--cyber-primary)' }}>
                <HardDriveUpload className="w-10 h-10" /><span className="font-display tracking-cyber">Solte para enviar para {basename(cwd) || '/'}</span>
              </div>
            </div>
          )}
          {error && <div className="m-3 rounded-lg px-3 py-2 text-[12px] flex items-center gap-2" style={{ background: 'color-mix(in srgb, var(--cyber-danger) 12%, transparent)', color: 'var(--cyber-danger)' }}><AlertTriangle className="w-4 h-4" /> {error}</div>}
          {loading && !entries.length ? (
            <div className="grid place-items-center h-full" style={{ color: 'var(--text-dim)' }}><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead className="sticky top-0" style={{ background: 'var(--bg-2)' }}>
                <tr style={{ borderBottom: '1px solid color-mix(in srgb, var(--cyber-primary) 15%, transparent)' }}>
                  <Th onClick={() => toggleSort('name')} active={sort.key === 'name'}>Nome</Th>
                  <Th onClick={() => toggleSort('size')} active={sort.key === 'size'} align="right">Tamanho</Th>
                  <th className="text-left px-2 py-1 font-mono text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Permissões</th>
                  <Th onClick={() => toggleSort('mtime')} active={sort.key === 'mtime'}>Modificado</Th>
                  <th className="text-right px-2 py-1 font-mono text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => {
                  const Icon = iconFor(e);
                  const isRen = rename && rename.name === e.name;
                  return (
                    <tr key={e.name} className="group hover:bg-theme-soft" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon className="w-4 h-4 shrink-0" style={{ color: e.isDir ? 'var(--cyber-primary)' : e.isLink ? 'var(--cyber-accent)' : 'var(--text-dim)' }} />
                          {isRen ? (
                            <input autoFocus value={rename.value} onChange={(ev) => setRename({ ...rename, value: ev.target.value })}
                              onKeyDown={(ev) => { if (ev.key === 'Enter') doRename(); if (ev.key === 'Escape') setRename(null); }}
                              onBlur={doRename}
                              className="font-mono text-[12px] px-1 rounded bg-black/40 outline-none" style={{ color: 'var(--text)', border: '1px solid var(--cyber-primary)' }} />
                          ) : (
                            <button onClick={() => (e.isDir ? load(pathJoin(cwd, e.name)) : isTextFile(e.name) ? openEditor(e) : doDownload(e))}
                              className="font-mono text-[12px] truncate text-left hover:underline" style={{ color: 'var(--text)' }} title={e.isDir ? 'Abrir' : isTextFile(e.name) ? 'Editar' : 'Baixar'}>
                              {e.name}{e.isLink ? ' →' : ''}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>{e.isDir ? '—' : formatSize(e.size)}</td>
                      <td className="px-2 py-1 font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>{modeToSymbolic(e.mode)}</td>
                      <td className="px-2 py-1 font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>{formatMtime(e.mtime)}</td>
                      <td className="px-2 py-1">
                        <div className="flex items-center justify-end gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                          {!e.isDir && <RowBtn icon={Download} title="Baixar p/ minha máquina" onClick={() => doDownload(e)} />}
                          <RowBtn icon={Pencil} title="Renomear" onClick={() => setRename({ name: e.name, value: e.name })} />
                          <RowBtn icon={Shield} title="Permissões (chmod)" onClick={() => setChmod({ name: e.name, mode: e.mode & 0o7777 })} />
                          <RowBtn icon={Trash2} title="Excluir" danger onClick={() => doDelete(e)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && !visible.length && !error && (
                  <tr><td colSpan={5} className="text-center py-10 font-mono text-[12px]" style={{ color: 'var(--text-dim)' }}>Pasta vazia. Arraste arquivos aqui para enviar.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* transferências */}
        {transfers.length > 0 && (
          <div className="border-t px-3 py-2 max-h-32 overflow-auto space-y-1" style={{ borderColor: 'color-mix(in srgb, var(--cyber-primary) 12%, transparent)' }}>
            {transfers.map((x) => {
              const pct = x.total ? Math.round((x.loaded / x.total) * 100) : (x.status === 'done' ? 100 : 0);
              const c = x.status === 'err' ? 'var(--cyber-danger)' : x.status === 'done' ? 'var(--cyber-accent)' : 'var(--cyber-primary)';
              const DirIcon = x.dir === 'up' ? HardDriveUpload : HardDriveDownload;
              return (
                <div key={x.id} className="flex items-center gap-2">
                  <DirIcon className="w-3.5 h-3.5 shrink-0" style={{ color: c }} />
                  <span className="font-mono text-[10px] truncate" style={{ color: 'var(--text)', width: 160 }}>{x.name}</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: c, transition: 'width 0.2s' }} />
                  </div>
                  <span className="font-mono text-[9px] w-24 text-right" style={{ color: c }}>
                    {x.status === 'err' ? 'erro' : x.status === 'done' ? 'concluído' : `${formatSize(x.loaded)}/${x.total ? formatSize(x.total) : '?'}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {busyMsg && <div className="px-3 py-1 text-[10px] font-mono border-t" style={{ color: 'var(--cyber-primary)', borderColor: 'rgba(255,255,255,0.06)' }}>{busyMsg}</div>}
      </motion.div>

      {/* modal chmod */}
      {chmod && <ChmodModal entry={chmod} onChange={(mode) => setChmod({ ...chmod, mode })} onCancel={() => setChmod(null)} onApply={applyChmod} />}

      {/* editor de texto (componente compartilhado: números de linha, busca, etc.) */}
      {editPath && (
        <FileEditor api={api} path={editPath} onClose={() => setEditPath(null)} onSaved={() => load(cwd)} />
      )}
    </motion.div>
  );
  return createPortal(body, document.body);
}

function TbBtn({ icon: Icon, title, onClick, accent, active, spin }) {
  return (
    <button onClick={onClick} title={title}
      className="p-1.5 rounded-lg border text-[11px] transition-colors"
      style={{ borderColor: 'color-mix(in srgb, var(--cyber-primary) 20%, transparent)', background: accent ? 'color-mix(in srgb, var(--cyber-primary) 16%, transparent)' : active ? 'color-mix(in srgb, var(--cyber-accent) 14%, transparent)' : 'transparent', color: accent ? 'var(--cyber-primary)' : active ? 'var(--cyber-accent)' : 'var(--text)' }}>
      <Icon className={`w-4 h-4 ${spin ? 'animate-spin' : ''}`} />
    </button>
  );
}
function RowBtn({ icon: Icon, title, onClick, danger }) {
  return (
    <button onClick={onClick} title={title} className="p-1 rounded hover:bg-black/30"
      style={{ color: danger ? 'var(--cyber-danger)' : 'var(--text-dim)' }}><Icon className="w-3.5 h-3.5" /></button>
  );
}
function Th({ children, onClick, active, align }) {
  return (
    <th onClick={onClick} className="px-2 py-1 font-mono text-[9px] uppercase tracking-wider cursor-pointer select-none"
      style={{ color: active ? 'var(--cyber-primary)' : 'var(--text-dim)', textAlign: align || 'left' }}>
      <span className="inline-flex items-center gap-1">{children}{active && <ArrowDownAZ className="w-3 h-3" />}</span>
    </th>
  );
}

// Editor visual de permissões (rwx para dono/grupo/outros + especiais) ↔ octal.
function ChmodModal({ entry, onChange, onCancel, onApply }) {
  const m = entry.mode & 0o7777;
  const bit = (b) => (m & b) !== 0;
  const flip = (b) => onChange(m ^ b);
  const rows = [
    { label: 'Dono', r: 0o400, w: 0o200, x: 0o100 },
    { label: 'Grupo', r: 0o040, w: 0o020, x: 0o010 },
    { label: 'Outros', r: 0o004, w: 0o002, x: 0o001 },
  ];
  const setOctal = (v) => { const parsed = parseModeInput(v); if (parsed != null) onChange(parsed); };
  return (
    <div className="fixed inset-0 z-[10007] grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.8)' }} onClick={(e) => { e.stopPropagation(); onCancel(); }}>
      <div className="glass p-4 w-full max-w-sm" style={{ borderRadius: 12, background: 'var(--bg-2)', border: '1px solid color-mix(in srgb, var(--cyber-primary) 30%, transparent)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3"><Shield className="w-4 h-4 text-theme" /><span className="font-display tracking-cyber text-theme text-[13px]">Permissões · {entry.name}</span></div>
        <table className="w-full mb-3">
          <thead><tr className="text-[9px] uppercase" style={{ color: 'var(--text-dim)' }}><th className="text-left py-1">Quem</th><th>Ler</th><th>Escrever</th><th>Executar</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="text-center">
                <td className="text-left font-mono text-[11px] py-1" style={{ color: 'var(--text)' }}>{row.label}</td>
                {[row.r, row.w, row.x].map((b) => (
                  <td key={b}><input type="checkbox" checked={bit(b)} onChange={() => flip(b)} style={{ accentColor: 'var(--cyber-primary)' }} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-2 mb-3">
          <span className="font-mono text-[11px]" style={{ color: 'var(--text-dim)' }}>octal</span>
          <input value={modeToOctal(m)} onChange={(e) => setOctal(e.target.value)} className="font-mono text-[12px] w-20 px-2 py-1 rounded bg-black/40 outline-none" style={{ color: 'var(--cyber-accent)', border: '1px solid color-mix(in srgb, var(--cyber-primary) 25%, transparent)' }} />
          <span className="font-mono text-[11px] flex-1" style={{ color: 'var(--text-dim)' }}>{modeToSymbolic(m)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1 rounded text-[11px]" style={{ color: 'var(--text-dim)' }}>Cancelar</button>
          <button onClick={onApply} className="px-3 py-1 rounded text-[11px]" style={{ background: 'color-mix(in srgb, var(--cyber-primary) 18%, transparent)', color: 'var(--cyber-primary)' }}>Aplicar</button>
        </div>
      </div>
    </div>
  );
}
