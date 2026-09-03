import { useEffect, useRef } from 'react';

const COLORS = ['#2fd67a', '#5b8cff', '#ffd166', '#ff5c7c', '#e7edf3'];
const LIFETIME_MS = 2200;

export default function Confetti() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const particles = Array.from({ length: 90 }, () => ({
      x: width / 2 + (Math.random() - 0.5) * 60,
      y: height * 0.25,
      vx: (Math.random() - 0.5) * 9,
      vy: Math.random() * -7 - 2,
      size: 4 + Math.random() * 4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
    }));

    const gravity = 0.25;
    const start = performance.now();
    let raf;

    function frame(now) {
      const elapsed = now - start;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      particles.forEach((p) => {
        p.vy += gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = Math.max(0, 1 - elapsed / LIFETIME_MS);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });
      if (elapsed < LIFETIME_MS) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className="confetti-canvas" />;
}
