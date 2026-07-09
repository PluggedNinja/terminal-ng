/**
 * ai.js — AI copilot endpoint.
 * If AI_API_KEY is set, proxies to an OpenAI-compatible chat completions API.
 * Otherwise falls back to an offline heuristic that explains common Linux commands,
 * so the panel is useful out of the box and trivially upgraded later.
 */
import express from 'express';
import * as codex from './codexOAuth.js';
import { readTable, writeTable } from './store.js';
import { encryptSecret, decryptSecret } from './crypto.js';

const SYSTEM_PROMPT = `You are a senior Linux/SSH operations copilot embedded in a terminal.
Answer concisely. When asked about a command, explain what it does, the key flags used,
risks, and a safer/alternative form if relevant. Prefer short, scannable answers.`;

const LANG_NAMES = {
  'pt-BR': 'Brazilian Portuguese', en: 'English', es: 'Spanish', fr: 'French',
  de: 'German', it: 'Italian', ja: 'Japanese', zh: 'Chinese', ru: 'Russian',
};
// Per-user "respond in this language" instruction, appended to system prompts.
function langLine(userId) {
  try {
    const lang = readTable('prefs', {})[userId]?.aiLang;
    if (!lang || lang === 'auto') return '';
    const name = LANG_NAMES[lang] || lang;
    return `\n\nIMPORTANT: Always write every response (summaries, findings, explanations, titles) in ${name}, regardless of the input language. Keep commands/code unchanged.`;
  } catch { return ''; }
}

