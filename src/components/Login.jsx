import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Terminal, Lock, User, ChevronRight, ShieldAlert, Music, VolumeX } from 'lucide-react';
import { api, setToken } from '../lib/api.js';
import { sfx, music } from '../lib/sound.js';
import { musicEnabled, setMusicEnabled } from '../lib/prefsUi.js';
import { useI18n, LANGS, LANG_LABELS } from '../lib/i18n.js';

const BOOT_LINES = [
  'INITIALIZING NEURAL HANDSHAKE...',
  'LOADING CRYPTO MODULE [AES-256] ........ OK',
  'MOUNTING /dev/cyberdeck ................. OK',
  'SPAWNING SSH RELAY DAEMON .............. OK',
  'AWAITING OPERATOR CREDENTIALS',
];

export default function Login({ onAuthed }) {
  const { t, lang, setLang } = useI18n();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [bootIdx, setBootIdx] = useState(0);
  const [musicOn, setMusicOn] = useState(musicEnabled);

  useEffect(() => {
    sfx.boot();
    const t = setInterval(() => setBootIdx((i) => (i < BOOT_LINES.length ? i + 1 : i)), 380);
    // A música é iniciada pelo App na 1ª interação (autoplay) e CONTINUA após o
    // login (em volume de fundo) — por isso não paramos no unmount.
    return () => clearInterval(t);
  }, []);

  const toggleMusic = () => {
    setMusicOn((v) => {
      const n = !v;
      setMusicEnabled(n);
      if (n) music.start('synthwave'); else music.stop();
      sfx.click();
      return n;
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true); sfx.click();
    try {
      const { token, user } = await api.post('/auth/login', { username, password });
      setToken(token);
      sfx.success();
      onAuthed(user);
    } catch (err) {
      setError(err.message || t('login.denied'));
      sfx.error();
      setBusy(false);
    }
  };

  return (
    <div className="relative z-10 h-full w-full flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="glass clip-cyber w-full max-w-md p-8"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="floaty grid place-items-center w-12 h-12 rounded-xl border border-theme bg-theme-soft">
            <Terminal className="w-6 h-6 text-theme" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-black glitch neon" data-text="TERMINAL//NG">TERMINAL//NG</h1>
            <p className="text-xs tracking-cyber" style={{ color: 'var(--text-dim)' }}>{t('login.subtitle')}</p>
          </div>
          <div className="ml-auto flex items-center gap-1 self-start">
            {LANGS.map((l) => (
              <button key={l} type="button" onClick={() => { sfx.click?.(); setLang(l); }} title={LANG_LABELS[l]}
                className="px-1.5 py-0.5 rounded text-[10px] font-display tracking-cyber transition-colors"
                style={{ background: lang === l ? 'color-mix(in srgb, var(--cyber-primary) 18%, transparent)' : 'transparent', color: lang === l ? 'var(--cyber-primary)' : 'var(--text-dim)' }}>{l.toUpperCase()}</button>
            ))}
            <button type="button" onClick={toggleMusic} title={musicOn ? t('login.music.on') : t('login.music.off')}
              className="ml-1 p-1 rounded transition-colors"
              style={{ color: musicOn ? 'var(--cyber-primary)' : 'var(--text-dim)', background: musicOn ? 'color-mix(in srgb, var(--cyber-primary) 16%, transparent)' : 'transparent' }}>
              {musicOn ? <Music className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div className="font-mono text-[11px] leading-relaxed mb-6 p-3 rounded-lg" style={{ background: 'rgba(0,0,0,0.4)', minHeight: 110 }}>
          {BOOT_LINES.slice(0, bootIdx).map((l, i) => (
            <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ color: i === BOOT_LINES.length - 1 ? 'var(--cyber-accent)' : 'var(--cyber-primary)' }}>
              <span style={{ color: 'var(--text-dim)' }}>{'>'}</span> {l}
            </motion.div>
          ))}
          {bootIdx < BOOT_LINES.length && <span className="neon">▋</span>}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-xs tracking-cyber" style={{ color: 'var(--text-dim)' }}>{t('login.operator')}</span>
            <div className="relative mt-1">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
              <input className="field" style={{ paddingLeft: 36 }} value={username}
                onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="admin" />
            </div>
          </label>

          <label className="block">
            <span className="text-xs tracking-cyber" style={{ color: 'var(--text-dim)' }}>{t('login.passkey')}</span>
            <div className="relative mt-1">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
              <input type="password" className="field" style={{ paddingLeft: 36 }} value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" />
            </div>
          </label>

          {error && (
            <motion.div initial={{ x: -6 }} animate={{ x: 0 }}
              className="flex items-center gap-2 text-sm" style={{ color: 'var(--cyber-danger)' }}>
              <ShieldAlert className="w-4 h-4" /> {error}
            </motion.div>
          )}

          <button type="submit" disabled={busy} className="btn w-full flex items-center justify-center gap-2"
            onMouseEnter={() => sfx.hover()}>
            {busy ? t('login.authenticating') : (<><span>{t('login.jackin')}</span><ChevronRight className="w-4 h-4" /></>)}
          </button>
        </form>

        <p className="mt-5 text-[11px] text-center" style={{ color: 'var(--text-dim)' }}>
          {t('login.seed')}
        </p>
      </motion.div>
    </div>
  );
}
