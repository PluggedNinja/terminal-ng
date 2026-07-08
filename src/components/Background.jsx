import React, { useRef, useEffect } from 'react';

/**
 * Background.jsx — animated cyberpunk canvas: falling glyph rain + drifting particles.
 * Sits behind everything (pointer-events none). Pure canvas, no deps.
 */
export default function Background({ animate = true }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!animate) return; // animações desligadas: só o fundo/grade estáticos
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf;
    let w, h, columns, drops;
    const glyphs = 'アカサタナﾊﾏﾔﾗ0123456789@#$%&*<>=/\\|ｦｧｨｩ'.split('');
    const fontSize = 14;

    const resize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      columns = Math.floor(w / fontSize);
      drops = Array.from({ length: columns }, () => Math.random() * -50);
    };
    resize();
    window.addEventListener('resize', resize);

    const particles = Array.from({ length: 40 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.6 + 0.4, hue: Math.random() > 0.5 ? '0,240,255' : '255,43,214',
    }));

    const draw = () => {
      ctx.fillStyle = 'rgba(4,5,12,0.10)';
      ctx.fillRect(0, 0, w, h);

      // glyph rain
      ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
      for (let i = 0; i < columns; i++) {
        const text = glyphs[Math.floor(Math.random() * glyphs.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        const lead = Math.random() > 0.985;
        ctx.fillStyle = lead ? 'rgba(182,255,0,0.9)' : 'rgba(0,240,255,0.20)';
        ctx.fillText(text, x, y);
        if (y > h && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 1;
      }

      // drifting particles
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.hue},0.5)`;
        ctx.shadowColor = `rgba(${p.hue},0.8)`;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [animate]);

  return (
    <>
      <div className="cyber-bg" />
      {animate && <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: 0, opacity: 0.6, pointerEvents: 'none' }} />}
      <div className="cyber-grid" />
    </>
  );
}
