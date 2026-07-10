/**
 * browse.js — mini "web proxy" para a janela de navegador do terminal-ng.
 * Busca a URL no lado do servidor, remove os cabeçalhos que impedem a página
 * de ser exibida num iframe (X-Frame-Options / CSP), injeta um <base> para os
 * recursos relativos resolverem na origem real e um script que encaminha os
 * cliques/submits (GET) para o pai — assim a navegação continua pelo proxy.
 *
 * Autenticação: o iframe não envia header Authorization, então o token JWT vai
 * na query (?token=), verificado aqui.
 */
import express from 'express';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import jwt from 'jsonwebtoken';
import { assertPublicUrl, guardedLookup } from './net-guard.js';
import { parseCookies, COOKIE_NAME } from './auth.js';

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB
const FETCH_TIMEOUT = 15000;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Cliente HTTP(S) com lookup guardado: valida o IP na conexão (anti DNS rebinding),
// NÃO segue redirects (tratados manualmente com revalidação) e descomprime a resposta.
// Devolve um objeto compatível com o subconjunto de Response usado abaixo.
function guardedGet(rawUrl, { headers, signal } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(rawUrl); } catch { return reject(new Error('URL inválida.')); }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: 'GET', headers: { ...headers, 'Accept-Encoding': 'gzip, deflate, br' }, lookup: guardedLookup }, (res) => {
      const chunks = []; let total = 0; let killed = false;
      res.on('data', (c) => {
        if (killed) return;
        total += c.length;
        if (total > MAX_BYTES + 65536) { killed = true; try { req.destroy(); } catch {} return; }
        chunks.push(c);
      });
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc.includes('br')) buf = zlib.brotliDecompressSync(buf);
          else if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
          else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
        } catch { /* mantém como veio */ }
        resolve({
          status: res.statusCode || 0,
          headers: { get: (k) => { const v = res.headers[String(k).toLowerCase()]; return Array.isArray(v) ? v[0] : (v ?? null); } },
          async text() { return buf.toString('utf8'); },
          async arrayBuffer() { return buf; },
        });
      });
    });
    req.on('error', (e) => reject(e));
    if (signal) {
      if (signal.aborted) { try { req.destroy(); } catch {} const e = new Error('Abortado'); e.name = 'AbortError'; return reject(e); }
      signal.addEventListener('abort', () => { const e = new Error('Abortado'); e.name = 'AbortError'; try { req.destroy(e); } catch {} }, { once: true });
    }
    req.end();
  });
}

function escapeAttr(s) { return String(s).replace(/"/g, '%22'); }
// Escapa texto para inserção segura em HTML (evita XSS refletido nas páginas de erro).
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Script injetado: encaminha navegação (links e forms GET) ao pai via postMessage.
const NAV_SCRIPT = `<script>(function(){try{
  function send(u){try{parent.postMessage({__tngBrowse:'navigate',url:u},'*');}catch(e){}}
  document.addEventListener('click',function(e){
    var a=e.target&&e.target.closest?e.target.closest('a[href]'):null; if(!a)return;
    var href=a.href||''; if(!href||/^javascript:/i.test(href)||href.indexOf('#')===0)return;
    if(/^https?:/i.test(href)){e.preventDefault();send(href);}
  },true);
  document.addEventListener('submit',function(e){
    var f=e.target; if(!f)return; var m=(f.method||'get').toLowerCase(); if(m==='post')return;
    try{var url=new URL(f.getAttribute('action')||location.href,location.href);
    var p=new URLSearchParams(); var els=f.elements||[];
    for(var i=0;i<els.length;i++){var el=els[i]; if(el.name&&!el.disabled&&el.type!=='submit'&&el.type!=='button'){p.append(el.name,el.value);}}
    url.search=p.toString(); e.preventDefault(); send(url.href);}catch(_){}
  },true);
}catch(_){}})();</script>`;

function rewriteHtml(html, finalUrl) {
  // remove <base> existentes e meta-CSP (bloqueiam nossos recursos/scripts)
  let out = html
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  const inject = `<base href="${escapeAttr(finalUrl)}">`;
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head([^>]*)>/i, (m) => `${m}${inject}`);
  else out = `<head>${inject}</head>${out}`;
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, `${NAV_SCRIPT}</body>`);
  else out += NAV_SCRIPT;
  return out;
}

