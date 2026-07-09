/**
 * pingLineParse.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Parser leve (client-side) da saída do comando `ping` para o "Modo Ping" do
 * terminal SSH. Reconhece início, respostas (RTT/TTL), perdas/timeouts e o
 * resumo final, em Linux (iputils), macOS/BSD e Windows.
 *
 *   parsePingLine(line) → evento | null
 *     { type: 'start',   host, ip }
 *     { type: 'reply',   seq, ttl, time, host }
 *     { type: 'loss',    seq, reason }
 *     { type: 'summary', transmitted?, received?, lossPct?, min?, avg?, max?, mdev? }
 *
 * Também exporta a classificação de latência/qualidade usada no overlay.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Heurística rápida: vale a pena tentar parsear esta linha?
export function looksLikePing(line) {
  return /icmp_seq|bytes from|ping statistics|packets transmitted|rtt min|round-trip|Request timed out|Request timeout for|Reply from|Unreachable|^PING |^Pinging |bytes of data|packet loss|Packets:\s*Sent|Minimum\s*=|Lost\s*=/i.test(line);
}

export function parsePingLine(raw) {
  const l = String(raw || '').trim();
  if (!l) return null;

  // ── Início: "PING google.com (142.250.x.x) 56(84) bytes of data." ──
  let m = l.match(/^PING\s+(\S+)\s+\(([0-9a-fA-F.:]+)\)/);
  if (m) return { type: 'start', host: m[1], ip: m[2] };
  m = l.match(/^PING\s+([0-9a-fA-F.:]+)\b/);
  if (m) return { type: 'start', host: m[1], ip: m[1] };
  // Windows: "Pinging 8.8.8.8 with 32 bytes of data:"
  m = l.match(/^Pinging\s+(?:(\S+)\s+\[([0-9a-fA-F.:]+)\]|([0-9a-fA-F.:]+))\s+with/i);
  if (m) return { type: 'start', host: m[1] || m[3], ip: m[2] || m[3] };

  // ── Resposta Linux/mac: "64 bytes from h (1.2.3.4): icmp_seq=1 ttl=117 time=12.3 ms" ──
  m = l.match(/icmp_seq[=\s](\d+).*?ttl[=\s](\d+).*?time[=\s]([\d.]+)\s*ms/i);
  if (m) {
    const h = l.match(/from\s+([^\s:(]+)/i);
    return { type: 'reply', seq: +m[1], ttl: +m[2], time: parseFloat(m[3]), host: h ? h[1] : null };
  }
  // Resposta sem ttl explícito mas com bytes from + time
  m = l.match(/icmp_seq[=\s](\d+).*?time[=\s]([\d.]+)\s*ms/i);
  if (m && /bytes from/i.test(l)) {
    const h = l.match(/from\s+([^\s:(]+)/i);
    return { type: 'reply', seq: +m[1], ttl: null, time: parseFloat(m[2]), host: h ? h[1] : null };
  }
  // ── Resposta Windows: "Reply from 8.8.8.8: bytes=32 time=12ms TTL=117" (ou time<1ms) ──
  m = l.match(/Reply from\s+([^\s:]+).*?time[=<]\s*([\d.]+)\s*ms.*?TTL[=\s]*(\d+)/i);
  if (m) return { type: 'reply', seq: null, ttl: +m[3], time: parseFloat(m[2]), host: m[1] };

  // ── Perdas / inacessível / timeout ──
  if (/Destination\s+Host\s+Unreachable/i.test(l)) {
    const s = l.match(/icmp_seq[=\s](\d+)/i);
    return { type: 'loss', seq: s ? +s[1] : null, reason: 'host inacessível' };
  }
  if (/Destination\s+(?:Net|Network|Protocol|Port)\s+Unreachable/i.test(l)) {
    return { type: 'loss', seq: null, reason: 'rede inacessível' };
  }
  m = l.match(/Request timeout for icmp_seq\s*(\d+)/i); // macOS/BSD
  if (m) return { type: 'loss', seq: +m[1], reason: 'timeout' };
  m = l.match(/no answer yet for icmp_seq[=\s](\d+)/i);
  if (m) return { type: 'loss', seq: +m[1], reason: 'sem resposta' };
  if (/Request timed out/i.test(l)) return { type: 'loss', seq: null, reason: 'timeout' };

  // ── Resumo: pacotes ──
  // "3 packets transmitted, 2 received, 33% packet loss, time 2003ms"
  m = l.match(/(\d+)\s+packets transmitted,\s+(\d+)\s+(?:packets\s+)?received.*?([\d.]+)%\s*packet loss/i);
  if (m) return { type: 'summary', transmitted: +m[1], received: +m[2], lossPct: parseFloat(m[3]) };
  // Windows: "Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),"
  m = l.match(/Sent\s*=\s*(\d+),\s*Received\s*=\s*(\d+),\s*Lost\s*=\s*(\d+)\s*\(([\d.]+)%/i);
  if (m) return { type: 'summary', transmitted: +m[1], received: +m[2], lossPct: parseFloat(m[4]) };

  // ── Resumo: RTT ──
  // "rtt min/avg/max/mdev = 11.1/12.3/13.7/0.4 ms"  |  "round-trip ... = .../.../.../... ms"
  m = l.match(/(?:rtt|round-trip)\s+min\/avg\/max(?:\/(?:mdev|stddev))?\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)(?:\/([\d.]+))?\s*ms/i);
  if (m) return { type: 'summary', min: parseFloat(m[1]), avg: parseFloat(m[2]), max: parseFloat(m[3]), mdev: m[4] ? parseFloat(m[4]) : null };
  // Windows: "Minimum = 11ms, Maximum = 13ms, Average = 12ms"
  m = l.match(/Minimum\s*=\s*([\d.]+)ms,\s*Maximum\s*=\s*([\d.]+)ms,\s*Average\s*=\s*([\d.]+)ms/i);
  if (m) return { type: 'summary', min: parseFloat(m[1]), max: parseFloat(m[2]), avg: parseFloat(m[3]), mdev: null };

  return null;
}

// ── Classificação de latência (cor + rótulo) ──
export const LAT_TIERS = [
  { max: 30,       label: 'rápido',      color: '#34d399' },
  { max: 80,       label: 'médio',       color: '#22d3ee' },
  { max: 150,      label: 'aceitável',   color: '#fbbf24' },
  { max: 300,      label: 'lento',       color: '#fb923c' },
  { max: Infinity, label: 'muito lento', color: '#f87171' },
];

export function classifyLatency(ms) {
  if (ms == null || isNaN(ms)) return { label: '—', color: '#64748b' };
  return LAT_TIERS.find((t) => ms < t.max) || LAT_TIERS[LAT_TIERS.length - 1];
}

// ── Classificação de qualidade geral (combina perda + latência média) ──
export function classifyQuality({ lossPct, avg }) {
  if (lossPct != null && lossPct >= 100) return { label: 'SEM RESPOSTA', color: '#f87171' };
  if (lossPct != null && lossPct >= 10) return { label: 'RUIM', color: '#fb7185' };
  if ((lossPct != null && lossPct >= 2) || (avg != null && avg >= 300)) return { label: 'INSTÁVEL', color: '#fb923c' };
  if (avg != null && avg >= 150) return { label: 'ACEITÁVEL', color: '#fbbf24' };
  if (avg != null && avg < 80) return { label: 'ÓTIMO', color: '#34d399' };
  if (avg != null) return { label: 'BOM', color: '#22d3ee' };
  return { label: '—', color: '#64748b' };
}
