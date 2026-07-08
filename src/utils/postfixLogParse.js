/**
 * postfixLogParse.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Parser leve (client-side) de linhas do syslog do Postfix (mail.log) para o
 * "Modo Parse" do terminal SSH. Transforma linhas crípticas em eventos
 * estruturados e amigáveis para leigos (rótulos em PT).
 *
 *   parsePostfixLine(line) → evento | null
 *
 * Não cobre 100% do Postfix — foca nos eventos que importam para o analista:
 * entrega (sent), adiamento (deferred), rejeição (bounced/reject), conexões
 * (smtpd connect/disconnect) e avisos (warning).
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Heurística rápida: vale a pena tentar parsear esta linha?
export function looksLikePostfix(line) {
  return /postfix\/\w+\[?\d*\]?:/.test(line) || /\bpostfix\b.*:/.test(line);
}

const KIND_META = {
  sent:       { label: 'ENTREGUE',    color: '#34d399', glow: 'rgba(52,211,153,0.35)', icon: 'check', tone: 'ok' },
  deferred:   { label: 'ADIADO',      color: '#fbbf24', glow: 'rgba(251,191,36,0.35)', icon: 'clock', tone: 'warn' },
  bounced:    { label: 'REJEITADO',   color: '#f87171', glow: 'rgba(248,113,113,0.4)', icon: 'x',     tone: 'err' },
  reject:     { label: 'BLOQUEADO',   color: '#fb7185', glow: 'rgba(251,113,133,0.4)', icon: 'shield', tone: 'err' },
  bounce:     { label: 'DEVOLUÇÃO',   color: '#f59e0b', glow: 'rgba(245,158,11,0.35)', icon: 'undo',  tone: 'warn' },
  connect:    { label: 'CONEXÃO',     color: '#38bdf8', glow: 'rgba(56,189,248,0.3)',  icon: 'plug',  tone: 'info' },
  disconnect: { label: 'DESCONECTOU', color: '#64748b', glow: 'rgba(100,116,139,0.25)', icon: 'plug', tone: 'mute' },
  warning:    { label: 'AVISO',       color: '#facc15', glow: 'rgba(250,204,21,0.3)',  icon: 'alert', tone: 'warn' },
  removed:    { label: 'FINALIZADO',  color: '#475569', glow: 'rgba(71,85,105,0.2)',   icon: 'dot',   tone: 'mute' },
  info:       { label: 'INFO',        color: '#94a3b8', glow: 'rgba(148,163,184,0.2)', icon: 'dot',   tone: 'mute' },
};

export function kindMeta(kind) {
  return KIND_META[kind] || KIND_META.info;
}

function field(msg, key) {
  // captura key=<valor> ou key=valor (até vírgula/espaço)
  const m1 = msg.match(new RegExp(key + '=<([^>]*)>'));
  if (m1) return m1[1];
  const m2 = msg.match(new RegExp(key + '=([^,\\s]+)'));
  return m2 ? m2[1] : null;
}

// Traduz um motivo cru de rejeição/adiamento para linguagem de leigo.
function humanReason(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (t.includes('spamhaus')) return 'IP em blocklist Spamhaus';
  if (t.includes('spamcop')) return 'IP em blocklist SpamCop';
  if (t.includes('barracuda')) return 'IP em blocklist Barracuda';
  if (t.includes('blocked using') || t.includes('blacklist') || t.includes('blocklist') || t.includes('rbl')) return 'IP em blocklist (RBL)';
  if (t.includes('greylist') || t.includes('greylisted') || t.includes('try again')) return 'Greylisting — tentar de novo';
  if (t.includes('user unknown') || t.includes('no such user') || t.includes('recipient address rejected') || t.includes('does not exist')) return 'Destinatário não existe';
  if (t.includes('mailbox full') || t.includes('quota') || t.includes('over quota')) return 'Caixa do destinatário cheia';
  if (t.includes('connection timed out') || t.includes('timeout')) return 'Tempo de conexão esgotado';
  if (t.includes('connection refused')) return 'Conexão recusada pelo destino';
  if (t.includes('relay access denied') || t.includes('relay denied')) return 'Relay negado';
  if (t.includes('rate limit') || t.includes('too many') || t.includes('throttl')) return 'Limite de taxa do destino';
  if (t.includes('spf')) return 'Falha de SPF';
  if (t.includes('dkim')) return 'Falha de DKIM';
  if (t.includes('dmarc')) return 'Falha de DMARC';
  if (t.includes('tls') || t.includes('certificate')) return 'Problema de TLS/certificado';
  if (t.includes('name service not known') || t.includes('does not resolve') || t.includes('hostname')) return 'DNS não resolve o host';
  if (t.includes('5.7.1') || t.includes('access denied')) return 'Acesso negado pelo destino';
  return null;
}

// Extrai código SMTP (3 dígitos + enhanced status) de um texto.
function smtpCode(text) {
  if (!text) return null;
  const m = text.match(/\b([245]\d\d)\b(?:\s+(\d\.\d\.\d))?/);
  if (!m) return null;
  return m[2] ? `${m[1]} ${m[2]}` : m[1];
}

/**
 * Parseia UMA linha. Retorna null se não for um evento Postfix relevante.
 * @param {string} rawLine
 * @returns {null | {
 *   ts, host, proc, sub, pid, queueId, kind, from, to, relay, status,
 *   reason, code, sizeBytes, nrcpt, raw
 * }}
 */
