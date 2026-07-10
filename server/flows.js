/**
 * flows.js — Task Flow engine (server-side, 24/7).
 * A "flow" is bound to a saved host and is a sequence of steps:
 *   - command : run a shell command, capture output
 *   - test    : run a command and evaluate a condition (contains/regex/exit…),
 *               branching the flow (continue / stop) on failure
 *   - ai      : the AI evaluates the accumulated output and decides yes/no
 *   - report  : (implicit) a final AI report is always produced
 * Flows run on a schedule (every/hourly/daily/cron) via a 60s scheduler, or
 * on demand via POST /api/flows/:id/run. Runs are stored with full results.
 *
 * NOTE: unattended runs need a credential saved on the host (password). Hosts
 * without a saved password can only be run while the app is open.
 */
import express from 'express';
import fs from 'node:fs';
import pkg from 'ssh2';
const { Client: SSHClient } = pkg;
import { readTable, writeTable } from './store.js';
import { verifyHostKey } from './hostkeys.js';
import { isAllowedKeyPath } from './keypath.js';
import * as codex from './codexOAuth.js';

const newId = (p = 'f') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ─── SSH helpers ───────────────────────────────────────────────────────────
function connectSSH(host, ownerId) {
  return new Promise((resolve, reject) => {
    const ssh = new SSHClient();
    const port = parseInt(host.port, 10) || 22;
    const hostKeyId = `${host.ip}:${port}`;
    let hostKeyError = null;
    const cfg = {
      host: host.ip, port, username: host.username,
      readyTimeout: 12000, keepaliveInterval: 10000,
      // TOFU (mesma tabela knownhosts da sessão interativa — ver hostkeys.js):
      // aceita e memoriza na 1ª conexão; recusa se a host key mudar depois (MITM).
      hostVerifier: (keyBuf) => {
        const v = verifyHostKey(ownerId, hostKeyId, keyBuf);
        if (!v.ok) hostKeyError = new Error(`a chave do servidor ${hostKeyId} MUDOU desde o último acesso — possível man-in-the-middle. Conexão recusada. Se a mudança for legítima, remova o host conhecido para reconfiar.`);
        return v.ok;
      },
      algorithms: { serverHostKey: ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'rsa-sha2-256', 'rsa-sha2-512'] },
    };
    if (host.keyPath) {
      if (!isAllowedKeyPath(host.keyPath)) return reject(new Error('caminho de chave fora do diretório permitido'));
      try { cfg.privateKey = fs.readFileSync(host.keyPath); if (host.passphrase) cfg.passphrase = host.passphrase; } catch (e) { return reject(new Error('key read: ' + e.message)); }
    }
    else cfg.password = host.password || '';
    ssh.on('ready', () => resolve(ssh));
    ssh.on('error', (err) => reject(hostKeyError || err));
    try { ssh.connect(cfg); } catch (e) { reject(hostKeyError || e); }
  });
}

function execOn(ssh, cmd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => finish({ code: 124, out: '[timeout]' }), timeoutMs);
    try {
      ssh.exec(cmd, (err, stream) => {
        if (err) return finish({ code: 1, out: String(err.message || err) });
        let out = '';
        stream.on('data', (d) => { out += d.toString(); if (out.length > 200000) out = out.slice(0, 200000); });
        stream.stderr.on('data', (d) => { out += d.toString(); if (out.length > 200000) out = out.slice(0, 200000); });
        stream.on('close', (code) => finish({ code: code == null ? 0 : code, out }));
      });
    } catch (e) { finish({ code: 1, out: String(e.message || e) }); }
  });
}

// ─── condition evaluation ───────────────────────────────────────────────────
function evalTest(step, res) {
  const out = res.out || '';
  const v = String(step.value || '');
  switch (step.op) {
    case 'contains': return out.includes(v);
    case 'not_contains': return !out.includes(v);
    case 'equals': return out.trim() === v.trim();
    case 'regex': try { return new RegExp(v).test(out); } catch { return false; }
    case 'exit_zero': return res.code === 0;
    case 'exit_nonzero': return res.code !== 0;
    default: return true;
  }
}

// ─── AI helper (codex OAuth → OpenAI key → empty) ───────────────────────────
async function aiAsk(userId, system, prompt) {
  try {
    if (codex.getStatus(userId).connected) { const { answer } = await codex.chat(userId, { prompt, system }); return answer || ''; }
    const key = process.env.AI_API_KEY;
    if (key) {
      const base = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
      const model = process.env.AI_MODEL || 'gpt-4o-mini';
      const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.2 }) });
      if (r.ok) { const d = await r.json(); return d?.choices?.[0]?.message?.content || ''; }
    }
  } catch { /* ignore */ }
  return '';
}

