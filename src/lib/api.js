/**
 * api.js — thin fetch wrapper that attaches the JWT and parses JSON.
 */

// App base path — supports deploy under a reverse-proxy subpath (e.g. nginx /term/).
// '/term/' or '/term/index.html' -> '/term'; '/' or '/index.html' -> ''.
export const APP_BASE = window.location.pathname
  .replace(/\/[^/]*$/, '')
  .replace(/\/+$/, '');

// A sessão vive num cookie HttpOnly (o navegador o envia sozinho e o JS NÃO o lê —
// protege contra roubo por XSS). O token fica só EM MEMÓRIA nesta aba, usado apenas
// como fallback do WebSocket em dev cross-origin; nunca em localStorage. Após um
// refresh, /auth/me revalida a sessão pelo cookie.
let memToken = '';
export function getToken() { return memToken; }
export function setToken(t) { memToken = t || ''; }

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (memToken) headers.Authorization = `Bearer ${memToken}`;
  const res = await fetch(`${APP_BASE}/api${path}`, {
    method,
    headers,
    credentials: 'include', // envia/recebe o cookie de sessão
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

// ── Terminal scripts + session logs ──
export const fetchTerminalScripts = async () => { try { const r = await request('GET', '/terminal/scripts'); return r?.scripts || []; } catch { return []; } };
export const createTerminalScript = (payload) => request('POST', '/terminal/scripts', payload);
export const deleteTerminalScript = (id) => request('DELETE', `/terminal/scripts/${encodeURIComponent(id)}`);
export const saveTerminalSessionLog = (payload) => request('POST', '/terminal/session-log', payload);

// ── Per-user preferences ──
export const getPrefs = async () => { try { return await request('GET', '/prefs'); } catch { return {}; } };
export const savePrefs = (patch) => request('PUT', '/prefs', patch);

// ── Codex / ChatGPT OAuth ──
export const codexLogin = () => request('POST', '/ai/codex/login');
export const codexPoll = (state) => request('GET', `/ai/codex/poll?state=${encodeURIComponent(state)}`);
export const codexManual = (state, code) => request('POST', '/ai/codex/manual', { state, code });
export const codexStatus = () => request('GET', '/ai/codex/status');
export const codexLogout = () => request('POST', '/ai/codex/logout');

// ── AI history + audit (per user) ──
export const getAIHistory = async () => { try { return await request('GET', '/ai/history'); } catch { return []; } };
export const saveAIHistory = (messages) => request('PUT', '/ai/history', { messages });
// AI conversations (topics)
export const getAIConversations = async () => { try { return await request('GET', '/ai/conversations'); } catch { return []; } };
export const getAIConversation = (id) => request('GET', `/ai/conversations/${encodeURIComponent(id)}`);
export const createAIConversation = (payload) => request('POST', '/ai/conversations', payload || {});
export const saveAIConversation = (id, patch) => request('PUT', `/ai/conversations/${encodeURIComponent(id)}`, patch);
export const deleteAIConversation = (id) => request('DELETE', `/ai/conversations/${encodeURIComponent(id)}`);
export const aiTitle = async (text) => { try { const r = await request('POST', '/ai/title', { text }); return r?.title || ''; } catch { return ''; } };
// Provedor de IA (Claude, Gemini, OpenAI-compatíveis…)
export const getAiProvider = async () => { try { return await request('GET', '/ai/provider'); } catch { return {}; } };
export const saveAiProvider = (payload) => request('PUT', '/ai/provider', payload);
export const testAiProvider = () => request('POST', '/ai/provider/test');
// Task flows (server-side scheduled automations)
export const getFlows = async () => { try { return await request('GET', '/flows'); } catch { return []; } };
export const createFlow = (payload) => request('POST', '/flows', payload || {});
export const saveFlow = (id, patch) => request('PUT', `/flows/${encodeURIComponent(id)}`, patch);
export const deleteFlow = (id) => request('DELETE', `/flows/${encodeURIComponent(id)}`);
export const runFlow = (id) => request('POST', `/flows/${encodeURIComponent(id)}/run`);
export const getFlowRuns = async (id) => { try { return await request('GET', `/flows/${encodeURIComponent(id)}/runs`); } catch { return []; } };
export const getHostsList = async () => { try { return await request('GET', '/hosts'); } catch { return []; } };
export const pingHost = (id) => request('POST', `/hosts/${encodeURIComponent(id)}/ping`);
export const getAudit = async () => { try { return await request('GET', '/ai/audit'); } catch { return []; } };
export const addAudit = (entry) => request('POST', '/ai/audit', entry).catch(() => {});
export const clearAudit = () => request('DELETE', '/ai/audit');

// ── Gestão de usuários (admin) + diretório (para compartilhamento) ──
export const listUsers = async () => { try { return await request('GET', '/auth/users'); } catch { return []; } };
export const createUser = (payload) => request('POST', '/auth/users', payload);
export const deleteUser = (id) => request('DELETE', `/auth/users/${encodeURIComponent(id)}`);
export const resetUserPassword = (id, newPassword) => request('POST', `/auth/users/${encodeURIComponent(id)}/password`, { newPassword });
export const setUserRole = (id, role) => request('PUT', `/auth/users/${encodeURIComponent(id)}/role`, { role });
export const getDirectory = async () => { try { return await request('GET', '/auth/directory'); } catch { return []; } };

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
};

// Build the authenticated WebSocket URL for the SSH terminal.
// Sempre SAME-ORIGIN: em produção conecta direto no backend; em dev o Vite faz
// proxy de /ws. Assim o cookie HttpOnly de sessão é enviado automaticamente e
// sobrevive a refresh. O token na query é só um fallback (quando ainda temos o
// token em memória nesta aba) — o cookie é a via principal.
export function terminalWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const tok = getToken();
  const q = tok ? `?token=${encodeURIComponent(tok)}` : '';
  return `${proto}://${window.location.host}${APP_BASE}/ws/terminal${q}`;
}

// Encerra a sessão no servidor (limpa o cookie HttpOnly) e o token em memória.
export async function logout() {
  try { await request('POST', '/auth/logout'); } catch { /* ignore */ }
  setToken('');
}
