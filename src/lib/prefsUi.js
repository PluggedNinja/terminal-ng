/**
 * prefsUi.js — preferências de UI (sons, música, animações) persistidas em
 * localStorage e aplicadas globalmente. Usado pelo App, Login e Settings.
 */
const get = (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch { return def; } };
const setLS = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// ── flags ──
export function sfxEnabled()   { return get('tng_sfx', '1') !== '0'; }
export function musicEnabled() { return get('tng_music', '1') !== '0'; }
export function animEnabled()  { return get('tng_anim', '1') !== '0'; }
export function musicTrack()   { return get('tng_music_track', 'synthwave'); }

export function setSfxEnabled(v)   { setLS('tng_sfx', v ? '1' : '0'); }
export function setMusicEnabled(v) { setLS('tng_music', v ? '1' : '0'); }
export function setAnimEnabled(v)  { setLS('tng_anim', v ? '1' : '0'); }
export function setMusicTrack(id)  { setLS('tng_music_track', id); }

// ── aplicação ──
// anima/desanima a UI inteira (CSS em index.css usa html[data-noanim="1"]).
export function applyAnim(on) {
  try { document.documentElement.dataset.noanim = on ? '' : '1'; } catch {}
}

// ── Parsers/helpers ligados/desligados (conjunto de "desligados") ──
export function parsersOff() { try { return new Set(JSON.parse(localStorage.getItem('tng_parsers_off') || '[]')); } catch { return new Set(); } }
export function isParserOff(kind) { return parsersOff().has(kind); }
export function setParserOff(kind, off) {
  const s = parsersOff();
  if (off) s.add(kind); else s.delete(kind);
  try { localStorage.setItem('tng_parsers_off', JSON.stringify([...s])); } catch {}
  try { window.dispatchEvent(new Event('tng:parsers')); } catch {}
}
export function errorHintsOn() { return get('tng_error_hints', '0') === '1'; }
export function setErrorHintsOn(v) { setLS('tng_error_hints', v ? '1' : '0'); }
