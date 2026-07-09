/**
 * tracerouteParse.js
 * Parser de saída de traceroute (Linux/BSD) e tracert (Windows) para hops
 * estruturados. Usado pelo overlay de traceroute no terminal integrado.
 */

// Heurística rápida: a linha parece pertencer a um traceroute?
export function looksLikeTraceroute(line) {
  if (!line) return false;
  if (/^traceroute(6)? to /i.test(line)) return true;
  if (/^tracing route to /i.test(line)) return true; // tracert (Windows)
  // Rejeita linhas de PING (e seus resumos), que senão seriam confundidas com
  // hops por começarem com número + "ms" (ex.: "64 bytes from x: ... time=10 ms").
  if (/icmp_seq|bytes from|ttl=\d|time[=<]|packets transmitted|round-trip|rtt\s+min/i.test(line)) return false;
  // linha de hop: começa com nº (1..63) e contém ms ou apenas estrelas
  if (/^\s*\d{1,2}\s+/.test(line) && /(\bms\b|\*)/.test(line)) return true;
  return false;
}

// Cabeçalho do traceroute: devolve { host, ip } do destino.
export function parseTracerouteStart(line) {
  if (!line) return null;
  let m = line.match(/^traceroute(?:6)? to\s+(\S+)\s+\(([0-9a-f.:]+)\)/i);
  if (m) return { host: m[1], ip: m[2] };
  m = line.match(/^tracing route to\s+(\S+)\s+\[([0-9a-f.:]+)\]/i);
  if (m) return { host: m[1], ip: m[2] };
  m = line.match(/^traceroute(?:6)? to\s+(\S+)/i);
  if (m) return { host: m[1], ip: m[1] };
  return null;
}

// Linha de hop -> { hop, host, ip, times:[ms...], timeout }
export function parseTracerouteHop(line) {
  const m = line.match(/^\s*(\d{1,2})\s+(.*)$/);
  if (!m) return null;
  const hop = parseInt(m[1], 10);
  if (!Number.isFinite(hop)) return null;
  const rest = m[2].trim();

  // todos timeouts: "* * *"
  if (/^(\*\s*)+$/.test(rest)) {
    return { hop, host: null, ip: null, times: [], timeout: true };
  }

  let host = null;
  let ip = null;
  // formato Linux: host (1.2.3.4)
  const hostIp = rest.match(/([A-Za-z0-9._-]+)\s+\(([0-9a-f.:]+)\)/i);
  if (hostIp) {
    host = hostIp[1];
    ip = hostIp[2];
  } else {
    // só IP, ou tracert (Windows) com IP no fim
    const ipOnly = rest.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/) || rest.match(/\b([0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,})\b/i);
    if (ipOnly) { ip = ipOnly[1]; host = ipOnly[1]; }
  }

  const times = [];
  const tre = /([\d.]+)\s*ms/g;
  let t;
  while ((t = tre.exec(rest)) !== null) {
    const v = parseFloat(t[1]);
    if (Number.isFinite(v)) times.push(v);
  }
  // tracert: tempos no formato "<1 ms" / "12 ms" antes do IP
  if (!times.length) {
    const tre2 = /<?\s*(\d+)\s*ms/g;
    let t2;
    while ((t2 = tre2.exec(rest)) !== null) times.push(parseFloat(t2[1]));
  }

  return { hop, host, ip, times, timeout: times.length === 0 && !ip };
}
