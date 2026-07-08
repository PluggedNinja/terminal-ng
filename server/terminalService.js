/**
 * terminalService.js  (ESM)
 * WebSocket service that creates interactive SSH sessions in real time.
 * Ported from the msecops project and extended with JWT gating on the upgrade.
 *
 * WebSocket protocol:
 *  - Client → { type: 'auth', username, password, ip, port, keyPath?, passphrase? }
 *  - Client → { type: 'resize', cols, rows }
 *  - Client → { type: 'input', data }
 *  - Client → { type: 'services' }
 *  - Client → { type: 'helper', key }
 *  - Client → { type: 'probe_start', id, mode: 'ping'|'trace'|'tail', target }
 *  - Client → { type: 'probe_stop', id }
 *  - Server → { type: 'output', data }
 *  - Server → { type: 'status', status, message? }
 *  - Server → { type: 'services', list }
 *  - Server → { type: 'helper_result', key, data }
 *  - Server → { type: 'probe_output', id, mode, data }
 *  - Server → { type: 'probe_done', id, mode }
 *  - Server → { type: 'probe_error', id, message }
 *  - Server → { type: 'error', message }
 *
 * "probe" roda um comando longo (ping/traceroute/tail -f) num canal exec
 * SEPARADO da shell interativa, transmitindo só a saída para os parsers. Assim
 * o terminal do usuário fica livre (não recebe o ping/tail embaralhando linhas).
 */
import { WebSocketServer } from 'ws';
import pkg from 'ssh2';
const { Client: SSHClient } = pkg;
import url from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { assertPublicUrl } from './net-guard.js';
import { readTable, writeTable } from './store.js';
import { parseCookies, COOKIE_NAME } from './auth.js';

const activeSessions = new Map();
const WS_PING_INTERVAL = 20000;

/**
 * Attach a WebSocket server to the existing HTTP server, scoped to /ws/terminal.
 * The connection is gated by a JWT passed as ?token= on the upgrade URL.
 */