function errorPage(title, detail, url) {
  return `<!doctype html><html><head><meta charset="utf-8"><base href="about:blank"></head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#0b1020;color:#d7e6f5;display:grid;place-items:center;height:100vh">
    <div style="max-width:520px;padding:24px;text-align:center">
      <div style="font-size:15px;color:#00f0ff;margin-bottom:8px">⚠ ${escapeHtml(title)}</div>
      <div style="font-size:12px;color:#9fb3c8;line-height:1.5">${escapeHtml(detail)}</div>
      <div style="font-size:11px;color:#6f8398;margin-top:12px;word-break:break-all">${escapeHtml(url || '')}</div>
    </div>
  </body></html>`;
}

export function browseRouter(jwtSecret) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    // auth via cookie HttpOnly (same-origin) ou token na query (fallback dev)
    const tok = parseCookies(req.headers.cookie)[COOKIE_NAME] || req.query.token || '';
    try { jwt.verify(String(tok), jwtSecret); }
    catch { return res.status(401).type('html').send(errorPage('Não autorizado', 'Sessão inválida ou expirada. Recarregue o app.', '')); }

    let url = String(req.query.url || '').trim();
    if (!url) return res.status(400).type('html').send(errorPage('URL vazia', 'Informe um endereço para navegar.', ''));
    let target;
    try { target = new URL(await assertPublicUrl(url)); }
    catch (e) { return res.status(400).type('html').send(errorPage('Endereço bloqueado', e.message || 'URL inválida.', url)); }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
    const fetchHeaders = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' };
    try {
      // Segue redirects MANUALMENTE, revalidando cada salto contra o anti-SSRF:
      // um site público não pode nos redirecionar para um IP interno (loopback,
      // rede privada, metadata de cloud). Máx. 5 saltos.
      let currentUrl = target.href;
      let r;
      for (let hop = 0; ; hop++) {
        r = await guardedGet(currentUrl, { signal: ac.signal, headers: fetchHeaders });
        const loc = (r.status >= 300 && r.status < 400) ? r.headers.get('location') : null;
        if (!loc) break;
        if (hop >= 5) throw new Error('Muitos redirecionamentos.');
        currentUrl = await assertPublicUrl(new URL(loc, currentUrl).href);
      }
      clearTimeout(timer);
      const finalUrl = currentUrl;
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      // cabeçalhos que impediriam o iframe / cache
      res.removeHeader('X-Frame-Options');
      res.set('X-Tng-Final-Url', finalUrl);
      res.set('Cache-Control', 'no-store');

      if (ct.includes('text/html') || ct === '') {
        let html = await r.text();
        if (html.length > MAX_BYTES) html = html.slice(0, MAX_BYTES);
        res.status(200).type('html').send(rewriteHtml(html, finalUrl));
      } else {
        // recurso não-HTML (imagem, pdf, json…): repassa como veio
        const buf = Buffer.from(await r.arrayBuffer());
        res.status(r.status).set('Content-Type', r.headers.get('content-type') || 'application/octet-stream').send(buf);
      }
    } catch (e) {
      clearTimeout(timer);
      const msg = e && e.name === 'AbortError' ? 'Tempo de resposta esgotado (o site demorou demais).' : `Falha ao carregar: ${e && e.message ? e.message : 'erro de rede'}.`;
      res.status(502).type('html').send(errorPage('Não foi possível abrir', msg + ' Sites muito pesados em JavaScript podem não funcionar aqui — tente "abrir externamente".', url));
    }
  });

  return router;
}
