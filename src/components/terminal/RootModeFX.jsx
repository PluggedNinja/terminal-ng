/**
 * RootModeFX.jsx
 * Overlay visual exibido quando o usuário está em modo ROOT no terminal.
 * Fundo com tom dourado + partículas brilhantes subindo (canvas, sem capturar
 * cliques). Faz fade-in/out conforme a prop `active`. Roda o rAF sempre, mas
 * quando inativo o custo é mínimo (canvas limpo, sem partículas).
 */
import React, { useRef, useEffect } from 'react';

const RootModeFX = ({ active, dustOnly = false }) => {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const particlesRef = useRef([]);
  const activeRef = useRef(active);
  const dustRef = useRef(dustOnly);
  const opacityRef = useRef(0);

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { dustRef.current = dustOnly; }, [dustOnly]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let w = 0;
    let h = 0;
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const r = parent.getBoundingClientRect();
      w = canvas.width = Math.max(1, Math.floor(r.width));
      h = canvas.height = Math.max(1, Math.floor(r.height));
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const spawn = () => ({
      x: Math.random() * w,
      y: h + Math.random() * 24,
      r: 0.6 + Math.random() * 1.9,
      vy: 0.25 + Math.random() * 0.95,
      vx: (Math.random() - 0.5) * 0.35,
      life: 0,
      ttl: 220 + Math.random() * 320,
      tw: Math.random() * Math.PI * 2,
    });

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const target = activeRef.current ? 1 : 0;
      opacityRef.current += (target - opacityRef.current) * 0.06;
      const op = opacityRef.current;
      ctx.clearRect(0, 0, w, h);
      if (op < 0.01 && !activeRef.current) { particlesRef.current = []; return; }

      // Tom dourado subindo do rodapé (vinheta) — omitido no modo "só poeira".
      if (!dustRef.current) {
        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, `rgba(214,164,28,${0.18 * op})`);
        grad.addColorStop(0.45, `rgba(214,164,28,${0.06 * op})`);
        grad.addColorStop(1, 'rgba(214,164,28,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      const want = activeRef.current ? Math.min(95, Math.floor(w / 14) + 24) : 0;
      while (particlesRef.current.length < want) particlesRef.current.push(spawn());

      ctx.globalCompositeOperation = 'lighter';
      const next = [];
      for (const p of particlesRef.current) {
        p.life += 1; p.y -= p.vy; p.x += p.vx; p.tw += 0.08;
        const lifeRatio = p.life / p.ttl;
        if (p.y < -12 || lifeRatio > 1) { if (activeRef.current) next.push(spawn()); continue; }
        const fade = Math.sin(Math.min(Math.PI, lifeRatio * Math.PI));
        const tw = 0.55 + 0.45 * Math.sin(p.tw);
        const a = op * fade * tw;
        ctx.beginPath();
        ctx.fillStyle = `rgba(255,216,120,${a})`;
        ctx.shadowColor = 'rgba(255,198,70,0.9)';
        ctx.shadowBlur = 6;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        next.push(p);
      }
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'source-over';
      particlesRef.current = next;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 20, mixBlendMode: 'screen',
      }}
    />
  );
};

export default RootModeFX;
