/**
 * agent.js — reusable autonomous-agent engine shared by the desktop AIPanel flow
 * and the mobile interface. It drives one terminal session: it asks the backend
 * (/ai/agent/step) for the next read-only command, runs it on the chosen session,
 * captures the output, and loops until the model concludes with a report.
 *
 * The command-safety checks below mirror the desktop copilot so both paths apply
 * the same guard rails (block destructive / interactive / write commands).
 */
import { api, addAudit } from './api.js';
import * as bus from './bus.js';

// --- safety: allow read-only diagnostics, block writes/destructive/interactive ---
export function isSafeCommand(cmd, level = 'medium') {
  if (level === 'none') return true;
  const c0 = String(cmd || '').trim();
  if (!c0) return true;
  let c = c0
    .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?^\s*\1\s*$/gm, ' HEREDOC ')
    .replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    .replace(/\d*>>?\s*\/dev\/null/g, ' ').replace(/&>\s*\/dev\/null/g, ' ').replace(/\d*>&\d+/g, ' ');
  const has = (re) => re.test(c);
  if (has(/(^|[\s;|&(])(dd|mkfs\w*|mke2fs|wipefs|shred|parted)([\s;|&)]|$)/i)) return false;
  if (has(/\brm\s+(-\w*[rf]|--recursive|--force)/i)) return false;
  if (has(/(^|[\s;|&(])(reboot|shutdown|halt|poweroff)([\s;|&)]|$)/i) || has(/\binit\s+[06]\b/)) return false;
  if (has(/>\s*\/dev\/(sd|nvme|vd|mapper|hd)/i)) return false;
  if (has(/:\s*\(\s*\)\s*\{.*\}\s*;/)) return false;
  if (level === 'low') return true;
  if (has(/(^|[\s;|&(])(rm|rmdir|mv|cp|install|chmod|chown|chgrp|chattr|setfacl|ln|mkdir|truncate|tee|crontab|visudo|passwd|useradd|userdel|usermod|groupadd|groupdel|mount|umount|swapon|swapoff|rmmod|modprobe|insmod)([\s;|&)]|$)/i)) return false;
  if (has(/(^|[\s;|&(])(apt|apt-get|aptitude|yum|dnf|zypper|pacman|snap|pip|pip3|npm|gem|cargo)([\s;|&)]|$)/i)) return false;
  if (has(/\bsystemctl\s+(start|stop|restart|reload|enable|disable|mask|unmask|kill|edit|isolate|set-)/i)) return false;
  if (has(/\bservice\s+\S+\s+(start|stop|restart|reload)/i)) return false;
  if (has(/\bsysctl\s+-w\b/)) return false;
  if (has(/\bsed\b[^;|]*\s-i\b/)) return false;
  if (has(/\bfind\b[^;|]*(-delete|-exec|-execdir|-ok)\b/i)) return false;
  if (has(/\b(iptables|ip6tables|nft|ufw|firewall-cmd)\b/i) && has(/(\s-(A|D|I|F|X|N|P)\b|\b(add|delete|insert|flush)\b)/i)) return false;
  if (has(/\bip\s+(addr|route|link|a|r|l|neigh)\s+(add|del|delete|flush|change|set|replace)/i)) return false;
  if (has(/(^|[\s;|&(])(vi|vim|nvim|nano|emacs|pico|joe|mcedit|sudoedit|editor|sensible-editor|ed|ex|vimdiff|view|less|more|most|man|info|pager|htop|atop|iotop|watch|tmux|screen|telnet|ssh|sftp|ftp|mysql|psql|mongo|redis-cli|sqlite3|irb|gdb|tig|lnav|dpkg-reconfigure)([\s;|&)]|$)/i)) return false;
  if (has(/\bcrontab\s+-e\b/) || has(/\bsystemctl\s+edit\b/)) return false;
  if (has(/(^|[\s;|&(])(python3?|node|ruby|perl|php)(\s+-i)?\s*($|[;|&])/i)) return false;
  if (has(/\btail\b[^;|]*\s-\w*[fF]\b/)) return false;
  if (has(/\btop\b/) && !has(/\btop\s+(\S+\s+)*-\S*b/)) return false;
  if (level === 'medium') return true;
  if (has(/(^|[^0-9&])>>?\s*[^\s&|]/)) return false;
  if (/\b(python3?|perl|ruby|node|php)\b/i.test(c0) && /(os\.system|subprocess|Popen|shutil\.(rmtree|move|copy)|os\.(remove|unlink|rmdir|rename)|System\()/i.test(c0)) return false;
  return true;
}

export function isWellFormed(cmd) {
  const s = String(cmd || '');
  if (!s.trim()) return false;
  let inS = false, inD = false, inB = false, esc = false;
  let p = 0, b = 0, k = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inS) { if (ch === "'") inS = false; continue; }
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (inD) { if (ch === '"') inD = false; continue; }
    if (inB) { if (ch === '`') inB = false; continue; }
    if (ch === "'") { inS = true; continue; }
    if (ch === '"') { inD = true; continue; }
    if (ch === '`') { inB = true; continue; }
    if (ch === '(') p++; else if (ch === ')') p--;
    else if (ch === '{') b++; else if (ch === '}') b--;
    else if (ch === '[') k++; else if (ch === ']') k--;
    if (p < 0 || b < 0 || k < 0) return false;
  }
  if (inS || inD || inB) return false;
  if (p !== 0 || b !== 0 || k !== 0) return false;
  if (/\\\s*$/.test(s)) return false;
  if (/(\||&&|\|\|)\s*$/.test(s.trim())) return false;
  return true;
}