export function aiRouter(requireAuthMw) {
  const router = express.Router();
  router.use(requireAuthMw);

  router.get('/status', (req, res) => {
    const cx = codex.getStatus(req.user.id);
    if (cx.connected) {
      return res.json({ enabled: true, mode: 'codex-oauth', model: cx.model, account: cx.email, plan: cx.plan });
    }
    const cfg = getProviderConfig(req.user.id);
    if (cfg) return res.json({ enabled: true, mode: 'live', provider: cfg.provider, model: cfg.model || '(padrão)' });
    res.json({ enabled: false, mode: 'offline-heuristic' });
  });

  // ── Provedor de IA por usuário (Claude, Gemini, OpenAI-compatíveis…) ──
  router.get('/provider', (req, res) => {
    const p = readTable('prefs', {})[req.user.id]?.aiProvider || {};
    res.json({ provider: p.provider || '', model: p.model || '', baseUrl: p.baseUrl || '', hasKey: !!p.apiKey }); // nunca devolve a chave
  });
  router.put('/provider', (req, res) => {
    const all = readTable('prefs', {});
    const u = all[req.user.id] || {};
    const b = req.body || {};
    if (b.clear) { delete u.aiProvider; }
    else if (b.provider) {
      const prev = u.aiProvider || {};
      u.aiProvider = {
        provider: String(b.provider).slice(0, 24),
        model: String(b.model || '').slice(0, 80),
        baseUrl: String(b.baseUrl || '').slice(0, 200),
        // só troca a chave se enviada; senão mantém a existente. Cifrada em repouso.
        apiKey: (b.apiKey != null && String(b.apiKey) !== '') ? encryptSecret(String(b.apiKey).slice(0, 400)) : (prev.apiKey || ''),
      };
    }
    all[req.user.id] = u; writeTable('prefs', all); res.json({ ok: true });
  });
  // Testa a config atual com um "ping".
  router.post('/provider/test', async (req, res) => {
    const cfg = getProviderConfig(req.user.id);
    if (!cfg) return res.json({ ok: false, error: 'Nenhum provedor configurado.' });
    try { const { answer, model } = await callChat(cfg, { system: 'You are a test. Reply with the single word: OK', user: 'ping' }); res.json({ ok: true, provider: cfg.provider, model, sample: String(answer).slice(0, 60) }); }
    catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // ── Codex / ChatGPT OAuth ──
  router.post('/codex/login', async (req, res) => {
    try { res.json(await codex.beginLogin({ userId: req.user.id })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/codex/poll', (req, res) => res.json(codex.pollState(req.query.state)));
  router.post('/codex/manual', async (req, res) => {
    const { state, code } = req.body || {};
    res.json(await codex.completeManually(state, code));
  });
  router.get('/codex/status', (req, res) => res.json(codex.getStatus(req.user.id)));
  router.post('/codex/logout', (req, res) => res.json(codex.logout(req.user.id)));

  // ── Per-user AI conversation history ──
  router.get('/history', (req, res) => { const all = readTable('aihistory', {}); res.json(all[req.user.id] || []); });
  router.put('/history', (req, res) => {
    const all = readTable('aihistory', {});
    const msgs = Array.isArray(req.body?.messages) ? req.body.messages.slice(-200) : [];
    all[req.user.id] = msgs; writeTable('aihistory', all); res.json({ ok: true, count: msgs.length });
  });
  router.delete('/history', (req, res) => { const all = readTable('aihistory', {}); delete all[req.user.id]; writeTable('aihistory', all); res.json({ ok: true }); });

  // ── Per-user AI conversations (topics) — each radar/chat is its own thread ──
  router.get('/conversations', (req, res) => {
    const all = readTable('aiconvs', {});
    const list = (all[req.user.id] || []).map((c) => ({ id: c.id, title: c.title, host: c.host || '', createdAt: c.createdAt, updatedAt: c.updatedAt, count: (c.messages || []).length }));
    list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    res.json(list);
  });
  router.get('/conversations/:id', (req, res) => {
    const all = readTable('aiconvs', {});
    const c = (all[req.user.id] || []).find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    res.json(c);
  });
  router.post('/conversations', (req, res) => {
    const all = readTable('aiconvs', {});
    const list = all[req.user.id] || [];
    const now = new Date().toISOString();
    const conv = { id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title: String(req.body?.title || 'Nova conversa').slice(0, 80), host: String(req.body?.host || '').slice(0, 120), createdAt: now, updatedAt: now, messages: Array.isArray(req.body?.messages) ? req.body.messages.slice(-200) : [] };
    list.push(conv); all[req.user.id] = list.slice(-100); writeTable('aiconvs', all); res.json(conv);
  });
  router.put('/conversations/:id', (req, res) => {
    const all = readTable('aiconvs', {});
    const list = all[req.user.id] || [];
    const c = list.find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    if (Array.isArray(req.body?.messages)) c.messages = req.body.messages.slice(-200);
    if (typeof req.body?.title === 'string' && req.body.title.trim()) c.title = req.body.title.slice(0, 80);
    if (typeof req.body?.host === 'string' && req.body.host.trim()) c.host = req.body.host.slice(0, 120);
    c.updatedAt = new Date().toISOString();
    all[req.user.id] = list; writeTable('aiconvs', all); res.json({ ok: true });
  });
  router.delete('/conversations/:id', (req, res) => {
    const all = readTable('aiconvs', {});
    all[req.user.id] = (all[req.user.id] || []).filter((x) => x.id !== req.params.id);
    writeTable('aiconvs', all); res.json({ ok: true });
  });

  // Auto-generate a short topic title from a subject string.
  router.post('/title', async (req, res) => {
    const text = String(req.body?.text || '').slice(0, 1200);
    if (!text.trim()) return res.json({ title: 'Nova conversa' });
    const sys = 'Gere um título curto (máximo 6 palavras, sem aspas e sem ponto final) que resuma o assunto. Responda apenas com o título.' + langLine(req.user.id);
    try {
      if (codex.getStatus(req.user.id).connected) {
        const { answer } = await codex.chat(req.user.id, { prompt: text, system: sys });
        return res.json({ title: cleanTitle(answer) });
      }
      const cfg = getProviderConfig(req.user.id);
      if (cfg) { const { answer } = await callChat(cfg, { system: sys, user: text }); return res.json({ title: cleanTitle(answer) }); }
    } catch { /* fall through */ }
    return res.json({ title: heuristicTitle(text) });
  });

  // ── Per-user AI audit trail (every command the AI typed + why) ──
  router.get('/audit', (req, res) => { const all = readTable('audit', {}); res.json(all[req.user.id] || []); });
  router.post('/audit', (req, res) => {
    const all = readTable('audit', {});
    const list = all[req.user.id] || [];
    const { type, command, why, goal, host, blocked } = req.body || {};
    list.push({ ts: new Date().toISOString(), type: type || 'agent', command: String(command || '').slice(0, 500), why: String(why || '').slice(0, 300), goal: String(goal || '').slice(0, 300), host: String(host || '').slice(0, 120), blocked: !!blocked });
    all[req.user.id] = list.slice(-1000); writeTable('audit', all); res.json({ ok: true });
  });
  router.delete('/audit', (req, res) => { const all = readTable('audit', {}); delete all[req.user.id]; writeTable('audit', all); res.json({ ok: true }); });

  // ── Auto-Pilot: structured insight for one command + its output ──
  router.post('/insight', async (req, res) => {
    const { command, output } = req.body || {};
    if (!command) return res.status(400).json({ error: 'command required' });
    const out = String(output || '').slice(-6000);
    const sys = `You are a Linux/SSH terminal copilot. Given a COMMAND and its OUTPUT, reply with ONLY minified JSON (no markdown, no prose), exactly this schema:
{"summary":"<=140 char plain-language explanation of what happened","severity":"ok|info|warn|crit","findings":["short bullet (errors, key numbers, anomalies)", "..."],"suggestions":[{"cmd":"a useful next command","why":"short reason"}]}
Max 4 findings and 3 suggestions. severity: ok=success/nothing wrong, info=normal, warn=something to check, crit=error/failure. Be concise and practical.` + langLine(req.user.id);
    const userMsg = `COMMAND:\n${command}\n\nOUTPUT:\n${out || '(no output)'}`;

    try {
      if (codex.getStatus(req.user.id).connected) {
        const { answer } = await codex.chat(req.user.id, { prompt: userMsg, system: sys });
        return res.json({ mode: 'codex-oauth', insight: parseInsight(answer, command) });
      }
      const cfg = getProviderConfig(req.user.id);
      if (cfg) { const { answer } = await callChat(cfg, { system: sys, user: userMsg, json: true }); return res.json({ mode: 'live', insight: parseInsight(answer, command) }); }
      return res.json({ mode: 'offline-heuristic', insight: heuristicInsight(command, out) });
    } catch (e) {
      return res.json({ mode: 'offline-heuristic', insight: heuristicInsight(command, out), warn: e.message });
    }
  });

  // ── Agent: decide the next read-only diagnostic command, or finish with a report ──
  router.post('/agent/step', async (req, res) => {
    const { goal, steps, conclude } = req.body || {};
    if (!goal) return res.status(400).json({ error: 'goal required' });
    const hist = (Array.isArray(steps) ? steps : []).map((s) => `$ ${s.command}\n${String(s.output || '').slice(-1500)}`).join('\n\n');
    const sys = `You are an autonomous Linux diagnostics agent operating a live SSH session.
RULES:
- You may ONLY run READ-ONLY, non-interactive commands (no changes to the system, no installs). Add 2>/dev/null, head, --no-pager where helpful.
- NEVER run editors or pagers or REPLs (vi, vim, nano, sudoedit, ed, less, more, man, top, htop, watch, mysql, python, node, tail -f). To inspect files use: cat, sed -n '1,80p', grep, awk, head/tail (without -f). They take over the terminal and break the session.
- Each turn, decide the SINGLE next command that best advances the goal, OR finish if you have enough evidence.
- Reply with ONLY minified JSON, one of:
  {"done":false,"thought":"<=90 char what you're checking and why","command":"the next read-only command"}
  {"done":true,"report":{"summary":"<=160 chars","rootCause":"<=200 chars or empty if none","findings":["bullet"],"fixes":[{"cmd":"a remediation command","why":"short"}]}}
- IMPORTANT: every fixes[].cmd MUST be a SINGLE runnable shell command — never prose/instructions. To edit a config file, express it as a real command (e.g. sed -i, or: grep -q 'X' f || echo 'X' >> f), NOT "add line X to file". Do not use editors (nano/vi/sudoedit). Quote it so it runs as-is.
- Prefer finishing within ~6 commands. Never repeat a command already in history.` + langLine(req.user.id);
    const userMsg = conclude
      ? `GOAL: ${goal}\n\nHISTORY:\n${hist || '(none)'}\n\nYou have enough information now. Respond ONLY with the final {"done":true,"report":{...}} — do not request more commands.`
      : `GOAL: ${goal}\n\nHISTORY (${(steps || []).length} steps):\n${hist || '(none yet)'}\n\nNext step as JSON:`;
    try {
      if (codex.getStatus(req.user.id).connected) {
        const { answer } = await codex.chat(req.user.id, { prompt: userMsg, system: sys });
        return res.json({ mode: 'codex-oauth', ...parseAgent(answer) });
      }
      const cfg = getProviderConfig(req.user.id);
      if (cfg) { const { answer } = await callChat(cfg, { system: sys, user: userMsg, json: true }); return res.json({ mode: 'live', ...parseAgent(answer) }); }
      return res.json({ mode: 'offline-heuristic', ...heuristicAgent(goal, steps || [], conclude) });
    } catch (e) {
      return res.json({ mode: 'offline-heuristic', ...heuristicAgent(goal, steps || [], conclude), warn: e.message });
    }
  });

  router.post('/ask', async (req, res) => {
    const { prompt, context } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    const sysPrompt = SYSTEM_PROMPT + langLine(req.user.id);
    // Prefer ChatGPT subscription (OAuth) when connected.
    if (codex.getStatus(req.user.id).connected) {
      try {
        const { answer } = await codex.chat(req.user.id, { prompt, context, system: sysPrompt });
        return res.json({ mode: 'codex-oauth', answer });
      } catch (e) {
        return res.status(502).json({ error: 'ChatGPT (OAuth) request failed', detail: e.message });
      }
    }

    const cfg = getProviderConfig(req.user.id);
    if (!cfg) {
      return res.json({ mode: 'offline-heuristic', answer: heuristicAnswer(prompt) });
    }

    try {
      const { answer, model } = await callChat(cfg, { system: sysPrompt, user: prompt, context });
      res.json({ mode: 'live', provider: cfg.provider, model, answer: answer || '(empty response)' });
    } catch (e) {
      res.status(502).json({ error: 'AI request failed', detail: e.message });
    }
  });

  return router;
}

// ─── Multi-provider chat: OpenAI-compatível, Anthropic (Claude) e Google (Gemini) ───
// Config por usuário (prefs.aiProvider) com fallback p/ variáveis de ambiente.
export function getProviderConfig(userId) {
  try {
    const p = readTable('prefs', {})[userId]?.aiProvider;
    if (p && p.provider && p.apiKey) return { provider: p.provider, apiKey: decryptSecret(p.apiKey), model: p.model || '', baseUrl: p.baseUrl || '' };
    // Ollama (local) pode não ter chave
    if (p && p.provider === 'ollama') return { provider: 'ollama', apiKey: decryptSecret(p.apiKey) || '', model: p.model || '', baseUrl: p.baseUrl || '' };
  } catch {}
  if (process.env.AI_API_KEY) return { provider: process.env.AI_PROVIDER || 'openai', apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL || '', baseUrl: process.env.AI_BASE_URL || '' };
  return null;
}

// Chama o modelo configurado. Retorna { answer, model }. Lança em erro de upstream.
export async function callChat(cfg, { system, user, context, json }) {
  const ctxMsg = context ? `Terminal context:\n${String(context).slice(-4000)}` : null;
  if (cfg.provider === 'anthropic') {
    const model = cfg.model || 'claude-3-5-sonnet-latest';
    const base = cfg.baseUrl || 'https://api.anthropic.com';
    const messages = [];
    if (ctxMsg) messages.push({ role: 'user', content: ctxMsg });
    messages.push({ role: 'user', content: user });
    const r = await fetch(`${base.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1500, system: json ? `${system}\n\nResponda APENAS com JSON válido, sem markdown.` : system, messages }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    return { answer: (d.content || []).map((b) => b.text || '').join('') || '', model };
  }
  if (cfg.provider === 'google') {
    const model = cfg.model || 'gemini-1.5-flash';
    const base = cfg.baseUrl || 'https://generativelanguage.googleapis.com';
    const r = await fetch(`${base.replace(/\/$/, '')}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: (ctxMsg ? ctxMsg + '\n\n' : '') + user }] }], generationConfig: json ? { responseMimeType: 'application/json', temperature: 0.2 } : { temperature: 0.3 } }),
    });
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    return { answer: (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('') || '', model };
  }
  // OpenAI-compatível: openai, groq, openrouter, deepseek, mistral, ollama, custom
  const base = cfg.baseUrl || 'https://api.openai.com/v1';
  const model = cfg.model || 'gpt-4o-mini';
  const messages = [{ role: 'system', content: system }];
  if (ctxMsg) messages.push({ role: 'user', content: ctxMsg });
  messages.push({ role: 'user', content: user });
  const body = { model, messages, temperature: json ? 0.2 : 0.3 };
  if (json) body.response_format = { type: 'json_object' };
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const r = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`AI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return { answer: d?.choices?.[0]?.message?.content || '', model };
}

function cleanTitle(s) {
  let t = String(s || '').trim().split('\n')[0].replace(/^["'`*#\s]+|["'`.\s]+$/g, '').replace(/\s+/g, ' ').slice(0, 80);
  return t || 'Conversa';
}
function heuristicTitle(text) {
  const t = String(text || '').replace(/[`#*_>🔬🔧▶]/g, '').replace(/\s+/g, ' ').trim();
  const words = t.split(' ').slice(0, 6).join(' ');
  return (words || 'Conversa').slice(0, 60);
}

// ─── Offline heuristic command explainer ───────────────────────────────────
const KNOWN = {
  ls: 'List directory contents. Common flags: -l (long), -a (hidden), -h (human sizes), -t (sort by time).',
  cd: 'Change directory. `cd -` returns to the previous directory; `cd` alone goes home.',
  grep: 'Search text with patterns. -i ignore case, -r recursive, -n line numbers, -v invert match.',
  ps: 'Report running processes. `ps aux` shows all processes with CPU/MEM. Pipe to grep to filter.',
  top: 'Live process/resource monitor. Press M (memory), P (cpu), q (quit). Consider `htop` if installed.',
  df: 'Show filesystem disk usage. `df -h` for human-readable. Watch for partitions near 100%.',
  du: 'Estimate file/dir space. `du -sh *` summarizes each item in the current directory.',
  systemctl: 'Control systemd services. status/start/stop/restart/enable <svc>. `journalctl -u <svc>` for logs.',
  journalctl: 'Query systemd logs. -u <unit>, -f follow, -e jump to end, --since "1 hour ago".',
  ss: 'Socket statistics. `ss -tulpn` lists listening TCP/UDP ports with the owning process.',
  netstat: 'Legacy socket listing. `netstat -tulpn`. Prefer `ss` on modern systems.',
  tail: 'Print the end of a file. `tail -f /var/log/...` follows new lines in real time.',
  chmod: 'Change file permissions. Numeric (e.g. 644, 755) or symbolic (u+x). Be careful with -R.',
  chown: 'Change file owner/group. `chown user:group file`. -R applies recursively.',
  scp: 'Copy files over SSH. `scp file user@host:/path`. -r for directories.',
  rsync: 'Efficient sync/copy. `rsync -avz src/ user@host:/dst/`. -n for a dry run first.',
  ping: 'Test reachability/latency via ICMP. -c N limits count. Watch RTT and packet loss.',
  traceroute: 'Trace the network path to a host hop by hop. High latency at a hop localizes the bottleneck.',
  ip: 'Modern network config tool. `ip a` (addresses), `ip r` (routes), `ip link` (interfaces).',
  free: 'Show memory usage. `free -h`. Mind available vs free; Linux caches aggressively.',
};

// Parse the model's JSON insight defensively (strip code fences / surrounding prose).
// Extract the FIRST complete top-level JSON object from a string. Handles
// models that emit prose around the JSON, or several objects concatenated.
function firstJsonObject(text) {
  const s = String(text || '');
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { start = -1; } } }
  }
  return null;
}

function parseInsight(text, command) {
  const raw = String(text || '');
  let obj = null;
  try { obj = JSON.parse(raw); } catch { obj = firstJsonObject(raw); }
  if (!obj || typeof obj !== 'object') {
    return { summary: 'A IA retornou uma resposta inválida.', severity: 'info', findings: [], suggestions: [] };
  }
  const sev = ['ok', 'info', 'warn', 'crit'].includes(obj.severity) ? obj.severity : 'info';
  return {
    summary: String(obj.summary || '').slice(0, 240),
    severity: sev,
    findings: Array.isArray(obj.findings) ? obj.findings.slice(0, 4).map((f) => String(f).slice(0, 160)) : [],
    suggestions: Array.isArray(obj.suggestions) ? obj.suggestions.slice(0, 3).map((s) => ({ cmd: String(s.cmd || s).slice(0, 500), why: String(s.why || '').slice(0, 120) })).filter((s) => s.cmd) : [],
    command,
  };
}

// Offline insight when no model is configured — pattern-based but still useful.
function heuristicInsight(command, output) {
  const o = String(output || '');
  const low = o.toLowerCase();
  const cmd = String(command || '').trim();
  const findings = [];
  const suggestions = [];
  let severity = 'ok';

  if (/command not found|not found/.test(low) && /bash:|sh:|zsh:/.test(low)) { severity = 'crit'; findings.push('Command not found — not installed or typo.'); suggestions.push({ cmd: `which ${cmd.split(/\s+/)[0]}`, why: 'check if it exists' }); }
  if (/permission denied|operation not permitted/.test(low)) { severity = 'warn'; findings.push('Permission denied — likely needs root.'); suggestions.push({ cmd: `sudo ${cmd}`, why: 'retry with privileges' }); }
  if (/no such file or directory/.test(low)) { severity = severity === 'crit' ? 'crit' : 'warn'; findings.push('A path does not exist.'); }
  if (/connection refused|could not resolve|timed out|timeout/.test(low)) { severity = 'warn'; findings.push('Network/connection problem detected.'); }
  if (/failed|error|cannot|fatal/i.test(o) && severity === 'ok') { severity = 'warn'; findings.push('Output mentions an error — review it.'); }

  // a couple of command-aware next steps
  const base = cmd.split(/\s+/)[0];
  const nexts = {
    df: { cmd: 'du -xh / 2>/dev/null | sort -rh | head', why: 'find what fills the disk' },
    free: { cmd: 'ps aux --sort=-%mem | head', why: 'top memory consumers' },
    'systemctl': { cmd: `journalctl -u ${cmd.split(/\s+/)[2] || '<unit>'} -n 50 --no-pager`, why: 'see recent logs' },
    ss: { cmd: 'ss -s', why: 'socket summary' },
    ip: { cmd: 'ip -br a', why: 'brief address view' },
    top: { cmd: 'ps aux --sort=-%cpu | head', why: 'top CPU consumers' },
  };
  if (nexts[base]) suggestions.push(nexts[base]);

  const summary = severity === 'crit' ? `"${base}" failed — see findings.`
    : severity === 'warn' ? `"${base}" ran with something worth checking.`
    : `"${base}" completed.`;
  return { summary, severity, findings, suggestions, command: cmd, offline: true };
}

// Parse the agent step JSON defensively.
function parseAgent(text) {
  const raw = String(text || '');
  let o = null;
  try { o = JSON.parse(raw); } catch { o = firstJsonObject(raw); }
  if (!o || typeof o !== 'object') return { done: true, report: { summary: 'A IA retornou uma resposta inválida. Rode o objetivo novamente.', rootCause: '', findings: [], fixes: [] } };
  if (o.done) {
    const rep = o.report || {};
    return { done: true, report: { summary: String(rep.summary || 'Done.').slice(0, 240), rootCause: String(rep.rootCause || '').slice(0, 240), findings: Array.isArray(rep.findings) ? rep.findings.slice(0, 6).map((f) => String(f).slice(0, 180)) : [], fixes: Array.isArray(rep.fixes) ? rep.fixes.slice(0, 4).map((f) => ({ cmd: String(f.cmd || f).slice(0, 900), why: String(f.why || '').slice(0, 140) })).filter((f) => f.cmd) : [] } };
  }
  return { done: false, thought: String(o.thought || '').slice(0, 120), command: String(o.command || '').slice(0, 700) };
}

// Offline diagnostic playbooks (no AI): a fixed read-only sequence per goal area.
function heuristicAgent(goal, steps, force) {
  const g = String(goal || '').toLowerCase();
  let plan;
  if (/disk|space|cheio|full|inode/.test(g)) plan = ['df -hT', 'df -i', 'du -xh / 2>/dev/null | sort -rh | head -15', 'ls -lhS /var/log 2>/dev/null | head'];
  else if (/mem|ram|oom|swap/.test(g)) plan = ['free -h', 'ps aux --sort=-%mem | head', 'dmesg 2>/dev/null | grep -i -E "oom|killed" | tail', 'cat /proc/meminfo | head'];
  else if (/cpu|load|slow|lento|perform/.test(g)) plan = ['uptime', 'ps aux --sort=-%cpu | head', 'top -bn1 | head -15', 'vmstat 1 3 2>/dev/null'];
  else if (/network|net|conn|dns|porta|port/.test(g)) plan = ['ip -br a', 'ss -tulpn', 'ss -s', 'cat /etc/resolv.conf'];
  else if (/service|serviço|fail|down|systemd/.test(g)) plan = ['systemctl --failed --no-pager', 'systemctl list-units --type=service --state=running --no-pager | head -20', 'journalctl -p err -n 40 --no-pager'];
  else plan = ['uptime', 'df -hT', 'free -h', 'systemctl --failed --no-pager', 'ps aux --sort=-%cpu | head'];

  const i = (steps || []).length;
  if (!force && i < plan.length) return { done: false, thought: `checking: ${plan[i].split(/\s+/)[0]}`, command: plan[i] };

  // Build a basic report from collected output.
  const all = (steps || []).map((s) => `${s.command}\n${s.output || ''}`).join('\n').toLowerCase();
  const findings = [];
  if (/\b9[0-9]%|\b100%/.test(all)) findings.push('A filesystem is ≥90% full.');
  if (/oom|out of memory|killed process/.test(all)) findings.push('Out-of-memory events detected.');
  if (/failed/.test(all)) findings.push('One or more services are failed.');
  if (/load average: ([0-9]+\.[0-9]+)/.test(all)) findings.push('Check load average vs CPU count.');
  return { done: true, report: { summary: `Diagnostics complete for: ${goal}`, rootCause: findings[0] || '', findings, fixes: [], offline: true } };
}

function heuristicAnswer(prompt) {
  const text = String(prompt).trim();
  const firstWord = text.replace(/^(what does|explain|how to use|o que faz|explique)\s+/i, '').split(/\s+/)[0]?.replace(/[^a-z0-9_-]/gi, '');
  if (firstWord && KNOWN[firstWord]) {
    return `**${firstWord}** — ${KNOWN[firstWord]}\n\n(Offline mode: set AI_API_KEY in .env for full AI answers.)`;
  }
  const hit = Object.keys(KNOWN).find((k) => text.toLowerCase().includes(k));
  if (hit) {
    return `**${hit}** — ${KNOWN[hit]}\n\n(Offline mode: set AI_API_KEY in .env for full AI answers.)`;
  }
  return `I'm running in offline heuristic mode, so I can explain common commands (ls, grep, systemctl, ss, journalctl, ping, traceroute, rsync, df, top, …).\n\nAsk e.g. "explain ss -tulpn". To unlock full AI answers, set AI_API_KEY in your .env.`;
}
