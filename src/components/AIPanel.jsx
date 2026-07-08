import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, Sparkles, Cpu, Zap, PanelRightClose, LogIn, LogOut, Loader2, Play, AlertTriangle, ShieldCheck, Info, Terminal, Radar, Square, Wrench, Target, X, ScrollText, Trash2, Plus, History, MessageSquare, Maximize2, Clock, Check } from 'lucide-react';
import { api, codexLogin, codexPoll, codexManual, codexLogout, getAIConversations, getAIConversation, createAIConversation, saveAIConversation, deleteAIConversation, aiTitle, getAudit, addAudit, clearAudit } from '../lib/api.js';
import { sfx } from '../lib/sound.js';
import * as bus from '../lib/bus.js';

const QUICK = ['explain ss -tulpn', 'why is disk full?', 'explain systemctl status', 'safe way to find big files'];
const AGENT_EXAMPLES = ['Por que o /var está cheio?', 'Veja o erro do apache2', 'Diagnostique lentidão (CPU/load)', 'Quais serviços falharam?', 'Uso de memória / OOM', 'Investigue o que está na porta 443'];
const PROVIDER_LABEL = (id) => ({ openai: 'OpenAI', anthropic: 'Claude', google: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter', deepseek: 'DeepSeek', mistral: 'Mistral', ollama: 'Ollama', custom: 'Custom' }[id] || id);

/**
 * AIPanel — the copilot. Talks to /api/ai. Works offline (heuristic) until an
 * AI_API_KEY is configured on the backend, then auto-upgrades to live answers.
 * getContext() optionally returns recent terminal text to ground answers.
 */
const GREETING = { role: 'ai', text: 'Copilot online. Turn on Auto-Pilot (⚡) and I will read every command you run and explain it with next steps. Or just ask me anything.' };

export default function AIPanel({ getContext, onCollapse, activeSessionId, runInActive, runInSession, activeHost, sessions = [] }) {
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([GREETING]);
  const messagesRef = useRef([GREETING]);
  const [convos, setConvos] = useState([]);
  const [convId, setConvId] = useState(null);
  const [showConvs, setShowConvs] = useState(false);
  const [agentTarget, setAgentTarget] = useState(activeSessionId);
  const [agentList, setAgentList] = useState([]); // running agents: {sid, convId, goal, host}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [autopilot, setAutopilot] = useState(() => localStorage.getItem('tng_autopilot') === '1');
  const [showGoal, setShowGoal] = useState(false);
  const [goalText, setGoalText] = useState('');
  const [blockLevel, setBlockLevel] = useState(() => localStorage.getItem('tng_block_level') || 'medium');
  const setLevel = (lv) => { setBlockLevel(lv); localStorage.setItem('tng_block_level', lv); };
  const [showAudit, setShowAudit] = useState(false);
  const [audit, setAudit] = useState([]);
  const [pickSession, setPickSession] = useState(null); // {convId, goal, cmd, why} pending a terminal choice
  const activeHostRef = useRef(activeHost); activeHostRef.current = activeHost;
  const convIdRef = useRef(null);
  const setConv = (id) => { convIdRef.current = id; setConvId(id); };
  const historyLoadedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const scrollRef = useRef(null);
  const pollRef = useRef(null);
  const autopilotRef = useRef(autopilot); autopilotRef.current = autopilot;
  const activeRef = useRef(activeSessionId); activeRef.current = activeSessionId;
  // Multi-agent: each entry is an independent agent bound to one terminal (sid).
  const agentsRef = useRef({});   // sid -> agent { sid, convId, goal, host, running, stop, abort, steps, messages, saveTimer }
  const convSidRef = useRef({});  // convId -> sid
  const convGoalRef = useRef({}); // convId -> goal
  const fixQueueRef = useRef({}); // sid -> [{ convId, goal, cmd, why }] pending fixes
  const insightBusyRef = useRef(false);
  const lastCmdRef = useRef('');
  messagesRef.current = messages;
  const syncAgentList = () => setAgentList(Object.values(agentsRef.current).filter((a) => a.running || a.done).map((a) => ({ sid: a.sid, convId: a.convId, goal: a.goal, host: a.host, running: a.running, done: a.done })));
  const hostFor = (sid) => (sessions.find((s) => s.id === sid)?.name) || activeHostRef.current || '';

  const toggleAutopilot = () => { sfx.toggle(); setAutopilot((v) => { const n = !v; localStorage.setItem('tng_autopilot', n ? '1' : '0'); return n; }); };

  // Auto-Pilot: react to each command from the ACTIVE terminal.
  useEffect(() => {
    const off = bus.on('tng:cmd', async ({ sessionId, command, output }) => {
      if (!autopilotRef.current) return;
      if (sessionId !== activeRef.current) return;
      if (agentsRef.current[sessionId]?.running) return; // an agent owns this terminal
      const cmd = String(command || '').trim();
      if (!cmd || cmd.length < 2) return;
      if (insightBusyRef.current) return; // skip overlapping analyses
      const sig = cmd + '|' + (output || '').length;
      if (sig === lastCmdRef.current) return;
      lastCmdRef.current = sig;
      insightBusyRef.current = true;
      setMessages((m) => [...m, { role: 'analyzing', text: cmd }]);
      try {
        const { insight } = await api.post('/ai/insight', { command: cmd, output });
        sfx.toggle();
        setMessages((m) => [...m.filter((x) => x.role !== 'analyzing'), { role: 'insight', data: insight }]);
      } catch (e) {
        setMessages((m) => m.filter((x) => x.role !== 'analyzing'));
      } finally { insightBusyRef.current = false; }
    });
    return off;
  }, []);

  const runSuggestion = (cmd) => { runInActive?.(cmd); setMessages((m) => [...m, { role: 'user', text: `▶ ${cmd}` }]); };

  // Safety gate — PERMISSIVE: allow read-only diagnostics freely; block only
  // things that write/change state or are interactive/long-running.
  const isSafeCommand = (cmd, level = 'medium') => {
    if (level === 'none') return true;
    const c0 = String(cmd || '').trim();
    if (!c0) return true;
    // strip heredoc bodies + quoted strings + harmless redirects so their
    // contents don't cause false positives (e.g. awk 'NR>1', grep '...--dport...').
    let c = c0
      .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?^\s*\1\s*$/gm, ' HEREDOC ')
      .replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
      .replace(/\d*>>?\s*\/dev\/null/g, ' ').replace(/&>\s*\/dev\/null/g, ' ').replace(/\d*>&\d+/g, ' ');
    const has = (re) => re.test(c);
    // catastrophic — blocked at low/medium/high
    if (has(/(^|[\s;|&(])(dd|mkfs\w*|mke2fs|wipefs|shred|parted)([\s;|&)]|$)/i)) return false;
    if (has(/\brm\s+(-\w*[rf]|--recursive|--force)/i)) return false;
    if (has(/(^|[\s;|&(])(reboot|shutdown|halt|poweroff)([\s;|&)]|$)/i) || has(/\binit\s+[06]\b/)) return false;
    if (has(/>\s*\/dev\/(sd|nvme|vd|mapper|hd)/i)) return false;
    if (has(/:\s*\(\s*\)\s*\{.*\}\s*;/)) return false;
    if (level === 'low') return true;
    // writes / state changes / package mgmt — medium + high
    if (has(/(^|[\s;|&(])(rm|rmdir|mv|cp|install|chmod|chown|chgrp|chattr|setfacl|ln|mkdir|truncate|tee|crontab|visudo|passwd|useradd|userdel|usermod|groupadd|groupdel|mount|umount|swapon|swapoff|rmmod|modprobe|insmod)([\s;|&)]|$)/i)) return false;
    if (has(/(^|[\s;|&(])(apt|apt-get|aptitude|yum|dnf|zypper|pacman|snap|pip|pip3|npm|gem|cargo)([\s;|&)]|$)/i)) return false;
    if (has(/\bsystemctl\s+(start|stop|restart|reload|enable|disable|mask|unmask|kill|edit|isolate|set-)/i)) return false;
    if (has(/\bservice\s+\S+\s+(start|stop|restart|reload)/i)) return false;
    if (has(/\bsysctl\s+-w\b/)) return false;
    if (has(/\bsed\b[^;|]*\s-i\b/)) return false;
    if (has(/\bfind\b[^;|]*(-delete|-exec|-execdir|-ok)\b/i)) return false;
    if (has(/\b(iptables|ip6tables|nft|ufw|firewall-cmd)\b/i) && has(/(\s-(A|D|I|F|X|N|P)\b|\b(add|delete|insert|flush)\b)/i)) return false;
    if (has(/\bip\s+(addr|route|link|a|r|l|neigh)\s+(add|del|delete|flush|change|set|replace)/i)) return false;
    // interactive / long-running (would hang the agent / take over the screen)
    if (has(/(^|[\s;|&(])(vi|vim|nvim|nano|emacs|pico|joe|mcedit|sudoedit|editor|sensible-editor|ed|ex|vimdiff|view|less|more|most|man|info|pager|htop|atop|iotop|watch|tmux|screen|telnet|ssh|sftp|ftp|mysql|psql|mongo|redis-cli|sqlite3|irb|gdb|tig|lnav|dpkg-reconfigure)([\s;|&)]|$)/i)) return false;
    if (has(/\bcrontab\s+-e\b/) || has(/\bsystemctl\s+edit\b/)) return false;
    if (has(/(^|[\s;|&(])(python3?|node|ruby|perl|php)(\s+-i)?\s*($|[;|&])/i)) return false;
    if (has(/\btail\b[^;|]*\s-\w*[fF]\b/)) return false;
    if (has(/\btop\b/) && !has(/\btop\s+(\S+\s+)*-\S*b/)) return false;
    if (level === 'medium') return true;
    // high — strictest: any real file redirect + destructive script payloads
    if (has(/(^|[^0-9&])>>?\s*[^\s&|]/)) return false;
    if (/\b(python3?|perl|ruby|node|php)\b/i.test(c0) && /(os\.system|subprocess|Popen|shutil\.(rmtree|move|copy)|os\.(remove|unlink|rmdir|rename)|System\()/i.test(c0)) return false;
    return true;
  };

  // Guard against commands that would hang the shell at a "> " continuation
  // prompt: unbalanced quotes/parens/brackets or a trailing pipe/operator.
  const isWellFormed = (cmd) => {
    const s = String(cmd || '');
    if (!s.trim()) return false;
    let inS = false, inD = false, inB = false, esc = false;
    let p = 0, b = 0, k = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inS) { if (ch === "'") inS = false; continue; } // no escapes inside single quotes
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
    if (inS || inD || inB) return false;          // unterminated quote
    if (p !== 0 || b !== 0 || k !== 0) return false; // unbalanced brackets
    if (/\\\s*$/.test(s)) return false;           // trailing backslash (line continuation)
    if (/(\||&&|\|\|)\s*$/.test(s.trim())) return false; // trailing pipe / logical operator (a lone ';' is fine)
    return true;
  };

  // Interactive / full-screen programs (editors, pagers, REPLs, monitors): the
  // agent must NOT run these — they take over the TTY and swallow the next
  // commands as keystrokes (e.g. opening nano via sudoedit).
  const isInteractive = (cmd) => {
    const c = String(cmd || '');
    // Full-screen tools — match anywhere (e.g. `sudo nano f`, `cmd | less`).
    if (/(^|[\s;|&(])(vi|vim|nvim|nano|emacs|pico|joe|mcedit|sudoedit|editor|sensible-editor|vimdiff|view|less|more|most|man|info|pager|htop|atop|iotop|top|watch|tmux|screen|tig|lnav|dpkg-reconfigure|visudo)([\s;|&)]|$)/i.test(c)) return true;
    if (/\bcrontab\s+-e\b/.test(c) || /\bsystemctl\s+edit\b/.test(c)) return true;
    if (/\btail\b[^;|]*\s-\w*[fF]\b/.test(c)) return true; // tail -f
    // REPLs/clients that share names with services — only when they're the
    // COMMAND of a segment, NOT an argument (e.g. "systemctl reload ssh",
    // "systemctl restart mysql" must NOT count as interactive).
    for (const seg of c.split(/&&|\|\||[;|]/)) {
      const w = (seg.trim().replace(/^(sudo|doas)\s+/, '').split(/\s+/)[0] || '');
      if (/^(ssh|sftp|ftp|telnet|mysql|psql|mongo|mongosh|redis-cli|sqlite3|irb|gdb|ed|ex)$/i.test(w)) return true;
      if (/^(python3?|node)$/i.test(w)) { const rest = seg.trim().replace(/^(sudo|doas)\s+/, '').replace(/^(python3?|node)\s*/i, ''); if (!rest || /^-i\b/.test(rest)) return true; } // bare REPL only
    }
    return false;
  };

  // Send Ctrl-C to a session to abort a hung / continuation-prompt command.
  const interruptSession = (sid) => { try { (runInSession ? runInSession(sid, '\x03') : runInActive?.('\x03')); } catch {} };

  // Run a command in a LOCKED session; resolve with captured output. Per-agent
  // abort lets stopAgent(sid) cancel just that agent's in-flight command.
  const runAndCapture = (cmd, sid, agent) => new Promise((resolve) => {
    let done = false;
    const finish = (out) => { if (!done) { done = true; off(); clearTimeout(t); if (agent) agent.abort = null; resolve(out); } };
    const off = bus.on('tng:cmd', ({ sessionId, command, output }) => {
      if (sessionId !== sid) return;
      const c = String(command || '').trim();
      if (c === cmd || c.endsWith(cmd) || cmd.endsWith(c)) finish(output || '');
    });
    const t = setTimeout(() => { interruptSession(sid); finish('[timeout: no output captured — sent Ctrl-C to recover the shell]'); }, 25000);
    if (agent) agent.abort = () => { interruptSession(sid); finish('[parado pelo usuário]'); };
    if (runInSession) runInSession(sid, cmd); else runInActive?.(cmd);
  });

  // Mirror an agent's buffer to the visible panel only when its conversation is
  // in the foreground; always persist (debounced) to the agent's conversation.
  const flushAgent = (agent) => {
    if (agent.convId && agent.convId === convIdRef.current) setMessages([...agent.messages]);
    if (agent.saveTimer) clearTimeout(agent.saveTimer);
    if (agent.convId) agent.saveTimer = setTimeout(() => {
      saveAIConversation(agent.convId, { messages: agent.messages }).then(() => {
        setConvos((cs) => cs.map((c) => (c.id === agent.convId ? { ...c, updatedAt: new Date().toISOString(), count: agent.messages.length } : c)));
      }).catch(() => {});
    }, 600);
  };
  const pushAgent = (agent, m) => { agent.messages = [...agent.messages, m]; flushAgent(agent); };
  const dropAnalyzing = (agent) => { agent.messages = agent.messages.filter((x) => x.role !== 'analyzing'); flushAgent(agent); };

  const stopAgent = (sid) => { const a = agentsRef.current[sid]; if (a) { a.stop = true; a.abort?.(); } sfx.close(); };

  const startAgent = (sid, convId, goal, seedMessages) => {
    const agent = { sid, convId, goal, host: hostFor(sid), running: true, stop: false, abort: null, steps: [], messages: seedMessages || [], saveTimer: null };
    agentsRef.current[sid] = agent;
    if (convId) { convSidRef.current[convId] = sid; convGoalRef.current[convId] = goal; }
    bus.emit('tng:ai', { sessionId: sid, on: true });
    syncAgentList();
    return agent;
  };
  const finishAgent = (agent) => {
    // Keep the agent as "done" so its badge stays (with a ✓) until acknowledged,
    // and mark its conversation unread if it finished in the background.
    agent.running = false; agent.done = true; agent.abort = null;
    bus.emit('tng:ai', { sessionId: agent.sid, on: false });
    if (agent.saveTimer) clearTimeout(agent.saveTimer);
    if (agent.convId) saveAIConversation(agent.convId, { messages: agent.messages }).catch(() => {});
    if (agent.convId && agent.convId !== convIdRef.current) setConvos((cs) => cs.map((c) => (c.id === agent.convId ? { ...c, unread: true } : c)));
    syncAgentList();
    // Run the next queued fix for this terminal, if any.
    const q = fixQueueRef.current[agent.sid];
    if (q && q.length) { const next = q.shift(); setTimeout(() => runFix(next.convId, next.goal, next.cmd, next.why, next.sid), 150); }
  };

  // Autonomous loop for ONE agent — read-only steps on its locked session until
  // it concludes (or the step budget runs out), always ending with a report.
  const runAgentLoop = async (agent) => {
    const lvl = localStorage.getItem('tng_block_level') || 'medium';
    const stampReport = (r) => ({ ...(r || {}), ts: new Date().toISOString(), goal: agent.goal, host: agent.host });
    let concluded = false;
    const MAX = 10;
    for (let i = 0; i < MAX; i++) {
      if (agent.stop) { pushAgent(agent, { role: 'agent', text: 'parado pelo usuário.' }); break; }
      let step;
      try { step = await api.post('/ai/agent/step', { goal: agent.goal, steps: agent.steps }); }
      catch (e) { pushAgent(agent, { role: 'ai', text: `⚠ ${e.message}`, error: true }); break; }
      if (agent.stop) { pushAgent(agent, { role: 'agent', text: 'parado pelo usuário.' }); break; }
      if (step.thought) pushAgent(agent, { role: 'agent', text: step.thought });
      if (step.done || !step.command) { pushAgent(agent, { role: 'report', data: stampReport(step.report || { summary: 'Diagnóstico concluído.', findings: [], fixes: [] }) }); concluded = true; sfx.success(); break; }
      const cmd = String(step.command).trim();
      const why = step.thought || agent.goal;
      if (!isWellFormed(cmd)) { agent.steps.push({ command: cmd, output: '[comando malformado: aspas/parênteses/colchetes não fechados — ignorado]' }); pushAgent(agent, { role: 'agent', text: `ignorado (malformado): ${cmd}` }); addAudit({ type: 'agent', command: cmd, why, goal: agent.goal, host: agent.host, blocked: true }); continue; }
      if (!isSafeCommand(cmd, lvl)) { agent.steps.push({ command: cmd, output: `[blocked by safety level: ${lvl}]` }); pushAgent(agent, { role: 'agent', text: `bloqueado (nível ${lvl}): ${cmd}` }); addAudit({ type: 'agent', command: cmd, why, goal: agent.goal, host: agent.host, blocked: true }); continue; }
      addAudit({ type: 'agent', command: cmd, why, goal: agent.goal, host: agent.host });
      pushAgent(agent, { role: 'analyzing', text: cmd });
      const output = await runAndCapture(cmd, agent.sid, agent);
      dropAnalyzing(agent);
      agent.steps.push({ command: cmd, output });
    }
    if (!concluded && !agent.stop) {
      try {
        const fin = await api.post('/ai/agent/step', { goal: agent.goal, steps: agent.steps, conclude: true });
        pushAgent(agent, { role: 'report', data: stampReport(fin.report || { summary: 'Diagnóstico concluído (limite de passos).', findings: [], fixes: [] }) });
        sfx.success();
      } catch { pushAgent(agent, { role: 'report', data: stampReport({ summary: 'Diagnóstico encerrado (limite de passos).', findings: [], fixes: [] }) }); }
    }
  };

  // Launch a new agent on a chosen terminal. Many can run in parallel — but only
  // one per terminal; a terminal already driven by an agent is refused.
  const runAgent = async (goalText, targetSid) => {
    const goal = String(goalText || '').trim() || 'Diagnose this host: disk, memory, CPU/load and failed services. Find the root cause of any problem.';
    if (!runInSession && !runInActive) { setMessages((m) => [...m, { role: 'ai', text: '⚠ Open a connected terminal first.', error: true }]); return; }
    const sid = targetSid || activeRef.current;
    if (!sid) { setMessages((m) => [...m, { role: 'ai', text: '⚠ Selecione um terminal para o agente.', error: true }]); return; }
    if (agentsRef.current[sid]?.running) { setMessages((m) => [...m, { role: 'ai', text: '⚠ Este terminal já está sendo usado por outro agente. Escolha outro.', error: true }]); return; }
    const seed = [{ role: 'user', text: `🔬 ${goal}` }];
    const host = hostFor(sid);
    let convId = null;
    try {
      const conv = await createAIConversation({ title: goal.slice(0, 40), host, messages: seed });
      convId = conv.id;
      setConvos((cs) => [{ id: conv.id, title: conv.title, host, updatedAt: conv.updatedAt, count: seed.length }, ...cs]);
      aiTitle(goal).then((t) => { if (t) { setConvos((cs) => cs.map((c) => (c.id === convId ? { ...c, title: t } : c))); saveAIConversation(convId, { title: t }).catch(() => {}); } }).catch(() => {});
    } catch { convId = 'local-' + Date.now().toString(36); }
    const agent = startAgent(sid, convId, goal, seed);
    setConv(convId); setMessages([...agent.messages]); // bring this agent's topic to the foreground
    sfx.connect();
    try { await runAgentLoop(agent); } finally { finishAgent(agent); }
  };

  // Apply a fix on a resolved session and keep going in the SAME conversation.
  const runFix = async (convId, goal, cmd, why, sid) => {
    if (agentsRef.current[sid]?.running) { setMessages((m) => [...m, { role: 'ai', text: '⚠ Este terminal já está ocupado por um agente.', error: true }]); return; }
    const agent = startAgent(sid, convId, goal, [...messagesRef.current, { role: 'user', text: `🔧 aplicar correção: ${cmd}` }]);
    if (convId === convIdRef.current) setMessages([...agent.messages]);
    sfx.connect();
    addAudit({ type: 'fix', command: cmd, why: why || 'correção escolhida pelo usuário', goal, host: agent.host });
    try {
      pushAgent(agent, { role: 'analyzing', text: cmd });
      const out = await runAndCapture(cmd, sid, agent);
      dropAnalyzing(agent);
      agent.steps.push({ command: cmd, output: out, note: 'fix applied (user approved)' });
      agent.goal = `${goal}\n\nUma correção foi aplicada: \`${cmd}\`. Verifique se resolveu (estado do serviço / uso / logs) e continue até concluir. Conclua com um relatório final.`;
      await runAgentLoop(agent);
    } finally { finishAgent(agent); }
  };

  // User picked a suggested fix → apply it (bypasses safety), then keep going.
  // If the terminal the task originally ran on is gone (e.g. an old conversation
  // reopened in a new session), ask the user which terminal to continue on.
  const continueFromFix = async (cmd, why, targetSid) => {
    if (!isWellFormed(cmd)) { setMessages((m) => [...m, { role: 'ai', text: `⚠ Correção ignorada (aspas/parênteses não fechados): ${cmd}`, error: true }]); return; }
    if (isInteractive(cmd)) { runSuggestion(cmd); setMessages((m) => [...m, { role: 'ai', text: `✎ "${cmd}" é interativo (editor/pager). Abri pra você editar manualmente — a IA não continua dentro de editores.` }]); return; }
    const convId = convIdRef.current;
    const goal = (convId && convGoalRef.current[convId]) || 'Resolver o problema diagnosticado.';
    // Prefer an explicitly chosen terminal (e.g. the real target server of a
    // remote scan), else the conversation's terminal.
    let sid = targetSid || (convId && convSidRef.current[convId]);
    // Original terminal missing/closed → ask which session to continue on.
    if (!sid || !sessions.some((s) => s.id === sid)) {
      if (sessions.length === 0) { setMessages((m) => [...m, { role: 'ai', text: '⚠ Abra um terminal para a IA continuar a tarefa.', error: true }]); return; }
      setPickSession({ convId, goal, cmd, why });
      return;
    }
    // Terminal busy → queue this fix to run after the current one finishes.
    if (agentsRef.current[sid]?.running) {
      const q = fixQueueRef.current[sid] || (fixQueueRef.current[sid] = []);
      q.push({ convId, goal, cmd, why, sid });
      setMessages((m) => [...m, { role: 'agent', text: `⏳ na fila (${q.length}): ${cmd}` }]);
      sfx.toggle();
      return;
    }
    runFix(convId, goal, cmd, why, sid);
  };

  const refreshStatus = () => api.get('/ai/status').then(setStatus).catch(() => {});
  useEffect(() => { refreshStatus(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  // Load the conversation list, then open the most recent topic (if any).
  useEffect(() => {
    getAIConversations().then(async (list) => {
      setConvos(Array.isArray(list) ? list : []);
      if (Array.isArray(list) && list.length) {
        try { const c = await getAIConversation(list[0].id); setConv(c.id); setMessages(c.messages?.length ? c.messages : [GREETING]); } catch {}
      }
    }).finally(() => { historyLoadedRef.current = true; });
  }, []);
  // Persist the active topic (debounced) whenever its messages change.
  useEffect(() => {
    if (!historyLoadedRef.current || !convIdRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const id = convIdRef.current;
    saveTimerRef.current = setTimeout(() => {
      saveAIConversation(id, { messages }).then(() => {
        setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, updatedAt: new Date().toISOString(), count: messages.length } : c)));
      }).catch(() => {});
    }, 800);
  }, [messages]);

  // Create a topic if none is active; auto-title it from the subject (via AI).
  const ensureConversation = async (firstText) => {
    if (convIdRef.current) return convIdRef.current;
    try {
      const conv = await createAIConversation({ title: String(firstText || 'Conversa').slice(0, 40), messages: [] });
      setConv(conv.id);
      setConvos((cs) => [{ id: conv.id, title: conv.title, updatedAt: conv.updatedAt, count: 0 }, ...cs]);
      aiTitle(firstText).then((t) => { if (t) { setConvos((cs) => cs.map((c) => (c.id === conv.id ? { ...c, title: t } : c))); saveAIConversation(conv.id, { title: t }).catch(() => {}); } }).catch(() => {});
      return conv.id;
    } catch { return null; }
  };

  const newChat = () => { sfx.toggle(); setShowConvs(false); setConv(null); setMessages([GREETING]); };
  const loadConversation = async (id) => {
    sfx.click(); setShowConvs(false);
    setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, unread: false } : c)));
    // Acknowledge a finished agent for this conversation (drop its ✓ badge).
    let changed = false;
    for (const sid of Object.keys(agentsRef.current)) { const a = agentsRef.current[sid]; if (a.convId === id && a.done && !a.running) { delete agentsRef.current[sid]; changed = true; } }
    if (changed) syncAgentList();
    try { const c = await getAIConversation(id); setConv(c.id); setMessages(c.messages?.length ? c.messages : [GREETING]); } catch {}
  };
  const removeConversation = async (id, e) => {
    e?.stopPropagation();
    if (!window.confirm('Apagar esta conversa?')) return;
    await deleteAIConversation(id).catch(() => {});
    setConvos((cs) => cs.filter((c) => c.id !== id));
    if (convIdRef.current === id) { setConv(null); setMessages([GREETING]); }
  };
  const openConvs = async () => { sfx.click(); setShowConvs((v) => !v); try { setConvos(await getAIConversations()); } catch {} };

  const openAudit = async () => { sfx.click(); setShowAudit(true); setAudit(await getAudit()); };
  useEffect(() => { scrollRef.current?.scrollTo({ top: 9e9, behavior: 'smooth' }); }, [messages, busy]);

  const connectChatGPT = async () => {
    sfx.click();
    try {
      const { authorizeUrl, state } = await codexLogin();
      window.open(authorizeUrl, '_blank', 'noopener,noreferrer');
      setConnecting(true);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const r = await codexPoll(state);
          if (r.status === 'ok') { clearInterval(pollRef.current); setConnecting(false); sfx.success(); refreshStatus(); }
          else if (r.status === 'error' || r.status === 'expired') {
            clearInterval(pollRef.current); setConnecting(false); sfx.error();
            const code = window.prompt(`Login não detectou o callback (${r.error || r.status}).\nCole aqui o "code" da URL final (após login no navegador) para concluir manualmente:`, '');
            if (code) { const m = await codexManual(state, code.trim()); if (m.status === 'ok') { sfx.success(); refreshStatus(); } }
          }
        } catch {}
      }, 1500);
      setTimeout(() => { if (pollRef.current) { clearInterval(pollRef.current); setConnecting(false); } }, 600000);
    } catch (e) { setConnecting(false); sfx.error(); setMessages((m) => [...m, { role: 'ai', text: `⚠ ${e.message}`, error: true }]); }
  };

  const disconnectChatGPT = async () => { sfx.toggle(); await codexLogout().catch(() => {}); refreshStatus(); };

  const ask = async (q) => {
    const prompt = (q ?? input).trim();
    if (!prompt || busy) return;
    sfx.click();
    await ensureConversation(prompt);
    setMessages((m) => [...m, { role: 'user', text: prompt }]);
    setInput(''); setBusy(true);
    try {
      const context = getContext?.();
      const { answer, mode } = await api.post('/ai/ask', { prompt, context });
      sfx.toggle();
      setMessages((m) => [...m, { role: 'ai', text: answer, mode }]);
    } catch (e) {
      sfx.error();
      const detail = e?.data?.detail ? `\n${e.data.detail}` : '';
      setMessages((m) => [...m, { role: 'ai', text: `⚠ ${e.message}${detail}`, error: true }]);
    } finally { setBusy(false); }
  };

  // Derived: the agent (if any) whose conversation is in the foreground, and the
  // set of terminals currently busy with an agent.
  const fgAgent = agentList.find((a) => a.convId === convId && a.running);
  const busySids = new Set(agentList.filter((a) => a.running).map((a) => a.sid));
  const freeSessions = sessions.filter((s) => !busySids.has(s.id));

  return (
    <div className="glass h-full flex flex-col">
      <div className="flex items-center gap-1.5 p-2.5 border-b" style={{ borderColor: 'color-mix(in srgb, var(--cyber-secondary) 22%, transparent)' }}>
        <div className="grid place-items-center w-7 h-7 rounded-lg shrink-0" style={{ background: 'color-mix(in srgb, var(--cyber-secondary) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--cyber-secondary) 35%, transparent)' }}>
          <Bot className="w-4 h-4" style={{ color: 'var(--cyber-secondary)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-bold text-[12px] tracking-cyber truncate" style={{ color: 'var(--cyber-secondary)' }}>COPILOT</h2>
          <div className="flex items-center gap-1.5 text-[10px] truncate" style={{ color: 'var(--text-dim)' }}>
            <Cpu className="w-3 h-3 shrink-0" />
            {connecting ? 'aguardando login…'
              : status ? (status.mode === 'codex-oauth'
                  ? `ChatGPT${status.plan ? ' ' + status.plan : ''}${status.account ? ' · ' + status.account : ''}`
                  : status.enabled ? `${status.provider ? PROVIDER_LABEL(status.provider) + ' · ' : ''}${status.model || 'live'}` : 'offline heuristic')
                : 'connecting…'}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={newChat} title="Nova conversa" onMouseEnter={() => sfx.hover()} className="btn btn-ghost" style={{ padding: 6 }}>
            <Plus className="w-4 h-4" />
          </button>
          <button onClick={openConvs} title="Conversas salvas (tópicos)" onMouseEnter={() => sfx.hover()} className="btn btn-ghost" style={{ padding: 6 }}>
            <History className="w-4 h-4" />
          </button>
          <button onClick={toggleAutopilot} title={autopilot ? 'Auto-Pilot ON — I analyze every command' : 'Auto-Pilot OFF'} onMouseEnter={() => sfx.hover()}
            className={`btn ${autopilot ? 'btn-pink' : 'btn-ghost'}`} style={{ padding: 6 }}>
            <Zap className="w-4 h-4" />
          </button>
          <button onClick={openAudit} title="Auditoria da IA — comandos digitados e o porquê" onMouseEnter={() => sfx.hover()} className="btn btn-ghost" style={{ padding: 6 }}>
            <ScrollText className="w-4 h-4" />
          </button>
          {status?.mode === 'codex-oauth' ? (
            <button onClick={disconnectChatGPT} title="Disconnect ChatGPT" onMouseEnter={() => sfx.hover()} className="btn btn-ghost" style={{ padding: 6 }}>
              <LogOut className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={connectChatGPT} disabled={connecting} title="Connect ChatGPT (OAuth)" onMouseEnter={() => sfx.hover()} className="btn btn-pink" style={{ padding: 6 }}>
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            </button>
          )}
          <button onClick={onCollapse} title="Collapse panel" onMouseEnter={() => sfx.hover()}
            className="btn btn-ghost" style={{ padding: 6 }}>
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {agentList.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b overflow-x-auto no-scrollbar" style={{ borderColor: 'color-mix(in srgb, var(--cyber-secondary) 20%, transparent)', background: 'color-mix(in srgb, var(--cyber-secondary) 6%, transparent)' }}>
          <span className="font-display text-[9px] tracking-cyber shrink-0" style={{ color: 'var(--cyber-secondary)' }}>AGENTES · {agentList.length}</span>
          {agentList.map((a) => {
            const done = a.done && !a.running;
            const accent = done ? 'var(--cyber-accent)' : 'var(--cyber-secondary)';
            return (
              <div key={a.sid} onClick={() => a.convId && loadConversation(a.convId)} title={done ? `Concluído — ${a.goal}` : a.goal}
                className="group shrink-0 flex items-center gap-1.5 rounded-full border pl-2 pr-1 py-0.5 cursor-pointer transition-colors"
                style={{ borderColor: a.convId === convId ? accent : `color-mix(in srgb, ${accent} 35%, transparent)`, background: a.convId === convId ? `color-mix(in srgb, ${accent} 14%, transparent)` : 'transparent' }}>
                {done ? <Check className="w-3 h-3" style={{ color: accent }} /> : <Loader2 className="w-3 h-3 animate-spin" style={{ color: accent }} />}
                <span className="text-[10px] max-w-[100px] truncate" style={{ color: 'var(--text)' }}>{a.host || a.sid}</span>
                {done ? (
                  <button onClick={(e) => { e.stopPropagation(); if (a.convId) loadConversation(a.convId); }} title="Ver resultado e dispensar" className="p-0.5 rounded-full hover:bg-black/40">
                    <X className="w-2.5 h-2.5" style={{ color: 'var(--text-dim)' }} />
                  </button>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); stopAgent(a.sid); }} title="Parar agente" className="p-0.5 rounded-full hover:bg-black/40">
                    <Square className="w-2.5 h-2.5" style={{ color: 'var(--cyber-danger)' }} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {showConvs && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="border-b overflow-hidden" style={{ borderColor: 'rgba(255,43,214,0.2)', background: 'color-mix(in srgb, var(--bg-2) 80%, transparent)' }}>
            <div className="max-h-64 overflow-y-auto p-2 space-y-1">
              <div className="flex items-center gap-1.5 px-1 pb-1 text-[10px] tracking-cyber" style={{ color: 'var(--text-dim)' }}>
                <MessageSquare className="w-3 h-3" /> TÓPICOS · {convos.length}
              </div>
              {convos.length === 0 && <p className="text-[11px] px-1 py-2" style={{ color: 'var(--text-dim)' }}>Nenhuma conversa ainda. Use o radar ou faça uma pergunta para criar uma.</p>}
              {convos.map((c) => (
                <div key={c.id} onClick={() => loadConversation(c.id)}
                  className={`group flex items-center gap-2 rounded-lg border px-2 py-1.5 cursor-pointer transition-colors ${c.id === convId ? '' : 'hover:bg-theme-soft'}`}
                  style={{ borderColor: c.id === convId ? 'var(--cyber-secondary)' : 'rgba(255,255,255,0.08)', background: c.id === convId ? 'color-mix(in srgb, var(--cyber-secondary) 12%, transparent)' : 'transparent' }}>
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" style={{ color: c.id === convId ? 'var(--cyber-secondary)' : 'var(--text-dim)' }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] truncate flex items-center gap-1.5" style={{ color: 'var(--text)', fontWeight: c.unread ? 700 : 400 }}>
                      {c.unread && <span className="w-1.5 h-1.5 rounded-full shrink-0" title="não lido" style={{ background: 'var(--cyber-accent)', boxShadow: '0 0 6px var(--cyber-accent)' }} />}
                      <span className="truncate">{c.title || 'Conversa'}</span>
                    </div>
                    <div className="text-[9px] flex items-center gap-1.5 truncate" style={{ color: 'var(--text-dim)' }}>
                      {c.host && <span className="flex items-center gap-0.5 shrink-0" style={{ color: 'var(--cyber-primary)' }}><Terminal className="w-2.5 h-2.5" />{c.host}</span>}
                      <span className="shrink-0">{c.count || 0} msgs</span>
                      {c.updatedAt && <span className="truncate">· {new Date(c.updatedAt).toLocaleString()}</span>}
                    </div>
                  </div>
                  <button onClick={(e) => removeConversation(c.id, e)} title="Apagar" className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-black/40">
                    <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--cyber-danger)' }} />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {messages.map((m, i) => {
          if (m.role === 'analyzing') {
            return (
              <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--cyber-secondary)' }}>
                <Sparkles className="w-3.5 h-3.5 spin-slow" /> analisando <span className="font-mono" style={{ color: 'var(--text-dim)' }}>{m.text}</span>
              </motion.div>
            );
          }
          if (m.role === 'insight') {
            return <InsightCard key={i} data={m.data} onRun={runSuggestion} />;
          }
          if (m.role === 'agent') {
            return (
              <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--cyber-secondary)' }}>
                <Target className="w-3.5 h-3.5 shrink-0" /> <span style={{ color: 'var(--text-dim)' }}>{m.text}</span>
              </motion.div>
            );
          }
          if (m.role === 'report') {
            return <ReportCard key={i} data={m.data} onRun={runSuggestion} onFix={continueFromFix} sessions={sessions} />;
          }
          return (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] rounded-xl px-3 py-2 text-sm font-mono whitespace-pre-wrap leading-relaxed ${m.role === 'user' ? '' : 'border'}`}
                style={m.role === 'user'
                  ? { background: 'rgba(0,240,255,0.12)', border: '1px solid rgba(0,240,255,0.3)', color: '#dffaff' }
                  : { background: 'rgba(255,43,214,0.06)', borderColor: m.error ? 'var(--cyber-danger)' : 'rgba(255,43,214,0.25)', color: m.error ? 'var(--cyber-danger)' : 'var(--text)' }}>
                {m.text}
              </div>
            </motion.div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--cyber-secondary)' }}>
            <Sparkles className="w-4 h-4 spin-slow" /> thinking…
          </div>
        )}
      </div>

      <div className="px-3 pb-2 flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button key={q} onClick={() => ask(q)} onMouseEnter={() => sfx.hover()}
            className="text-[10px] px-2 py-1 rounded-md border border-theme text-theme-soft hover:bg-theme-soft transition-colors">
            {q}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="p-3 pt-1 flex gap-2">
        {fgAgent ? (
          <button type="button" onClick={() => stopAgent(fgAgent.sid)} className="btn btn-danger" title="Parar este agente" style={{ padding: '8px 10px' }}><Square className="w-4 h-4" /></button>
        ) : (
          <button type="button" onClick={() => { sfx.click(); setGoalText(input); setAgentTarget((freeSessions[0] && freeSessions[0].id) || activeSessionId || null); setShowGoal(true); }} className="btn btn-ghost" title="Novo agente — escolha um terminal livre e um objetivo (roda em paralelo)" onMouseEnter={() => sfx.hover()} style={{ padding: '8px 10px' }}><Radar className="w-4 h-4" /></button>
        )}
        <input className="field flex-1" placeholder={fgAgent ? 'agente rodando neste tópico…' : 'ask the copilot…'} value={input} onChange={(e) => setInput(e.target.value)} disabled={!!fgAgent} />
        <button type="submit" className="btn btn-pink" disabled={busy || !!fgAgent}><Send className="w-4 h-4" /></button>
      </form>

      {createPortal(
      <AnimatePresence>
        {showGoal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9998] grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.7)', backdropFilter: 'blur(4px)' }} onClick={() => setShowGoal(false)}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} className="glass clip-cyber w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-3">
                <Radar className="w-5 h-5 text-theme" />
                <h2 className="font-display font-bold tracking-cyber text-theme flex-1">Objetivo do agente</h2>
                <button onClick={() => setShowGoal(false)}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
              </div>
              <p className="text-[11px] mb-2" style={{ color: 'var(--text-dim)' }}>Descreva o que a IA deve investigar. Roda só comandos de leitura, em paralelo com outros agentes. Cada agente usa um terminal livre.</p>
              <textarea value={goalText} onChange={(e) => setGoalText(e.target.value)} rows={3} autoFocus
                placeholder="ex.: por que o /var está cheio?" className="field w-full font-mono"
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { const g = goalText, t = agentTarget; setShowGoal(false); setInput(''); runAgent(g, t); } }} />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {AGENT_EXAMPLES.map((ex) => (
                  <button key={ex} onClick={() => setGoalText(ex)} onMouseEnter={() => sfx.hover()}
                    className="text-[10px] px-2 py-1 rounded-md border border-theme text-theme-soft hover:bg-theme-soft transition-colors">{ex}</button>
                ))}
              </div>
              <div className="mt-3">
                <span className="text-[10px] tracking-cyber flex items-center gap-1" style={{ color: 'var(--text-dim)' }}><Terminal className="w-3 h-3" /> Terminal livre para este agente</span>
                {sessions.length === 0 ? (
                  <p className="text-[10px] mt-1" style={{ color: 'var(--cyber-danger)' }}>Nenhum terminal aberto.</p>
                ) : freeSessions.length === 0 ? (
                  <p className="text-[10px] mt-1" style={{ color: 'var(--cyber-warn)' }}>Todos os terminais estão ocupados por agentes. Abra outro terminal ou pare um agente.</p>
                ) : (
                  <select value={agentTarget || ''} onChange={(e) => setAgentTarget(e.target.value)} className="field w-full mt-1" style={{ padding: '6px 8px' }}>
                    {freeSessions.map((s) => (
                      <option key={s.id} value={s.id} style={{ background: 'var(--bg-2)' }}>{s.name}{s.id === activeSessionId ? ' · ativo' : ''}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="mt-3">
                <span className="text-[10px] tracking-cyber" style={{ color: 'var(--text-dim)' }}>Nível de bloqueio de comandos</span>
                <div className="flex gap-1.5 mt-1">
                  {[['none', 'Nenhum'], ['low', 'Baixo'], ['medium', 'Médio'], ['high', 'Alto']].map(([v, l]) => (
                    <button key={v} onClick={() => { setLevel(v); sfx.toggle(); }}
                      className="flex-1 text-[10px] px-2 py-1 rounded-md border transition-colors"
                      style={blockLevel === v ? { borderColor: 'var(--cyber-primary)', color: 'var(--cyber-primary)', background: 'color-mix(in srgb, var(--cyber-primary) 14%, transparent)' } : { borderColor: 'color-mix(in srgb, var(--cyber-primary) 25%, transparent)', color: 'var(--text-dim)' }}>{l}</button>
                  ))}
                </div>
                <p className="text-[9px] mt-1" style={{ color: 'var(--text-dim)' }}>
                  {blockLevel === 'none' ? 'Sem trava — roda qualquer comando (cuidado!).'
                    : blockLevel === 'low' ? 'Bloqueia só o catastrófico (rm -rf, dd, mkfs, reboot…).'
                    : blockLevel === 'high' ? 'Estrito — só leitura pura; bloqueia scripts e redirecionamentos.'
                    : 'Equilibrado — bloqueia escrita/serviços/interativos, permite diagnósticos.'}
                </p>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setShowGoal(false)} className="btn btn-ghost flex-1">Cancelar</button>
                <button onClick={() => { const g = goalText, t = agentTarget; setShowGoal(false); setInput(''); runAgent(g, t); }} disabled={freeSessions.length === 0}
                  className="btn flex-1 flex items-center justify-center gap-1.5 disabled:opacity-40"><Radar className="w-4 h-4" /> Iniciar</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}

      {createPortal(
      <AnimatePresence>
        {showAudit && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9998] grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.7)', backdropFilter: 'blur(4px)' }} onClick={() => setShowAudit(false)}>
            <motion.div initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} className="glass clip-cyber w-full max-w-2xl p-5 flex flex-col" style={{ maxHeight: '80vh' }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-3">
                <ScrollText className="w-5 h-5 text-theme" />
                <h2 className="font-display font-bold tracking-cyber text-theme flex-1">Auditoria da IA</h2>
                <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{audit.length}</span>
                <button onClick={async () => { if (window.confirm('Limpar toda a auditoria?')) { await clearAudit(); setAudit([]); } }} title="Limpar" className="p-1.5 rounded hover:bg-black/40"><Trash2 className="w-4 h-4" style={{ color: 'var(--cyber-danger)' }} /></button>
                <button onClick={() => setShowAudit(false)}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
                {audit.length === 0 && <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Nenhuma ação registrada ainda. Rode o agente (🛰) para gerar a trilha.</p>}
                {groupAudit(audit).map((g, gi) => (
                  <div key={gi} className="space-y-1.5">
                    <div className="flex items-center gap-2 sticky top-0 z-10 py-1" style={{ background: 'color-mix(in srgb, var(--bg-2) 92%, transparent)' }}>
                      <MessageSquare className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--cyber-secondary)' }} />
                      <span className="font-display text-[11px] tracking-cyber truncate" style={{ color: 'var(--cyber-secondary)' }}>{g.topic}</span>
                      <span className="ml-auto text-[9px] px-1.5 rounded shrink-0" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)' }}>{g.items.length}</span>
                    </div>
                    {g.items.map((e, i) => (
                      <div key={i} className="rounded-lg border border-theme p-2 ml-1" style={{ background: e.blocked ? 'rgba(255,56,96,0.06)' : 'rgba(0,240,255,0.04)' }}>
                        <div className="flex items-center gap-2 text-[9px]" style={{ color: 'var(--text-dim)' }}>
                          <span>{new Date(e.ts).toLocaleString()}</span>
                          {e.host && <span className="text-theme-soft">@{e.host}</span>}
                          <span className="ml-auto px-1 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>{e.type}{e.blocked ? ' · bloqueado' : ''}</span>
                        </div>
                        <div className="font-mono text-[12px] mt-0.5" style={{ color: e.blocked ? 'var(--cyber-danger)' : 'var(--cyber-accent)' }}>$ {e.command}</div>
                        {e.why && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-dim)' }}>↳ {e.why}</div>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}

      {createPortal(
      <AnimatePresence>
        {pickSession && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9998] grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.72)', backdropFilter: 'blur(5px)' }} onClick={() => setPickSession(null)}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }} className="glass clip-cyber w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-2">
                <Terminal className="w-5 h-5 text-theme" />
                <h2 className="font-display font-bold tracking-cyber text-theme flex-1">Continuar em qual terminal?</h2>
                <button onClick={() => setPickSession(null)}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
              </div>
              <p className="text-[11px] mb-3" style={{ color: 'var(--text-dim)' }}>O terminal original desta tarefa não está mais aberto. Escolha em qual sessão a IA deve aplicar a correção e continuar.</p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {sessions.map((s) => {
                  const busy = agentList.some((a) => a.running && a.sid === s.id);
                  return (
                    <button key={s.id} disabled={busy} onClick={() => { const ps = pickSession; setPickSession(null); runFix(ps.convId, ps.goal, ps.cmd, ps.why, s.id); }}
                      className="w-full flex items-center gap-2 text-left rounded-lg border px-3 py-2 transition-colors disabled:opacity-40 hover:bg-theme-soft"
                      style={{ borderColor: 'color-mix(in srgb, var(--cyber-primary) 25%, transparent)' }}>
                      <Terminal className="w-4 h-4 shrink-0 text-theme" />
                      <span className="text-[12px] flex-1 truncate" style={{ color: 'var(--text)' }}>{s.name}</span>
                      {busy && <span className="text-[9px]" style={{ color: 'var(--cyber-warn)' }}>ocupado</span>}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  );
}

const SEV = {
  ok:   { color: 'var(--cyber-accent)',  Icon: ShieldCheck, label: 'OK' },
  info: { color: 'var(--cyber-primary)', Icon: Info,        label: 'INFO' },
  warn: { color: 'var(--cyber-warn)',    Icon: AlertTriangle, label: 'WARN' },
  crit: { color: 'var(--cyber-danger)',  Icon: AlertTriangle, label: 'CRIT' },
};

function fmtWhen(ts) { try { return ts ? new Date(ts).toLocaleString() : ''; } catch { return ''; } }

// Group audit entries by conversation topic (the agent goal), newest first.
function groupAudit(audit) {
  const groups = [];
  const idx = {};
  audit.slice().reverse().forEach((e) => {
    const topic = (e.goal && e.goal.trim()) || 'Sem tópico';
    if (!(topic in idx)) { idx[topic] = groups.length; groups.push({ topic, items: [] }); }
    groups[idx[topic]].items.push(e);
  });
  return groups;
}

function ReportContent({ data, color, onRun, onFix, sessions = [], fixTarget, setFixTarget }) {
  return (
    <div className="space-y-2">
      <p className="text-[12px] leading-snug" style={{ color: 'var(--text)' }}>{data?.summary}</p>
      {data?.rootCause && (
        <div className="rounded-lg px-2 py-1.5 text-[11px]" style={{ background: 'var(--cyber-warn)18', border: '1px solid var(--cyber-warn)44', color: 'var(--text)' }}>
          <span className="font-display text-[9px] tracking-cyber" style={{ color: 'var(--cyber-warn)' }}>ROOT CAUSE</span>
          <div>{data.rootCause}</div>
        </div>
      )}
      {Array.isArray(data?.findings) && data.findings.length > 0 && (
        <ul className="space-y-0.5">
          {data.findings.map((f, i) => (
            <li key={i} className="text-[11px] flex gap-1.5" style={{ color: 'var(--text-dim)' }}><span style={{ color }}>▸</span><span>{f}</span></li>
          ))}
        </ul>
      )}
      {Array.isArray(data?.fixes) && data.fixes.length > 0 && (
        <div className="space-y-1.5 pt-0.5">
          <span className="font-display text-[9px] tracking-cyber" style={{ color: 'var(--cyber-secondary)' }}>SUGGESTED FIXES · clique p/ a IA aplicar e continuar</span>
          {sessions.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-dim)' }}>
              <Terminal className="w-3 h-3 shrink-0" /> aplicar em:
              <select value={fixTarget || ''} onChange={(e) => setFixTarget?.(e.target.value)} className="field flex-1" style={{ padding: '4px 6px', fontSize: 11 }}>
                <option value="" style={{ background: 'var(--bg-2)' }}>terminal da tarefa</option>
                {sessions.map((s) => <option key={s.id} value={s.id} style={{ background: 'var(--bg-2)' }}>{s.name}</option>)}
              </select>
            </div>
          )}
          {data.fixes.map((s, i) => (
            <button key={i} onClick={() => (onFix ? onFix(s.cmd, s.why, fixTarget || undefined) : onRun(s.cmd))} title={s.why || 'aplicar e continuar até resolver'}
              className="group w-full flex items-center gap-2 text-left rounded-lg border border-theme px-2 py-1.5 hover:bg-theme-soft transition-colors">
              <Wrench className="w-3 h-3 shrink-0" style={{ color: 'var(--cyber-secondary)' }} />
              <span className="font-mono text-[11px] truncate" style={{ color: 'var(--cyber-secondary)' }}>{s.cmd}</span>
              <span className="ml-auto text-[9px] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--cyber-accent)' }}>▶ resolver</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ data, onRun, onFix, sessions = [] }) {
  const [expanded, setExpanded] = useState(false);
  const [fixTarget, setFixTarget] = useState('');
  const crit = data?.rootCause;
  const color = crit ? 'var(--cyber-warn)' : 'var(--cyber-accent)';
  const when = fmtWhen(data?.ts);
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border overflow-hidden" style={{ borderColor: `${color}66`, background: 'rgba(8,11,22,0.7)', boxShadow: `0 0 22px ${color}22` }}>
        <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: `1px solid ${color}33`, background: `${color}14` }}>
          <Radar className="w-3.5 h-3.5 shrink-0" style={{ color }} />
          <span className="font-display text-[10px] tracking-cyber" style={{ color }}>DIAGNOSTIC REPORT</span>
          {data?.offline && <span className="text-[8px] px-1 rounded" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-dim)' }}>offline</span>}
          {when && <span className="ml-auto flex items-center gap-1 text-[9px]" style={{ color: 'var(--text-dim)' }}><Clock className="w-3 h-3" />{when}</span>}
          <button onClick={() => setExpanded(true)} title="Expandir relatório" className={`${when ? '' : 'ml-auto'} p-1 rounded hover:bg-black/40`}>
            <Maximize2 className="w-3.5 h-3.5" style={{ color }} />
          </button>
        </div>
        <div className="px-3 py-2">
          <ReportContent data={data} color={color} onRun={onRun} onFix={onFix} sessions={sessions} fixTarget={fixTarget} setFixTarget={setFixTarget} />
        </div>
      </motion.div>

      {createPortal(
        <AnimatePresence>
          {expanded && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9998] grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.72)', backdropFilter: 'blur(5px)' }} onClick={() => setExpanded(false)}>
              <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
                className="glass clip-cyber w-full max-w-2xl flex flex-col" style={{ maxHeight: '85vh' }} onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: `1px solid ${color}33`, background: `${color}10` }}>
                  <Radar className="w-5 h-5 shrink-0" style={{ color }} />
                  <h2 className="font-display font-bold tracking-cyber flex-1" style={{ color }}>DIAGNOSTIC REPORT</h2>
                  <button onClick={() => setExpanded(false)}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
                </div>
                <div className="px-5 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]" style={{ color: 'var(--text-dim)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {when && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {when}</span>}
                  {data?.host && <span className="flex items-center gap-1"><Terminal className="w-3 h-3" /> {data.host}</span>}
                  {data?.goal && <span className="truncate">objetivo: {data.goal}</span>}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 text-[13px]">
                  <ReportContent data={data} color={color} onRun={onRun} onFix={onFix} sessions={sessions} fixTarget={fixTarget} setFixTarget={setFixTarget} />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>, document.body)}
    </>
  );
}

function InsightCard({ data, onRun }) {
  const sev = SEV[data?.severity] || SEV.info;
  const Icon = sev.Icon;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border overflow-hidden" style={{ borderColor: `${sev.color}55`, background: 'rgba(8,11,22,0.6)', boxShadow: `0 0 18px ${sev.color}22` }}>
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: `1px solid ${sev.color}33`, background: `${sev.color}12` }}>
        <Icon className="w-3.5 h-3.5" style={{ color: sev.color }} />
        <span className="font-display text-[10px] tracking-cyber" style={{ color: sev.color }}>{sev.label}</span>
        {data?.command && <span className="font-mono text-[10px] truncate" style={{ color: 'var(--text-dim)' }}>$ {data.command}</span>}
      </div>
      <div className="px-3 py-2 space-y-2">
        <p className="text-[12px] leading-snug" style={{ color: 'var(--text)' }}>{data?.summary}</p>
        {Array.isArray(data?.findings) && data.findings.length > 0 && (
          <ul className="space-y-0.5">
            {data.findings.map((f, i) => (
              <li key={i} className="text-[11px] flex gap-1.5" style={{ color: 'var(--text-dim)' }}>
                <span style={{ color: sev.color }}>▸</span><span>{f}</span>
              </li>
            ))}
          </ul>
        )}
        {Array.isArray(data?.suggestions) && data.suggestions.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-0.5">
            {data.suggestions.map((s, i) => (
              <button key={i} onClick={() => onRun(s.cmd)} title={s.why || 'run in terminal'}
                className="group flex items-center gap-2 text-left rounded-lg border border-theme px-2 py-1.5 hover:bg-theme-soft transition-colors">
                <Play className="w-3 h-3 shrink-0 text-theme" />
                <span className="font-mono text-[11px] truncate text-theme">{s.cmd}</span>
                {s.why && <span className="ml-auto text-[9px] truncate" style={{ color: 'var(--text-dim)' }}>{s.why}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
