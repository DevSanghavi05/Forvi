import { useEffect, useRef } from 'react';

// where the text baseline sits inside the line box, as a fraction of font size
const ASCENT_RATIO = 0.78;

/**
 * Renders text as a true dot-matrix: the glyphs are sampled on a fixed grid and
 * a WHOLE dot is drawn wherever a cell is covered, so dots are never clipped by
 * the letter outline. A gentle flicker briefly drops a few dots (like a real
 * LED sign) unless reduced motion is requested.
 */
export default function DottedText({
  text,
  color = '#2f5fe6',
  cell = 0.08, // grid spacing as a fraction of the font size
  dotRatio = 0.5, // dot diameter relative to the cell
  threshold = 0.3, // minimum coverage in a cell before it lights up
  reduceMotion = false
}) {
  const measureRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const measure = measureRef.current;
    const canvas = canvasRef.current;
    if (!measure || !canvas) return;

    const ctx = canvas.getContext('2d');
    let cells = [];
    let raf = 0;
    let timer = 0;

    const paint = (hidden) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = color;
      for (let i = 0; i < cells.length; i++) {
        if (hidden && hidden.has(i)) continue;
        const c = cells[i];
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const build = () => {
      const rect = measure.getBoundingClientRect();
      const w = Math.ceil(rect.width);
      const h = Math.ceil(rect.height);
      if (w < 2 || h < 2) return;

      const cs = getComputedStyle(measure);
      const F = parseFloat(cs.fontSize);
      const weight = cs.fontWeight;
      const family = cs.fontFamily;
      const ls = parseFloat(cs.letterSpacing) || 0;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(w * dpr));
      off.height = Math.max(1, Math.round(h * dpr));
      const octx = off.getContext('2d', { willReadFrequently: true });
      octx.scale(dpr, dpr);
      octx.font = `${weight} ${F}px ${family}`;
      octx.textBaseline = 'alphabetic';
      octx.textAlign = 'left';
      if ('letterSpacing' in octx) octx.letterSpacing = `${ls}px`;
      octx.fillStyle = '#000';
      // baseline placed the same way CSS lays it out, so the dots line up
      // with the surrounding solid text
      const baseline = (h - F) / 2 + F * ASCENT_RATIO;
      octx.fillText(text, 0, baseline);

      const data = octx.getImageData(0, 0, off.width, off.height).data;
      const W = off.width;
      const H = off.height;

      canvas.width = W;
      canvas.height = H;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const cellDev = Math.max(3, cell * F * dpr);
      const r = (cell * F * dotRatio * dpr) / 2;
      const step = Math.max(1, Math.floor(cellDev / 4));

      cells = [];
      for (let cy = cellDev / 2; cy < H; cy += cellDev) {
        for (let cx = cellDev / 2; cx < W; cx += cellDev) {
          const x0 = Math.max(0, Math.floor(cx - cellDev / 2));
          const x1 = Math.min(W, Math.ceil(cx + cellDev / 2));
          const y0 = Math.max(0, Math.floor(cy - cellDev / 2));
          const y1 = Math.min(H, Math.ceil(cy + cellDev / 2));
          let sum = 0;
          let count = 0;
          for (let yy = y0; yy < y1; yy += step) {
            const row = yy * W;
            for (let xx = x0; xx < x1; xx += step) {
              sum += data[(row + xx) * 4 + 3];
              count++;
            }
          }
          if (count && sum / count / 255 >= threshold) {
            cells.push({ x: cx, y: cy, r });
          }
        }
      }
      paint(null);
    };

    // LED-style flicker: hide a few random dots, then let them return
    const flick = () => {
      if (!cells.length) return;
      const hidden = new Set();
      const n = 2 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        hidden.add(Math.floor(Math.random() * cells.length));
      }
      paint(hidden);
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(build);
    };

    schedule();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(measure);
    window.addEventListener('resize', schedule);
    if (!reduceMotion) timer = setInterval(flick, 170);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [text, color, cell, dotRatio, threshold, reduceMotion]);

  return (
    <span className="dotted">
      <span className="dotted__measure" ref={measureRef}>
        {text}
      </span>
      <canvas className="dotted__canvas" ref={canvasRef} aria-hidden="true"></canvas>
    </span>
  );
}
