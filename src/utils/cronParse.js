/**
 * cronParse.js
 * Traduz expressões cron (5 campos, + apelidos @daily etc.) para linguagem
 * natural em PT-BR e calcula as próximas execuções.
 */

const DOW = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MON = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ALIASES = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
};

function expandField(expr, min, max) {
  // retorna conjunto de valores válidos
  const out = new Set();
  for (const part of String(expr).split(',')) {
    let step = 1; let range = part;
    const sm = part.match(/^(.*)\/(\d+)$/);
    if (sm) { range = sm[1]; step = parseInt(sm[2], 10); }
    let lo = min; let hi = max;
    if (range === '*' || range === '') { /* full */ }
    else if (/^\d+$/.test(range)) { lo = hi = parseInt(range, 10); }
    else { const rm = range.match(/^(\d+)-(\d+)$/); if (rm) { lo = parseInt(rm[1], 10); hi = parseInt(rm[2], 10); } else return null; }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr) {
  let e = String(expr || '').trim();
  if (!e) return null;
  if (ALIASES[e.toLowerCase()]) e = ALIASES[e.toLowerCase()];
  if (e.startsWith('@reboot')) return { text: 'No boot do sistema', fields: null, alias: '@reboot' };
  const f = e.split(/\s+/);
  if (f.length < 5) return null;
  const [min, hr, dom, mon, dow] = f;
  const mins = expandField(min, 0, 59);
  const hrs = expandField(hr, 0, 23);
  const doms = expandField(dom, 1, 31);
  const mons = expandField(mon, 1, 12);
  let dows = expandField(dow, 0, 7);
  if (!mins || !hrs || !doms || !mons || !dows) return null;
  if (dows.has(7)) { dows = new Set([...dows].map((d) => (d === 7 ? 0 : d))); }
  return { fields: { mins, hrs, doms, mons, dows, raw: { min, hr, dom, mon, dow } }, text: describeCron(min, hr, dom, mon, dow) };
}

function describeCron(min, hr, dom, mon, dow) {
  const parts = [];
  // horário
  if (min === '*' && hr === '*') parts.push('a cada minuto');
  else if (/^\*\/(\d+)$/.test(min) && hr === '*') parts.push(`a cada ${min.match(/\d+/)[0]} minuto(s)`);
  else if (hr === '*' && /^\d+$/.test(min)) parts.push(`no minuto ${min} de cada hora`);
  else if (/^\d+$/.test(min) && /^\d+$/.test(hr)) parts.push(`às ${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  else if (/^\*\/(\d+)$/.test(hr)) parts.push(`a cada ${hr.match(/\d+/)[0]} hora(s)` + (/^\d+$/.test(min) ? ` no minuto ${min}` : ''));
  else parts.push(`min ${min}, hora ${hr}`);
  // dia
  if (dow !== '*' && dom === '*') {
    const days = [...(expandField(dow, 0, 7) || [])].map((d) => DOW[d === 7 ? 0 : d]).filter(Boolean);
    parts.push(`toda(s) ${days.join(', ')}`);
  } else if (dom !== '*') {
    parts.push(`no dia ${dom}` + (mon !== '*' ? ` de ${[...(expandField(mon, 1, 12) || [])].map((m) => MON[m]).join(', ')}` : ' de cada mês'));
  } else if (mon !== '*') {
    parts.push(`em ${[...(expandField(mon, 1, 12) || [])].map((m) => MON[m]).join(', ')}`);
  } else {
    parts.push('todos os dias');
  }
  return parts.join(', ');
}

/** Próximas N execuções a partir de `from` (Date). */
export function nextRuns(expr, n = 3, from = new Date()) {
  const p = parseCron(expr);
  if (!p || !p.fields) return [];
  const { mins, hrs, doms, mons, dows } = p.fields;
  const domRestricted = p.fields.raw.dom !== '*';
  const dowRestricted = p.fields.raw.dow !== '*';
  const out = [];
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let guard = 0; guard < 366 * 24 * 60 && out.length < n; guard++) {
    const okMon = mons.has(d.getMonth() + 1);
    const okDom = doms.has(d.getDate());
    const okDow = dows.has(d.getDay());
    // cron: se ambos dom e dow restritos, casa qualquer um (OR)
    const dayOk = (domRestricted && dowRestricted) ? (okDom || okDow) : (okDom && okDow);
    if (okMon && dayOk && hrs.has(d.getHours()) && mins.has(d.getMinutes())) {
      out.push(new Date(d.getTime()));
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return out;
}
