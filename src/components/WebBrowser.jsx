/**
 * WebBrowser.jsx — janela de navegador do terminal-ng.
 * Dois modos:
 *  • Proxy (padrão): páginas via /api/browse (busca no servidor do app).
 *  • Via SSH: busca a página DE DENTRO do host remoto (curl na sessão SSH) —
 *    útil para checar dashboards/serviços internos acessíveis só pelo servidor.
 * Barra de endereço (URL ou busca), voltar/avançar/recarregar/início/externo.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Globe, ArrowLeft, ArrowRight, RotateCw, Home, ExternalLink, X, Search, Loader2, ShieldAlert, Server } from 'lucide-react';
import { getToken, APP_BASE } from '../lib/api.js';

const QUICK = [
  { label: 'DuckDuckGo', url: 'https://html.duckduckgo.com/html/', icon: '🦆' },
  { label: 'Wikipedia', url: 'https://pt.wikipedia.org', icon: '📚' },
  { label: 'MDN', url: 'https://developer.mozilla.org', icon: '📖' },
  { label: 'Stack Overflow', url: 'https://stackoverflow.com', icon: '💬' },
  { label: 'man7 (Linux)', url: 'https://man7.org/linux/man-pages/', icon: '🐧' },
  { label: 'GitHub', url: 'https://github.com', icon: '🐙' },
  { label: 'Hacker News', url: 'https://news.ycombinator.com', icon: '🔶' },
  { label: 'DevDocs', url: 'https://devdocs.io', icon: '⚡' },
];

function toUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(s) && !/\s/.test(s)) return 'https://' + s;
  return 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(s);
}

// script injetado no modo SSH: encaminha cliques/forms(GET) ao pai via postMessage
const NAV_SCRIPT = `<script>(function(){try{function s(u){try{parent.postMessage({__tngBrowse:'navigate',url:u},'*');}catch(e){}}
document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;var h=a.href||'';if(!h||/^javascript:/i.test(h)||h.indexOf('#')===0)return;if(/^https?:/i.test(h)){e.preventDefault();s(h);}},true);
document.addEventListener('submit',function(e){var f=e.target;if(!f)return;if((f.method||'get').toLowerCase()==='post')return;try{var u=new URL(f.getAttribute('action')||location.href,location.href);var p=new URLSearchParams();var els=f.elements||[];for(var i=0;i<els.length;i++){var el=els[i];if(el.name&&!el.disabled&&el.type!=='submit'&&el.type!=='button')p.append(el.name,el.value);}u.search=p.toString();e.preventDefault();s(u.href);}catch(_){}}, true);
}catch(_){}})();</script>`;

function b64ToBytes(b64) { const bin = atob(b64 || ''); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }
function buildDoc(html, baseUrl) {
  const base = `<base href="${String(baseUrl).replace(/"/g, '%22')}">`;
  let out = String(html).replace(/<base\b[^>]*>/gi, '').replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head([^>]*)>/i, (m) => m + base);
  else out = `<head>${base}</head>` + out;
  return out + NAV_SCRIPT;
}
const noteDoc = (title, text) => `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#0b1020;color:#d7e6f5;display:grid;place-items:center;height:100vh"><div style="max-width:520px;text-align:center;padding:24px"><div style="color:#00f0ff;font-size:15px;margin-bottom:8px">${title}</div><div style="color:#9fb3c8;font-size:12px;line-height:1.5">${text}</div></div></body></html>`;

export default function WebBrowser({ onClose, sshSessions = [], defaultSid }) {
  const [input, setInput] = useState('');
  const [url, setUrl] = useState('');
  const [hist, setHist] = useState([]);
  const [idx, setIdx] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [sshMode, setSshMode] = useState(false);
  const [doc, setDoc] = useState(null); // srcdoc (modo SSH); null = usa proxy via src
  const [sshSid, setSshSid] = useState(defaultSid || (sshSessions[0] && sshSessions[0].sid) || null);
  const sess = sshSessions.find((s) => s.sid === sshSid) || sshSessions[0] || null;
  const sshFetch = sess ? sess.fetch : null;
  const fetchRef = useRef(null); fetchRef.current = sshFetch; // estável p/ o efeito
  const hasSsh = sshSessions.length > 0;

  const proxySrc = useCallback((u) => `${APP_BASE}/api/browse?url=${encodeURIComponent(u)}&token=${encodeURIComponent(getToken() || '')}&_=${nonce}`, [nonce]);

  const go = useCallback((raw, { push = true } = {}) => {
    const u = /^https?:\/\//i.test(raw) ? raw : toUrl(raw);
    if (!u) return;
    setUrl(u); setInput(u); setLoading(true);
    if (push) setHist((h) => { const base = h.slice(0, idx + 1); const next = [...base, u]; setIdx(next.length - 1); return next; });
  }, [idx]);

  // Modo SSH: busca via curl no host remoto e monta o documento (srcdoc).
  useEffect(() => {
    if (!url || !sshMode || !fetchRef.current) { setDoc(null); return; }
    let alive = true; setLoading(true);
    fetchRef.current(url).then((m) => {
      if (!alive) return;
      const ct = String(m.contentType || '').toLowerCase();
      if (ct.includes('html') || ct === '') setDoc(buildDoc(new TextDecoder('utf-8').decode(b64ToBytes(m.bodyB64)), url));
      else if (ct.startsWith('image/')) setDoc(`<!doctype html><body style="margin:0;background:#0b1020;display:grid;place-items:center;height:100vh"><img src="data:${m.contentType};base64,${m.bodyB64}" style="max-width:100%;max-height:100%"></body>`);
      else setDoc(noteDoc('Conteúdo não-HTML', `${m.contentType || 'tipo desconhecido'} — ${(m.status || '')}. Use "abrir externamente" para baixar/ver.`));
      setLoading(false);
    }).catch((e) => { if (alive) { setDoc(noteDoc('Falha via SSH', e.message || 'erro')); setLoading(false); } });
    return () => { alive = false; };
  }, [url, nonce, sshMode, sshSid]);

  const back = () => { if (idx > 0) { const i = idx - 1; setIdx(i); setUrl(hist[i]); setInput(hist[i]); setLoading(true); } };
  const fwd = () => { if (idx < hist.length - 1) { const i = idx + 1; setIdx(i); setUrl(hist[i]); setInput(hist[i]); setLoading(true); } };
  const reload = () => { if (url) { setNonce((n) => n + 1); setLoading(true); } };
  const home = () => { setUrl(''); setInput(''); setDoc(null); };
  const openExternal = () => { if (url) window.open(url, '_blank', 'noopener'); };

  useEffect(() => {
    const onMsg = (e) => { const d = e.data; if (d && d.__tngBrowse === 'navigate' && d.url) go(d.url); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [go]);
  useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') onClose?.(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);

  const submit = (e) => { e.preventDefault(); if (input.trim()) go(input); };

  const IconBtn = ({ icon: Icon, onClick, disabled, title, spin }) => (
    <button onClick={onClick} disabled={disabled} title={title} className="p-1.5 rounded-lg disabled:opacity-30 hover:bg-theme-soft" style={{ color: 'var(--text)' }}>
      <Icon className={`w-4 h-4 ${spin ? 'animate-spin' : ''}`} />
    </button>
  );

  const body = (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[10008] grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.74)', backdropFilter: 'blur(5px)' }} onClick={onClose}>
      <motion.div initial={{ scale: 0.97, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }}
        className="glass clip-cyber w-full max-w-5xl flex flex-col" style={{ height: '90vh', background: 'color-mix(in srgb, var(--bg-2) 97%, transparent)', border: '1px solid color-mix(in srgb, var(--cyber-primary) 28%, transparent)', borderRadius: 14 }}
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center gap-1.5 px-3 py-2 border-b" style={{ borderColor: 'color-mix(in srgb, var(--cyber-primary) 16%, transparent)' }}>
          <Globe className="w-4 h-4 text-theme shrink-0" />
          <IconBtn icon={ArrowLeft} onClick={back} disabled={idx <= 0} title="Voltar" />
          <IconBtn icon={ArrowRight} onClick={fwd} disabled={idx >= hist.length - 1} title="Avançar" />
          <IconBtn icon={loading ? Loader2 : RotateCw} onClick={reload} disabled={!url} title="Recarregar" spin={loading} />
          <IconBtn icon={Home} onClick={home} title="Início" />
          <form onSubmit={submit} className="flex-1 flex items-center gap-1.5">
            <div className="flex-1 relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="busque ou digite um endereço"
                className="w-full font-mono text-[12px] rounded-lg pl-8 pr-3 py-1.5 outline-none" style={{ background: 'rgba(0,0,0,0.35)', color: 'var(--text)', border: '1px solid color-mix(in srgb, var(--cyber-primary) 20%, transparent)' }} />
            </div>
          </form>
          {hasSsh && sshMode && sshSessions.length > 1 && (
            <select value={sshSid || ''} onChange={(e) => { setSshSid(e.target.value); if (url) setNonce((n) => n + 1); }}
              className="font-mono text-[11px] rounded-lg px-2 py-1 outline-none" style={{ background: 'rgba(0,0,0,0.35)', color: 'var(--cyber-accent)', border: '1px solid color-mix(in srgb, var(--cyber-accent) 30%, transparent)', maxWidth: 150 }} title="Sessão SSH usada para buscar">
              {sshSessions.map((s) => <option key={s.sid} value={s.sid} style={{ background: 'var(--bg-2)', color: 'var(--text)' }}>{s.label}</option>)}
            </select>
          )}
          {hasSsh && (
            <button onClick={() => { setSshMode((v) => !v); if (url) setNonce((n) => n + 1); }} title={sshMode ? `Buscando pelo host remoto${sess ? ' (' + sess.label + ')' : ''} — clique para usar o proxy local` : 'Buscar de dentro do host remoto (via SSH)'}
              className="px-2 py-1 rounded-lg flex items-center gap-1 text-[11px]" style={{ color: sshMode ? 'var(--cyber-accent)' : 'var(--text-dim)', background: sshMode ? 'color-mix(in srgb, var(--cyber-accent) 14%, transparent)' : 'transparent' }}>
              <Server className="w-3.5 h-3.5" /> SSH
            </button>
          )}
          <IconBtn icon={ExternalLink} onClick={openExternal} disabled={!url} title="Abrir no navegador do sistema" />
          <button onClick={onClose} title="Fechar" className="p-1 rounded hover:bg-black/40"><X className="w-4.5 h-4.5" style={{ color: 'var(--cyber-danger)' }} /></button>
        </div>

        <div className="flex-1 min-h-0 relative" style={{ background: '#0b1020' }}>
          {url ? (
            doc != null ? (
              <iframe title="navegador-ssh" srcDoc={doc} onLoad={() => setLoading(false)} className="w-full h-full" style={{ border: 'none', background: '#fff' }} sandbox="allow-scripts allow-forms allow-popups" />
            ) : (
              // SEM allow-same-origin: o conteúdo do proxy é servido na MESMA origem
              // do app (/api/browse); com allow-scripts + allow-same-origin o sandbox
              // não isolaria nada e o JS de qualquer site navegado rodaria na origem
              // do Terminal-NG (podendo chamar /api/* com o cookie de sessão e roubar
              // as credenciais SSH salvas). Sem allow-same-origin o documento fica em
              // origem opaca: os scripts rodam isolados e não alcançam a sessão/API.
              <iframe title="navegador" src={proxySrc(url)} onLoad={() => setLoading(false)} className="w-full h-full" style={{ border: 'none', background: '#fff' }} sandbox="allow-scripts allow-forms allow-popups" />
            )
          ) : (
            <div className="h-full overflow-auto p-6">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-2 mb-4">
                  <Globe className="w-6 h-6 text-theme" />
                  <div>
                    <div className="font-display tracking-cyber text-theme text-lg">Navegador</div>
                    <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Proxy do servidor do app. {hasSsh ? 'Ligue “SSH” para navegar de dentro do host remoto.' : ''}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {QUICK.map((q) => (
                    <button key={q.url} onClick={() => go(q.url)} className="rounded-lg border border-theme p-3 text-left hover:bg-theme-soft transition-colors" style={{ background: 'rgba(0,240,255,0.04)' }}>
                      <div className="text-xl mb-1">{q.icon}</div>
                      <div className="font-mono text-[12px]" style={{ color: 'var(--text)' }}>{q.label}</div>
                      <div className="font-mono text-[9px] truncate" style={{ color: 'var(--text-dim)' }}>{q.url.replace(/^https?:\/\//, '')}</div>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] mt-5 leading-relaxed flex items-start gap-1.5" style={{ color: 'var(--text-dim)' }}>
                  <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                  Sites simples (docs, wikis, buscas) funcionam bem. Apps pesados em JavaScript/login podem não renderizar — use “abrir externamente”. O modo <b>SSH</b> traz a página pela rede do servidor remoto (ótimo para dashboards internos), mas os recursos (CSS/imagens) ainda carregam pelo seu navegador.
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
  return createPortal(body, document.body);
}