export function attachTerminalWebSocket(server, jwtSecret) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const parsed = url.parse(request.url, true);
    console.log(`[Terminal WS] upgrade request: ${parsed.pathname} from ${socket.remoteAddress}`);
    if (parsed.pathname !== '/ws/terminal') return; // ignore other upgrade paths

    // Token via cookie HttpOnly (same-origin) ou, como fallback, na query (?token=).
    const cookieTok = parseCookies(request.headers?.cookie)[COOKIE_NAME];
    const token = cookieTok || parsed.query?.token;
    let user = null;
    try {
      user = jwt.verify(String(token || ''), jwtSecret);
    } catch (e) {
      console.error(`[Terminal WS] upgrade REJECTED — invalid token: ${e.message}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    console.log(`[Terminal WS] upgrade ACCEPTED for user="${user.username}"`);
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws._user = user;
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    console.log(`[Terminal WS] New connection (user=${ws._user?.username || '?'})`);

    let sshClient = null;
    let sshStream = null;
    let authenticated = false;
    let isAlive = true;
    const probes = new Map(); // id -> exec stream (sondas ping/trace/tail)
    const sftpState = { client: null, xfers: new Map() }; // sessão SFTP + transferências ativas

    ws.on('pong', () => { isAlive = true; });

    const pingInterval = setInterval(() => {
      if (!isAlive) { clearInterval(pingInterval); ws.terminate(); return; }
      isAlive = false;
      try { ws.ping(); } catch {}
    }, WS_PING_INTERVAL);

    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        sendJson(ws, { type: 'error', message: 'Authentication timeout (30s)' });
        ws.close();
      }
    }, 30000);

    ws.on('message', (rawMsg) => {
      let msg;
      try {
        msg = JSON.parse(rawMsg.toString());
      } catch {
        if (authenticated && sshStream) sshStream.write(rawMsg.toString());
        return;
      }

      switch (msg.type) {
        case 'auth':
          handleAuth(ws, msg, authTimeout, (client, stream) => {
            sshClient = client;
            sshStream = stream;
            authenticated = true;
            activeSessions.set(ws, { ssh: client, stream });
          });
          break;
        case 'input':
          if (sshStream && authenticated) sshStream.write(msg.data);
          break;
        case 'resize':
          if (sshStream && authenticated && msg.cols && msg.rows) sshStream.setWindow(msg.rows, msg.cols, 0, 0);
          break;
        case 'services':
          if (sshClient && authenticated) collectStatus(sshClient, (status) => sendJson(ws, { type: 'services', list: status.list, cpu: status.cpu, mem: status.mem, users: status.users }));
          break;
        case 'helper':
          if (sshClient && authenticated && msg.key) runHelper(sshClient, msg.key, (data) => sendJson(ws, { type: 'helper_result', key: msg.key, data }));
          break;
        case 'sysinfo':
          if (sshClient && authenticated) collectSysinfo(sshClient, (data) => sendJson(ws, { type: 'sysinfo', data }));
          break;
        case 'probe_start':
          if (sshClient && authenticated) startProbe(ws, sshClient, probes, msg);
          break;
        case 'probe_stop':
          if (msg.id) stopProbe(probes, msg.id);
          break;
        case 'sftp_list':
        case 'sftp_realpath':
        case 'sftp_mkdir':
        case 'sftp_rename':
        case 'sftp_delete':
        case 'sftp_chmod':
        case 'sftp_stat':
        case 'sftp_get':
        case 'sftp_get_ack':
        case 'sftp_get_cancel':
        case 'sftp_put_start':
        case 'sftp_put_chunk':
        case 'sftp_put_end':
        case 'sftp_put_cancel':
          if (sshClient && authenticated) handleSftp(ws, sshClient, sftpState, msg);
          break;
        case 'http_fetch':
          if (sshClient && authenticated) handleHttpFetch(ws, sshClient, msg);
          break;
        case 'bg_exec':
          if (sshClient && authenticated) handleBgExec(ws, sshClient, msg);
          break;
        default:
          if (authenticated && sshStream && msg.data) sshStream.write(msg.data);
          break;
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      clearInterval(pingInterval);
      stopAllProbes(probes);
      cleanupSftp(sftpState);
      cleanup(ws, sshClient, sshStream);
    });

    ws.on('error', () => {
      clearInterval(pingInterval);
      stopAllProbes(probes);
      cleanupSftp(sftpState);
      cleanup(ws, sshClient, sshStream);
    });
  });

  console.log('[Terminal WS] WebSocket server attached on /ws/terminal');
  return wss;
}

function resolvePrivateKey(keyPath) {
  if (!keyPath) return null;
  try {
    const stat = fs.statSync(keyPath);
    if (stat.isFile()) return { keyData: fs.readFileSync(keyPath), keyFile: keyPath };
    if (stat.isDirectory()) {
      for (const name of ['id_ed25519', 'id_rsa', 'id_ecdsa', 'id_dsa']) {
        const filePath = path.join(keyPath, name);
        try { if (fs.statSync(filePath).isFile()) return { keyData: fs.readFileSync(filePath), keyFile: filePath }; }
        catch { /* next */ }
      }
    }
  } catch (err) {
    console.error(`[Terminal WS] key resolve error ${keyPath}:`, err.message);
  }
  return null;
}

// ── Verificação de host key (TOFU: trust on first use) ──
// Guarda o fingerprint por usuário+host. No 1º acesso confia e persiste; depois
// recusa se a chave do servidor mudar (defesa contra man-in-the-middle).
function hostKeyFingerprint(keyBuf) {
  return crypto.createHash('sha256').update(keyBuf).digest('base64');
}
function verifyHostKey(userId, hostKey, keyBuf) {
  const all = readTable('knownhosts', {});
  const forUser = all[userId] || {};
  const fp = hostKeyFingerprint(keyBuf);
  const known = forUser[hostKey];
  if (!known) { // TOFU: primeira vez → confia e memoriza
    forUser[hostKey] = fp; all[userId] = forUser; writeTable('knownhosts', all);
    return { ok: true, first: true };
  }
  if (known === fp) return { ok: true };
  return { ok: false, expected: known, got: fp };
}

function handleAuth(ws, msg, authTimeout, onSuccess) {
  const { ip, port, username, password, keyPath, passphrase } = msg;
  if (!ip || !username) {
    sendJson(ws, { type: 'error', message: 'IP and username are required.' });
    return;
  }
  const userId = ws._user?.id || 'anon';
  const hostKeyId = `${ip}:${parseInt(port, 10) || 22}`;
  let hostKeyRejected = false;

  let privateKeyData = null;
  let resolvedKeyFile = null;
  if (keyPath) {
    const resolved = resolvePrivateKey(keyPath);
    if (resolved) { privateKeyData = resolved.keyData; resolvedKeyFile = resolved.keyFile; }
    else { sendJson(ws, { type: 'error', message: `Key not found at: ${keyPath}` }); return; }
  }

  const authMethod = privateKeyData ? 'key' : 'password';
  sendJson(ws, { type: 'status', status: 'connecting', message: `Connecting to ${ip}:${port || 22} via ${authMethod}...` });

  const ssh = new SSHClient();

  ssh.on('ready', () => {
    clearTimeout(authTimeout);
    sendJson(ws, { type: 'status', status: 'connected', message: `Connected via ${authMethod}!` });
    ssh.shell({ term: 'xterm-256color', cols: 120, rows: 30 }, (err, stream) => {
      if (err) { sendJson(ws, { type: 'error', message: `Shell error: ${err.message}` }); ssh.end(); return; }
      onSuccess(ssh, stream);
      stream.on('data', (data) => { if (ws.readyState === 1) sendJson(ws, { type: 'output', data: data.toString('utf-8') }); });
      stream.stderr.on('data', (data) => { if (ws.readyState === 1) sendJson(ws, { type: 'output', data: data.toString('utf-8') }); });
      stream.on('close', () => { sendJson(ws, { type: 'status', status: 'disconnected', message: 'SSH session ended.' }); ws.close(); });
    });
  });

  ssh.on('error', (err) => {
    clearTimeout(authTimeout);
    if (hostKeyRejected) return; // já enviamos mensagem clara de host key alterada
    let friendlyMsg;
    if (err.message.includes('Authentication') || err.message.includes('auth')) {
      friendlyMsg = privateKeyData
        ? `Key authentication failed (${resolvedKeyFile}). Make sure the key is authorized on the server.`
        : 'Authentication failed — check username and password.';
    } else if (err.message.includes('ECONNREFUSED')) friendlyMsg = `Connection refused at ${ip}:${port || 22}`;
    else if (err.message.includes('ETIMEDOUT')) friendlyMsg = `Timeout connecting to ${ip}:${port || 22}`;
    else if (err.message.includes('Cannot parse')) friendlyMsg = `Could not read private key: invalid or corrupt format.`;
    else friendlyMsg = `SSH error: ${err.message}`;
    sendJson(ws, { type: 'error', message: friendlyMsg });
  });

  ssh.on('close', () => {
    if (ws.readyState === 1) sendJson(ws, { type: 'status', status: 'disconnected', message: 'SSH connection closed.' });
  });

  const connectConfig = {
    host: ip,
    port: parseInt(port, 10) || 22,
    username,
    readyTimeout: 10000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 6,
    algorithms: {
      serverHostKey: ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'rsa-sha2-256', 'rsa-sha2-512'],
    },
    // TOFU: aceita na 1ª conexão e memoriza; recusa se a host key mudar depois.
    hostVerifier: (keyBuf) => {
      const v = verifyHostKey(userId, hostKeyId, keyBuf);
      if (!v.ok) {
        hostKeyRejected = true;
        sendJson(ws, { type: 'error', message: `A chave do servidor ${hostKeyId} MUDOU desde o último acesso — possível ataque man-in-the-middle. Conexão recusada. Se a mudança for legítima, remova o host conhecido para reconfiar.` });
      }
      return v.ok;
    },
  };
  if (privateKeyData) { connectConfig.privateKey = privateKeyData; if (passphrase) connectConfig.passphrase = passphrase; }
  else connectConfig.password = password;

  ssh.connect(connectConfig);
}

function sendJson(ws, obj) {
  try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch { /* closing */ }
}

// ─── Sondas (probe): ping / traceroute / tail num canal exec separado ──────
const PROBE_MAX = 4;
// Monta o comando da sonda. Alvo/arquivo validados por regex p/ evitar injeção
// de shell (sem espaços nem metacaracteres).
function buildProbeCommand(mode, target) {
  const t = String(target || '').trim();
  if (mode === 'ping') {
    if (!/^[A-Za-z0-9][A-Za-z0-9.:_-]*$/.test(t)) return null;
    return `LC_ALL=C ping ${t}`;
  }
  if (mode === 'trace') {
    if (!/^[A-Za-z0-9][A-Za-z0-9.:_-]*$/.test(t)) return null;
    return `LC_ALL=C traceroute ${t} 2>&1 || LC_ALL=C tracepath ${t} 2>&1`;
  }
  if (mode === 'tail') {
    if (!/^[A-Za-z0-9._/-]+$/.test(t)) return null;
    return `tail -n 50 -F ${t} 2>&1`;
  }
  return null;
}

function startProbe(ws, sshClient, probes, msg) {
  const { id, mode, target } = msg || {};
  if (!id || probes.has(id)) return;
  if (probes.size >= PROBE_MAX) { sendJson(ws, { type: 'probe_error', id, mode, message: 'Limite de sondas simultâneas atingido.' }); return; }
  const cmd = buildProbeCommand(mode, target);
  if (!cmd) { sendJson(ws, { type: 'probe_error', id, mode, message: 'Alvo inválido.' }); return; }
  // pty:true garante flush por linha (ping/tail são contínuos) e mata o
  // processo remoto ao fechar o canal (SIGHUP no grupo de foreground).
  try {
    sshClient.exec(cmd, { pty: true }, (err, stream) => {
      if (err) { sendJson(ws, { type: 'probe_error', id, mode, message: err.message }); probes.delete(id); return; }
      probes.set(id, stream);
      stream.on('data', (d) => { if (ws.readyState === 1) sendJson(ws, { type: 'probe_output', id, mode, data: d.toString('utf-8') }); });
      if (stream.stderr) stream.stderr.on('data', (d) => { if (ws.readyState === 1) sendJson(ws, { type: 'probe_output', id, mode, data: d.toString('utf-8') }); });
      stream.on('close', () => { probes.delete(id); if (ws.readyState === 1) sendJson(ws, { type: 'probe_done', id, mode }); });
    });
  } catch (e) { sendJson(ws, { type: 'probe_error', id, mode, message: e.message }); }
}

function stopProbe(probes, id) {
  const stream = probes.get(id);
  if (!stream) return;
  try { stream.signal('KILL'); } catch {}
  try { stream.close(); } catch {}
  try { stream.end(); } catch {}
  probes.delete(id);
}

function stopAllProbes(probes) {
  for (const id of Array.from(probes.keys())) stopProbe(probes, id);
}

function cleanup(ws, sshClient, sshStream) {
  activeSessions.delete(ws);
  try { if (sshStream) sshStream.close(); } catch {}
  try { if (sshClient) sshClient.end(); } catch {}
}

// ─── SFTP: navegador de arquivos + transferências (scp/ftp-like) ───────────
const SFTP_CHUNK = 64 * 1024; // 64 KiB por chunk (com flow-control por ack)

function getSftp(sshClient, sftpState, cb) {
  if (sftpState.client) return cb(null, sftpState.client);
  try {
    sshClient.sftp((err, sftp) => {
      if (err) return cb(err);
      sftpState.client = sftp;
      cb(null, sftp);
    });
  } catch (e) { cb(e); }
}

function cleanupSftp(sftpState) {
  for (const x of sftpState.xfers.values()) {
    try { x.stream && x.stream.destroy && x.stream.destroy(); } catch {}
    try { x.stream && x.stream.close && x.stream.close(); } catch {}
  }
  sftpState.xfers.clear();
  try { sftpState.client && sftpState.client.end && sftpState.client.end(); } catch {}
  sftpState.client = null;
}

// Aspas seguras p/ um único argumento de shell (usado só no rm -rf recursivo).
function shQuote(p) { return `'${String(p).replace(/'/g, `'\\''`)}'`; }

