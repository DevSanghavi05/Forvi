import { useEffect, useRef } from 'react';

const WAVE_W = 1200;
const WAVE_H = 340;

// base heights (top edge) for each chunky step, per layer
const FRONT_BASE = [150, 120, 176, 206, 168, 132, 162, 134];
const BACK_BASE = [112, 86, 138, 168, 128, 96, 122, 100];

function buildPath(tops, seg) {
  let d = `M0,${tops[0].toFixed(1)}`;
  for (let i = 0; i < tops.length; i++) {
    d += ` H${((i + 1) * seg).toFixed(1)}`;
    if (i < tops.length - 1) d += ` V${tops[i + 1].toFixed(1)}`;
  }
  return `${d} L${WAVE_W},${WAVE_H} L0,${WAVE_H} Z`;
}

// give every step its own amplitude / phase / speed so they bob independently.
// phases are well spread so the steps never all line up flat at once
function motionFor(base, ampBase) {
  return base.map((_, i) => ({
    amp: ampBase + (i % 3) * 4,
    phase: i * 2.1,
    speed: 0.7 + (i % 4) * 0.18
  }));
}

/**
 * Stepped blue wave where each step rises and falls on its own timing, on both
 * the front (deep) and back (light) layers. Falls back to a static frame when
 * reduced motion is requested.
 */
export default function Wave({ reduceMotion = false }) {
  const frontRef = useRef(null);
  const backRef = useRef(null);

  useEffect(() => {
    const seg = WAVE_W / FRONT_BASE.length;
    const fp = motionFor(FRONT_BASE, 12);
    const bp = motionFor(BACK_BASE, 9);

    const render = (t) => {
      const ftops = FRONT_BASE.map(
        (b, i) => b + fp[i].amp * Math.sin(t * fp[i].speed + fp[i].phase)
      );
      const btops = BACK_BASE.map(
        (b, i) => b + bp[i].amp * Math.sin(t * bp[i].speed + bp[i].phase)
      );
      if (frontRef.current) frontRef.current.setAttribute('d', buildPath(ftops, seg));
      if (backRef.current) backRef.current.setAttribute('d', buildPath(btops, seg));
    };

    // paint a frame immediately so the wave is never blank on mount
    render(0);
    if (reduceMotion) return undefined;

    let raf = 0;
    let start = null;
    const loop = (now) => {
      if (start === null) start = now;
      render((now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion]);

  return (
    <div className="wave" aria-hidden="true">
      <svg
        className="wave-svg"
        viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="waveFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#93abff" />
            <stop offset="38%" stopColor="#3f66ea" />
            <stop offset="100%" stopColor="#1c3ea6" />
          </linearGradient>
          <linearGradient id="waveFillBack" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c2d0ff" />
            <stop offset="100%" stopColor="#5f82f2" />
          </linearGradient>
          <filter id="waveSoft" x="-5%" y="-40%" width="110%" height="180%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>
        <path
          ref={backRef}
          filter="url(#waveSoft)"
          fill="url(#waveFillBack)"
          opacity="0.7"
        />
        <path ref={frontRef} filter="url(#waveSoft)" fill="url(#waveFill)" />
      </svg>
    </div>
  );
}