function heuristicReport(run) {
  const lines = [`Tarefa: ${run.name}`, `Status: ${run.status}`];
  for (const s of run.steps) {
    if (s.type === 'test') lines.push(`- ${s.name}: ${s.pass ? 'OK' : 'FALHOU'}`);
    else if (s.type === 'ai') lines.push(`- ${s.name}: ${s.decision} (${s.reason || ''})`);
    else lines.push(`- ${s.name}: exit ${s.code}`);
  }
  return lines.join('\n');
}

function saveRun(ownerId, run) {
  const all = readTable('flowruns', {});
  const list = all[ownerId] || [];
  list.unshift(run);
  all[ownerId] = list.slice(0, 200);
  writeTable('flowruns', all);
}

// ─── the engine ─────────────────────────────────────────────────────────────
async function runFlow(flow, ownerId) {
  const run = { id: newId('run'), flowId: flow.id, name: flow.name, host: '', startedAt: new Date().toISOString(), finishedAt: null, status: 'running', steps: [], report: '' };
  const hosts = readTable('hosts', []);
  const host = hosts.find((h) => h.id === flow.hostId && h.ownerId === ownerId);
  if (!host) { run.status = 'error'; run.error = 'Host não encontrado.'; run.finishedAt = new Date().toISOString(); saveRun(ownerId, run); return run; }
  run.host = host.label;
  if (!host.password && !host.keyPath) { run.status = 'error'; run.error = 'Host sem credencial salva — marque "store pw" no host para rodar sem o app.'; run.finishedAt = new Date().toISOString(); saveRun(ownerId, run); return run; }

  let ssh;
  try { ssh = await connectSSH(host, ownerId); }
  catch (e) { run.status = 'error'; run.error = 'Falha SSH: ' + (e.message || e); run.finishedAt = new Date().toISOString(); saveRun(ownerId, run); return run; }

  try {
    for (const step of flow.steps || []) {
      if (step.type === 'command') {
        const res = await execOn(ssh, step.cmd, (step.timeout || 30) * 1000);
        run.steps.push({ type: 'command', name: step.name || step.cmd, cmd: step.cmd, code: res.code, output: res.out.slice(-4000) });
      } else if (step.type === 'test') {
        const res = await execOn(ssh, step.cmd, (step.timeout || 30) * 1000);
        const pass = evalTest(step, res);
        run.steps.push({ type: 'test', name: step.name || step.cmd, cmd: step.cmd, code: res.code, output: res.out.slice(-4000), op: step.op, value: step.value, pass });
        if (!pass && step.onFail === 'stop') { run.status = 'failed'; run.stoppedAt = step.name || step.cmd; break; }
      } else if (step.type === 'ai') {
        const ctx = run.steps.map((s) => `### ${s.name}\n$ ${s.cmd || ''}\n${(s.output || '').slice(-1200)}`).join('\n\n');
        const sys = 'Você é um agente de automação de infraestrutura. Avalie a pergunta com base no contexto e responda ESTRITAMENTE em JSON minificado: {"decision":"yes|no","reason":"<=160 chars"}. "yes" = condição satisfeita / pode prosseguir.';
        const ans = await aiAsk(ownerId, sys, `PERGUNTA: ${step.prompt}\n\nCONTEXTO (saídas anteriores):\n${ctx || '(nenhum)'}`);
        let decision = 'yes', reason = '';
        try { const a = ans.indexOf('{'); const b = ans.lastIndexOf('}'); const o = JSON.parse(ans.slice(a, b + 1)); decision = o.decision === 'no' ? 'no' : 'yes'; reason = String(o.reason || '').slice(0, 200); }
        catch { decision = /\b(no|n[ãa]o|fail|erro|negativ)/i.test(ans) ? 'no' : 'yes'; reason = ans.slice(0, 200); }
        run.steps.push({ type: 'ai', name: step.name || 'Decisão IA', prompt: step.prompt, decision, reason });
        if (decision === 'no' && step.onNo === 'stop') { run.status = 'failed'; run.stoppedAt = step.name || 'Decisão IA'; break; }
      }
    }
    if (run.status === 'running') run.status = 'ok';

    // Final report — always.
    const ctx = run.steps.map((s) => `### ${s.name} [${s.type}${s.pass != null ? (s.pass ? ' OK' : ' FALHOU') : ''}${s.decision ? ' ' + s.decision : ''}]\n$ ${s.cmd || ''}\n${(s.output || s.reason || '').slice(-1500)}`).join('\n\n');
    const sys = 'Você é um SRE sênior. Escreva um relatório curto e claro do resultado desta automação: o que foi verificado, o que passou/falhou, causa provável e próximos passos. Bullets curtos.';
    run.report = (await aiAsk(ownerId, sys, `TAREFA: ${flow.name}\nOBJETIVO: ${flow.goal || ''}\n\nPASSOS:\n${ctx}`)) || heuristicReport(run);
  } catch (e) {
    run.status = 'error'; run.error = String(e.message || e);
  } finally { try { ssh.end(); } catch { /* closing */ } }

  run.finishedAt = new Date().toISOString();
  saveRun(ownerId, run);
  return run;
}

