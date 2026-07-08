import React, { useState, useEffect } from 'react';
import Background from './components/Background.jsx';
import Login from './components/Login.jsx';
import Workspace from './components/Workspace.jsx';
import MobileApp from './components/MobileApp.jsx';
import { api, getToken, setToken } from './lib/api.js';
import { applyTheme, currentThemeId } from './lib/themes.js';
import { music, setMuted } from './lib/sound.js';
import { animEnabled, applyAnim, musicEnabled, sfxEnabled } from './lib/prefsUi.js';

// Auto-detect a phone-sized viewport (narrow width / coarse pointer).
function useIsMobile() {
  const query = '(max-width: 768px)';
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on); };
  }, []);
  return isMobile;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [anim, setAnim] = useState(animEnabled);
  const isMobile = useIsMobile();

  // Apply the saved theme as early as possible.
  useEffect(() => { applyTheme(currentThemeId()); }, []);

  // Aplica preferências de UI (animações, mute de SFX) e gerencia a música.
  useEffect(() => {
    applyAnim(animEnabled());
    setMuted(!sfxEnabled());
    // autoplay exige gesto: inicia a música na 1ª interação (a trilha certa já
    // foi definida pelo efeito de [user] abaixo: synthwave no login, chill após).
    const tryStart = () => { if (musicEnabled() && !music.isPlaying()) music.start(); };
    window.addEventListener('pointerdown', tryStart, { once: true });
    window.addEventListener('keydown', tryStart, { once: true });
    // reage a mudanças feitas nas Configurações
    const onAnim = () => setAnim(animEnabled());
    window.addEventListener('tng:anim', onAnim);
    return () => { window.removeEventListener('tng:anim', onAnim); window.removeEventListener('pointerdown', tryStart); window.removeEventListener('keydown', tryStart); };
  }, []);

  // Trilha por contexto, com CROSSFADE: login → 'synthwave' (volume alto);
  // ao entrar → 'lo-fi chill' (fundo, 0.17), com fade de saída/entrada.
  useEffect(() => {
    if (user) music.transition('chill', true);      // fade-out synthwave → fade-in chill (0.17)
    else music.transition('synthwave', false);      // volta p/ synthwave (login, volume alto)
  }, [user]);

  // Restaura a sessão pelo cookie HttpOnly (o navegador o envia sozinho).
  useEffect(() => {
    api.get('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(''))
      .finally(() => setChecking(false));
  }, []);

  return (
    <div className={`${anim ? 'scanlines ' : ''}vignette`} style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <Background animate={anim} />
      {checking ? (
        <div className="relative z-10 h-full grid place-items-center">
          <span className="font-display tracking-cyber neon">BOOTING…</span>
        </div>
      ) : user ? (
        isMobile
          ? <MobileApp user={user} onLogout={() => setUser(null)} />
          : <Workspace user={user} onLogout={() => setUser(null)} />
      ) : (
        <Login onAuthed={setUser} />
      )}
    </div>
  );
}