export function parsePostfixLine(rawLine) {
  const line = String(rawLine || '').replace(/\s+$/, '');
  if (!line || !looksLikePostfix(line)) return null;

  // syslog: "<mês dia hora> <host> postfix/<sub>[pid]: <resto>"
  const m = line.match(/(?:^|\s)((?:[A-Z][a-z]{2}\s+\d{1,2}\s[\d:]{8})|(?:\d{4}-\d\d-\d\dT[\d:.]+\S*))?\s*(\S+)?\s*postfix\/(\w+)(?:\[(\d+)\])?:\s+(.*)$/);
  if (!m) return null;
  const [, ts, host, sub, pid, rest0] = m;
  let rest = rest0 || '';

  const ev = {
    ts: ts || '', host: host || '', proc: `postfix/${sub}`, sub, pid: pid || '',
    queueId: '', kind: 'info', from: null, to: null, relay: null, status: null,
    client: null, reason: null, code: null, sizeBytes: null, nrcpt: null, raw: line,
  };

  // queue id no começo do resto
  const q = rest.match(/^([0-9A-F]{6,16}):\s*(.*)$/);
  if (q) { ev.queueId = q[1]; rest = q[2]; }

  // captura genérica (aparecem em linhas diferentes por queue id)
  const gClient = field(rest, 'client'); if (gClient) ev.client = gClient;
  const gFrom = field(rest, 'from'); if (gFrom) ev.from = gFrom;

  // smtpd: conexões
  if (sub === 'smtpd') {
    if (/^connect from /i.test(rest)) {
      ev.kind = 'connect';
      ev.host2 = (rest.match(/connect from (\S+)/i) || [])[1] || null;
      return ev;
    }
    if (/^disconnect from /i.test(rest) || /^lost connection/i.test(rest)) {
      ev.kind = 'disconnect';
      ev.host2 = (rest.match(/from (\S+)/i) || [])[1] || null;
      return ev;
    }
    if (/NOQUEUE: reject/i.test(rest) || /^reject/i.test(rest)) {
      ev.kind = 'reject';
      ev.to = field(rest, 'to');
      ev.from = field(rest, 'from');
      const reasonText = (rest.match(/:\s*\d\d\d[^;]*$/) || rest.match(/reject:\s*(.*)$/) || [])[0] || rest;
      ev.code = smtpCode(rest);
      ev.reason = humanReason(rest) || 'Rejeitado na conexão';
      return ev;
    }
    // QUEUEID: client=host[ip] — entrada da mensagem (origem da conexão/email)
    if (ev.queueId && /client=/.test(rest)) { ev.kind = 'received'; return ev; }
  }

  // warning genérico
  if (/^warning:/i.test(rest)) {
    ev.kind = 'warning';
    ev.reason = rest.replace(/^warning:\s*/i, '').slice(0, 200);
    return ev;
  }

  // qmgr / cleanup / removed
  if (sub === 'qmgr') {
    if (/removed$/.test(rest)) { ev.kind = 'removed'; return ev; }
    ev.from = field(rest, 'from');
    ev.sizeBytes = parseInt(field(rest, 'size'), 10) || null;
    ev.nrcpt = parseInt(field(rest, 'nrcpt'), 10) || null;
    ev.kind = 'info';
    ev.queued = true;
    return ev;
  }

  // smtp / lmtp / local / pipe / error / bounce → entrega com status=
  const status = field(rest, 'status');
  if (status) {
    ev.to = field(rest, 'to');
    ev.relay = field(rest, 'relay');
    ev.status = status;
    ev.code = smtpCode(rest);
    if (status === 'sent') ev.kind = 'sent';
    else if (status === 'deferred') ev.kind = 'deferred';
    else if (status === 'bounced') ev.kind = 'bounced';
    else if (status === 'expired') ev.kind = 'bounced';
    else ev.kind = 'info';
    // motivo dentro dos parênteses
    const paren = rest.match(/\(([^]*)\)\s*$/);
    if (paren && status !== 'sent') ev.reason = humanReason(paren[1]) || paren[1].slice(0, 160);
    return ev;
  }

  if (sub === 'bounce') { ev.kind = 'bounce'; ev.reason = 'Notificação de devolução gerada'; return ev; }

  return null; // não é um evento que nos interessa
}

export default parsePostfixLine;
