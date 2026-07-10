/**
 * net-guard.js — proteção anti-SSRF.
 * Resolve o hostname e recusa destinos internos (loopback, link-local, redes
 * privadas, metadata de cloud). Usado antes de qualquer fetch/curl no lado do
 * servidor (browse.js e o http_fetch do terminal).
 */
import dns from 'node:dns/promises';
import net from 'node:net';

function ipIsPrivate(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;                          // 10/8
    if (p[0] === 127) return true;                         // loopback
    if (p[0] === 0) return true;                           // 0.0.0.0/8
    if (p[0] === 169 && p[1] === 254) return true;         // link-local / metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16/12
    if (p[0] === 192 && p[1] === 168) return true;         // 192.168/16
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT 100.64/10
    if (p[0] >= 224) return true;                          // multicast/reservado
    return false;
  }
  if (net.isIPv6(ip)) {
    const a = ip.toLowerCase();
    if (a === '::1' || a === '::') return true;            // loopback / unspecified
    if (a.startsWith('fe80')) return true;                 // link-local
    if (a.startsWith('fc') || a.startsWith('fd')) return true; // ULA fc00::/7
    if (a.startsWith('::ffff:')) return ipIsPrivate(a.slice(7)); // IPv4 mapeado
    return false;
  }
  return true; // desconhecido → trata como inseguro
}

/**
 * lookup "guardado" para usar como opção `lookup` de http/https.request.
 * Revalida o IP NO MOMENTO DA CONEXÃO — fecha a janela de DNS rebinding: mesmo
 * que o assertPublicUrl tenha validado antes, se o nome for re-resolvido para um
 * IP interno na conexão real, aqui recusamos.
 * Assinatura compatível com dns.lookup: (hostname, options?, callback).
 */
export function guardedLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = (options && typeof options === 'object') ? options : {};
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    for (const a of list) {
      if (ipIsPrivate(a.address)) {
        const e = new Error('Destino interno bloqueado (possível DNS rebinding).');
        e.code = 'EBLOCKED';
        return cb(e);
      }
    }
    if (opts.all) return cb(null, list);
    const first = list[0];
    return cb(null, first.address, first.family);
  });
}

/**
 * Valida uma URL e resolve o host. Lança Error se o destino for interno/inválido.
 * Retorna a URL normalizada (com esquema https:// se omitido).
 */
export async function assertPublicUrl(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (!url) throw new Error('URL vazia.');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let target;
  try { target = new URL(url); } catch { throw new Error('URL inválida.'); }
  if (!/^https?:$/.test(target.protocol)) throw new Error('Protocolo não suportado (apenas http/https).');

  const host = target.hostname;
  // IP literal → valida direto; hostname → resolve todos os endereços.
  if (net.isIP(host)) {
    if (ipIsPrivate(host)) throw new Error('Destino interno bloqueado.');
  } else {
    let addrs;
    try { addrs = await dns.lookup(host, { all: true }); }
    catch { throw new Error('Não foi possível resolver o host.'); }
    if (!addrs.length) throw new Error('Host sem endereços.');
    for (const a of addrs) if (ipIsPrivate(a.address)) throw new Error('Destino interno bloqueado.');
  }
  return target.href;
}