function sftpErr(ws, reqId, message) { sendJson(ws, { type: 'sftp_error', reqId, message: String(message || 'erro SFTP') }); }
function sftpOk(ws, reqId, extra) { sendJson(ws, { type: 'sftp_ok', reqId, ...(extra || {}) }); }

function handleSftp(ws, sshClient, sftpState, msg) {
  const reqId = msg.reqId;
  // Transferências em andamento despacham direto (sem reabrir sftp).
  if (msg.type === 'sftp_get_ack') { const x = sftpState.xfers.get(reqId); if (!x) return; if (x.buf) sendBufChunk(ws, sftpState, reqId); else if (x.stream && x.stream.resume) x.stream.resume(); return; }
  if (msg.type === 'sftp_get_cancel') { const x = sftpState.xfers.get(reqId); if (x) { try { x.stream && x.stream.destroy(); } catch {} sftpState.xfers.delete(reqId); } return; }
  if (msg.type === 'sftp_put_chunk') { return sftpPutChunk(ws, sftpState, msg); }
  if (msg.type === 'sftp_put_end') { return sftpPutEnd(ws, sftpState, sshClient, msg); }
  if (msg.type === 'sftp_put_cancel') { sftpState.xfers.delete(reqId); return; }

  getSftp(sshClient, sftpState, (err, sftp) => {
    if (err) return sftpErr(ws, reqId, err.message);
    switch (msg.type) {
      case 'sftp_realpath':
        sftp.realpath(msg.path || '.', (e, abs) => e ? sftpErr(ws, reqId, e.message) : sftpOk(ws, reqId, { path: abs }));
        break;
      case 'sftp_list':
        sftp.realpath(msg.path || '.', (e1, abs) => {
          const dir = e1 ? (msg.path || '.') : abs;
          sftp.readdir(dir, (e, list) => {
            if (e) return sftpErr(ws, reqId, e.message);
            const entries = (list || []).map((it) => {
              const a = it.attrs || {};
              const mode = a.mode || 0;
              const type = (mode & 0o170000);
              return {
                name: it.filename,
                longname: it.longname || '',
                size: a.size || 0,
                mode,
                mtime: a.mtime || 0,
                uid: a.uid, gid: a.gid,
                isDir: type === 0o040000,
                isLink: type === 0o120000,
              };
            });
            sendJson(ws, { type: 'sftp_list_result', reqId, path: dir, entries });
          });
        });
        break;
      case 'sftp_stat':
        sftp.stat(msg.path, (e, st) => e ? sftpErr(ws, reqId, e.message) : sftpOk(ws, reqId, { stat: { size: st.size, mode: st.mode, mtime: st.mtime, uid: st.uid, gid: st.gid, isDir: st.isDirectory() } }));
        break;
      case 'sftp_mkdir':
        sftp.mkdir(msg.path, (e) => e ? sftpErr(ws, reqId, e.message) : sftpOk(ws, reqId));
        break;
      case 'sftp_rename':
        sftp.rename(msg.from, msg.to, (e) => e ? sftpErr(ws, reqId, e.message) : sftpOk(ws, reqId));
        break;
      case 'sftp_chmod': {
        const m = typeof msg.mode === 'string' ? parseInt(msg.mode, 8) : msg.mode;
        sftp.chmod(msg.path, m, (e) => e ? sftpErr(ws, reqId, e.message) : sftpOk(ws, reqId));
        break;
      }
      case 'sftp_delete':
        if (msg.recursive) {
          sshClient.exec(`rm -rf -- ${shQuote(msg.path)}`, (e, stream) => {
            if (e) return sftpErr(ws, reqId, e.message);
            let err = '';
            stream.stderr.on('data', (d) => { err += d.toString(); });
            stream.on('close', (code) => code === 0 ? sftpOk(ws, reqId) : sftpErr(ws, reqId, err || `rm saiu com código ${code}`));
          });
        } else if (msg.isDir) {
          sftp.rmdir(msg.path, (e) => e ? sftpErr(ws, reqId, e.message) : sftpOk(ws, reqId));
        } else {
          sftp.unlink(msg.path, (e) => e ? sftpErr(ws, reqId, e.message) : sftpOk(ws, reqId));
        }
        break;
      case 'sftp_get':
        sftpGet(ws, sftp, sftpState, sshClient, msg);
        break;
      case 'sftp_put_start':
        sftpPutStart(ws, sftp, sftpState, msg);
        break;
      default:
        sftpErr(ws, reqId, `op SFTP desconhecida: ${msg.type}`);
    }
  });
}