export function isInteractive(cmd) {
  const c = String(cmd || '');
  if (/(^|[\s;|&(])(vi|vim|nvim|nano|emacs|pico|joe|mcedit|sudoedit|editor|sensible-editor|vimdiff|view|less|more|most|man|info|pager|htop|atop|iotop|top|watch|tmux|screen|tig|lnav|dpkg-reconfigure|visudo)([\s;|&)]|$)/i.test(c)) return true;
  if (/\bcrontab\s+-e\b/.test(c) || /\bsystemctl\s+edit\b/.test(c)) return true;
  if (/\btail\b[^;|]*\s-\w*[fF]\b/.test(c)) return true;
  for (const seg of c.split(/&&|\|\||[;|]/)) {
    const w = (seg.trim().replace(/^(sudo|doas)\s+/, '').split(/\s+/)[0] || '');
    if (/^(ssh|sftp|ftp|telnet|mysql|psql|mongo|mongosh|redis-cli|sqlite3|irb|gdb|ed|ex)$/i.test(w)) return true;
    if (/^(python3?|node)$/i.test(w)) { const rest = seg.trim().replace(/^(sudo|doas)\s+/, '').replace(/^(python3?|node)\s*/i, ''); if (!rest || /^-i\b/.test(rest)) return true; }
  }
  return false;
}

// Run one command on `sid`, capturing its output from the terminal bus.
function runAndCapture(cmd, sid, runInSession, setAbort) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (out) => { if (done) return; done = true; off(); clearTimeout(t); setAbort?.(null); resolve(out); };
    const off = bus.on('tng:cmd', ({ sessionId, command, output }) => {
      if (sessionId !== sid) return;
      const c = String(command || '').trim();
      if (c === cmd || c.endsWith(cmd) || cmd.endsWith(c)) finish(output || '');
    });
    const t = setTimeout(() => { try { runInSession(sid, '\x03'); } catch {} finish('[timeout: no output captured — sent Ctrl-C to recover the shell]'); }, 25000);
    setAbort?.(() => { try { runInSession(sid, '\x03'); } catch {} finish('[stopped by user]'); });
    try { runInSession(sid, cmd); } catch { finish('[failed to send command]'); }
  });
}

