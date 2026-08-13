/**
 * commandParsers.js
 * Registro unificado de parsers de saída de comandos do terminal-ng.
 *
 * Cada parser converte a saída textual de um comando Linux numa estrutura de
 * RENDER NORMALIZADA (sections), consumida por <ToolParseOverlay/>. Assim, um
 * único ponto de integração no XTerminal cobre TODOS os parsers: basta o
 * comando casar em `toolKindForCmd(cmd)` e a saída ser passada a `parseTool`.
 *
 * Schema das sections (cada parser devolve { title, icon, sections: [] }):
 *   { type:'table',  columns:[{key,label,align,bar,mono}], rows:[{...}] }
 *   { type:'bars',   items:[{label, sub, pct, valueText, tone}] }
 *   { type:'cards',  items:[{title, sub, badge, tone, pct, value}] }
 *   { type:'badges', label, items:[{text, tone, count}] }
 *   { type:'kv',     items:[{k, v, tone}] }
 *   { type:'spark',  items:[{label, values:[Number], unit, tone}] }
 *   { type:'note',   tone, title, text }
 * tone ∈ 'ok'|'warn'|'danger'|'info'|'dim'|'accent'
 */

// ───────────────────────── helpers de baixo nível ─────────────────────────
export function toBytes(s) {
  if (s == null) return null;
  const str = String(s).replace(/[<>~]/g, '').replace(/i?b$/i, '').trim();
  const m = str.match(/^([\d.]+)\s*([kmgtpe])?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4, p: 1024 ** 5, e: 1024 ** 6 }[(m[2] || '').toLowerCase()] || 1;
  return n * mult;
}
export function fmtBytes(b) {
  if (b == null || !Number.isFinite(b)) return '—';
  const u = ['B', 'K', 'M', 'G', 'T', 'P'];
  let i = 0; let v = Math.abs(b);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${(b < 0 ? '-' : '')}${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)}${u[i]}`;
}
const num = (s) => { const n = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const lastOf = (a) => (a && a.length ? a[a.length - 1] : null);
const clean = (lines) => (Array.isArray(lines) ? lines : String(lines || '').split('\n'))
  .map((l) => String(l).replace(/\x1b\[[0-9;]*m/g, '').replace(/\r$/, ''))
  .filter((l) => l.length > 0);
const pctTone = (p) => (p >= 90 ? 'danger' : p >= 75 ? 'warn' : 'ok');

// ── classificação de severidade de uma linha de log ───────────────────────
const SEV_TONE = { fatal: 'danger', error: 'danger', warn: 'warn', notice: 'info', info: 'dim' };
const SEV_LABEL = { fatal: 'FATAL', error: 'ERRO', warn: 'AVISO', notice: 'NOTICE', info: 'INFO' };
export function classifyLog(msg) {
  const s = String(msg || '');
  if (/\b(fatal|panic|emergency|kernel panic|segfault|core[- ]dump(?:ed)?|oom[- ]?kill|out of memory|general protection)\b/i.test(s)) return 'fatal';
  if (/\bstatus=(?:[1-9]\d*)\b/.test(s)
    || /\bcode=(?:killed|dumped)\b/i.test(s)
    || /result\s+'?(?:exit-code|failed|timeout|core-dump|signal)'?/i.test(s)
    || /\b(error|err|fail(?:ed|ure|s)?|denied|refused|cannot|could ?n[o']t|unable|not found|no such (?:file|directory|process)|timed out|critical|crit|alert|unauthorized|exception|traceback|rejected|invalid|corrupt)\b/i.test(s)) return 'error';
  if (/\b(warn(?:ing)?|deprecat\w*|retry|retrying|throttl\w*|slow|degraded|unstable|timeout|will retry|backoff)\b/i.test(s)) return 'warn';
  if (/\bnotice\b/i.test(s)) return 'notice';
  return 'info';
}

// Monta o resultado padrão de um parser de log: gráfico de tipos + destaque
// de fatal/erros + fontes mais ativas + tabela colorida por severidade.
function logResult(title, icon, counts, rows, unitCount, extra = {}) {
  const order = ['fatal', 'error', 'warn', 'notice', 'info'];
  const present = order.filter((k) => counts[k]);
  const total = order.reduce((a, k) => a + (counts[k] || 0), 0) || 1;
  const maxC = Math.max(1, ...present.map((k) => counts[k]));
  const sections = [];
  // gráfico de tipos de log (severidades) — proporção do total
  sections.push({ type: 'bars', items: order.filter((k) => counts[k]).map((k) => ({
    label: SEV_LABEL[k], sub: `${Math.round((counts[k] / total) * 100)}% do total`,
    pct: Math.round((counts[k] / maxC) * 100), valueText: String(counts[k]), tone: SEV_TONE[k],
  })) });
  // destaque de crítico
  if (counts.fatal || counts.error) {
    const bits = [];
    if (counts.fatal) bits.push(`${counts.fatal} FATAL`);
    if (counts.error) bits.push(`${counts.error} erro(s)`);
    if (counts.warn) bits.push(`${counts.warn} aviso(s)`);
    sections.push({ type: 'note', tone: counts.fatal ? 'danger' : 'danger', title: bits.join(' · '), text: extra.streaming ? 'Atualizando ao vivo — linhas críticas destacadas abaixo.' : 'Linhas críticas destacadas abaixo.' });
  }
  // fontes mais ativas (unidade/serviço/programa)
  const topUnits = Object.entries(unitCount).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (topUnits.length) sections.push({ type: 'badges', label: 'Fontes mais ativas', items: topUnits.map(([text, count]) => ({ text, count, tone: 'accent' })) });
  // tabela: erros/fatal primeiro, depois cronológico recente
  const recent = rows.slice(-400);
  const critical = recent.filter((r) => r._sev === 'fatal' || r._sev === 'error').slice(-60);
  const tail = recent.slice(-120);
  const seen = new Set();
  const merged = [...critical, ...tail].filter((r) => { if (seen.has(r._id)) return false; seen.add(r._id); return true; });
  sections.push({ type: 'table', columns: [
    { key: 'time', label: 'Hora', mono: true },
    { key: 'sev', label: 'Nível', mono: true, tone: (r) => r._tone },
    { key: 'unit', label: 'Fonte', mono: true, tone: () => 'accent' },
    { key: 'msg', label: 'Mensagem', mono: true, tone: (r) => r._tone },
  ], rows: merged });
  return { title, icon, sections };
}

// ───────────────────────── detecção comando → parser ──────────────────────
// Remove prefixos (sudo/time/stdbuf/env/watch) e pipes/redirs p/ achar o binário.
function bareCmd(cmd) {
  let c = String(cmd || '').trim();
  c = c.replace(/^(?:sudo(?:\s+-\S+)*\s+|time\s+|stdbuf(?:\s+-\S+)*\s+|env\s+\S+=\S+\s+|watch(?:\s+-\S+)*\s+|nice(?:\s+-\S+)*\s+|ionice(?:\s+-\S+)*\s+)+/i, '');
  return c.trim();
}
function firstWord(cmd) { return bareCmd(cmd).split(/\s+/)[0] || ''; }

/** Retorna o id do parser para um comando, ou null. */
export function toolKindForCmd(cmd) {
  const c = bareCmd(cmd);
  const w = firstWord(cmd);
  if (/^(ss|netstat)\b/.test(c)) return 'sockets';
  if (/^ip\s+(-\w+\s+)*(a\b|addr\b|address\b|l\b|link\b)/.test(c)) return 'ipaddr';
  if (/^ip\s+(-\w+\s+)*(r\b|route\b|ro\b)/.test(c)) return 'iproute';
  if (/^ifconfig\b/.test(c)) return 'ipaddr';
  if (/^(iptables|ip6tables)\b.*(-L|--list)/.test(c) || /^(iptables|ip6tables)\b(?!.*-[AIDF])/.test(c)) return 'iptables';
  if (/^nft\s+(list)\b/.test(c)) return 'iptables';
  if (/^(ps)\b/.test(c)) return 'ps';
  if (/^top\s+-b/.test(c)) return 'ps';
  if (/^free\b/.test(c)) return 'free';
  if (/^vmstat\b/.test(c)) return 'vmstat';
  if (/^iostat\b/.test(c)) return 'iostat';
  if (/^mpstat\b/.test(c)) return 'mpstat';
  if (/^du\b/.test(c)) return 'du';
  if (/^smartctl\b/.test(c)) return 'smartctl';
  if (/^journalctl\b/.test(c)) return 'journal';
  if (/^dmesg\b/.test(c)) return 'dmesg';
  if (/^tcpdump\b/.test(c)) return 'tcpdump';
  if (/^systemctl\b/.test(c) && !/\b(start|stop|restart|reload|enable|disable|mask|edit)\b/.test(c)) return 'systemctl';
  if (/^systemd-analyze\s+blame/.test(c)) return 'analyze';
  if (/^(lsof)\b/.test(c)) return 'lsof';
  if (/^(uptime|w)\b/.test(c)) return 'uptime';
  if (/^last\b/.test(c)) return 'last';
  if (/(?:^|;\s*)screen\s+(?:-ls|-list|--list)\b/.test(c)) return 'screen';
  if (/^ls\b/.test(c)) return 'ls'; // só `ls` (não lsblk/lsof/lsattr — sem boundary após "ls")
  // logs por arquivo (cat/tail/grep em caminhos conhecidos)
  if (/^(cat|tail|head|grep|less|bat|zcat)\b/.test(c)) {
    if (/access[._-]?log|access\.log/.test(c)) return 'weblog';
    if (/(nginx|apache2|httpd).*error|error[._-]?log/.test(c)) return 'weberr';
    if (/auth\.log|secure\b/.test(c)) return 'authlog';
    if (/syslog|messages\b/.test(c)) return 'syslog';
  }
  return null;
}

// Comandos cuja saída é "ao vivo"/contínua e não deve ser capturada em bloco.
export function isStreamingTool(cmd) {
  const c = bareCmd(cmd);
  return /(-f\b|--follow|^vmstat\s+\d|^iostat\s+\d|^mpstat\s+\d|^tcpdump\b|^top(?!\s+-b))/.test(c) || /^watch\b/.test(String(cmd || ''));
}

// ───────────────────────────── parsers ────────────────────────────────────

// ss / netstat — sockets
function parseSockets(lines) {
  const L = clean(lines);
  const rows = [];
  const stateCount = {};
  for (const ln of L) {
    if (/^(Netid|Proto|Active|State|Recv-Q)\b/i.test(ln)) continue;
    // ss: State Recv-Q Send-Q Local:Port Peer:Port Process
    let m = ln.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);
    let proto = null, state, local, peer, proc;
    if (m && /^(LISTEN|ESTAB|TIME-WAIT|CLOSE-WAIT|SYN-SENT|SYN-RECV|FIN-WAIT|LAST-ACK|CLOSING|UNCONN|ESTABLISHED)/i.test(m[1])) {
      [, state, , , local, peer, proc] = m;
    } else {
      // netstat: Proto Recv-Q Send-Q Local Foreign State [PID/Program]
      m = ln.match(/^(tcp6?|udp6?)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)?(?:\s+(.*))?$/);
      if (!m) continue;
      proto = m[1]; state = m[6] || 'UNCONN'; local = m[4]; peer = m[5]; proc = m[7];
    }
    const lp = (local.match(/:(\d+|\*)$/) || [])[1] || '';
    const pid = (String(proc || '').match(/pid=(\d+)/) || [])[1] || (String(proc || '').match(/^(\d+)\//) || [])[1] || '';
    const pname = (String(proc || '').match(/"([^"]+)"/) || [])[1] || (String(proc || '').match(/\d+\/(\S+)/) || [])[1] || '';
    state = state.toUpperCase().replace('ESTABLISHED', 'ESTAB');
    stateCount[state] = (stateCount[state] || 0) + 1;
    rows.push({ state, proto: proto || '', local, port: lp, peer, proc: pname || (pid ? `pid ${pid}` : '') });
  }
  if (!rows.length) return null;
  const order = { LISTEN: 0, ESTAB: 1 };
  rows.sort((a, b) => (order[a.state] ?? 5) - (order[b.state] ?? 5) || (num(a.port) || 0) - (num(b.port) || 0));
  const toneFor = (s) => (s === 'LISTEN' ? 'accent' : s === 'ESTAB' ? 'ok' : s.startsWith('TIME') ? 'dim' : 'warn');
  return {
    title: 'Sockets · ss', icon: 'plug',
    sections: [
      { type: 'badges', label: 'Estados', items: Object.entries(stateCount).map(([text, count]) => ({ text, count, tone: toneFor(text) })) },
      { type: 'table',
        columns: [
          { key: 'state', label: 'Estado', mono: true }, { key: 'local', label: 'Local', mono: true },
          { key: 'peer', label: 'Peer', mono: true }, { key: 'proc', label: 'Processo', mono: true },
        ],
        rows: rows.slice(0, 200) },
    ],
  };
}

// ip addr / ip link / ifconfig — interfaces
function parseIpAddr(lines) {
  const L = clean(lines);
  const ifaces = [];
  let cur = null;
  for (const ln of L) {
    let m = ln.match(/^\d+:\s+([^:@]+)[:@].*?<([^>]*)>.*?(?:mtu\s+(\d+))?/);
    if (m) { cur = { name: m[1].trim(), flags: m[2], mtu: m[3] || '', state: /UP/.test(m[2]) ? 'UP' : 'DOWN', addrs: [], mac: '' }; ifaces.push(cur); continue; }
    // ifconfig style header
    m = ln.match(/^([A-Za-z0-9@._-]+):\s+flags=\d+<([^>]*)>\s+mtu\s+(\d+)/);
    if (m) { cur = { name: m[1], flags: m[2], mtu: m[3], state: /UP/.test(m[2]) ? 'UP' : 'DOWN', addrs: [], mac: '' }; ifaces.push(cur); continue; }
    if (!cur) continue;
    m = ln.match(/^\s*(?:inet|inet addr:?)\s*(\d+\.\d+\.\d+\.\d+)(?:\/(\d+))?/);
    if (m) { cur.addrs.push(m[1] + (m[2] ? '/' + m[2] : '')); continue; }
    m = ln.match(/^\s*inet6\s+([0-9a-f:]+)(?:\/(\d+))?/i);
    if (m && !/fe80/i.test(m[1])) { cur.addrs.push(m[1] + (m[2] ? '/' + m[2] : '')); continue; }
    m = ln.match(/(?:link\/ether|ether)\s+([0-9a-f:]{17})/i);
    if (m) cur.mac = m[1];
    m = ln.match(/RX.*?(\d+)\s+packets.*?(\d+)\s+(?:bytes|errors)/i);
  }
  if (!ifaces.length) return null;
  return {
    title: 'Interfaces · ip addr', icon: 'network',
    sections: [
      { type: 'cards', items: ifaces.map((i) => ({
        title: i.name, sub: `${i.addrs.join('  ') || 'sem IP'}${i.mac ? '  ·  ' + i.mac : ''}  ·  mtu ${i.mtu || '?'}`,
        badge: i.state, tone: i.state === 'UP' ? 'ok' : 'dim',
      })) },
    ],
  };
}

// ip route — tabela de rotas
function parseIpRoute(lines) {
  const L = clean(lines);
  const rows = [];
  let def = null;
  for (const ln of L) {
    if (/^(Kernel|Destination)/.test(ln)) continue;
    const dst = (ln.match(/^(default|[0-9a-f:.]+(?:\/\d+)?)/i) || [])[1];
    if (!dst) continue;
    const via = (ln.match(/\bvia\s+(\S+)/) || [])[1] || '';
    const dev = (ln.match(/\bdev\s+(\S+)/) || [])[1] || '';
    const src = (ln.match(/\bsrc\s+(\S+)/) || [])[1] || '';
    const metric = (ln.match(/\bmetric\s+(\d+)/) || [])[1] || '';
    if (dst === 'default') def = via || dev;
    rows.push({ dst, via: via || '—', dev, src, metric });
  }
  if (!rows.length) return null;
  return {
    title: 'Rotas · ip route', icon: 'route',
    sections: [
      def ? { type: 'note', tone: 'info', title: 'Gateway default', text: def } : null,
      { type: 'table',
        columns: [
          { key: 'dst', label: 'Destino', mono: true }, { key: 'via', label: 'Via', mono: true },
          { key: 'dev', label: 'Dev', mono: true }, { key: 'src', label: 'Src', mono: true }, { key: 'metric', label: 'Métrica', mono: true, align: 'right' },
        ], rows },
    ].filter(Boolean),
  };
}

// iptables -L -n -v / nft list — regras
function parseIptables(lines) {
  const L = clean(lines);
  const chains = [];
  let cur = null;
  for (const ln of L) {
    let m = ln.match(/^Chain\s+(\S+)\s+\(policy\s+(\w+)/);
    if (m) { cur = { name: m[1], policy: m[2], rules: [] }; chains.push(cur); continue; }
    m = ln.match(/^Chain\s+(\S+)\s+\((\d+)\s+references\)/);
    if (m) { cur = { name: m[1], policy: `${m[2]} refs`, rules: [] }; chains.push(cur); continue; }
    if (/^\s*(pkts|target|num)\b/i.test(ln)) continue;
    if (!cur) continue;
    // -v: pkts bytes target prot opt in out source destination [extra]
    m = ln.match(/^\s*(\d+[KMG]?)\s+(\d+[KMG]?)\s+(\S+)\s+(\S+)\s+\S+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);
    if (m) { cur.rules.push({ pkts: m[1], target: m[3], prot: m[4], src: m[6], dst: m[7], extra: (m[9] || '').trim() }); continue; }
    // sem -v: target prot opt source destination [extra]
    m = ln.match(/^(\S+)\s+(\S+)\s+\S+\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);
    if (m && /^(ACCEPT|DROP|REJECT|LOG|RETURN|MASQUERADE|DNAT|SNAT|[A-Z][A-Za-z0-9_-]+)$/.test(m[1])) {
      cur.rules.push({ pkts: '', target: m[1], prot: m[2], src: m[3], dst: m[4], extra: (m[5] || '').trim() });
    }
  }
  if (!chains.length) return null;
  const tone = (t) => (/ACCEPT/.test(t) ? 'ok' : /DROP|REJECT/.test(t) ? 'danger' : /LOG/.test(t) ? 'info' : 'accent');
  const sections = [];
  for (const ch of chains) {
    sections.push({ type: 'note', tone: ch.policy === 'DROP' ? 'danger' : ch.policy === 'ACCEPT' ? 'ok' : 'info', title: `Chain ${ch.name}`, text: `policy ${ch.policy} · ${ch.rules.length} regra(s)` });
    if (ch.rules.length) sections.push({ type: 'table',
      columns: [
        { key: 'target', label: 'Alvo', mono: true, tone: (r) => tone(r.target) }, { key: 'prot', label: 'Prot', mono: true },
        { key: 'src', label: 'Origem', mono: true }, { key: 'dst', label: 'Destino', mono: true },
        { key: 'extra', label: 'Detalhe', mono: true }, { key: 'pkts', label: 'Pkts', mono: true, align: 'right' },
      ], rows: ch.rules });
  }
  return { title: 'Firewall · iptables', icon: 'shield', sections };
}

// ps aux / ps -ef — processos
function parsePs(lines) {
  const L = clean(lines);
  if (!L.length) return null;
  const header = L[0];
  const aux = /\bRSS\b/.test(header) && /%CPU/i.test(header);
  const rows = [];
  for (let i = 1; i < L.length; i++) {
    const ln = L[i];
    if (aux) {
      const m = ln.match(/^(\S+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
      if (!m) continue;
      rows.push({ user: m[1], pid: m[2], cpu: num(m[3]) || 0, mem: num(m[4]) || 0, rss: parseInt(m[6], 10) * 1024, stat: m[8], cmd: m[11] });
    } else {
      const m = ln.match(/^(\S+)\s+(\d+)\s+(\d+)\s+\d+\s+\S+\s+\S+\s+\S+\s+(.*)$/);
      if (!m) continue;
      rows.push({ user: m[1], pid: m[2], cpu: 0, mem: 0, rss: 0, stat: '', cmd: m[4] });
    }
  }
  if (!rows.length) return null;
  const zombies = rows.filter((r) => /Z/.test(r.stat));
  const top = rows.slice().sort((a, b) => b.cpu - a.cpu || b.mem - a.mem);
  const sections = [];
  if (zombies.length) sections.push({ type: 'note', tone: 'warn', title: `${zombies.length} processo(s) zumbi`, text: zombies.map((z) => `${z.pid} ${z.cmd.slice(0, 30)}`).join(', ') });
  sections.push({ type: 'table',
    columns: [
      { key: 'pid', label: 'PID', mono: true, align: 'right' }, { key: 'user', label: 'Usuário', mono: true },
      ...(aux ? [{ key: 'cpu', label: '%CPU', mono: true, align: 'right', bar: true, max: 100, tone: (r) => pctTone(r.cpu) },
        { key: 'mem', label: '%MEM', mono: true, align: 'right', bar: true, max: 100 }] : []),
      { key: 'cmd', label: 'Comando', mono: true },
    ],
    rows: top.slice(0, 120).map((r) => ({ ...r, cmd: r.cmd.slice(0, 80), cpu: r.cpu, mem: r.mem })) });
  return { title: 'Processos · ps', icon: 'cpu', sections };
}

// free -m / free -h — memória
function parseFree(lines) {
  const L = clean(lines);
  const out = [];
  for (const ln of L) {
    const m = ln.match(/^(Mem|Swap|Mём|Mem\.|Mem:|Swap:)\s*:?\s+(.*)$/i);
    if (!m) continue;
    const label = m[1].replace(':', '');
    const vals = m[2].trim().split(/\s+/).map(toBytes);
    const total = vals[0], used = vals[1], free = vals[2];
    const avail = label.toLowerCase().startsWith('mem') ? (vals[6] ?? vals[5] ?? null) : null;
    if (total == null) continue;
    out.push({ label: /swap/i.test(label) ? 'Swap' : 'RAM', total, used, free, avail });
  }
  if (!out.length) return null;
  const bars = out.map((r) => {
    const usedPct = r.total ? Math.round((r.used / r.total) * 100) : 0;
    let tone = pctTone(usedPct);
    if (r.label === 'Swap' && usedPct > 0) tone = usedPct > 50 ? 'danger' : 'warn';
    return { label: r.label, sub: r.avail != null ? `disp. ${fmtBytes(r.avail)}` : `livre ${fmtBytes(r.free)}`, pct: usedPct, valueText: `${fmtBytes(r.used)}/${fmtBytes(r.total)}`, tone };
  });
  const sections = [{ type: 'bars', items: bars }];
  const swap = out.find((r) => r.label === 'Swap');
  if (swap && swap.total && swap.used / swap.total > 0.5) sections.push({ type: 'note', tone: 'danger', title: 'Pressão de swap', text: 'Uso de swap acima de 50% — possível falta de RAM ou vazamento de memória.' });
  return { title: 'Memória · free', icon: 'memory', sections };
}

// vmstat — snapshot (uma leitura) ou STREAM (sparklines ao vivo)
function parseVmstat(lines, streaming) {
  const L = clean(lines);
  const dataRowsRaw = L.filter((l) => /^\s*\d+\s+\d+\s+\d+/.test(l));
  if (streaming) {
    const series = { cpu: [], wa: [], r: [], swap: [] };
    for (const ln of dataRowsRaw) {
      const c = ln.trim().split(/\s+/).map(num);
      const us = c[12], sy = c[13], id = c[14], wa = c[15], st = c[16], rr = c[0], si = c[6], so = c[7];
      if (id == null) continue;
      series.cpu.push(Math.max(0, Math.min(100, (us || 0) + (sy || 0) + (st || 0))));
      series.wa.push(wa || 0); series.r.push(rr || 0); series.swap.push((si || 0) + (so || 0));
    }
    if (!series.cpu.length) return null;
    const items = [
      { label: 'CPU%', values: series.cpu, unit: '%', tone: pctTone(lastOf(series.cpu) || 0) },
      { label: 'I/O wait', values: series.wa, unit: '%', tone: (lastOf(series.wa) || 0) > 20 ? 'danger' : (lastOf(series.wa) || 0) > 10 ? 'warn' : 'ok' },
      { label: 'run q (r)', values: series.r, unit: '', tone: (lastOf(series.r) || 0) > 4 ? 'warn' : 'dim' },
      { label: 'swap io', values: series.swap, unit: '', tone: (lastOf(series.swap) || 0) > 0 ? 'warn' : 'dim' },
    ];
    const sections = [{ type: 'spark', items }];
    if ((lastOf(series.wa) || 0) > 20) sections.push({ type: 'note', tone: 'danger', title: 'I/O wait alto', text: `CPU esperando disco (${lastOf(series.wa)}%) — gargalo de I/O.` });
    if ((lastOf(series.cpu) || 0) >= 90) sections.push({ type: 'note', tone: 'danger', title: 'CPU saturada', text: `Uso de CPU em ${lastOf(series.cpu)}%.` });
    return { title: 'vmstat · ao vivo', icon: 'gauge', sections };
  }
  const dataRows = dataRowsRaw;
  if (!dataRows.length) return null;
  const last = dataRows[dataRows.length - 1].trim().split(/\s+/).map(num);
  // colunas clássicas: r b swpd free buff cache si so bi bo in cs us sy id wa st
  const [r, b, swpd, free, buff, cache, si, so, bi, bo, intr, cs, us, sy, id, wa, st] = last;
  const kv = [
    { k: 'run queue (r)', v: String(r ?? '—'), tone: (r || 0) > 4 ? 'warn' : 'dim' },
    { k: 'blocked (b)', v: String(b ?? '—'), tone: (b || 0) > 0 ? 'warn' : 'dim' },
    { k: 'CPU us/sy/id/wa', v: `${us}/${sy}/${id}/${wa}`, tone: (wa || 0) > 20 ? 'danger' : (id || 0) < 20 ? 'warn' : 'ok' },
    { k: 'swap in/out', v: `${si}/${so}`, tone: ((si || 0) + (so || 0)) > 0 ? 'warn' : 'dim' },
    { k: 'io bi/bo', v: `${bi}/${bo}`, tone: 'dim' },
    { k: 'free', v: fmtBytes((free || 0) * 1024), tone: 'dim' },
  ];
  const sections = [{ type: 'kv', items: kv }];
  if ((wa || 0) > 20) sections.push({ type: 'note', tone: 'danger', title: 'I/O wait alto', text: `CPU esperando disco ${wa}% — gargalo de I/O.` });
  return { title: 'vmstat', icon: 'gauge', sections };
}

// iostat -x — snapshot ou STREAM (%util por dispositivo ao vivo)
function parseIostat(lines, streaming) {
  const L = clean(lines);
  if (streaming) {
    const dev = {}; let cols = null, headerCount = 0, util = -1;
    for (const ln of L) {
      if (/^Device/i.test(ln)) { cols = ln.trim().split(/\s+/); util = cols.findIndex((c) => /%util/i.test(c)); headerCount++; continue; }
      if (!cols || headerCount < 2) continue; // pula o 1º bloco (médias desde o boot)
      const p = ln.trim().split(/\s+/);
      if (p.length < 3 || /^(avg-cpu|Linux)/i.test(p[0]) || !/^[a-z]/i.test(p[0])) continue;
      (dev[p[0]] || (dev[p[0]] = { util: [] }));
      if (util >= 0 && p[util] != null) dev[p[0]].util.push(num(p[util]) || 0);
    }
    const names = Object.keys(dev).filter((n) => dev[n].util.length).sort((a, b) => (lastOf(dev[b].util) || 0) - (lastOf(dev[a].util) || 0)).slice(0, 6);
    if (!names.length) return null;
    const items = names.map((n) => ({ label: n, values: dev[n].util, unit: '%', tone: pctTone(lastOf(dev[n].util) || 0) }));
    const sections = [{ type: 'spark', items }];
    const busy = names.filter((n) => (lastOf(dev[n].util) || 0) >= 90);
    if (busy.length) sections.push({ type: 'note', tone: 'danger', title: 'Disco saturado', text: `${busy.join(', ')} ~100% de utilização.` });
    return { title: 'iostat · %util ao vivo', icon: 'gauge', sections };
  }
  const headerIdx = L.findIndex((l) => /^Device/i.test(l));
  if (headerIdx < 0) return null;
  const cols = L[headerIdx].trim().split(/\s+/);
  const utilIdx = cols.findIndex((c) => /%util/i.test(c));
  const rIdx = cols.findIndex((c) => /^r\/s/i.test(c));
  const wIdx = cols.findIndex((c) => /^w\/s/i.test(c));
  const awaitIdx = cols.findIndex((c) => /await/i.test(c));
  const rows = [];
  for (let i = headerIdx + 1; i < L.length; i++) {
    const parts = L[i].trim().split(/\s+/);
    if (parts.length < 3 || /^(avg-cpu|Linux|Device)/i.test(parts[0])) continue;
    const util = utilIdx >= 0 ? num(parts[utilIdx]) : null;
    rows.push({ dev: parts[0], rps: rIdx >= 0 ? parts[rIdx] : '', wps: wIdx >= 0 ? parts[wIdx] : '', await: awaitIdx >= 0 ? parts[awaitIdx] : '', util: util ?? 0 });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.util - a.util);
  return {
    title: 'I/O de disco · iostat', icon: 'gauge',
    sections: [{ type: 'table',
      columns: [
        { key: 'dev', label: 'Dispositivo', mono: true }, { key: 'rps', label: 'r/s', mono: true, align: 'right' },
        { key: 'wps', label: 'w/s', mono: true, align: 'right' }, { key: 'await', label: 'await(ms)', mono: true, align: 'right' },
        { key: 'util', label: '%util', mono: true, align: 'right', bar: true, max: 100, tone: (r) => pctTone(r.util) },
      ], rows }],
  };
}

// mpstat — snapshot ou STREAM (busy% por CPU ao vivo)
function parseMpstat(lines, streaming) {
  const L = clean(lines);
  if (streaming) {
    const cpus = {}; let cpuIdx = -1, idleIdx = -1;
    for (const ln of L) {
      if (/%idle/i.test(ln) && /CPU/i.test(ln)) { const c = ln.trim().split(/\s+/); cpuIdx = c.findIndex((x) => /CPU/i.test(x)); idleIdx = c.findIndex((x) => /%idle/i.test(x)); continue; }
      if (cpuIdx < 0) continue;
      const p = ln.trim().split(/\s+/);
      if (p.length <= idleIdx) continue;
      const cpu = p[cpuIdx]; const idle = num(p[idleIdx]);
      if (idle == null || !/^(\d+|all)$/i.test(cpu)) continue;
      (cpus[cpu] || (cpus[cpu] = [])).push(Math.max(0, Math.min(100, 100 - idle)));
    }
    const names = Object.keys(cpus).filter((n) => cpus[n].length).sort((a, b) => (a === 'all' ? -1 : b === 'all' ? 1 : Number(a) - Number(b)));
    if (!names.length) return null;
    const items = names.slice(0, 10).map((n) => ({ label: `CPU ${n}`, values: cpus[n], unit: '%', tone: pctTone(lastOf(cpus[n]) || 0) }));
    return { title: 'mpstat · ao vivo', icon: 'cpu', sections: [{ type: 'spark', items }] };
  }
  const hi = L.findIndex((l) => /%idle/i.test(l) && /CPU/i.test(l));
  if (hi < 0) return null;
  const cols = L[hi].trim().split(/\s+/);
  const cpuIdx = cols.findIndex((c) => /CPU/i.test(c));
  const idleIdx = cols.findIndex((c) => /%idle/i.test(c));
  const usrIdx = cols.findIndex((c) => /%usr/i.test(c));
  const items = [];
  for (let i = hi + 1; i < L.length; i++) {
    const p = L[i].trim().split(/\s+/);
    if (p.length <= idleIdx) continue;
    const cpu = p[cpuIdx]; const idle = num(p[idleIdx]);
    if (idle == null) continue;
    const busy = Math.round(100 - idle);
    items.push({ label: `CPU ${cpu}`, sub: `usr ${usrIdx >= 0 ? p[usrIdx] : '?'}`, pct: busy, valueText: `${busy}%`, tone: pctTone(busy) });
  }
  if (!items.length) return null;
  return { title: 'CPU · mpstat', icon: 'cpu', sections: [{ type: 'bars', items }] };
}

// du -h / du -sh — uso por diretório
function parseDu(lines) {
  const L = clean(lines);
  const rows = [];
  for (const ln of L) {
    const m = ln.match(/^([\d.,]+[KMGTP]?)\s+(.+)$/i);
    if (!m) continue;
    const b = toBytes(m[1]);
    if (b == null) continue;
    rows.push({ path: m[2].trim(), bytes: b, size: m[1] });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.bytes - a.bytes);
  const top = rows.slice(0, 40);
  const max = Math.max(1, ...top.map((r) => r.bytes));
  return {
    title: 'Uso de disco · du', icon: 'folder',
    sections: [{ type: 'bars', items: top.map((r) => ({ label: r.path.replace(/^.*\//, '') || r.path, sub: r.path, pct: Math.round((r.bytes / max) * 100), valueText: fmtBytes(r.bytes), tone: 'accent' })) }],
  };
}

// smartctl -a / -H — saúde de disco
function parseSmartctl(lines) {
  const L = clean(lines);
  const kv = [];
  let health = null; let model = null;
  for (const ln of L) {
    let m = ln.match(/SMART overall-health self-assessment test result:\s*(\w+)/i) || ln.match(/SMART Health Status:\s*(\w+)/i);
    if (m) health = m[1];
    m = ln.match(/Device Model:\s*(.+)/i) || ln.match(/Model Number:\s*(.+)/i);
    if (m) model = m[1].trim();
    m = ln.match(/Temperature_Celsius.*?\s(\d+)(?:\s|$)/i) || ln.match(/Temperature:\s*(\d+)/i);
    if (m) kv.push({ k: 'Temperatura', v: `${m[1]} °C`, tone: num(m[1]) > 55 ? 'danger' : num(m[1]) > 45 ? 'warn' : 'ok' });
    m = ln.match(/Reallocated_Sector_Ct.*?(\d+)$/i);
    if (m) kv.push({ k: 'Setores realocados', v: m[1], tone: num(m[1]) > 0 ? 'danger' : 'ok' });
    m = ln.match(/Current_Pending_Sector.*?(\d+)$/i);
    if (m) kv.push({ k: 'Setores pendentes', v: m[1], tone: num(m[1]) > 0 ? 'danger' : 'ok' });
    m = ln.match(/Power_On_Hours.*?(\d+)$/i);
    if (m) kv.push({ k: 'Horas ligado', v: m[1], tone: 'dim' });
    m = ln.match(/Power_Cycle_Count.*?(\d+)$/i);
    if (m) kv.push({ k: 'Ciclos de energia', v: m[1], tone: 'dim' });
    m = ln.match(/Media_Wearout_Indicator.*?(\d+)$/i) || ln.match(/Percentage Used:\s*(\d+)/i);
    if (m) kv.push({ k: 'Desgaste', v: `${m[1]}${/Percentage/.test(ln) ? '%' : ''}`, tone: 'dim' });
  }
  if (!health && !kv.length) return null;
  const sections = [];
  if (health) sections.push({ type: 'note', tone: /PASS|OK/i.test(health) ? 'ok' : 'danger', title: `Saúde: ${health}`, text: model || 'SMART self-assessment' });
  if (kv.length) sections.push({ type: 'kv', items: kv });
  return { title: 'SMART · smartctl', icon: 'hardDrive', sections };
}

// Extrai (time, unit, msg) de uma linha syslog/journal (vários formatos).
function splitLogLine(ln) {
  // ISO: 2026-06-30T13:05:39.895687-03:00 host prog[pid]: msg
  // BSD: Jun 30 12:00:00 host prog[pid]: msg
  let m = ln.match(/^(\d{4}-\d\d-\d\dT[\d:.]+\S*|\w{3}\s+\d+\s+[\d:]+)\s+(\S+)\s+([^\s:[]+)(?:\[\d+\])?:\s*(.*)$/);
  if (m) {
    let unit = m[3]; let msg = m[4];
    // serviço systemd citado no início da msg (ex.: "foo.service: Main process exited")
    const svc = (msg.match(/^(\S+\.(?:service|socket|timer|mount|scope|target|slice)):/) || [])[1];
    if (svc) unit = svc;
    return { time: m[1], unit, msg };
  }
  // continuação/linha solta (ex.: "uvicorn: No such file or directory")
  return { time: '', unit: '', msg: ln };
}

function parseLogStream(lines, title, icon, streaming) {
  const L = clean(lines);
  const rows = [];
  const counts = { fatal: 0, error: 0, warn: 0, notice: 0, info: 0 };
  const unitCount = {};
  let id = 0;
  for (const ln of L) {
    const { time, unit, msg } = splitLogLine(ln);
    const sev = classifyLog(msg);
    counts[sev]++;
    if (unit) unitCount[unit] = (unitCount[unit] || 0) + 1;
    rows.push({ _id: id++, time, unit: unit || '—', sev: SEV_LABEL[sev], msg: msg.slice(0, 150), _sev: sev, _tone: SEV_TONE[sev] });
  }
  if (!rows.length) return null;
  return logResult(title, icon, counts, rows, unitCount, { streaming });
}

function parseJournal(lines, streaming) { return parseLogStream(lines, streaming ? 'journalctl · ao vivo' : 'journalctl', 'scroll', streaming); }

// dmesg — kernel ring buffer (severidade + destaca eventos críticos)
function parseDmesg(lines, streaming) {
  const L = clean(lines);
  const rows = [];
  const counts = { fatal: 0, error: 0, warn: 0, notice: 0, info: 0 };
  const flags = { oom: 0, io: 0, segfault: 0 };
  let id = 0;
  for (const ln of L) {
    const tm = (ln.match(/^\[?\s*([\d.]+)\]?/) || [])[1] || '';
    const msg = ln.replace(/^\[?\s*[\d.]+\]?\s*/, '');
    let sev;
    if (/out of memory|oom-killer|killed process/i.test(msg)) { sev = 'fatal'; flags.oom++; }
    else if (/segfault|general protection|kernel panic|BUG:|Call Trace/i.test(msg)) { sev = 'fatal'; flags.segfault++; }
    else if (/I\/O error|ata\d.*error|medium error|EXT4-fs error|filesystem.*read-only|task .* blocked/i.test(msg)) { sev = 'error'; flags.io++; }
    else sev = classifyLog(msg);
    counts[sev]++;
    rows.push({ _id: id++, time: tm, unit: '—', sev: SEV_LABEL[sev], msg: msg.slice(0, 150), _sev: sev, _tone: SEV_TONE[sev] });
  }
  if (!rows.length) return null;
  const res = logResult(streaming ? 'dmesg · ao vivo' : 'dmesg · kernel', 'cpu', counts, rows, {}, { streaming });
  const alerts = [];
  if (flags.oom) alerts.push({ text: 'OOM killer', count: flags.oom, tone: 'danger' });
  if (flags.io) alerts.push({ text: 'erros de I/O', count: flags.io, tone: 'danger' });
  if (flags.segfault) alerts.push({ text: 'segfault/panic', count: flags.segfault, tone: 'danger' });
  if (alerts.length) res.sections.splice(1, 0, { type: 'badges', label: 'Alertas críticos de hardware/kernel', items: alerts });
  return res;
}

// web access log (combined/common) — top IPs, status, URLs
const ACCESS_RE = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)[^"]*"\s+(\d{3})\s+(\d+|-)/;
function parseWebAccess(lines) {
  const L = clean(lines);
  const rows = [];
  const ipCount = {}; const status = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  const urlCount = {};
  for (const ln of L) {
    const m = ln.match(ACCESS_RE);
    if (!m) continue;
    const [, ip, , method, url, code] = m;
    ipCount[ip] = (ipCount[ip] || 0) + 1;
    const cls = `${code[0]}xx`; if (status[cls] != null) status[cls]++;
    const key = `${method} ${url.split('?')[0]}`;
    urlCount[key] = (urlCount[key] || 0) + 1;
    rows.push({ ip, code, url: `${method} ${url}`.slice(0, 70), _tone: code[0] === '5' ? 'danger' : code[0] === '4' ? 'warn' : 'dim' });
  }
  if (!rows.length) return null;
  const topIp = Object.entries(ipCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topUrl = Object.entries(urlCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return {
    title: 'Acesso web', icon: 'globe',
    sections: [
      { type: 'badges', label: 'Status', items: [
        { text: '2xx', count: status['2xx'], tone: 'ok' }, { text: '3xx', count: status['3xx'], tone: 'info' },
        { text: '4xx', count: status['4xx'], tone: 'warn' }, { text: '5xx', count: status['5xx'], tone: 'danger' },
      ] },
      { type: 'bars', items: topIp.map(([ip, c]) => ({ label: ip, sub: 'requisições', pct: Math.round((c / topIp[0][1]) * 100), valueText: String(c), tone: 'accent' })) },
      { type: 'table', columns: [{ key: 'url', label: 'Top URLs', mono: true }, { key: 'count', label: 'hits', mono: true, align: 'right' }],
        rows: topUrl.map(([url, count]) => ({ url, count })) },
    ],
  };
}

// web error log (nginx/apache) — usa severidade + nível do próprio log
const WEB_LVL_SEV = { emerg: 'fatal', alert: 'fatal', crit: 'fatal', error: 'error', err: 'error', warn: 'warn', notice: 'notice', info: 'info', debug: 'info' };
function parseWebError(lines, streaming) {
  const L = clean(lines);
  const rows = [];
  const counts = { fatal: 0, error: 0, warn: 0, notice: 0, info: 0 };
  const unitCount = {};
  let id = 0;
  for (const ln of L) {
    const m = ln.match(/\[(error|warn|crit|alert|emerg|notice|debug|info)\]/i) || ln.match(/\]\s*\[(\w+)\]/);
    const lvl = m ? m[1].toLowerCase() : null;
    const sev = lvl ? (WEB_LVL_SEV[lvl] || classifyLog(ln)) : classifyLog(ln);
    counts[sev]++;
    const client = (ln.match(/client:?\s*([0-9a-f:.]+)/i) || [])[1];
    if (client) unitCount[client] = (unitCount[client] || 0) + 1;
    rows.push({ _id: id++, time: '', unit: client || '—', sev: SEV_LABEL[sev], msg: ln.slice(0, 150), _sev: sev, _tone: SEV_TONE[sev] });
  }
  if (!rows.length) return null;
  return logResult(streaming ? 'Erros web · ao vivo' : 'Erros web', 'alert', counts, rows, unitCount, { streaming });
}

// auth.log / secure — SSH brute force, sudo
function parseAuthLog(lines) {
  const L = clean(lines);
  const failByIp = {}; const acceptByUser = {}; const sudo = [];
  let invalid = 0;
  for (const ln of L) {
    let m = ln.match(/Failed password for (?:invalid user )?(\S+) from (\S+)/i);
    if (m) { failByIp[m[2]] = (failByIp[m[2]] || 0) + 1; if (/invalid user/i.test(ln)) invalid++; continue; }
    m = ln.match(/Invalid user (\S+) from (\S+)/i);
    if (m) { failByIp[m[2]] = (failByIp[m[2]] || 0) + 1; invalid++; continue; }
    m = ln.match(/Accepted (?:password|publickey) for (\S+) from (\S+)/i);
    if (m) { acceptByUser[`${m[1]}@${m[2]}`] = (acceptByUser[`${m[1]}@${m[2]}`] || 0) + 1; continue; }
    m = ln.match(/sudo:\s+(\S+).*COMMAND=(.+)$/);
    if (m) sudo.push({ user: m[1], cmd: m[2].slice(0, 60) });
  }
  const topFail = Object.entries(failByIp).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!topFail.length && !Object.keys(acceptByUser).length && !sudo.length) return null;
  const sections = [];
  if (topFail.length) {
    const max = topFail[0][1];
    sections.push({ type: 'note', tone: max >= 10 ? 'danger' : 'warn', title: 'Tentativas de login falhas', text: `${topFail.reduce((a, b) => a + b[1], 0)} falhas · ${invalid} usuários inválidos${max >= 10 ? ' · possível força bruta' : ''}` });
    sections.push({ type: 'bars', items: topFail.map(([ip, c]) => ({ label: ip, sub: 'falhas', pct: Math.round((c / max) * 100), valueText: String(c), tone: c >= 10 ? 'danger' : 'warn' })) });
  }
  if (Object.keys(acceptByUser).length) sections.push({ type: 'badges', label: 'Logins aceitos', items: Object.entries(acceptByUser).slice(0, 8).map(([text, count]) => ({ text, count, tone: 'ok' })) });
  if (sudo.length) sections.push({ type: 'table', columns: [{ key: 'user', label: 'sudo', mono: true }, { key: 'cmd', label: 'Comando', mono: true }], rows: sudo.slice(-30) });
  return { title: 'Autenticação', icon: 'shield', sections };
}

// syslog / messages — usa o mesmo motor de severidade
function parseSyslog(lines, streaming) { return parseLogStream(lines, streaming ? 'syslog · ao vivo' : 'syslog', 'scroll', streaming); }

// systemctl (list-units / status) — serviços
function parseSystemctl(lines) {
  const L = clean(lines);
  const rows = [];
  for (const ln of L) {
    const m = ln.match(/^\s*●?\s*(\S+\.(?:service|socket|timer|mount|target))\s+(loaded|not-found|masked)\s+(\w+)\s+(\w+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ unit: m[1], active: m[3], sub: m[4], desc: m[5].slice(0, 50), _tone: m[3] === 'active' ? 'ok' : m[3] === 'failed' ? 'danger' : 'dim' });
  }
  if (!rows.length) return null;
  const failed = rows.filter((r) => r.active === 'failed');
  const sections = [];
  if (failed.length) sections.push({ type: 'note', tone: 'danger', title: `${failed.length} unidade(s) falha(s)`, text: failed.map((f) => f.unit).join(', ') });
  sections.push({ type: 'table', columns: [
    { key: 'unit', label: 'Unidade', mono: true }, { key: 'active', label: 'Active', mono: true, tone: (r) => r._tone },
    { key: 'sub', label: 'Sub', mono: true }, { key: 'desc', label: 'Descrição', mono: true },
  ], rows });
  return { title: 'Serviços · systemctl', icon: 'settings', sections };
}

// systemd-analyze blame — tempo de boot por unidade
function parseAnalyze(lines) {
  const L = clean(lines);
  const rows = [];
  for (const ln of L) {
    const m = ln.match(/^\s*((?:\d+min\s*)?[\d.]+m?s)\s+(\S+)/);
    if (!m) continue;
    let ms = 0;
    const t = m[1];
    const min = (t.match(/(\d+)min/) || [])[1]; if (min) ms += parseInt(min, 10) * 60000;
    const sec = (t.match(/([\d.]+)s(?!\w)/) || [])[1]; if (sec && !/ms/.test(t.replace(/[\d.]+s/, ''))) ms += parseFloat(sec) * 1000;
    const msv = (t.match(/([\d.]+)ms/) || [])[1]; if (msv) ms += parseFloat(msv);
    rows.push({ unit: m[2], time: t, ms });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.ms - a.ms);
  const top = rows.slice(0, 25);
  const max = Math.max(1, ...top.map((r) => r.ms));
  return { title: 'Boot · systemd-analyze', icon: 'gauge', sections: [{ type: 'bars', items: top.map((r) => ({ label: r.unit, sub: 'init', pct: Math.round((r.ms / max) * 100), valueText: r.time, tone: r.ms > 5000 ? 'danger' : r.ms > 1000 ? 'warn' : 'accent' })) }] };
}

// lsof — arquivos/portas abertas por processo
function parseLsof(lines) {
  const L = clean(lines);
  if (!L.length) return null;
  const rows = [];
  for (let i = 1; i < L.length; i++) {
    const p = L[i].trim().split(/\s+/);
    if (p.length < 8) continue;
    const name = p.slice(8).join(' ');
    rows.push({ cmd: p[0], pid: p[1], user: p[2], type: p[4], name: name.slice(0, 60) });
  }
  if (!rows.length) return null;
  return { title: 'Arquivos abertos · lsof', icon: 'folder', sections: [{ type: 'table', columns: [
    { key: 'cmd', label: 'Comando', mono: true }, { key: 'pid', label: 'PID', mono: true, align: 'right' },
    { key: 'user', label: 'Usuário', mono: true }, { key: 'type', label: 'Tipo', mono: true }, { key: 'name', label: 'Recurso', mono: true },
  ], rows: rows.slice(0, 150) }] };
}

// uptime / w — carga
function parseUptime(lines) {
  const L = clean(lines);
  const head = L.find((l) => /load average/i.test(l));
  if (!head) return null;
  const m = head.match(/load average[s]?:\s*([\d.]+),?\s+([\d.]+),?\s+([\d.]+)/i);
  const up = (head.match(/up\s+(.*?),\s+\d+\s+user/i) || [])[1];
  const users = L.slice(1).filter((l) => /^\S+\s+(pts|tty)/.test(l)).map((l) => l.split(/\s+/)[0]);
  const sections = [];
  if (m) sections.push({ type: 'kv', items: [
    { k: 'Uptime', v: up || '—', tone: 'dim' },
    { k: 'Carga 1min', v: m[1], tone: 'accent' }, { k: 'Carga 5min', v: m[2], tone: 'dim' }, { k: 'Carga 15min', v: m[3], tone: 'dim' },
  ] });
  if (users.length) sections.push({ type: 'badges', label: 'Usuários conectados', items: [...new Set(users)].map((u) => ({ text: u, tone: 'ok' })) });
  if (!sections.length) return null;
  return { title: 'Carga · uptime', icon: 'gauge', sections };
}

// last — histórico de logins
function parseLast(lines) {
  const L = clean(lines);
  const rows = [];
  for (const ln of L) {
    if (/^(wtmp|reboot|$)/.test(ln) || /^\s*$/.test(ln)) continue;
    const m = ln.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    rows.push({ user: m[1], tty: m[2], from: m[3], when: m[4].slice(0, 40) });
  }
  if (!rows.length) return null;
  return { title: 'Logins · last', icon: 'scroll', sections: [{ type: 'table', columns: [
    { key: 'user', label: 'Usuário', mono: true }, { key: 'tty', label: 'TTY', mono: true }, { key: 'from', label: 'Origem', mono: true }, { key: 'when', label: 'Quando', mono: true },
  ], rows: rows.slice(0, 60) }] };
}

// Health check — agrega a saída de uma bateria de comandos somente-leitura
// (emitida pelo botão "Saúde", delimitada por marcadores ##X##).
function parseHealth(lines) {
  const L = clean(lines);
  const buckets = {}; let cur = null;
  for (const ln of L) {
    const m = ln.match(/^##(\w+)##$/);
    if (m) { cur = m[1]; buckets[cur] = []; continue; }
    if (/###TNGHC/.test(ln)) continue;
    if (cur) buckets[cur].push(ln);
  }
  if (!Object.keys(buckets).length) return null;
  const sections = []; const problems = [];

  const cores = num((buckets.CORES || [])[0]) || null;
  const up = (buckets.UP || []).join(' ');
  const la = up.match(/load average[s]?:\s*([\d.]+),?\s+([\d.]+),?\s+([\d.]+)/i);
  const uptime = (up.match(/up\s+(.*?),\s+\d+\s+user/i) || [])[1];
  const load1 = la ? num(la[1]) : null;
  if (la) {
    const loadTone = (cores && load1 != null) ? (load1 > cores * 1.5 ? 'danger' : load1 > cores ? 'warn' : 'ok') : 'dim';
    sections.push({ type: 'kv', items: [
      { k: 'Uptime', v: uptime || '—', tone: 'dim' },
      { k: 'Carga 1/5/15', v: `${la[1]} / ${la[2]} / ${la[3]}${cores ? `  (${cores} cores)` : ''}`, tone: loadTone },
    ] });
    if (cores && load1 > cores * 1.5) problems.push('carga alta');
  }

  const memBars = [];
  for (const ln of (buckets.MEM || [])) {
    const m = ln.match(/^(Mem|Swap):\s+(.*)$/i);
    if (!m) continue;
    const v = m[2].trim().split(/\s+/).map((x) => num(x));
    const total = v[0], used = v[1];
    if (!total) continue;
    const pct = Math.round((used / total) * 100);
    const isSwap = /swap/i.test(m[1]);
    let tone = pctTone(pct); if (isSwap) tone = pct > 50 ? 'danger' : pct > 0 ? 'warn' : 'dim';
    memBars.push({ label: isSwap ? 'Swap' : 'RAM', sub: `${fmtBytes(used * 1048576)}/${fmtBytes(total * 1048576)}`, pct, valueText: `${pct}%`, tone });
    if (!isSwap && pct >= 90) problems.push('RAM cheia');
    if (isSwap && pct > 50) problems.push('swap em uso');
  }
  if (memBars.length) sections.push({ type: 'bars', items: memBars });

  const diskBars = [];
  for (const ln of (buckets.DISK || [])) {
    if (/^Filesystem/i.test(ln)) continue;
    const m = ln.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)%\s+(\S+)$/);
    if (!m) continue;
    const pct = parseInt(m[5], 10);
    diskBars.push({ label: m[6], sub: `${m[3]}/${m[2]}`, pct, valueText: `${pct}%`, tone: pctTone(pct) });
    if (pct >= 90) problems.push(`disco ${m[6]} cheio`);
  }
  if (diskBars.length) { diskBars.sort((a, b) => b.pct - a.pct); sections.push({ type: 'bars', items: diskBars.slice(0, 10) }); }

  const failed = (buckets.FAIL || []).map((l) => (l.trim().split(/\s+/)[0])).filter((u) => /\.\w+$/.test(u));
  if (failed.length) { problems.push(`${failed.length} serviço(s) falho(s)`); sections.push({ type: 'badges', label: 'Unidades com falha', items: failed.slice(0, 10).map((u) => ({ text: u, tone: 'danger' })) }); }

  const topRows = [];
  for (const ln of (buckets.TOP || [])) {
    const p = ln.trim().split(/\s+/);
    if (p.length < 3 || num(p[0]) == null) continue;
    topRows.push({ cpu: num(p[0]), mem: num(p[1]), comm: p.slice(2).join(' ') });
  }
  if (topRows.length) sections.push({ type: 'table', columns: [
    { key: 'comm', label: 'Processo', mono: true }, { key: 'cpu', label: '%CPU', mono: true, align: 'right', bar: true, tone: (r) => pctTone(r.cpu) }, { key: 'mem', label: '%MEM', mono: true, align: 'right' },
  ], rows: topRows });

  const ports = num((buckets.PORTS || [])[0]);
  if (ports != null) sections.push({ type: 'kv', items: [{ k: 'Portas ouvindo (TCP/UDP)', v: String(ports), tone: 'accent' }] });

  const crit = problems.length > 0 && /cheio|falho|carga alta/.test(problems.join(' '));
  const status = problems.length === 0 ? { tone: 'ok', title: '✓ Sistema saudável', text: 'Nenhum problema detectado nos checks rápidos.' }
    : { tone: crit ? 'danger' : 'warn', title: crit ? '⚠ Atenção: problemas detectados' : '⚠ Verificar', text: problems.join(' · ') };
  sections.unshift({ type: 'note', ...status });
  return { title: 'Health check', icon: 'gauge', sections };
}

// Comando (somente-leitura) emitido pelo botão "Saúde". Marcadores ##X## são
// parseados por parseHealth. Tudo entre chaves p/ uma única linha de prompt.
export const HEALTH_COMMAND = "{ echo '###TNGHC###'; echo '##UP##'; uptime; echo '##CORES##'; nproc 2>/dev/null; echo '##MEM##'; free -m; echo '##DISK##'; df -hP -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null; echo '##FAIL##'; systemctl --failed --no-legend --plain 2>/dev/null; echo '##TOP##'; ps -eo pcpu,pmem,comm --sort=-pcpu 2>/dev/null | sed 1d | head -5; echo '##PORTS##'; ss -tulnH 2>/dev/null | wc -l; echo '###TNGHCEND###'; }";

// ls / ls -l / -la / -lah — listagem com links de edição p/ arquivos de texto.
function posixJoin(dir, name) {
  const d = String(dir || '').replace(/\/+$/, '');
  if (!d) return name;
  if (String(name).startsWith('/')) return name;
  return `${d}/${name}`;
}
export const LS_EDIT_RE = /\.(conf|cfg|txt|tom|toml|ya?ml|ini|env|json|properties|list|rules)$/i;
export function lsBaseDir(cmd, cwd) {
  const after = String(cmd || '').replace(/^.*?\bls\b/, '').trim();
  const args = after.split(/\s+/).filter((a) => a && !a.startsWith('-'));
  const pathArg = args.find((a) => !/[*?[\]]/.test(a));
  if (pathArg) {
    const p = pathArg.replace(/\/+$/, '') || '/';
    if (p.startsWith('/') || p.startsWith('~')) return p;
    return posixJoin(cwd || '', p);
  }
  return cwd || '';
}
function parseLs(lines, _streaming, opts = {}) {
  const L = clean(lines);
  if (!L.length) return null;
  const baseDir = lsBaseDir(opts.cmd, opts.cwd);
  const title = baseDir ? `ls · ${baseDir}` : 'ls';
  const rows = []; let isLong = false;
  for (const ln of L) {
    if (/^total\s+\d+/i.test(ln)) continue;
    const parts = ln.split(/\s+/);
    if (parts.length >= 9 && /^[bcdlps-][rwxsStT-]{9}[.+@]?$/.test(parts[0])) {
      isLong = true;
      const perms = parts[0]; const owner = parts[2]; const group = parts[3]; const size = parts[4];
      const date = parts.slice(5, 8).join(' ');
      const name = parts.slice(8).join(' ').replace(/ ->.*$/, '').replace(/[*/=@|]$/, '');
      if (name === '.' || name === '..') continue;
      const isDir = perms[0] === 'd'; const isLink = perms[0] === 'l';
      const editable = !isDir && LS_EDIT_RE.test(name);
      rows.push({ perms, owner, group, date, name, isDir, isLink, editable, sizeText: isDir ? '—' : fmtBytes(toBytes(size)), openPath: editable ? posixJoin(baseDir, name) : '' });
    }
  }
  if (isLong && rows.length) {
    return { title, icon: 'folder', sections: [{ type: 'table', columns: [
      { key: 'perms', label: 'Permissões', mono: true, tone: (r) => (r.isDir ? 'accent' : r.editable ? 'ok' : 'dim') },
      { key: 'owner', label: 'Dono', mono: true }, { key: 'sizeText', label: 'Tam.', mono: true, align: 'right' },
      { key: 'date', label: 'Data', mono: true },
      { key: 'name', label: 'Nome', mono: true, link: 'openPath', linkTitle: 'Editar arquivo', tone: (r) => (r.isDir ? 'accent' : r.editable ? 'ok' : 'dim') },
    ], rows }] };
  }
  const names = L.join(' ').split(/\s+/).filter((n) => n && n !== 'total');
  if (!names.length) return null;
  const seen = new Set(); const items = [];
  for (const raw of names) {
    const name = raw.replace(/[*/=@|]$/, '');
    if (name === '.' || name === '..' || seen.has(name)) continue;
    seen.add(name);
    const editable = LS_EDIT_RE.test(name);
    items.push({ text: name, tone: editable ? 'ok' : 'dim', openPath: editable ? posixJoin(baseDir, name) : '' });
  }
  return { title, icon: 'folder', sections: [{ type: 'filelist', items }] };
}

// GNU Screen — sessões existentes e ações interativas no overlay.
// Formatos observados:
//   1234.nome  (Detached)
//   1234.nome  (08/13/2026 10:30:00 AM)  (Attached)
//   No Sockets found in /run/screen/S-user.
function parseScreen(lines) {
  const L = clean(lines);
  if (!L.length) return null;
  const looksLikeListing = L.some((ln) => /(?:There (?:is a screen|are screens)|Sockets? (?:in|found)|No Sockets found)/i.test(ln)
    || /^\s*\d+\.\S+.*\((?:Attached|Detached|Multi|Dead|Remote|Removed)/i.test(ln));
  if (!looksLikeListing) return null;
  // Comandos de ação podem terminar em `; screen -ls`. Nesse caso, usa
  // apenas a listagem final para não preservar dados anteriores à ação.
  const markerIndexes = L.map((ln, index) => /^(?:There (?:is a screen|are screens)|No Sockets found)/i.test(ln.trim()) ? index : -1)
    .filter((index) => index >= 0);
  const scanLines = markerIndexes.length ? L.slice(markerIndexes[markerIndexes.length - 1]) : L;

  const sessions = [];
  let socketDir = '';
  let reportedCount = null;
  for (const raw of scanLines) {
    const ln = raw.trim();
    let m = ln.match(/^(\d+)\.([^\s(]+)(.*)$/);
    if (m) {
      const groups = [...m[3].matchAll(/\(([^)]+)\)/g)].map((x) => x[1].trim());
      const statusRaw = groups.find((x) => /^(?:Attached|Detached|Multi|Dead|Remote|Removed)/i.test(x)) || '';
      if (!statusRaw) continue;
      const lower = statusRaw.toLowerCase();
      const status = /dead|removed/.test(lower) ? 'dead'
        : /detached/.test(lower) ? 'detached'
          : /multi/.test(lower) ? 'multi'
            : /attached/.test(lower) ? 'attached' : 'remote';
      const date = groups.find((x) => x !== statusRaw) || '';
      sessions.push({
        id: `${m[1]}.${m[2]}`,
        pid: m[1],
        name: m[2],
        status,
        statusLabel: statusRaw,
        date,
      });
      continue;
    }
    m = ln.match(/^(\d+)\s+Sockets?\s+in\s+(.+?)\.?$/i);
    if (m) { reportedCount = Number(m[1]); socketDir = m[2].replace(/\.$/, ''); continue; }
    m = ln.match(/^No Sockets found in\s+(.+?)\.?$/i);
    if (m) { reportedCount = 0; socketDir = m[1].replace(/\.$/, ''); }
  }

  const order = { detached: 0, attached: 1, multi: 2, remote: 3, dead: 4 };
  sessions.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name));
  return {
    title: 'Sessões · GNU Screen', icon: 'screen',
    sections: [{
      type: 'screenSessions', sessions, socketDir,
      reportedCount: reportedCount == null ? sessions.length : reportedCount,
    }],
  };
}

// tcpdump — captura de pacotes (streaming até Ctrl-C)
function parseTcpdump(lines, streaming) {
  const L = clean(lines);
  const proto = {}; const srcCount = {}; const conv = {}; const portCount = {}; const ifCount = {};
  let syn = 0, synack = 0, rst = 0, fin = 0, bytes = 0;
  let iface = null, captured = null, dropped = null;
  const rows = [];
  const bump = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };
  // host.porta → [host, porta]; ICMP/ARP vêm sem porta
  const splitHP = (s, noPort) => {
    if (noPort) return [s, null];
    const m = String(s).match(/^(.+)\.([^.\s]+)$/);
    return m ? [m[1], m[2]] : [s, null];
  };
  for (const ln of L) {
    if (/^tcpdump:/.test(ln)) continue;
    let m = ln.match(/^listening on (\S+)/);
    if (m) { iface = m[1].replace(/,$/, ''); continue; }
    m = ln.match(/^(\d+) packets? captured/); if (m) { captured = +m[1]; continue; }
    m = ln.match(/^(\d+) packets? dropped by kernel/); if (m) { dropped = +m[1]; continue; }
    if (/packets? received by filter/.test(ln)) continue;
    m = ln.match(/^(\d{2}:\d{2}:\d{2})(?:\.\d+)?\s+(.*)$/);
    if (!m) continue; // continuação (hex/verbose) — ignora
    const time = m[1]; let rest = m[2];
    // -i any (LINUX_SLL2): "eth0  In|Out|B|M|P  IP ..." — remove iface+direção
    const sll = rest.match(/^([\w.@-]+)\s+(In|Out|B|M|P)\s+(.*)$/);
    if (sll && /^(IP6?|ARP)\b/.test(sll[3])) { bump(ifCount, sll[1]); rest = sll[3]; }
    let p = 'outro', src = '', dst = '', info = '', tone = 'dim', hs = '', hd = '';
    if (/^ARP\b/i.test(rest)) {
      p = 'ARP'; info = rest.replace(/^ARP,?\s*/i, '');
      const w = info.match(/who-has (\S+) tell (\S+?),?\s/);
      if (w) { dst = w[1]; src = w[2]; }
      const r2 = info.match(/^Reply (\S+) is-at/i);
      if (r2) src = r2[1];
    } else {
      const ip = rest.match(/^(IP6?)\s+(\S+?)\s+>\s+(\S+):\s*(.*)$/);
      if (!ip) continue;
      const payload = ip[4];
      const icmp = /^ICMP/i.test(payload) || /\bICMP6?\b/.test(payload);
      let sp, dp;
      [src, sp] = splitHP(ip[2], icmp); [dst, dp] = splitHP(ip[3], icmp);
      const fl = payload.match(/Flags \[([^\]]+)\]/);
      const len = payload.match(/length (\d+)/); if (len) bytes += +len[1];
      if (icmp) { p = 'ICMP'; tone = 'info'; }
      else if (dp === '53' || dp === 'domain' || sp === '53' || sp === 'domain') { p = 'DNS'; tone = 'accent'; }
      else if (fl) { p = 'TCP'; tone = 'ok'; }
      else if (/\bUDP\b/i.test(payload) || (dp && !fl)) { p = 'UDP'; tone = 'info'; }
      if (fl) {
        const f = fl[1];
        if (/S/.test(f) && /\./.test(f)) synack++;
        else if (/S/.test(f)) syn++;
        if (/R/.test(f)) { rst++; tone = 'danger'; }
        if (/F/.test(f)) fin++;
        info = `[${f}]${len ? ` len ${len[1]}` : ''}`;
      } else {
        info = payload.length > 60 ? `${payload.slice(0, 57)}…` : payload;
      }
      hs = src; hd = dst;
      if (dp) { bump(portCount, dp); dst = `${dst}:${dp}`; }
      if (sp) src = `${src}:${sp}`;
      if (ip[1] === 'IP6') bump(proto, 'IPv6');
    }
    if (!hs) hs = src; if (!hd) hd = dst;
    bump(proto, p);
    bump(srcCount, hs);
    if (hs && hd) bump(conv, `${hs} → ${hd}`);
    rows.push({ time, proto: p, src: src || '—', dst: dst || '—', info, _tone: tone });
  }
  const sections = [];
  if (!rows.length) {
    sections.push({ type: 'note', tone: 'dim', title: 'Nenhum pacote ainda', text: streaming ? 'Capturando ao vivo — os pacotes aparecem aqui conforme chegam (Ctrl-C encerra).' : 'Nada capturado (verifique interface/filtro).' });
    return { title: 'Pacotes (tcpdump)', icon: 'network', sections };
  }
  // resumo
  const kv = [{ k: 'Pacotes analisados', v: String(rows.length), tone: 'accent' }];
  if (bytes) kv.push({ k: 'Bytes (payload)', v: fmtBytes(bytes), tone: 'info' });
  if (iface) kv.push({ k: 'Interface', v: iface, tone: 'dim' });
  if (captured != null) kv.push({ k: 'Capturados (kernel)', v: String(captured), tone: 'dim' });
  if (dropped) kv.push({ k: 'Descartados pelo kernel', v: String(dropped), tone: 'danger' });
  sections.push({ type: 'kv', items: kv });
  // alertas
  const tcpTot = syn + synack + rst + fin;
  if (rst >= 10 && tcpTot && rst / tcpTot > 0.3) {
    sections.push({ type: 'note', tone: 'danger', title: `${rst} RST — conexões recusadas/derrubadas`, text: 'Alto volume de reset TCP: serviço fora, firewall rejeitando ou porta fechada.' });
  } else if (syn >= 20 && synack < syn / 4) {
    sections.push({ type: 'note', tone: 'warn', title: `${syn} SYN sem resposta proporcional (${synack} SYN-ACK)`, text: 'Possível port scan, porta filtrada (DROP) ou destino inalcançável.' });
  }
  if (dropped) sections.push({ type: 'note', tone: 'warn', title: 'Kernel descartou pacotes', text: 'A captura perdeu pacotes — use filtros mais específicos ou -n para reduzir carga.' });
  // protocolos + flags
  sections.push({ type: 'badges', label: 'Protocolos', items: Object.entries(proto).sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ text, count, tone: text === 'TCP' ? 'ok' : text === 'DNS' ? 'accent' : 'info' })) });
  const ifs = Object.entries(ifCount).sort((a, b) => b[1] - a[1]);
  if (ifs.length) sections.push({ type: 'badges', label: 'Interfaces', items: ifs.map(([text, count]) => ({ text, count, tone: 'info' })) });
  if (tcpTot) sections.push({ type: 'badges', label: 'Flags TCP', items: [
    { text: 'SYN', count: syn, tone: 'info' }, { text: 'SYN-ACK', count: synack, tone: 'ok' },
    { text: 'FIN', count: fin, tone: 'dim' }, { text: 'RST', count: rst, tone: rst ? 'danger' : 'dim' },
  ].filter((i) => i.count) });
  // portas e conversas
  const topPorts = Object.entries(portCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topPorts.length) sections.push({ type: 'badges', label: 'Portas de destino', items: topPorts.map(([text, count]) => ({ text, count, tone: 'accent' })) });
  const topConv = Object.entries(conv).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (topConv.length) {
    const maxC = topConv[0][1];
    sections.push({ type: 'bars', items: topConv.map(([label, n]) => ({ label, sub: null, pct: Math.round((n / maxC) * 100), valueText: `${n} pkt`, tone: 'info' })) });
  }
  // tabela dos últimos pacotes (RST em destaque via tone)
  sections.push({ type: 'table', columns: [
    { key: 'time', label: 'Hora', mono: true },
    { key: 'proto', label: 'Proto', mono: true, tone: (r) => r._tone },
    { key: 'src', label: 'Origem', mono: true },
    { key: 'dst', label: 'Destino', mono: true },
    { key: 'info', label: 'Info', mono: true, tone: (r) => r._tone },
  ], rows: rows.slice(-120) });
  return { title: `Pacotes (tcpdump)${streaming ? ' — ao vivo' : ''}`, icon: 'network', sections };
}

// ───────────────────────── registry ───────────────────────────────────────
const PARSERS = {
  sockets: parseSockets, ipaddr: parseIpAddr, iproute: parseIpRoute, iptables: parseIptables,
  ps: parsePs, free: parseFree, vmstat: parseVmstat, iostat: parseIostat, mpstat: parseMpstat,
  du: parseDu, smartctl: parseSmartctl, journal: parseJournal, dmesg: parseDmesg,
  weblog: parseWebAccess, weberr: parseWebError, authlog: parseAuthLog, syslog: parseSyslog,
  systemctl: parseSystemctl, analyze: parseAnalyze, lsof: parseLsof, uptime: parseUptime, last: parseLast,
  health: parseHealth, ls: parseLs, screen: parseScreen, tcpdump: parseTcpdump,
};

export const TOOL_LABELS = {
  sockets: 'Sockets (ss/netstat)', ipaddr: 'Interfaces (ip addr)', iproute: 'Rotas (ip route)',
  iptables: 'Firewall (iptables/nft)', ps: 'Processos (ps/top)', free: 'Memória (free)',
  vmstat: 'vmstat', iostat: 'I/O (iostat)', mpstat: 'CPU (mpstat)', du: 'Uso de disco (du)',
  smartctl: 'SMART (smartctl)', journal: 'journalctl', dmesg: 'Kernel (dmesg)',
  weblog: 'Acesso web', weberr: 'Erros web', authlog: 'Autenticação', syslog: 'syslog',
  systemctl: 'Serviços (systemctl)', analyze: 'Boot (systemd-analyze)', lsof: 'lsof',
  uptime: 'Carga (uptime/w)', last: 'Logins (last)', screen: 'Sessões (screen -ls)', tcpdump: 'Pacotes (tcpdump)',
};

/** Tipos de log que aceitam captura contínua (tail -f, journalctl -f, dmesg -w). */
export const LOG_KINDS = new Set(['syslog', 'journal', 'dmesg', 'weblog', 'weberr', 'authlog']);
/** Tipos que rodam em STREAM (logs seguidos + métricas com intervalo: vmstat/iostat/mpstat). */
export const STREAM_KINDS = new Set([...LOG_KINDS, 'vmstat', 'iostat', 'mpstat', 'tcpdump']);

/** Parseia a saída (linhas ou string) de um comando do tipo `kind`. */
export function parseTool(kind, lines, opts = {}) {
  const fn = PARSERS[kind];
  if (!fn) return null;
  try { return fn(lines, opts.streaming, opts); } catch { return null; }
}

export const TOOL_KINDS = Object.keys(PARSERS);