const SUDO_MAX = 8 * 1024 * 1024; // limite p/ fallback via sudo (linha de comando)
const isPermErr = (e) => /permission denied|EACCES|no such|denied|not permitted|failure/i.test(String((e && e.message) || e || ''));

// Envia o próximo pedaço de um buffer em memória (modo sudo/fallback do download).
function sendBufChunk(ws, sftpState, reqId) {
  const x = sftpState.xfers.get(reqId);
  if (!x || !x.buf) return;
  if (x.pos >= x.buf.length) { sftpState.xfers.delete(reqId); sendJson(ws, { type: 'sftp_get_eof', reqId }); return; }
  const slice = x.buf.subarray(x.pos, x.pos + SFTP_CHUNK);
  x.pos += slice.length;
  sendJson(ws, { type: 'sftp_get_chunk', reqId, seq: x.seq++, data: slice.toString('base64') });
}

// Fallback de leitura via shell com sudo -n (quando o SFTP não tem permissão,
// ex.: usuário fez `sudo su -` mas o SFTP roda como o usuário de login).
function sudoRead(ws, sshClient, sftpState, msg) {
  const reqId = msg.reqId;
  const cmd = `sudo -n cat -- ${shQuote(msg.path)} | base64`;
  try {
    sshClient.exec(cmd, (e, stream) => {
      if (e) return sftpErr(ws, reqId, e.message);
      let out = ''; let err = '';
      stream.on('data', (d) => { out += d.toString(); });
      stream.stderr.on('data', (d) => { err += d.toString(); });
      stream.on('close', (code) => {
        if (code !== 0) return sftpErr(ws, reqId, (err.trim() || 'Permissão negada.') + ' (tentei sudo -n; configure sudo sem senha ou edite via shell)');
        let buf; try { buf = Buffer.from(out.replace(/\s+/g, ''), 'base64'); } catch { return sftpErr(ws, reqId, 'Falha ao decodificar conteúdo.'); }
        sftpState.xfers.set(reqId, { type: 'get', buf, pos: 0, seq: 0 });
        sendJson(ws, { type: 'sftp_get_meta', reqId, size: buf.length, mode: 0, sudo: true });
        sendBufChunk(ws, sftpState, reqId);
      });
    });
  } catch (e2) { sftpErr(ws, reqId, e2.message); }
}

