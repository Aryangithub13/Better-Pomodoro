import { useEffect, useRef } from "react";

/* ================================================================
   AmbientCanvas — the room the instrument sits in. Slow dust motes
   drifting upward through a wandering pool of lamplight, all in
   neutral grey at near-threshold contrast. Focus dimmers the room;
   breaks lift it slightly. Renders a single static frame when the
   visitor prefers reduced motion.
   ================================================================ */

interface Mote {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  swaySp: number;
  a: number;
}

export function AmbientCanvas({
  mode,
  running,
  reduced,
}: {
  mode: string;
  running: boolean;
  reduced: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ mode, running });
  stateRef.current = { mode, running };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let W = 0;
    let H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const motes: Mote[] = Array.from({ length: 70 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.4,
      vy: 0.004 + Math.random() * 0.012, // screen-heights per second
      sway: Math.random() * Math.PI * 2,
      swaySp: 0.2 + Math.random() * 0.5,
      a: 0.04 + Math.random() * 0.11,
    }));

    let t0 = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - t0) / 1000);
      t0 = now;
      const { mode: m, running: r } = stateRef.current;
      const lift = m === "focus" ? (r ? 0.75 : 0.55) : 1;

      ctx.clearRect(0, 0, W, H);

      /* wandering lamplight */
      const gx = W * (0.5 + 0.28 * Math.sin(now / 23000));
      const gy = H * 0.16;
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H) * 0.72);
      grad.addColorStop(0, `rgba(255,255,255,${0.05 * lift})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      /* dust */
      for (const p of motes) {
        if (!reduced) {
          p.y -= p.vy * dt;
          p.sway += p.swaySp * dt;
          if (p.y < -0.02) {
            p.y = 1.02;
            p.x = Math.random();
          }
        }
        const x = p.x * W + Math.sin(p.sway) * 14;
        const y = p.y * H;
        ctx.fillStyle = `rgba(212,212,212,${p.a * lift})`;
        ctx.fillRect(x, y, p.r, p.r);
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [reduced]);

  return <canvas ref={ref} className="ambient" aria-hidden="true" />;
}
