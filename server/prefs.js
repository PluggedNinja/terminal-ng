/**
 * prefs.js — per-user preferences (terminal appearance, etc.).
 * Stored in server/data/prefs.json keyed by user id. Arbitrary JSON blob.
 */
import express from 'express';
import { readTable, writeTable } from './store.js';

export function prefsRouter(requireAuthMw) {
  const r = express.Router();
  r.use(requireAuthMw);

  r.get('/', (req, res) => {
    const all = readTable('prefs', {});
    res.json(all[req.user.id] || {});
  });

  r.put('/', (req, res) => {
    const all = readTable('prefs', {});
    const cur = all[req.user.id] || {};
    all[req.user.id] = { ...cur, ...(req.body || {}) };
    writeTable('prefs', all);
    res.json(all[req.user.id]);
  });

  return r;
}