// Download remoto → cliente. Testa permissão via sftp.open; se negar, cai p/ sudo.
function sftpGet(ws, sftp, sftpState, sshClient, msg) {
  const reqId = msg.reqId;
  sftp.open(msg.path, 'r', (err, handle) => {
    if (err) return sudoRead(ws, sshClient, sftpState, msg); // provável permissão → sudo
    sftp.fstat(handle, (e2, st) => {
      if (e2) { try { sftp.close(handle, () => {}); } catch {} return sudoRead(ws, sshClient, sftpState, msg); }
      if (st.isDirectory()) { try { sftp.close(handle, () => {}); } catch {} return sftpErr(ws, reqId, 'É um diretório (não é possível baixar diretamente).'); }
      sftp.close(handle, () => {
        sendJson(ws, { type: 'sftp_get_meta', reqId, size: st.size, mode: st.mode });
        let stream;
        try { stream = sftp.createReadStream(msg.path, { highWaterMark: SFTP_CHUNK }); }
        catch (e3) { return sftpErr(ws, reqId, e3.message); }
        sftpState.xfers.set(reqId, { type: 'get', stream });
        let seq = 0;
        stream.on('data', (chunk) => { stream.pause(); sendJson(ws, { type: 'sftp_get_chunk', reqId, seq: seq++, data: chunk.toString('base64') }); });
        stream.on('error', (e4) => { sftpState.xfers.delete(reqId); sftpErr(ws, reqId, e4.message); });
        stream.on('end', () => { sftpState.xfers.delete(reqId); sendJson(ws, { type: 'sftp_get_eof', reqId }); });
      });
    });
  });
}

// Upload cliente → remoto: acumula chunks e grava de forma ATÔMICA no fim
// (writeFile). Acks imediatos por chunk (não dependem de callback de stream,
// que travava em algumas versões do ssh2).
// Teto absoluto por upload (defesa contra exaustão de disco/DoS).
const MAX_UPLOAD = 5 * 1024 * 1024 * 1024; // 5 GiB

// Estratégia: acumula em memória só até SUDO_MAX (para permitir o fallback via
// sudo em arquivos pequenos protegidos). Se o upload passar desse limite, muda
// para STREAMING direto ao SFTP (com backpressure) — assim a RAM do backend fica
// limitada a ~SUDO_MAX independentemente do tamanho do arquivo.
function sftpPutStart(ws, sftp, sftpState, msg) {
  const reqId = msg.reqId;
  sftpState.xfers.set(reqId, { type: 'put', chunks: [], written: 0, path: msg.path, stream: null, streaming: false, errored: false });
  sendJson(ws, { type: 'sftp_put_ack', reqId, seq: 0 }); // pede o 1º chunk
}
function sftpPutChunk(ws, sftpState, msg) {
  const reqId = msg.reqId;
  const x = sftpState.xfers.get(reqId);
  if (!x || x.type !== 'put' || x.errored) return;
  const buf = Buffer.from(msg.data || '', 'base64');
  x.written += buf.length;
  if (x.written > MAX_UPLOAD) {
    x.errored = true; try { x.stream && x.stream.destroy(); } catch {}
    sftpState.xfers.delete(reqId);
    return sftpErr(ws, reqId, 'Upload excede o tamanho máximo permitido.');
  }
  // transborda o buffer → passa a fazer streaming direto
  if (!x.streaming && x.written > SUDO_MAX) {
    try { x.stream = sftpState.client.createWriteStream(x.path); }
    catch (e) { x.errored = true; sftpState.xfers.delete(reqId); return sftpErr(ws, reqId, e.message); }
    x.stream.on('error', (err) => { if (x.errored) return; x.errored = true; sftpState.xfers.delete(reqId); sftpErr(ws, reqId, err.message); });
    x.streaming = true;
    for (const b of x.chunks) x.stream.write(b); // libera o que já estava em buffer
    x.chunks = null;
  }
  const ackSeq = (msg.seq || 0) + 1;
  if (x.streaming) {
    const ok = x.stream.write(buf);
    if (ok) sendJson(ws, { type: 'sftp_put_ack', reqId, seq: ackSeq, written: x.written });
    else x.stream.once('drain', () => { if (!x.errored) sendJson(ws, { type: 'sftp_put_ack', reqId, seq: ackSeq, written: x.written }); });
  } else {
    x.chunks.push(buf);
    sendJson(ws, { type: 'sftp_put_ack', reqId, seq: ackSeq, written: x.written });
  }
}
function sftpPutEnd(ws, sftpState, sshClient, msg) {
  const reqId = msg.reqId;
  const x = sftpState.xfers.get(reqId);
  if (!x || x.type !== 'put') return sftpErr(ws, reqId, 'upload não iniciado');
  if (x.errored) return;
  // Caminho streaming (arquivo grande): fecha o stream e confirma.
  if (x.streaming) {
    x.stream.end(() => { if (x.errored) return; sftpState.xfers.delete(reqId); sendJson(ws, { type: 'sftp_put_done', reqId, written: x.written }); });
    return;
  }
  // Caminho buffered (<= SUDO_MAX): grava atômico + fallback via sudo se sem permissão.
  const data = Buffer.concat(x.chunks);
  const finish = () => { sftpState.xfers.delete(reqId); sendJson(ws, { type: 'sftp_put_done', reqId, written: data.length }); };
  sftpState.client.writeFile(x.path, data, (err) => {
    if (!err) return finish();
    if (isPermErr(err) && data.length <= SUDO_MAX) return sudoWrite(ws, sshClient, sftpState, reqId, x.path, data);
    sftpState.xfers.delete(reqId); sftpErr(ws, reqId, err.message);
  });
}
// Fallback de escrita via shell: base64 → sudo -n tee.
function sudoWrite(ws, sshClient, sftpState, reqId, p, data) {
  const b64 = data.toString('base64');
  const cmd = `printf %s ${shQuote(b64)} | base64 -d | sudo -n tee -- ${shQuote(p)} > /dev/null`;
  try {
    sshClient.exec(cmd, (e, stream) => {
      if (e) { sftpState.xfers.delete(reqId); return sftpErr(ws, reqId, e.message); }
      let err = '';
      stream.stderr.on('data', (d) => { err += d.toString(); });
      stream.on('close', (code) => {
        sftpState.xfers.delete(reqId);
        if (code === 0) sendJson(ws, { type: 'sftp_put_done', reqId, written: data.length });
        else sftpErr(ws, reqId, (err.trim() || 'Permissão negada.') + ' (tentei sudo -n; configure sudo sem senha)');
      });
    });
  } catch (e2) { sftpState.xfers.delete(reqId); sftpErr(ws, reqId, e2.message); }
}

