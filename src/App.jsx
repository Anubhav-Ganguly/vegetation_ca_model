import { useEffect, useRef, useState } from "react";

export default function App() {
  const canvasRef = useRef(null);

  // =============================
  // PARAMETERS
  // =============================

  const N = 160;                // grid size
  const STEPS_PER_FRAME = 3;
  const INIT_DENSITY = 0.15;

  const [R, setR] = useState(0.25);   // rainfall
  const E = 0.45;                     // evaporation
  const alpha = 4.0;
  const beta = 2.0;
  const mort = 0.18;
  const eps = 0.01;

  const waterDiff = 0.8;              // strong diffusion
  const longComp = 0.6;               // long-range competition

  const WR = 6;  // water radius
  const SR = 1;  // seed radius

  // =============================
  // STATE ARRAYS
  // =============================

  const v = useRef(new Float32Array(N * N));
  const w = useRef(new Float32Array(N * N));
  const s = useRef(new Float32Array(N * N));

  const nv = new Float32Array(N * N);
  const nw = new Float32Array(N * N);
  const ns = new Float32Array(N * N);

  const [metrics, setMetrics] = useState({ mean: 0, var: 0 });

  // =============================
  // NEIGHBOR OFFSETS
  // =============================

  function buildOffsets(r) {
    const arr = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          arr.push([dx, dy]);
        }
      }
    }
    return arr;
  }

  const W_OFF = buildOffsets(WR);
  const S_OFF = buildOffsets(SR);

  // =============================
  // INITIALIZATION
  // =============================

  function init() {
    for (let i = 0; i < N * N; i++) {
      v.current[i] = Math.random() < INIT_DENSITY ? Math.random() : 0;
      w.current[i] = 0.5 + 0.1 * Math.random();
      s.current[i] = 0.5 + 0.1 * Math.random();
    }
  }

  // =============================
  // CLAMP
  // =============================

  function clamp(x) {
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  // =============================
  // UPDATE STEP
  // =============================

  function step() {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;

        const vi = v.current[i];
        const wi = w.current[i];
        const si = s.current[i];

        // water diffusion
        let wsum = 0;
        for (const [dx, dy] of W_OFF) {
          const nx = (x + dx + N) % N;
          const ny = (y + dy + N) % N;
          wsum += w.current[ny * N + nx];
        }
        const wavg = wsum / W_OFF.length;
        const wflow = wavg - wi;

        // long-range vegetation competition
        let vLong = 0;
        for (const [dx, dy] of W_OFF) {
          const nx = (x + dx + N) % N;
          const ny = (y + dy + N) % N;
          vLong += v.current[ny * N + nx];
        }
        vLong /= W_OFF.length;

        // short-range seeding
        let vseed = 0;
        for (const [dx, dy] of S_OFF) {
          const nx = (x + dx + N) % N;
          const ny = (y + dy + N) % N;
          vseed += v.current[ny * N + nx];
        }
        vseed /= S_OFF.length;

        // vegetation
        const growth = (alpha * wi * si) / (1 + beta * wi);
        nv[i] = clamp(
          vi +
          growth * vi -
          mort * vi +
          eps * vseed * (1 - vi)
        );

        // water
        nw[i] = clamp(
          wi +
          R -
          E * wi -
          vi * wi * (1 + si) -
          longComp * vLong * wi +
          waterDiff * wflow
        );

        // soil
        ns[i] = clamp(
          si + 0.06 * vi - 0.04 * si
        );
      }
    }

    v.current.set(nv);
    w.current.set(nw);
    s.current.set(ns);
  }

  // =============================
  // METRICS
  // =============================

  function computeMetrics() {
    let sum = 0;
    for (let i = 0; i < N * N; i++) sum += v.current[i];
    const mean = sum / (N * N);

    let varsum = 0;
    for (let i = 0; i < N * N; i++) {
      const d = v.current[i] - mean;
      varsum += d * d;
    }

    setMetrics({ mean, var: varsum / (N * N) });
  }

  // =============================
  // DRAW
  // =============================

  function draw() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(N, N);

    for (let i = 0; i < N * N; i++) {
      const g = v.current[i] * 255;
      img.data[i * 4 + 0] = 0;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = 0;
      img.data[i * 4 + 3] = 255;
    }

    ctx.putImageData(img, 0, 0);
  }

  // =============================
  // ANIMATION LOOP
  // =============================

  useEffect(() => {
    init();

    let frame;
    function loop() {
      for (let i = 0; i < STEPS_PER_FRAME; i++) step();
      computeMetrics();
      draw();
      frame = requestAnimationFrame(loop);
    }

    loop();
    return () => cancelAnimationFrame(frame);
  }, [R]);

  // =============================
  // UI
  // =============================

  return (
    <div style={{ textAlign: "center", fontFamily: "sans-serif" }}>
      <h2>Vegetation Pattern Formation (Turing CA)</h2>

      <canvas
        ref={canvasRef}
        width={N}
        height={N}
        style={{ border: "1px solid black", imageRendering: "pixelated" }}
      />

      <div style={{ marginTop: 10 }}>
        Rainfall:
        <input
          type="range"
          min="0"
          max="0.5"
          step="0.01"
          value={R}
          onChange={(e) => setR(parseFloat(e.target.value))}
          style={{ width: 300, marginLeft: 10 }}
        />
        {R.toFixed(2)}
      </div>

      <div style={{ marginTop: 10 }}>
        Mean Vegetation: {metrics.mean.toFixed(3)} |
        Variance: {metrics.var.toFixed(5)}
      </div>

      <button
        style={{ marginTop: 10 }}
        onClick={() => init()}
      >
        Reset
      </button>
    </div>
  );
}
