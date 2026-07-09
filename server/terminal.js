/**
 * terminal.js — HTTP endpoints supporting the SSH terminal window:
 *  GET    /api/terminal/scripts       — list scripts (global + user)
 *  POST   /api/terminal/scripts       — create { name, description, code, scope }
 *  DELETE /api/terminal/scripts/:id   — delete (owner, or global)
 *  POST   /api/terminal/session-log   — save the full SSH session log
 */
import express from 'express';
import { listForUser, createScript, removeScript, saveSessionLog } from './terminalScripts.js';

export function terminalRouter(requireAuthMw) {
  const r = express.Router();
  r.use(requireAuthMw);

  r.get('/scripts', (req, res) => {
    try { res.json({ success: true, scripts: listForUser(req.user.id) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  r.post('/scripts', (req, res) => {
    try {
      const { name, description, code, scope } = req.body || {};
      const script = createScript({ name, description, code, scope, userId: req.user.id, userName: req.user.username });
      res.json({ success: true, script });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  r.delete('/scripts/:id', (req, res) => {
    try {
      const result = removeScript(req.params.id, req.user);
      if (!result.ok) return res.status(403).json({ success: false, error: result.error });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  r.post('/session-log', (req, res) => {
    try {
      const { host, ip, startedAt, endedAt, content } = req.body || {};
      const username = (req.body && req.body.username) || 'ssh';
      if (!content || !String(content).trim()) return res.status(400).json({ success: false, error: 'Empty session — nothing to save.' });
      const data = saveSessionLog({ appUser: req.user.username, username, host, ip, startedAt, endedAt, content });
      res.json({ success: true, data });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  return r;
}