// ─── Fetch via SSH: busca uma URL DE DENTRO do host remoto (curl) ──────────
// Body vai em base64 no stdout; cabeçalhos no stderr (-D /dev/stderr).
async function handleHttpFetch(ws, sshClient, msg) {
  const reqId = msg.reqId;
  let url;
  try { url = await assertPublicUrl(msg.url); }
  catch (e) { return sendJson(ws, { type: 'http_fetch_result', reqId, ok: false, error: e.message || 'URL inválida.' }); }
  const q = shQuote(url);
  const cmd = `curl -sSL --max-time 25 -A 'Mozilla/5.0 (X11; Linux x86_64) TNG-Browser' -D /dev/stderr ${q} | base64 | tr -d '\\n'`;
  try {
    sshClient.exec(cmd, (err, stream) => {
      if (err) return sendJson(ws, { type: 'http_fetch_result', reqId, ok: false, error: err.message });
      let body = ''; let hdr = ''; let over = false;
      stream.on('data', (d) => { body += d.toString(); if (body.length > 20 * 1024 * 1024 && !over) { over = true; try { stream.close(); } catch {} } });
      stream.stderr.on('data', (d) => { hdr += d.toString(); });
      stream.on('close', () => {
        if (!body && /command not found|not found/i.test(hdr) && /curl/i.test(hdr + cmd)) {
          return sendJson(ws, { type: 'http_fetch_result', reqId, ok: false, error: 'curl não encontrado no host remoto (instale curl).' });
        }
        const statuses = [...hdr.matchAll(/HTTP\/[\d.]+\s+(\d{3})/g)];
        const status = statuses.length ? Number(statuses[statuses.length - 1][1]) : 0;
        const ctm = [...hdr.matchAll(/content-type:\s*([^\r\n]+)/gi)];
        const contentType = ctm.length ? ctm[ctm.length - 1][1].trim() : '';
        if (!body) return sendJson(ws, { type: 'http_fetch_result', reqId, ok: false, error: hdr.split('\n').find((l) => /curl:/i.test(l)) || 'Sem resposta do host remoto.' });
        sendJson(ws, { type: 'http_fetch_result', reqId, ok: true, status, contentType, bodyB64: body, finalUrl: url });
      });
    });
  } catch (e) { sendJson(ws, { type: 'http_fetch_result', reqId, ok: false, error: e.message }); }
}

// ─── Exec em segundo plano: roda um comando num canal SEPARADO (não toca a
//     shell interativa) e devolve a saída. Usado pelo Health check. ──────────
function handleBgExec(ws, sshClient, msg) {
  const reqId = msg.reqId;
  const cmd = String(msg.command || '');
  if (!cmd) return sendJson(ws, { type: 'bg_exec_result', reqId, ok: false, error: 'comando vazio' });
  try {
    sshClient.exec(cmd, (err, stream) => {
      if (err) return sendJson(ws, { type: 'bg_exec_result', reqId, ok: false, error: err.message });
      let out = ''; let over = false;
      const cap = (d) => { out += d.toString('utf-8'); if (out.length > 4 * 1024 * 1024 && !over) { over = true; try { stream.close(); } catch {} } };
      stream.on('data', cap);
      if (stream.stderr) stream.stderr.on('data', cap);
      stream.on('close', (code) => sendJson(ws, { type: 'bg_exec_result', reqId, ok: true, output: out, code }));
    });
  } catch (e) { sendJson(ws, { type: 'bg_exec_result', reqId, ok: false, error: e.message }); }
}