// ─── scheduler ──────────────────────────────────────────────────────────────
function cronField(p, val) {
  if (p === '*') return true;
  for (const part of String(p).split(',')) {
    const st = part.match(/^\*\/(\d+)$/); if (st) { if (val % parseInt(st[1], 10) === 0) return true; continue; }
    const rg = part.match(/^(\d+)-(\d+)$/); if (rg) { if (val >= +rg[1] && val <= +rg[2]) return true; continue; }
    if (+part === val) return true;
  }
  return false;
}
function cronMatch(expr, now) {
  const parts = String(expr || '').trim().split(/\s+/); if (parts.length !== 5) return false;
  const fields = [now.getMinutes(), now.getHours(), now.getDate(), now.getMonth() + 1, now.getDay()];
  return parts.every((p, i) => cronField(p, fields[i]));
}
function shouldRun(flow, now) {
  const s = flow.schedule;
  if (!flow.enabled || !s || s.kind === 'manual') return false;
  const m = now.getMinutes(), h = now.getHours();
  if (s.kind === 'every') { const iv = Math.max(1, parseInt(s.minutes, 10) || 60); return (h * 60 + m) % iv === 0; }
  if (s.kind === 'hourly') { return m === (parseInt(s.minute, 10) || 0); }
  if (s.kind === 'daily') { const [hh, mm] = String(s.time || '06:00').split(':').map(Number); return h === hh && m === (mm || 0); }
  if (s.kind === 'cron') { return cronMatch(s.expr, now); }
  return false;
}

const running = new Set();
let schedTimer = null;
function tick() {
  const now = new Date();
  const all = readTable('flows', {});
  for (const ownerId of Object.keys(all)) {
    for (const flow of all[ownerId] || []) {
      if (running.has(flow.id)) continue;
      if (shouldRun(flow, now)) {
        running.add(flow.id);
        runFlow(flow, ownerId).catch(() => {}).finally(() => running.delete(flow.id));
      }
    }
  }
}
export function startFlowScheduler() {
  if (schedTimer) return;
  schedTimer = setInterval(tick, 60000);
  console.log('[Flows] scheduler online (60s tick)');
}

// ─── REST router ────────────────────────────────────────────────────────────
export function flowsRouter(requireAuthMw) {
  const r = express.Router();
  r.use(requireAuthMw);

  r.get('/', (req, res) => { const all = readTable('flows', {}); res.json(all[req.user.id] || []); });
  r.get('/runs/all', (req, res) => { const all = readTable('flowruns', {}); res.json((all[req.user.id] || []).slice(0, 60)); });

  r.post('/', (req, res) => {
    const all = readTable('flows', {});
    const list = all[req.user.id] || [];
    const now = new Date().toISOString();
    const f = {
      id: newId('f'),
      name: String(req.body?.name || 'Novo fluxo').slice(0, 80),
      goal: String(req.body?.goal || '').slice(0, 300),
      hostId: req.body?.hostId || '',
      schedule: req.body?.schedule || { kind: 'manual' },
      enabled: req.body?.enabled !== false,
      steps: Array.isArray(req.body?.steps) ? req.body.steps.slice(0, 40) : [],
      createdAt: now, updatedAt: now,
    };
    list.push(f); all[req.user.id] = list; writeTable('flows', all); res.json(f);
  });

  r.put('/:id', (req, res) => {
    const all = readTable('flows', {});
    const f = (all[req.user.id] || []).find((x) => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: 'not found' });
    for (const k of ['name', 'goal', 'hostId', 'schedule', 'enabled', 'steps']) if (req.body?.[k] !== undefined) f[k] = req.body[k];
    f.updatedAt = new Date().toISOString();
    writeTable('flows', all); res.json(f);
  });

  r.delete('/:id', (req, res) => {
    const all = readTable('flows', {});
    all[req.user.id] = (all[req.user.id] || []).filter((x) => x.id !== req.params.id);
    writeTable('flows', all); res.json({ ok: true });
  });

  r.post('/:id/run', async (req, res) => {
    const all = readTable('flows', {});
    const f = (all[req.user.id] || []).find((x) => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: 'not found' });
    try { const run = await runFlow(f, req.user.id); res.json(run); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  r.get('/:id/runs', (req, res) => { const all = readTable('flowruns', {}); res.json((all[req.user.id] || []).filter((x) => x.flowId === req.params.id).slice(0, 30)); });

  return r;
}
