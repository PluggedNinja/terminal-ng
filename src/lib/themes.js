/**
 * themes.js — 20 themes for TERMINAL//NG (cyberpunk + clássicos de editor + 1 claro).
 * Each theme overrides the CSS variables defined in index.css. applyTheme sets
 * them inline on :root (wins over the stylesheet defaults). `light: true` marca
 * temas de fundo claro (a UI adapta sombras/realces).
 */
export const THEMES = [
  { id: 'neon',     name: 'Neon Grid',     primary: '#00f0ff', secondary: '#ff2bd6', accent: '#b6ff00', danger: '#ff3860', warn: '#ffb000', bg0: '#04050c', bg1: '#070a16', bg2: '#0b1020', text: '#d7e6f5', dim: '#6f8398' },
  { id: 'synthwave',name: 'Synthwave',     primary: '#ff39c0', secondary: '#9d5cff', accent: '#ffcc44', danger: '#ff4d6d', warn: '#ff9e3d', bg0: '#120524', bg1: '#1a082e', bg2: '#241046', text: '#ffe3fb', dim: '#a98fc8' },
  { id: 'matrix',   name: 'Matrix',        primary: '#00ff66', secondary: '#13b34d', accent: '#aaff88', danger: '#ff5555', warn: '#d4ff00', bg0: '#000600', bg1: '#001100', bg2: '#03210a', text: '#bfffce', dim: '#5f9f70' },
  { id: 'amber',    name: 'Amber CRT',     primary: '#ffb000', secondary: '#ff7b00', accent: '#ffd480', danger: '#ff5a3c', warn: '#ffd400', bg0: '#120c00', bg1: '#1a1100', bg2: '#241a05', text: '#ffdca0', dim: '#b08a52' },
  { id: 'blood',    name: 'Blood Dragon',  primary: '#ff2b4e', secondary: '#ff5ec7', accent: '#ffd400', danger: '#ff2b4e', warn: '#ff8a00', bg0: '#120206', bg1: '#1a0408', bg2: '#260a12', text: '#ffd9df', dim: '#b07484' },
  { id: 'ice',      name: 'Ice',           primary: '#79e2ff', secondary: '#4aa8ff', accent: '#d8f6ff', danger: '#ff6b8a', warn: '#ffd166', bg0: '#050b16', bg1: '#08111f', bg2: '#0d1b2e', text: '#e2f4ff', dim: '#7c97ad' },
  { id: 'vapor',    name: 'Vaporwave',     primary: '#ff8ad8', secondary: '#8affe6', accent: '#b18cff', danger: '#ff5d8f', warn: '#ffd56b', bg0: '#140a22', bg1: '#1b0e2e', bg2: '#271544', text: '#fbe6ff', dim: '#a98fc0' },
  { id: 'hacker',   name: 'Hacker',        primary: '#39ff14', secondary: '#00d4ff', accent: '#ccff00', danger: '#ff3b3b', warn: '#ffe23b', bg0: '#040804', bg1: '#060d06', bg2: '#0a160a', text: '#cdfac8', dim: '#6aa05f' },
  { id: 'solar',    name: 'Solar Flare',   primary: '#ff7a18', secondary: '#ffd400', accent: '#ff3d00', danger: '#ff2d2d', warn: '#ffb000', bg0: '#150a02', bg1: '#1d0f02', bg2: '#2a1705', text: '#ffe7c2', dim: '#bb8a55' },
  { id: 'ocean',    name: 'Deep Ocean',    primary: '#00d4c8', secondary: '#1f8fff', accent: '#7af7e0', danger: '#ff5d73', warn: '#ffc857', bg0: '#03101a', bg1: '#051724', bg2: '#082234', text: '#d6f2f5', dim: '#6f95a3' },
  // ── novos ──
  { id: 'dracula',  name: 'Dracula',       primary: '#bd93f9', secondary: '#ff79c6', accent: '#50fa7b', danger: '#ff5555', warn: '#ffb86c', bg0: '#1a1b26', bg1: '#21222c', bg2: '#282a36', text: '#f8f8f2', dim: '#6272a4' },
  { id: 'nord',     name: 'Nord',          primary: '#88c0d0', secondary: '#81a1c1', accent: '#a3be8c', danger: '#bf616a', warn: '#ebcb8b', bg0: '#242933', bg1: '#2e3440', bg2: '#3b4252', text: '#eceff4', dim: '#7b88a1' },
  { id: 'gruvbox',  name: 'Gruvbox',       primary: '#fabd2f', secondary: '#fe8019', accent: '#b8bb26', danger: '#fb4934', warn: '#fabd2f', bg0: '#1d2021', bg1: '#282828', bg2: '#32302f', text: '#ebdbb2', dim: '#928374' },
  { id: 'tokyo',    name: 'Tokyo Night',   primary: '#7aa2f7', secondary: '#bb9af7', accent: '#7dcfff', danger: '#f7768e', warn: '#e0af68', bg0: '#16161e', bg1: '#1a1b26', bg2: '#1f2335', text: '#c0caf5', dim: '#565f89' },
  { id: 'monokai',  name: 'Monokai',       primary: '#66d9ef', secondary: '#f92672', accent: '#a6e22e', danger: '#f92672', warn: '#fd971f', bg0: '#1e1f1c', bg1: '#272822', bg2: '#2d2e2a', text: '#f8f8f2', dim: '#88846f' },
  { id: 'crimson',  name: 'Crimson Night', primary: '#ff4365', secondary: '#ff7597', accent: '#ffd23f', danger: '#ff2e63', warn: '#ff9f1c', bg0: '#0e0a0d', bg1: '#150e13', bg2: '#1f141b', text: '#ffe0e6', dim: '#a37580' },
  { id: 'forest',   name: 'Forest',        primary: '#6fcf97', secondary: '#56ccf2', accent: '#c8f560', danger: '#ff6b6b', warn: '#ffd166', bg0: '#06120c', bg1: '#0a1a12', bg2: '#102418', text: '#d9f2e2', dim: '#6f9a82' },
  { id: 'royal',    name: 'Royal Purple',  primary: '#9d4edd', secondary: '#c77dff', accent: '#e0aaff', danger: '#ff5d8f', warn: '#ffc857', bg0: '#0d0618', bg1: '#140a22', bg2: '#1e0f33', text: '#ece0ff', dim: '#8a7aa3' },
  { id: 'slate',    name: 'Mono Slate',    primary: '#9fb3c8', secondary: '#7a8aa0', accent: '#c8d4e0', danger: '#e06c75', warn: '#d9a441', bg0: '#0c0f14', bg1: '#11151c', bg2: '#171c25', text: '#d6dee8', dim: '#6b7787' },
  { id: 'light',    name: 'Daylight',      light: true, primary: '#0a84ff', secondary: '#b5179e', accent: '#00a37a', danger: '#e5484d', warn: '#c77700', bg0: '#eef1f7', bg1: '#f5f7fb', bg2: '#ffffff', text: '#1b2330', dim: '#5b6b7f' },
];

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r}, ${g}, ${b}, ${a})`; };

export function applyTheme(idOrTheme) {
  const t = typeof idOrTheme === 'string' ? THEMES.find((x) => x.id === idOrTheme) : idOrTheme;
  if (!t) return;
  const s = document.documentElement.style;
  s.setProperty('--cyber-primary', t.primary);
  s.setProperty('--cyber-secondary', t.secondary);
  s.setProperty('--cyber-accent', t.accent);
  s.setProperty('--cyber-danger', t.danger || '#ff3860');
  s.setProperty('--cyber-warn', t.warn || '#ffb000');
  s.setProperty('--bg-0', t.bg0);
  s.setProperty('--bg-1', t.bg1);
  s.setProperty('--bg-2', t.bg2);
  s.setProperty('--text', t.text);
  s.setProperty('--text-dim', t.dim);
  s.setProperty('--panel', rgba(t.bg2, 0.72));
  s.setProperty('--grid', rgba(t.primary, t.light ? 0.05 : 0.06));
  // marca tema claro p/ a UI adaptar sombras/realces (ver index.css [data-light])
  try { document.documentElement.dataset.light = t.light ? '1' : ''; } catch {}
  try { localStorage.setItem('tng_theme', t.id); } catch {}
  try { window.dispatchEvent(new CustomEvent('tng:theme', { detail: t.id })); } catch {}
}

export function currentThemeId() {
  try { return localStorage.getItem('tng_theme') || 'neon'; } catch { return 'neon'; }
}