// ─── Listening services + system stats bar ────────────────────────────────
// Service names come from the REMOTE host's /etc/services (fetched once per
// connection and cached on the ssh client object).
function parseEtcServices(txt) {
  const map = {};
  for (const raw of String(txt || '').split('\n')) {
    const l = raw.replace(/#.*$/, '').trim();
    if (!l) continue;
    const parts = l.split(/\s+/);
    const name = parts[0];
    const m = (parts[1] || '').match(/^(\d+)\/(tcp|udp)$/i);
    if (name && m) map[`${m[1]}/${m[2].toLowerCase()}`] = name;
  }
  return map;
}

function readRemoteServices(sshClient, cb) {
  if (sshClient._svcMap) return cb(sshClient._svcMap);
  try {
    sshClient.exec('cat /etc/services 2>/dev/null', (err, stream) => {
      if (err) { sshClient._svcMap = {}; return cb(sshClient._svcMap); }
      let out = '';
      stream.on('data', (d) => { out += d.toString(); });
      stream.stderr.on('data', () => {});
      stream.on('close', () => { sshClient._svcMap = parseEtcServices(out); cb(sshClient._svcMap); });
    });
  } catch { sshClient._svcMap = {}; cb(sshClient._svcMap); }
}

function parseListening(text, svcMap) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split(/\s+/);
    if (!/^(tcp|udp)/i.test(cols[0])) continue;
    const proto = cols[0].toLowerCase().replace(/6$/, '');
    let port = null, proc = null;
    if (line.includes('users:((')) {
      const local = cols[4] || '';
      const mp = local.match(/:(\d+)$/);
      port = mp ? mp[1] : null;
      const mproc = line.match(/users:\(\("([^"]+)"/);
      proc = mproc ? mproc[1] : null;
    } else {
      const local = cols[3] || '';
      const mp = local.match(/:(\d+)$/);
      port = mp ? mp[1] : null;
      const last = cols[cols.length - 1] || '';
      const mproc = last.match(/\/([^/]+)$/);
      proc = mproc ? mproc[1] : null;
    }
    if (!port) continue;
    const key = `${proto}/${port}/${proc || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ proto, port: parseInt(port, 10), process: proc || null, service: (svcMap && svcMap[`${port}/${proto}`]) || null });
  }
  return out.sort((a, b) => a.port - b.port);
}

// CPU% computed from the delta of two /proc/stat readings (kept per connection).
function computeCpu(sshClient, statLine) {
  const m = String(statLine || '').match(/^cpu\s+(.+)$/m);
  if (!m) return null;
  const v = m[1].trim().split(/\s+/).map(Number);
  const total = v.reduce((a, b) => a + (b || 0), 0);
  const idle = (v[3] || 0) + (v[4] || 0); // idle + iowait
  const prev = sshClient._cpuPrev;
  sshClient._cpuPrev = { total, idle };
  if (!prev) return null; // need two samples
  const dt = total - prev.total;
  const di = idle - prev.idle;
  if (dt <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100)));
}

// Parse `who` output → list of logged-in sessions.
function parseWho(txt) {
  const out = [];
  for (const raw of String(txt || '').split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    const c = l.split(/\s+/);
    if (!c[0]) continue;
    const from = (l.match(/\(([^)]+)\)/) || [])[1] || '';
    out.push({ user: c[0], tty: c[1] || '', since: `${c[2] || ''} ${c[3] || ''}`.trim(), from });
  }
  return out;
}

function computeMem(meminfo) {
  const get = (k) => { const m = String(meminfo).match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')); return m ? parseInt(m[1], 10) : null; };
  const total = get('MemTotal');
  let avail = get('MemAvailable');
  if (total == null) return null;
  if (avail == null) { const free = get('MemFree') || 0, buf = get('Buffers') || 0, cache = get('Cached') || 0; avail = free + buf + cache; }
  const usedKb = total - avail;
  return { pct: Math.round((usedKb / total) * 100), usedMb: Math.round(usedKb / 1024), totalMb: Math.round(total / 1024) };
}

function collectStatus(sshClient, cb) {
  let done = false;
  const finish = (status) => { if (!done) { done = true; cb(status); } };
  const timer = setTimeout(() => finish({ list: [], cpu: null, mem: null }), 8000);
  readRemoteServices(sshClient, (svcMap) => {
    const cmd = "grep '^cpu ' /proc/stat 2>/dev/null; echo __MEM__; cat /proc/meminfo 2>/dev/null; echo __NET__; (ss -H -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null); echo __WHO__; who 2>/dev/null";
    try {
      sshClient.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timer); return finish({ list: [], cpu: null, mem: null }); }
        let out = '';
        stream.on('data', (d) => { out += d.toString(); });
        stream.stderr.on('data', () => {});
        stream.on('close', () => {
          clearTimeout(timer);
          const [cpuPart, rest1 = ''] = out.split('__MEM__');
          const [memPart, rest2 = ''] = rest1.split('__NET__');
          const [netPart = '', whoPart = ''] = rest2.split('__WHO__');
          finish({
            list: parseListening(netPart, svcMap),
            cpu: computeCpu(sshClient, cpuPart),
            mem: computeMem(memPart),
            users: parseWho(whoPart),
          });
        });
      });
    } catch { clearTimeout(timer); finish({ list: [], cpu: null, mem: null }); }
  });
}

// ─── Full system dashboard (one exec, marker-split) ───────────────────────
const SYSINFO_CMD = [
  'echo __HOST__', 'hostname 2>/dev/null; uname -rsmo 2>/dev/null; cat /etc/os-release 2>/dev/null | grep -E "^PRETTY_NAME="',
  'echo __UPTIME__', 'cat /proc/uptime 2>/dev/null; cat /proc/loadavg 2>/dev/null; nproc 2>/dev/null',
  'echo __CPU__', 'LC_ALL=C lscpu 2>/dev/null | grep -E "Model name|^CPU\\(s\\)|Socket|Thread|Core|MHz|Architecture"',
  'echo __CPUSTAT__', "grep '^cpu ' /proc/stat 2>/dev/null",
  'echo __MEM__', 'cat /proc/meminfo 2>/dev/null',
  'echo __DISK__', 'LC_ALL=C df -PB1 -x tmpfs -x devtmpfs -x squashfs 2>/dev/null',
  'echo __PROC__', 'LC_ALL=C ps -eo pid,comm,pcpu,pmem,user --sort=-pcpu 2>/dev/null | head -n 11',
  'echo __PCOUNT__', 'ps -e --no-headers 2>/dev/null | wc -l',
  'echo __USERS__', 'who 2>/dev/null',
  'echo __LAST__', 'LC_ALL=C last -w -n 12 2>/dev/null | grep -vE "^(reboot|wtmp|$)" | head -n 10',
  'echo __NET__', 'ip -o -4 addr show 2>/dev/null | awk \'{print $2" "$4}\'',
  'echo __LOG__', '(journalctl -p err -n 20 --no-pager -o short-iso 2>/dev/null) || (tail -n 20 /var/log/syslog 2>/dev/null) || (tail -n 20 /var/log/messages 2>/dev/null)',
  'echo __END__',
].join('; ');

function section(out, name) {
  const re = new RegExp(`__${name}__\\n([\\s\\S]*?)(?:__[A-Z]+__|$)`);
  const m = out.match(re);
  return m ? m[1].trim() : '';
}

function parseSysinfo(out) {
  const host = section(out, 'HOST');
  const hostLines = host.split('\n').map((l) => l.trim()).filter(Boolean);
  const pretty = (hostLines.find((l) => l.startsWith('PRETTY_NAME=')) || '').replace(/^PRETTY_NAME=/, '').replace(/"/g, '');
  const hostname = hostLines[0] || '';
  const kernel = hostLines[1] || '';

  const up = section(out, 'UPTIME').split('\n');
  const uptimeSec = parseFloat((up[0] || '').split(/\s+/)[0]) || null;
  const loadParts = (up[1] || '').split(/\s+/);
  const load = loadParts.length >= 3 ? [parseFloat(loadParts[0]), parseFloat(loadParts[1]), parseFloat(loadParts[2])] : null;
  const cores = parseInt((up[2] || '').trim(), 10) || null;

  const cpuTxt = section(out, 'CPU');
  const cpuModel = (cpuTxt.match(/Model name:\s*(.+)/) || [])[1] || '';
  const arch = (cpuTxt.match(/Architecture:\s*(.+)/) || [])[1] || '';

  // instantaneous CPU usage from a single /proc/stat read (idle ratio)
  let cpuPct = null;
  const cm = section(out, 'CPUSTAT').match(/^cpu\s+(.+)/m);
  if (cm) {
    const v = cm[1].trim().split(/\s+/).map(Number);
    const total = v.reduce((a, b) => a + (b || 0), 0);
    const idle = (v[3] || 0) + (v[4] || 0);
    if (total > 0) cpuPct = Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)));
  }
  // prefer load-based pressure if we have cores
  const loadPct = load && cores ? Math.min(100, Math.round((load[0] / cores) * 100)) : null;

  const memTxt = section(out, 'MEM');
  const mem = computeMem(memTxt);
  const getKb = (k) => { const m = memTxt.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')); return m ? parseInt(m[1], 10) : null; };
  const swapTotal = getKb('SwapTotal'); const swapFree = getKb('SwapFree');
  const swap = swapTotal ? { totalMb: Math.round(swapTotal / 1024), usedMb: Math.round((swapTotal - (swapFree || 0)) / 1024), pct: swapTotal ? Math.round(((swapTotal - (swapFree || 0)) / swapTotal) * 100) : 0 } : null;

  const disks = [];
  for (const line of section(out, 'DISK').split('\n')) {
    const c = line.trim().split(/\s+/);
    if (c.length < 6 || c[0] === 'Filesystem' || !/^\d+$/.test(c[1])) continue;
    const size = parseInt(c[1], 10), used = parseInt(c[2], 10), avail = parseInt(c[3], 10);
    disks.push({ fs: c[0], sizeB: size, usedB: used, availB: avail, pct: parseInt(c[4], 10) || (size ? Math.round((used / size) * 100) : 0), mount: c.slice(5).join(' ') });
  }

  const procs = [];
  const pl = section(out, 'PROC').split('\n');
  for (let i = 1; i < pl.length; i++) {
    const c = pl[i].trim().split(/\s+/);
    if (c.length < 5) continue;
    procs.push({ pid: c[0], name: c[1], cpu: parseFloat(c[2]) || 0, mem: parseFloat(c[3]) || 0, user: c[4] });
  }
  const procCount = parseInt(section(out, 'PCOUNT').trim(), 10) || null;

  const users = section(out, 'USERS').split('\n').filter(Boolean).map((l) => {
    const c = l.split(/\s+/);
    return { user: c[0], tty: c[1], from: (l.match(/\(([^)]+)\)/) || [])[1] || '', since: `${c[2] || ''} ${c[3] || ''}`.trim() };
  });

  // Últimos logins (last): "user tty from ... Mon Day HH:MM - HH:MM (dur)"
  const lastUsers = section(out, 'LAST').split('\n').filter(Boolean).map((l) => {
    const c = l.trim().split(/\s+/);
    if (c.length < 3) return null;
    const user = c[0]; const tty = c[1];
    const looksIp = /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(c[2]) || c[2].includes(':') || /^[a-z0-9.-]+$/i.test(c[2]);
    const from = looksIp ? c[2] : '';
    const rest = l.replace(/\s+-\s+.*$/, '');
    const when = (rest.match(/(\w{3}\s+\d+\s+[\d:]+)/) || [])[1] || (rest.match(/(\w{3}\s+\d+.*)$/) || [])[1] || '';
    const still = /still logged in|still running/i.test(l);
    return { user, tty, from, when, still };
  }).filter(Boolean).slice(0, 10);

  const nets = section(out, 'NET').split('\n').filter(Boolean).map((l) => { const c = l.split(/\s+/); return { iface: c[0], addr: c[1] }; }).filter((n) => n.iface && n.iface !== 'lo');

  const logs = section(out, 'LOG').split('\n').filter(Boolean).slice(-20).map((l) => {
    const sev = /\b(error|fail|fatal|critical|denied|refused|panic)\b/i.test(l) ? 'error' : /\b(warn|warning)\b/i.test(l) ? 'warn' : 'info';
    return { sev, text: l };
  });

  return { hostname, kernel, os: pretty, arch, uptimeSec, load, cores, cpuModel, cpuPct, loadPct, mem, swap, disks, procs, procCount, users, lastUsers, nets, logs };
}

function collectSysinfo(sshClient, cb) {
  let done = false;
  const finish = (data) => { if (!done) { done = true; cb(data); } };
  const timer = setTimeout(() => finish(null), 12000);
  try {
    sshClient.exec(SYSINFO_CMD, (err, stream) => {
      if (err) { clearTimeout(timer); return finish(null); }
      let out = '';
      stream.on('data', (d) => { out += d.toString(); if (out.length > 800000) out = out.slice(0, 800000); });
      stream.stderr.on('data', () => {});
      stream.on('close', () => { clearTimeout(timer); try { finish(parseSysinfo(out)); } catch { finish(null); } });
    });
  } catch { clearTimeout(timer); finish(null); }
}

const HELPER_COMMANDS = {
  'postfix-defaults': 'postconf -d 2>/dev/null',
  'postfix-current': 'postconf -n 2>/dev/null',
  'sshd-effective': 'sshd -T 2>/dev/null || /usr/sbin/sshd -T 2>/dev/null',
  'apache-settings': 'apachectl -S 2>/dev/null || apache2ctl -S 2>/dev/null',
};
function runHelper(sshClient, key, cb) {
  const cmd = HELPER_COMMANDS[key];
  if (!cmd) { cb(''); return; }
  let done = false;
  const finish = (out) => { if (!done) { done = true; cb(out); } };
  const timer = setTimeout(() => finish(''), 8000);
  try {
    sshClient.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); return finish(''); }
      let out = '';
      stream.on('data', (d) => { out += d.toString(); if (out.length > 500000) out = out.slice(0, 500000); });
      stream.stderr.on('data', () => {});
      stream.on('close', () => { clearTimeout(timer); finish(out); });
    });
  } catch { clearTimeout(timer); finish(''); }
}
