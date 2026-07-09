/**
 * codexOAuth.js — OpenAI ChatGPT OAuth (PKCE), the same flow the `openai/codex`
 * CLI uses. Lets the user log in with a ChatGPT Plus/Pro/Team subscription
 * instead of pasting an API key. Ported from the nexor-platform reference and
 * adapted to this single-host Node app (tokens persisted per user in the JSON
 * store; callback server on the Codex CLI ports 1455/1457).
 *
 * NOTE: the public Codex CLI client_id only accepts redirect_uri
 * http://localhost:1455/auth/callback (or 1457). The user's browser must reach
 * those ports on the backend host — fine when the backend runs locally.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { readTable, writeTable } from './store.js';
import { encryptSecret, decryptSecret } from './crypto.js';

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
const TOKEN_URL = `${ISSUER}/oauth/token`;
// Public client id of the ChatGPT "Codex CLI" — NOT a secret.
const CLIENT_ID = process.env.OPENAI_OAUTH_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann';
const PREFERRED_PORTS = [1455, 1457];
const CALLBACK_PATH = '/auth/callback';
const SCOPES = 'openid profile email offline_access';
const REFRESH_MARGIN = 60; // seconds
const LOGIN_TTL = 600 * 1000;
const CHAT_URL = process.env.OPENAI_OAUTH_CHAT_URL || 'https://chatgpt.com/backend-api/codex/responses';
const DEFAULT_MODEL = process.env.AI_CODEX_MODEL || 'gpt-5.5';
// Models accepted by Codex when signed in with a ChatGPT account (as of mid-2026).
// OpenAI rotates these; the chat() call tries them in order and remembers the first
// that works. Override with AI_CODEX_MODEL if your plan exposes a different one.
const CODEX_MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'];

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const makeVerifier = () => b64url(crypto.randomBytes(64));
const challengeFor = (v) => b64url(crypto.createHash('sha256').update(v).digest());

function decodeJwt(jwt) {
  try { const p = String(jwt).split('.'); if (p.length < 2) return {}; return JSON.parse(Buffer.from(p[1], 'base64url').toString('utf8')); }
  catch { return {}; }
}

const pending = new Map(); // state -> { verifier, redirectUri, port, userId, server, code, error, credential, createdAt }

function dropStale() {
  const now = Date.now();
  for (const [s, p] of pending) if (now - p.createdAt > LOGIN_TTL) { shutdown(p); pending.delete(s); }
}
function shutdown(p) { try { p.server && p.server.close(); } catch {} }

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>TERMINAL//NG — ChatGPT conectado</title>
<style>body{font-family:system-ui,sans-serif;background:#04050c;color:#d7e6f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{max-width:440px;padding:36px;border:1px solid #00f0ff55;border-radius:14px;text-align:center;background:#070a16;box-shadow:0 0 40px rgba(0,240,255,0.15)}
h1{color:#00f0ff;margin:0 0 8px;font-size:22px;letter-spacing:.05em}p{margin:8px 0 0;color:#6f8398;font-size:14px}</style></head>
<body><div class="card"><h1>✓ ChatGPT conectado</h1><p>Pode fechar esta aba e voltar ao TERMINAL//NG.</p></div></body></html>`;

function pickPort() {
  return new Promise((resolve, reject) => {
    let i = 0;
    const tryPort = () => {
      if (i >= PREFERRED_PORTS.length) return reject(new Error(`No free OAuth callback port (${PREFERRED_PORTS.join(', ')}).`));
      const port = PREFERRED_PORTS[i++];
      const srv = http.createServer();
      srv.once('error', () => { try { srv.close(); } catch {} tryPort(); });
      srv.listen(port, '0.0.0.0', () => resolve({ port, server: srv }));
    };
    tryPort();
  });
}

export async function beginLogin({ userId }) {
  dropStale();
  // cancel previous logins for this user (free the ports)
  for (const [s, p] of pending) if (p.userId === userId) { shutdown(p); pending.delete(s); }

  const { port, server } = await pickPort();
  const redirectUri = `http://localhost:${port}${CALLBACK_PATH}`;
  const verifier = makeVerifier();
  const state = b64url(crypto.randomBytes(32));
  const p = { verifier, redirectUri, port, userId, server, code: null, error: null, credential: null, createdAt: Date.now() };
  pending.set(state, p);

  server.on('request', async (req, res) => {
    const u = new URL(req.url, `http://localhost:${port}`);
    if (u.pathname !== CALLBACK_PATH) { res.writeHead(404); res.end(); return; }
    const qs = u.searchParams;
    if (qs.get('state') !== state) { res.writeHead(400); res.end('invalid state'); return; }
    const err = qs.get('error');
    const code = qs.get('code');
    res.writeHead(err || !code ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(err || !code ? `<h1>OAuth error</h1><p>${err || 'no code'}</p>` : SUCCESS_HTML);
    if (err) { p.error = `${err}: ${qs.get('error_description') || ''}`; shutdown(p); return; }
    if (!code) { p.error = 'no code in callback'; shutdown(p); return; }
    try { p.credential = await exchangeAndPersist(p, code); }
    catch (e) { p.error = e.message; }
    finally { shutdown(p); }
  });

  const params = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri, scope: SCOPES,
    code_challenge: challengeFor(verifier), code_challenge_method: 'S256', state,
    id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true', originator: 'terminal_ng',
  });
  return { authorizeUrl: `${AUTHORIZE_URL}?${params}`, state, redirectUri };
}

export function pollState(state) {
  const p = pending.get(state);
  if (!p) return { status: 'expired' };
  if (p.error) return { status: 'error', error: p.error };
  if (p.credential) return { status: 'ok', account: p.credential };
  return { status: 'pending' };
}

export async function completeManually(state, code) {
  const p = pending.get(state);
  if (!p) return { status: 'error', error: 'state unknown/expired — restart login' };
  if (p.credential) return { status: 'ok', account: p.credential };
  try { p.credential = await exchangeAndPersist(p, code); shutdown(p); return { status: 'ok', account: p.credential }; }
  catch (e) { p.error = e.message; return { status: 'error', error: e.message }; }
}

async function exchangeAndPersist(p, code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: p.redirectUri, client_id: CLIENT_ID, code_verifier: p.verifier,
  });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
  if (!r.ok) throw new Error(`token exchange HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const tokens = await r.json();
  return persistTokens(p.userId, tokens);
}

function persistTokens(userId, tokens) {
  const access = tokens.access_token || '';
  const refresh = tokens.refresh_token || '';
  const idTok = tokens.id_token || '';
  const expiresAt = Date.now() + Math.max(60, parseInt(tokens.expires_in, 10) || 3600) * 1000;
  const claims = Object.keys(decodeJwt(idTok)).length ? decodeJwt(idTok) : decodeJwt(access);
  const authClaims = claims['https://api.openai.com/auth'] || {};
  const accountId = authClaims.chatgpt_account_id || claims.chatgpt_account_id || claims.user_id || '';
  const plan = authClaims.chatgpt_plan_type || claims.chatgpt_plan_type || '';
  const email = claims.email || '';

  const all = readTable('codex', {});
  // Tokens cifrados em repouso (AES-256-GCM). accountId/email/plan não são segredos.
  all[userId] = { access: encryptSecret(access), refresh: encryptSecret(refresh), idToken: encryptSecret(idTok), expiresAt, email, plan, accountId, model: DEFAULT_MODEL, connectedAt: new Date().toISOString() };
  writeTable('codex', all);
  return { email, plan, model: DEFAULT_MODEL };
}

export function getStatus(userId) {
  const all = readTable('codex', {});
  const c = all[userId];
  if (!c || !c.access) return { connected: false };
  return { connected: true, email: c.email || '', plan: c.plan || '', model: c.model || DEFAULT_MODEL };
}

export function logout(userId) {
  const all = readTable('codex', {});
  if (all[userId]) { delete all[userId]; writeTable('codex', all); }
  return { ok: true };
}

async function refreshToken(userId) {
  const all = readTable('codex', {});
  const c = all[userId];
  if (!c || !c.refresh) return null;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decryptSecret(c.refresh), client_id: CLIENT_ID, scope: SCOPES });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
  if (!r.ok) return null;
  const t = await r.json();
  if (t.access_token) {
    c.access = encryptSecret(t.access_token);
    if (t.refresh_token) c.refresh = encryptSecret(t.refresh_token);
    c.expiresAt = Date.now() + Math.max(60, (parseInt(t.expires_in, 10) || 3600) - REFRESH_MARGIN) * 1000;
    all[userId] = c; writeTable('codex', all);
    return t.access_token;
  }
  return decryptSecret(c.access);
}

async function ensureFresh(userId) {
  const all = readTable('codex', {});
  const c = all[userId];
  if (!c || !c.access) return null;
  if (c.expiresAt && c.expiresAt - Date.now() > REFRESH_MARGIN * 1000) return decryptSecret(c.access);
  return (await refreshToken(userId)) || decryptSecret(c.access);
}

/** Run a chat turn over the ChatGPT subscription (OAuth). Returns { answer }. */
export async function chat(userId, { prompt, context, system }) {
  const all = readTable('codex', {});
  const c = all[userId];
  if (!c || !c.access) throw new Error('ChatGPT not connected');
  const token = await ensureFresh(userId);

  const input = [];
  if (context) input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: `Terminal context:\n${String(context).slice(-4000)}` }] });
  input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] });
  const instructions = system || 'You are a senior Linux/SSH operations copilot embedded in a terminal. Answer concisely.';

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'OpenAI-Beta': 'responses=experimental',
    originator: 'codex_cli_rs',
    session_id: crypto.randomUUID(),
  };
  if (c.accountId) headers['chatgpt-account-id'] = c.accountId;

  // Try the configured model first, then sensible fallbacks. A wrong model name
  // self-corrects instead of failing the whole request.
  // Try the env/stored model first (if it's a currently-valid one), then the
  // known ChatGPT-account models, newest first. Skip retired ones (gpt-5/gpt-5-codex).
  const retired = new Set(['gpt-5', 'gpt-5-codex', 'gpt-5.1-codex']);
  const candidates = [...new Set([process.env.AI_CODEX_MODEL, c.model, ...CODEX_MODELS].filter(Boolean).filter((m) => !retired.has(m)))];

  const runOnce = async (model) => {
    const payload = { model, instructions, input, store: false, stream: true };
    const r = await fetch(CHAT_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!r.ok || !r.body) {
      const body = await r.text().catch(() => '');
      const err = new Error(`HTTP ${r.status} (model=${model}): ${body.slice(0, 240)}`);
      err.status = r.status; err.body = body;
      throw err;
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = ''; const parts = []; let finalResp = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const ds = line.slice(5).trim();
        if (!ds || ds === '[DONE]') continue;
        let evt; try { evt = JSON.parse(ds); } catch { continue; }
        if (evt.type === 'response.output_text.delta') {
          const d = evt.delta;
          if (typeof d === 'string') parts.push(d);
          else if (d && d.text) parts.push(d.text);
        } else if (evt.type === 'response.completed') finalResp = evt.response || {};
        else if (evt.type === 'response.failed') { const e2 = new Error(((evt.response || {}).error || {}).message || 'response.failed'); e2.status = 400; throw e2; }
      }
    }
    if (!parts.length && finalResp) {
      for (const blk of finalResp.output || []) for (const cc of blk.content || []) if (cc.type === 'output_text' || cc.type === 'text') parts.push(cc.text || '');
    }
    // Remember the working model for next time.
    if (c.model !== model) { c.model = model; const t = readTable('codex', {}); if (t[userId]) { t[userId].model = model; writeTable('codex', t); } }
    return { answer: parts.join('') || '(empty response)' };
  };

  const errors = [];
  for (const model of candidates) {
    try { return await runOnce(model); }
    catch (e) {
      errors.push(`${model} → ${e.message}`);
      // Only treat genuine "this model isn't available" responses as a reason to
      // try the next candidate; any other error (auth/payload) is surfaced now.
      const modelUnavailable = /not supported|not found|does not exist|unknown model|model_not_found|no such model/i.test(e.message || '');
      if (!modelUnavailable) throw e;
    }
  }
  throw new Error(errors.join(' | '));
}
