import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Type, X, RotateCcw, Palette, Languages, AppWindow, Music, Volume2, VolumeX, Zap, Sparkles, Bot, Cpu, Check, Loader2, KeyRound } from 'lucide-react';
import { sfx, music, setMuted } from '../lib/sound.js';
import { THEMES, applyTheme, currentThemeId } from '../lib/themes.js';
import { savePrefs, getAiProvider, saveAiProvider, testAiProvider } from '../lib/api.js';
import { sfxEnabled, setSfxEnabled, musicEnabled, setMusicEnabled, animEnabled, setAnimEnabled, applyAnim, musicTrack, setMusicTrack, parsersOff, setParserOff, errorHintsOn, setErrorHintsOn } from '../lib/prefsUi.js';
import { TOOL_LABELS } from '../utils/commandParsers.js';

// Todos os parsers/helpers que podem ser ligados/desligados.
const PARSER_ITEMS = [
  ['ping', 'Ping (RTT/perdas)'], ['trace', 'Traceroute'], ['storage', 'Discos (df/lsblk/LVM)'],
  ['mail', 'Mail (Postfix)'], ['config', 'Config helper (editor)'],
  ...Object.entries(TOOL_LABELS),
];

// Provedores de IA suportados. Base/modelo pré-preenchidos (editáveis).
export const AI_PROVIDERS = [
  { id: 'openai',     name: 'OpenAI (ChatGPT API)', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: 'sk-...' },
  { id: 'anthropic',  name: 'Anthropic (Claude)', base: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest', key: 'sk-ant-...' },
  { id: 'google',     name: 'Google (Gemini)', base: 'https://generativelanguage.googleapis.com', model: 'gemini-1.5-flash', key: 'AIza...' },
  { id: 'groq',       name: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', key: 'gsk_...' },
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet', key: 'sk-or-...' },
  { id: 'deepseek',   name: 'DeepSeek', base: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'sk-...' },
  { id: 'mistral',    name: 'Mistral', base: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', key: '...' },
  { id: 'ollama',     name: 'Ollama (local)', base: 'http://localhost:11434/v1', model: 'llama3.1', key: '(sem chave)' },
  { id: 'custom',     name: 'Custom (OpenAI-compatível)', base: '', model: '', key: 'API key' },
];

const Toggle = ({ on, onClick, icon: Icon, label, desc }) => (
  <>
    <label className="flex items-center justify-between gap-3 cursor-pointer" onClick={onClick}>
      <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}>{Icon && <Icon className="w-3.5 h-3.5" />} {label}</span>
      <span className="relative inline-flex items-center rounded-full transition-colors" style={{ width: 38, height: 20, background: on ? 'var(--cyber-primary)' : 'rgba(255,255,255,0.15)' }}>
        <span className="absolute rounded-full bg-white transition-transform" style={{ width: 16, height: 16, top: 2, left: 2, transform: on ? 'translateX(18px)' : 'translateX(0)' }} />
      </span>
    </label>
    {desc && <p className="text-[10px] -mt-1.5" style={{ color: 'var(--text-dim)' }}>{desc}</p>}
  </>
);

export const FONT_OPTIONS = [
  { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { label: 'Fira Code', value: "'Fira Code', monospace" },
  { label: 'Cascadia Code', value: "'Cascadia Code', monospace" },
  { label: 'Consolas', value: "'Consolas', monospace" },
  { label: 'Courier New', value: "'Courier New', monospace" },
  { label: 'System Mono', value: 'ui-monospace, SFMono-Regular, monospace' },
];

export const TERM_DEFAULTS = {
  fontFamily: FONT_OPTIONS[0].value,
  fontSize: 14,
  lineHeight: 1.2,
  background: '#0a0e1a',
  foreground: '#e2e8f0',
  cursor: '#06b6d4',
};

export default function TerminalSettings({ value, onChange, onClose }) {
  const v = { ...TERM_DEFAULTS, ...value };
  const set = (patch) => onChange(patch);
  const [theme, setTheme] = useState(currentThemeId());
  const pickTheme = (id) => { applyTheme(id); setTheme(id); sfx.toggle(); savePrefs({ theme: id }).catch(() => {}); };
  const [aiLang, setAiLang] = useState(() => { try { return localStorage.getItem('tng_ai_lang') || 'pt-BR'; } catch { return 'pt-BR'; } });
  const pickLang = (l) => { setAiLang(l); try { localStorage.setItem('tng_ai_lang', l); } catch {} sfx.toggle(); savePrefs({ aiLang: l }).catch(() => {}); };
  const [wsCard, setWsCard] = useState(() => { try { return localStorage.getItem('tng_workspace_card') !== '0'; } catch { return true; } });
  const toggleWsCard = () => { const v = !wsCard; setWsCard(v); try { localStorage.setItem('tng_workspace_card', v ? '1' : '0'); } catch {} sfx.toggle(); savePrefs({ workspaceCard: v }).catch(() => {}); try { window.dispatchEvent(new Event('tng:workspace')); } catch {} };
  const [termBlack, setTermBlack] = useState(() => { try { return localStorage.getItem('tng_term_black') === '1'; } catch { return false; } });
  const toggleTermBlack = () => { const v = !termBlack; setTermBlack(v); try { localStorage.setItem('tng_term_black', v ? '1' : '0'); } catch {} sfx.toggle(); savePrefs({ termBlack: v }).catch(() => {}); try { window.dispatchEvent(new Event('tng:theme')); } catch {} };
  const [overlayFloat, setOverlayFloat] = useState(() => { try { return localStorage.getItem('tng_overlay_float') === '1'; } catch { return false; } });
  const toggleOverlayFloat = () => { const v = !overlayFloat; setOverlayFloat(v); try { localStorage.setItem('tng_overlay_float', v ? '1' : '0'); } catch {} sfx.toggle(); savePrefs({ overlayFloat: v }).catch(() => {}); try { window.dispatchEvent(new Event('tng:theme')); } catch {} };

  // ── Abas + Sons/Animações ──
  const [tab, setTab] = useState('appearance');
  const [musicOn, setMusicOn] = useState(musicEnabled);
  const [track, setTrack] = useState(musicTrack);
  const [sfxOn, setSfxOn] = useState(sfxEnabled);
  const [animOn, setAnimOn] = useState(animEnabled);
  const toggleMusic = () => { const n = !musicOn; setMusicOn(n); setMusicEnabled(n); if (n) music.start(track); else music.stop(); sfx.toggle(); };
  const pickTrack = (id) => { setTrack(id); setMusicTrack(id); music.setTrack(id); if (musicOn && !music.isPlaying()) music.start(id); sfx.toggle(); };
  const toggleSfx = () => { const n = !sfxOn; setSfxOn(n); setSfxEnabled(n); setMuted(!n); if (n) sfx.toggle(); };
  const toggleAnim = () => { const n = !animOn; setAnimOn(n); setAnimEnabled(n); applyAnim(n); try { window.dispatchEvent(new Event('tng:anim')); } catch {} sfx.toggle(); };

  // ── Provedor de IA ──
  const [aiProv, setAiProv] = useState('openai');
  const [aiKey, setAiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiBase, setAiBase] = useState('');
  const [aiHasKey, setAiHasKey] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState(null); // { ok, text }
  useEffect(() => {
    getAiProvider().then((p) => {
      if (p && p.provider) { setAiProv(p.provider); setAiModel(p.model || ''); setAiBase(p.baseUrl || ''); setAiHasKey(!!p.hasKey); }
    }).catch(() => {});
  }, []);
  const presetFor = (id) => AI_PROVIDERS.find((x) => x.id === id) || AI_PROVIDERS[0];
  const pickProvider = (id) => { const pre = presetFor(id); setAiProv(id); setAiModel(pre.model); setAiBase(pre.base); setAiMsg(null); sfx.toggle(); };
  const saveAi = async () => {
    setAiBusy(true); setAiMsg(null);
    try {
      const payload = { provider: aiProv, model: aiModel, baseUrl: aiBase };
      if (aiKey) payload.apiKey = aiKey;
      await saveAiProvider(payload);
      setAiHasKey(aiHasKey || !!aiKey); setAiKey('');
      const t = await testAiProvider();
      setAiMsg(t.ok ? { ok: true, text: `Conectado · ${t.provider} · ${t.model || ''}` } : { ok: false, text: t.error || 'Falha no teste' });
    } catch (e) { setAiMsg({ ok: false, text: e.message }); }
    setAiBusy(false);
  };
  const clearAi = async () => { setAiBusy(true); try { await saveAiProvider({ clear: true }); setAiHasKey(false); setAiKey(''); setAiMsg({ ok: true, text: 'Provedor removido (volta ao modo offline/Codex).' }); } catch (e) { setAiMsg({ ok: false, text: e.message }); } setAiBusy(false); sfx.toggle(); };

  // ── Proteção contra comandos perigosos ──
  const [cmdGuard, setCmdGuard] = useState(() => { try { return localStorage.getItem('tng_cmd_guard') !== '0'; } catch { return true; } });
  const toggleCmdGuard = () => { const v = !cmdGuard; setCmdGuard(v); try { localStorage.setItem('tng_cmd_guard', v ? '1' : '0'); } catch {} sfx.toggle(); };

  // ── Parsers/helpers ligados/desligados ──
  const [pOff, setPOff] = useState(() => parsersOff());
  const isOn = (k) => !pOff.has(k);
  const toggleParser = (k) => { setParserOff(k, isOn(k)); setPOff(parsersOff()); sfx.toggle(); };
  const setAllParsers = (on) => { PARSER_ITEMS.forEach(([k]) => setParserOff(k, !on)); setPOff(parsersOff()); sfx.toggle(); };
  const [errHints, setErrHints] = useState(errorHintsOn);
  const toggleErrHints = () => { const v = !errHints; setErrHints(v); setErrorHintsOn(v); sfx.toggle(); };

  const ColorRow = ({ label, k }) => (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{label}</span>
      <div className="flex items-center gap-2">
        <input type="text" value={v[k]} onChange={(e) => set({ [k]: e.target.value })} className="field font-mono" style={{ width: 110, padding: '6px 8px' }} />
        <input type="color" value={v[k]} onChange={(e) => set({ [k]: e.target.value })} className="w-8 h-8 rounded cursor-pointer bg-transparent border border-theme" />
      </div>
    </label>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} className="glass clip-cyber w-full max-w-3xl flex flex-col" style={{ maxHeight: '88vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 pt-5 pb-3 shrink-0">
          <Type className="w-5 h-5 text-theme" />
          <h2 className="font-display font-bold tracking-cyber text-theme flex-1">Configurações</h2>
          {tab === 'appearance' && <button onClick={() => { sfx.click(); set(TERM_DEFAULTS); }} title="Restaurar padrões" className="p-1.5 rounded hover:bg-theme-soft"><RotateCcw className="w-4 h-4 text-theme-soft" /></button>}
          <button onClick={onClose}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
        </div>

        {/* abas */}
        <div className="flex gap-1 mb-3 mx-5 p-1 rounded-lg shrink-0" style={{ background: 'rgba(0,0,0,0.25)' }}>
          {[['appearance', 'Aparência', Palette], ['parsers', 'Parsers', Cpu], ['sound', 'Sons / Animações', Music], ['ai', 'IA', Bot]].map(([id, label, Icon]) => (
            <button key={id} onClick={() => { sfx.click(); setTab(id); }}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px] transition-colors"
              style={{ background: tab === id ? 'color-mix(in srgb, var(--cyber-primary) 16%, transparent)' : 'transparent', color: tab === id ? 'var(--cyber-primary)' : 'var(--text-dim)' }}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
        {tab === 'parsers' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Escolha quais painéis aparecem automaticamente ao rodar comandos.</p>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => setAllParsers(true)} className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--cyber-primary) 14%, transparent)', color: 'var(--cyber-primary)' }}>Todos</button>
                <button onClick={() => setAllParsers(false)} className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-dim)' }}>Nenhum</button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
              {PARSER_ITEMS.map(([k, label]) => (
                <label key={k} onClick={() => toggleParser(k)} className="flex items-center justify-between gap-2 cursor-pointer py-1">
                  <span className="text-[11px] truncate" style={{ color: isOn(k) ? 'var(--text)' : 'var(--text-dim)' }}>{label}</span>
                  <span className="relative inline-flex items-center rounded-full transition-colors shrink-0" style={{ width: 30, height: 16, background: isOn(k) ? 'var(--cyber-primary)' : 'rgba(255,255,255,0.15)' }}>
                    <span className="absolute rounded-full bg-white transition-transform" style={{ width: 12, height: 12, top: 2, left: 2, transform: isOn(k) ? 'translateX(14px)' : 'translateX(0)' }} />
                  </span>
                </label>
              ))}
            </div>
            <div className="h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
            <Toggle on={errHints} onClick={toggleErrHints} icon={Zap} label="Dicas de erro automáticas"
              desc="Mostra um painel “Possível problema” quando a saída de um comando tem erro (arquivo inexistente, permissão, DNS…). Desligado por padrão para não poluir a tela." />
            <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>A Análise IA é sempre <b>sob demanda</b>: clique no botão ✨ do painel para avaliar a saída — nunca automático.</p>
          </div>
        )}

        {tab === 'sound' && (
          <div className="space-y-3.5">
            <Toggle on={musicOn} onClick={toggleMusic} icon={Music} label="Música ambiente" desc="Trilha em loop. Toca no login e continua de fundo (volume mais baixo) após entrar." />
            <div className="flex items-center justify-between gap-3" style={{ opacity: musicOn ? 1 : 0.5 }}>
              <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}><Volume2 className="w-3.5 h-3.5" /> Trilha</span>
              <select value={track} disabled={!musicOn} onChange={(e) => pickTrack(e.target.value)} className="field" style={{ width: 180, padding: '6px 8px' }}>
                {music.tracks.map((t) => <option key={t.id} value={t.id} style={{ background: 'var(--bg-2)' }}>{t.name}</option>)}
              </select>
            </div>
            <div className="h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
            <Toggle on={sfxOn} onClick={toggleSfx} icon={sfxOn ? Volume2 : VolumeX} label="Efeitos sonoros (SFX)" desc="Cliques, conexões, alertas e demais sons da interface." />
            <div className="h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
            <Toggle on={animOn} onClick={toggleAnim} icon={animOn ? Sparkles : Zap} label="Animações" desc="Chuva de glyphs, scanlines, brilhos e transições. Desligue para uma UI mais sóbria/leve." />
          </div>
        )}

        {tab === 'ai' && (
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
              Escolha um provedor de IA e informe sua chave. Funciona para <b>Claude</b>, <b>Gemini</b>, <b>OpenAI</b> e qualquer API compatível (Groq, OpenRouter, DeepSeek, Mistral, Ollama…). Alternativa: login do ChatGPT (Codex) fica no painel de IA.
            </p>
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}><Cpu className="w-3.5 h-3.5" /> Provedor</span>
              <select value={aiProv} onChange={(e) => pickProvider(e.target.value)} className="field" style={{ width: 220, padding: '6px 8px' }}>
                {AI_PROVIDERS.map((p) => <option key={p.id} value={p.id} style={{ background: 'var(--bg-2)' }}>{p.name}</option>)}
              </select>
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}><KeyRound className="w-3.5 h-3.5" /> API key</span>
              <input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder={aiHasKey ? '•••••• (salva — deixe em branco p/ manter)' : presetFor(aiProv).key}
                className="field font-mono" style={{ width: 220, padding: '6px 8px' }} autoComplete="off" />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Modelo</span>
              <input value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder={presetFor(aiProv).model} className="field font-mono" style={{ width: 220, padding: '6px 8px' }} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Base URL</span>
              <input value={aiBase} onChange={(e) => setAiBase(e.target.value)} placeholder={presetFor(aiProv).base || 'https://…'} className="field font-mono" style={{ width: 220, padding: '6px 8px' }} />
            </label>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={saveAi} disabled={aiBusy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]" style={{ background: 'color-mix(in srgb, var(--cyber-primary) 18%, transparent)', color: 'var(--cyber-primary)' }}>
                {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Salvar e testar
              </button>
              <button onClick={clearAi} disabled={aiBusy} className="px-3 py-1.5 rounded-lg text-[12px]" style={{ color: 'var(--text-dim)' }}>Remover</button>
            </div>
            {aiMsg && (
              <div className="rounded-lg px-3 py-2 text-[11px] flex items-center gap-2" style={{ background: `color-mix(in srgb, ${aiMsg.ok ? 'var(--cyber-accent)' : 'var(--cyber-danger)'} 12%, transparent)`, color: aiMsg.ok ? 'var(--cyber-accent)' : 'var(--cyber-danger)' }}>
                {aiMsg.ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />} {aiMsg.text}
              </div>
            )}
            <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>A chave fica salva no servidor do terminal-ng (perfil do usuário) e nunca é reexibida. Ollama roda local, sem chave.</p>
          </div>
        )}

        {tab === 'appearance' && (
        <div className="space-y-3.5">
          <Toggle on={cmdGuard} onClick={toggleCmdGuard} icon={Zap} label="Proteção contra comandos perigosos"
            desc="Antes de executar comandos catastróficos (rm em /etc, /var, /usr, /boot…, mkfs, dd em disco, fork bomb, chmod -R 777 no sistema), pede confirmação num modal. rm comum (node_modules, /tmp) não é bloqueado." />
          <div className="h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div>
            <div className="flex items-center gap-1.5 mb-1.5"><Palette className="w-3.5 h-3.5 text-theme" /><span className="text-xs" style={{ color: 'var(--text-dim)' }}>Tema</span></div>
            <div className="grid grid-cols-5 gap-1.5">
              {THEMES.map((t) => (
                <button key={t.id} onClick={() => pickTheme(t.id)} title={t.name}
                  className="rounded-lg p-1 transition-transform hover:scale-105"
                  style={{ border: `1px solid ${theme === t.id ? t.primary : 'rgba(255,255,255,0.08)'}`, boxShadow: theme === t.id ? `0 0 10px ${t.primary}66` : 'none' }}>
                  <div className="h-7 rounded-md relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${t.bg1}, ${t.bg2})` }}>
                    <div className="absolute inset-x-1 bottom-1 flex gap-1">
                      <span style={{ flex: 1, height: 4, borderRadius: 3, background: t.primary }} />
                      <span style={{ flex: 1, height: 4, borderRadius: 3, background: t.secondary }} />
                      <span style={{ flex: 1, height: 4, borderRadius: 3, background: t.accent }} />
                    </div>
                  </div>
                  <div className="text-[7px] mt-0.5 truncate text-center" style={{ color: theme === t.id ? t.primary : 'var(--text-dim)' }}>{t.name}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <label className="flex items-center justify-between gap-3 cursor-pointer" onClick={toggleWsCard}>
            <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}><AppWindow className="w-3.5 h-3.5" /> Moldura do workspace (card verde)</span>
            <span className="relative inline-flex items-center rounded-full transition-colors" style={{ width: 38, height: 20, background: wsCard ? 'var(--cyber-primary)' : 'rgba(255,255,255,0.15)' }}>
              <span className="absolute rounded-full bg-white transition-transform" style={{ width: 16, height: 16, top: 2, left: 2, transform: wsCard ? 'translateX(18px)' : 'translateX(0)' }} />
            </span>
          </label>
          <p className="text-[10px] -mt-1.5" style={{ color: 'var(--text-dim)' }}>Desligue para as janelas flutuarem na tela toda, sem a moldura.</p>
          <div className="h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <label className="flex items-center justify-between gap-3 cursor-pointer" onClick={toggleTermBlack}>
            <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}><Type className="w-3.5 h-3.5" /> Fundo do terminal preto</span>
            <span className="relative inline-flex items-center rounded-full transition-colors" style={{ width: 38, height: 20, background: termBlack ? 'var(--cyber-primary)' : 'rgba(255,255,255,0.15)' }}>
              <span className="absolute rounded-full bg-white transition-transform" style={{ width: 16, height: 16, top: 2, left: 2, transform: termBlack ? 'translateX(18px)' : 'translateX(0)' }} />
            </span>
          </label>
          <p className="text-[10px] -mt-1.5" style={{ color: 'var(--text-dim)' }}>Fundo 100% preto. Em modo root, mostra só a poeira subindo (sem o degradê dourado).</p>
          <div className="h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <label className="flex items-center justify-between gap-3 cursor-pointer" onClick={toggleOverlayFloat}>
            <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}><AppWindow className="w-3.5 h-3.5" /> Parsers/Helper fora do terminal</span>
            <span className="relative inline-flex items-center rounded-full transition-colors" style={{ width: 38, height: 20, background: overlayFloat ? 'var(--cyber-primary)' : 'rgba(255,255,255,0.15)' }}>
              <span className="absolute rounded-full bg-white transition-transform" style={{ width: 16, height: 16, top: 2, left: 2, transform: overlayFloat ? 'translateX(18px)' : 'translateX(0)' }} />
            </span>
          </label>
          <p className="text-[10px] -mt-1.5" style={{ color: 'var(--text-dim)' }}>Ligado: parsers (ping/trace/disk/mail) e o helper flutuam sobre a tela com o nome da sessão no título. Desligado: ficam dentro do terminal.</p>
          <div className="h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}><Languages className="w-3.5 h-3.5" /> Idioma da IA</span>
            <select value={aiLang} onChange={(e) => pickLang(e.target.value)} className="field" style={{ width: 180, padding: '6px 8px' }}>
              {[['auto', 'Automático'], ['pt-BR', 'Português (BR)'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'], ['ja', '日本語'], ['zh', '中文'], ['ru', 'Русский']].map(([v, l]) => (
                <option key={v} value={v} style={{ background: 'var(--bg-2)' }}>{l}</option>
              ))}
            </select>
          </label>
          <div className="h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Font family</span>
            <select value={v.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} className="field" style={{ width: 180, padding: '6px 8px' }}>
              {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value} style={{ background: '#0b1020' }}>{f.label}</option>)}
            </select>
          </label>

          <label className="flex items-center justify-between gap-3">
            <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Font size · {v.fontSize}px</span>
            <input type="range" min="9" max="28" value={v.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} style={{ width: 180, accentColor: 'var(--cyber-primary)' }} />
          </label>

          <label className="flex items-center justify-between gap-3">
            <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Line height · {v.lineHeight}</span>
            <input type="range" min="1" max="2" step="0.05" value={v.lineHeight} onChange={(e) => set({ lineHeight: Number(e.target.value) })} style={{ width: 180, accentColor: 'var(--cyber-primary)' }} />
          </label>

          <ColorRow label="Text color" k="foreground" />
          <ColorRow label="Background" k="background" />
          <ColorRow label="Cursor" k="cursor" />

          {/* live preview */}
          <div className="rounded-lg p-3 border border-theme" style={{ background: v.background }}>
            <div style={{ fontFamily: v.fontFamily, fontSize: v.fontSize, lineHeight: v.lineHeight, color: v.foreground }}>
              <div>operator@nexor:~$ <span style={{ background: v.cursor, color: v.background }}>&nbsp;</span></div>
              <div>uptime · load average: 0.08, 0.03, 0.01</div>
            </div>
          </div>
        </div>
        )}

        <p className="mt-4 text-[11px] text-center" style={{ color: 'var(--text-dim)' }}>as alterações são aplicadas na hora e salvas no seu perfil</p>
        </div>
      </motion.div>
    </motion.div>
  );
}
