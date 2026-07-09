/**
 * store.js — tiny JSON file persistence (no external DB).
 * Each "table" is a JSON file under server/data/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Normal Node run → data in server/data/. Packaged SEA exe (import.meta.url
// empty) → data in a stable per-user folder (%APPDATA%/terminal-ng or ~), so it
// survives rebuilds and isn't wiped with the build/ folder.
let DATA_DIR;
try {
  DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
} catch {
  const home = process.env.TNG_DATA_DIR || process.env.APPDATA || process.env.HOME || process.env.USERPROFILE || process.cwd();
  DATA_DIR = path.join(home, 'terminal-ng', 'data');
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export function readTable(name, fallback = []) {
  const file = path.join(DATA_DIR, `${name}.json`);
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeTable(name, data) {
  const file = path.join(DATA_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