/**
 * Drive an agent on one session.
 *
 * @param {object} opts
 * @param {string} opts.goal        objective in natural language
 * @param {string} opts.sid         session id to run commands on
 * @param {function} opts.runInSession (sid, cmd) => void
 * @param {string} [opts.blockLevel]  none|low|medium|high (default medium)
 * @param {function} [opts.isStopped] () => boolean — return true to halt
 * @param {function} opts.onEvent    receives {type,...} events for the UI
 * @param {object} [opts.audit]      {host} metadata for the audit trail
 * @param {string} [opts.approvedCmd] a user-approved command to run first (bypasses safety)
 * @param {function} [opts.registerAbort] receives the current command's abort fn (or null)
 */
export async function runAgentSession({ goal, sid, runInSession, blockLevel = 'medium', isStopped = () => false, onEvent = () => {}, audit = {}, approvedCmd, registerAbort }) {
  const host = audit.host || '';
  const steps = [];
  let abort = null;
  const setAbort = (fn) => { abort = fn; registerAbort?.(fn); };
  const stamp = (r) => ({ ...(r || {}), ts: new Date().toISOString(), goal, host });
  let realGoal = goal;

  // Optional: run a user-approved fix command first, then continue verifying.
  if (approvedCmd) {
    const cmd = String(approvedCmd).trim();
    if (isWellFormed(cmd) && !isInteractive(cmd)) {
      addAudit({ type: 'fix', command: cmd, why: 'user approved', goal, host });
      onEvent({ type: 'command', cmd });
      const out = await runAndCapture(cmd, sid, runInSession, setAbort);
      onEvent({ type: 'output', cmd, output: out });
      steps.push({ command: cmd, output: out, note: 'fix applied (user approved)' });
      realGoal = `${goal}\n\nUma correção foi aplicada: \`${cmd}\`. Verifique se resolveu (estado do serviço / uso / logs) e continue até concluir com um relatório final.`;
    }
  }

  let concluded = false;
  const MAX = 10;
  const stopAll = { abort: () => abort?.() };
  for (let i = 0; i < MAX; i++) {
    if (isStopped()) { onEvent({ type: 'stopped' }); break; }
    let step;
    try { step = await api.post('/ai/agent/step', { goal: realGoal, steps }); }
    catch (e) { onEvent({ type: 'error', text: e.message }); break; }
    if (isStopped()) { onEvent({ type: 'stopped' }); break; }
    if (step.thought) onEvent({ type: 'thought', text: step.thought });
    if (step.done || !step.command) {
      onEvent({ type: 'report', data: stamp(step.report || { summary: 'Diagnóstico concluído.', findings: [], fixes: [] }) });
      concluded = true; break;
    }
    const cmd = String(step.command).trim();
    const why = step.thought || realGoal;
    if (!isWellFormed(cmd)) { steps.push({ command: cmd, output: '[malformed command — skipped]' }); onEvent({ type: 'blocked', cmd, reason: 'malformed' }); addAudit({ type: 'agent', command: cmd, why, goal, host, blocked: true }); continue; }
    if (!isSafeCommand(cmd, blockLevel)) { steps.push({ command: cmd, output: `[blocked by safety level: ${blockLevel}]` }); onEvent({ type: 'blocked', cmd, reason: blockLevel }); addAudit({ type: 'agent', command: cmd, why, goal, host, blocked: true }); continue; }
    addAudit({ type: 'agent', command: cmd, why, goal, host });
    onEvent({ type: 'command', cmd });
    const output = await runAndCapture(cmd, sid, runInSession, setAbort);
    onEvent({ type: 'output', cmd, output });
    steps.push({ command: cmd, output });
  }
  if (!concluded && !isStopped()) {
    try {
      const fin = await api.post('/ai/agent/step', { goal: realGoal, steps, conclude: true });
      onEvent({ type: 'report', data: stamp(fin.report || { summary: 'Diagnóstico concluído (limite de passos).', findings: [], fixes: [] }) });
    } catch { onEvent({ type: 'report', data: stamp({ summary: 'Diagnóstico encerrado (limite de passos).', findings: [], fixes: [] }) }); }
  }
  return { stop: () => stopAll.abort() };
}
