import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend, ComposedChart,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
// FRUSTRATED CML — COMPLETE SIMULATION + THEORY GRAPHS
// Based on: "Critical Phase Transitions in Frustrated Cellular Automata"
// A ≡ u21·√2, B ≡ u22,  εc = A/[2(2A-B)]
// ═══════════════════════════════════════════════════════════════════

// ── Palette ─────────────────────────────────────────────────────────
const C = {
  bg:"#05080f", panel:"#090e1a", card:"#0c1220", border:"#14213a",
  border2:"#1e3050", amber:"#f59e0b", amberL:"#fcd34d", amberD:"#78450a",
  cyan:"#22d3ee", cyanD:"#0e7490", rose:"#fb7185", roseD:"#9f1239",
  green:"#4ade80", greenD:"#166534", violet:"#a78bfa", violetD:"#4c1d95",
  blue:"#60a5fa", blueD:"#1e3a5f",
  muted:"#3d566e", text:"#b8cce0", dim:"#4a6070", dimL:"#7a90a0",
  white:"#e8f4ff", grid:"#0f1a2b",
};
const tt = {
  background:"#080d18", border:`1px solid ${C.border2}`,
  borderRadius:6, fontFamily:"'Courier New', monospace", fontSize:10, color:C.text,
};

// ── Math ─────────────────────────────────────────────────────────────
const sgn = v => v > 0 ? 1 : v < 0 ? -1 : 0;

const computeEc = (A, B) => {
  if (B === 0 || sgn(A) === sgn(B)) return null;
  const d = 2*(2*A - B);
  if (Math.abs(d) < 1e-12) return null;
  const ec = A / d;
  return ec > 0 ? ec : null;
};

// g(k,ε) = log|A cosk + B| + log|1 + 2ε cosk|
const gRate = (k, A, B, eps) => {
  const lc = A*Math.cos(k) + B;
  const le = 1 + 2*eps*Math.cos(k);
  if (Math.abs(lc) < 1e-14 || Math.abs(le) < 1e-14) return -Infinity;
  return Math.log(Math.abs(lc)) + Math.log(Math.abs(le));
};

// g''(π,ε) = A/(B-A) + 2ε/(1-2ε)
const gCurv = (A, B, eps) => A/(B-A) + (Math.abs(1-2*eps)>1e-12 ? 2*eps/(1-2*eps) : Infinity);

// cos k* = -(A + 2εB)/(4εA)
const cosKstar = (A, B, eps) => {
  const d = 4*eps*A;
  if (Math.abs(d) < 1e-12) return null;
  const v = -(A + 2*eps*B)/d;
  return Math.abs(v) <= 1 ? v : null;
};

// ── Seeded RNG (LCG) ─────────────────────────────────────────────────
const rng = seed => {
  let s = seed >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s/0x100000000; };
};

// ── CA Core (Definition 2.2, Steps 1–4) ─────────────────────────────
// Step 2: ψ^U_i = (A/2)(ψ_{i-1}+ψ_{i+1}) + Bψ_i  → Fourier: (Acosk+B)ψ̃_k
// Step 3: ψ''_i = ψ^U_i + ε(ψ^U_{i-1}+ψ^U_{i+1})  → ×(1+2εcosk)
function caStep(psi, A, B, eps) {
  const L = psi.length;
  const U = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    U[i] = (A/2)*(psi[(i-1+L)%L] + psi[(i+1)%L]) + B*psi[i];
  }
  const pp = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    pp[i] = U[i] + eps*(U[(i-1+L)%L] + U[(i+1)%L]);
  }
  let norm = 0;
  for (let i = 0; i < L; i++) norm += pp[i]*pp[i];
  norm = Math.sqrt(norm) || 1;
  return pp.map(v => v/norm);
}

// ── Real DFT power spectrum ──────────────────────────────────────────
function powerSpectrum(psi) {
  const N = psi.length;
  const half = Math.floor(N/2) + 1;
  const P = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const a = 2*Math.PI*k*n/N;
      re += psi[n]*Math.cos(a);
      im -= psi[n]*Math.sin(a);
    }
    P[k] = (re*re + im*im)/N;
  }
  return P;
}

// ── Colormaps ────────────────────────────────────────────────────────
// RdBu diverging centered at 0
const divColor = (v, scale) => {
  const t = Math.max(-1, Math.min(1, v/Math.max(scale, 1e-9)));
  if (t >= 0) {
    // positive: dark → amber/orange
    const r = Math.round(255*Math.min(1, 0.2 + 1.5*t));
    const g = Math.round(255*Math.min(1, 0.3*t));
    const b = Math.round(20);
    return [r, g, b];
  } else {
    // negative: dark → cyan/blue
    const s = -t;
    const r = Math.round(20);
    const g = Math.round(255*Math.min(1, 0.5*s));
    const b = Math.round(255*Math.min(1, 0.2 + 1.5*s));
    return [r, g, b];
  }
};

// Power spectrum colormap (black → violet → white)
const specColor = (v, maxV) => {
  const t = Math.min(1, v/Math.max(maxV, 1e-9));
  const r = Math.round(255*Math.pow(t, 0.5));
  const g = Math.round(255*Math.pow(t, 0.8)*0.3);
  const b = Math.round(255*Math.min(1, t*1.2));
  return [r, g, b];
};

// ── Phase map colormap ──────────────────────────────────────────────
const phaseColor = (A, B, eps, ec) => {
  if (Math.abs(A) < 0.05 || Math.abs(B) < 0.05) return "#1a2030"; // trivial
  if (sgn(A) === sgn(B)) return C.blueD; // FM
  if (!ec || ec <= 0) return "#1a2030";
  if (eps < ec*0.97) return C.amberD;   // AFM
  if (eps > ec*1.03) return C.greenD;   // Incomm.
  return C.roseD; // critical
};

// ── UI Components ────────────────────────────────────────────────────
const Card = ({children, style={}}) => (
  <div style={{background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"16px 20px", ...style}}>
    {children}
  </div>
);

const SecLabel = ({children, color=C.dim}) => (
  <div style={{fontFamily:"monospace", fontSize:9, letterSpacing:"0.18em",
    textTransform:"uppercase", color, marginBottom:8}}>{children}</div>
);

const Stat = ({label, value, color=C.amber, small=false}) => (
  <div style={{background:C.bg, border:`1px solid ${C.border}`, borderRadius:6, padding:small?"6px 10px":"8px 12px"}}>
    <div style={{fontSize:7, letterSpacing:"0.14em", color:C.dim, textTransform:"uppercase", marginBottom:3}}>{label}</div>
    <div style={{fontFamily:"monospace", fontSize:small?11:13, fontWeight:700, color}}>{value}</div>
  </div>
);

const Badge = ({label, color}) => (
  <span style={{display:"inline-block", padding:"3px 12px", borderRadius:20, fontSize:10,
    fontFamily:"monospace", fontWeight:700,
    background:color+"25", border:`1px solid ${color}60`, color}}>{label}</span>
);

function Slider({label, value, min, max, step, onChange, color=C.amber}) {
  return (
    <div style={{flex:1, minWidth:160}}>
      <div style={{display:"flex", justifyContent:"space-between", marginBottom:3}}>
        <span style={{fontFamily:"monospace", fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.1em"}}>{label}</span>
        <span style={{fontFamily:"monospace", fontSize:12, fontWeight:700, color}}>{value.toFixed(5)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(parseFloat(e.target.value))}
        style={{width:"100%", accentColor:color, cursor:"pointer"}}/>
      <div style={{display:"flex", justifyContent:"space-between", marginTop:1}}>
        <span style={{fontSize:8, fontFamily:"monospace", color:C.muted}}>{min}</span>
        <span style={{fontSize:8, fontFamily:"monospace", color:C.muted}}>{max}</span>
      </div>
    </div>
  );
}

// ── Canvas Heatmap ───────────────────────────────────────────────────
function Heatmap({data, width, height, colorFn, title, subtitle}) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !data || data.length === 0) return;
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const T = data.length, L = data[0].length;
    canvas.width = L; canvas.height = T;
    // Find scale
    let maxAbs = 0;
    for (const row of data) for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v));
    const img = ctx.createImageData(L, T);
    for (let t = 0; t < T; t++) {
      for (let i = 0; i < L; i++) {
        const [r,g,b] = colorFn(data[t][i], maxAbs);
        const idx = (t*L + i)*4;
        img.data[idx]=r; img.data[idx+1]=g; img.data[idx+2]=b; img.data[idx+3]=255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Stretch to display size
    const disp = ref.current.parentElement;
    if (disp) {
      ref.current.style.width = "100%";
      ref.current.style.height = height+"px";
      ref.current.style.imageRendering = "pixelated";
    }
  }, [data, colorFn, height]);

  return (
    <div>
      {title && <SecLabel>{title}</SecLabel>}
      {subtitle && <div style={{fontSize:9, color:C.dim, marginBottom:8}}>{subtitle}</div>}
      <div style={{position:"relative", height, background:C.bg, borderRadius:6, overflow:"hidden",
        border:`1px solid ${C.border}`}}>
        <canvas ref={ref} style={{display:"block", width:"100%", height:"100%", imageRendering:"pixelated"}}/>
        <div style={{position:"absolute", bottom:4, left:8, fontSize:8, fontFamily:"monospace", color:C.dimL}}>
          t=0 (top) → t=T (bottom) · i=0…L-1 (left→right)
        </div>
      </div>
    </div>
  );
}

// ── Phase diagram (A,B plane) canvas ────────────────────────────────
function PhaseDiagram({eps}) {
  const ref = useRef(null);
  const N = 200;
  useEffect(() => {
    if (!ref.current) return;
    const ctx = ref.current.getContext("2d");
    ref.current.width = N; ref.current.height = N;
    const img = ctx.createImageData(N, N);
    const Arange = [-2, 2], Brange = [-2, 2];
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const A = Arange[0] + (col/N)*(Arange[1]-Arange[0]);
        const B = Brange[1] - (row/N)*(Brange[1]-Brange[0]); // flip y
        const ec = computeEc(A, B);
        let r=10,g=16,b=28; // default bg
        if (Math.abs(A) < 0.07 || Math.abs(B) < 0.07) {
          r=18;g=22;b=35; // trivial
        } else if (sgn(A) === sgn(B)) {
          // FM
          r=8;g=30;b=80;
        } else if (ec && eps < ec*0.92) {
          // AFM
          r=100;g=60;b=5;
        } else if (ec && eps > ec*1.08) {
          // Incommensurate
          r=10;g=80;b=30;
        } else if (ec) {
          // Critical
          r=150;g=20;b=40;
        }
        const idx = (row*N+col)*4;
        img.data[idx]=r; img.data[idx+1]=g; img.data[idx+2]=b; img.data[idx+3]=255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Draw axes
    ctx.strokeStyle="#ffffff30"; ctx.lineWidth=0.5;
    ctx.beginPath(); ctx.moveTo(N/2,0); ctx.lineTo(N/2,N); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,N/2); ctx.lineTo(N,N/2); ctx.stroke();
    // Current point
    // We don't have A,B here, just show the diagram
  }, [eps]);
  return (
    <canvas ref={ref} style={{width:"100%", height:"100%", imageRendering:"pixelated",
      borderRadius:6, border:`1px solid ${C.border}`}}/>
  );
}

// ══════════════════════════════════════════════════════════════════════
export default function App() {
  const [A, setA]     = useState(1.0);
  const [B, setB]     = useState(-1/Math.SQRT2);
  const [eps, setEps] = useState(0.12);
  const [L]           = useState(120);
  const [T]           = useState(250);
  const [tab, setTab] = useState("sim");
  const [seed]        = useState(42);

  const ec   = useMemo(() => computeEc(A, B), [A, B]);
  const curv = useMemo(() => gCurv(A, B, eps), [A, B, eps]);
  const kStar = useMemo(() => {
    if (!ec || eps <= ec) return null;
    const cv = cosKstar(A, B, eps);
    return cv !== null ? Math.acos(cv) : null;
  }, [A, B, eps, ec]);

  const isFrustrated = ec !== null;
  const phase = !isFrustrated ? (sgn(A)===sgn(B)?"Ferromagnetic":"Trivial")
    : eps < ec-0.004 ? "Antiferromagnetic"
    : Math.abs(eps-ec) < 0.004 ? "Critical"
    : "Incommensurate";
  const phCol = {Ferromagnetic:C.blue, Antiferromagnetic:C.amber,
    Critical:C.rose, Incommensurate:C.green, Trivial:C.muted}[phase];

  // ── Run CA simulation ─────────────────────────────────────────────
  const {history, specHistory} = useMemo(() => {
    const rand = rng(seed);
    let psi = Float64Array.from({length:L}, () => rand()-0.5);
    let norm = Math.sqrt(psi.reduce((s,v)=>s+v*v,0));
    psi = psi.map(v=>v/norm);
    const history = [Array.from(psi)];
    const specHistory = [];
    // Sparse spectrum saves: every 10 steps
    for (let t = 0; t < T; t++) {
      psi = caStep(psi, A, B, eps);
      history.push(Array.from(psi));
      if (t%10 === 0 || t === T-1) specHistory.push({t, P:Array.from(powerSpectrum(psi))});
    }
    return {history, specHistory};
  }, [A, B, eps, L, T, seed]);

  // ── Spectrum chart data ───────────────────────────────────────────
  const specData = useMemo(() => {
    const half = Math.floor(L/2)+1;
    return Array.from({length:half}, (_,k) => {
      const kval = (k/L)*2*Math.PI; // actual k
      const kpi = kval/Math.PI;
      const row = {kpi:+kpi.toFixed(4)};
      // early, mid, final
      const snapshots = [0, Math.floor(specHistory.length/3),
        Math.floor(2*specHistory.length/3), specHistory.length-1];
      snapshots.forEach((si,idx) => {
        const sn = specHistory[Math.min(si, specHistory.length-1)];
        row[`t${idx}`] = sn ? +(sn.P[k]||0).toFixed(6) : 0;
      });
      return row;
    });
  }, [specHistory, L]);

  // ── Growth rate data ──────────────────────────────────────────────
  const growthData = useMemo(() => {
    if (!ec) return [];
    const epsList = [ec*0.25, ec*0.6, ec, ec*1.5, ec*2.5];
    const colors = [C.cyanD, C.cyan, C.rose, C.amber, C.green];
    return {
      curves: Array.from({length:301}, (_,i) => {
        const k = (i/300)*Math.PI;
        const row = {kpi:+(k/Math.PI).toFixed(4)};
        epsList.forEach((e,j) => {
          const g = gRate(k, A, B, e);
          row[`e${j}`] = isFinite(g) ? +g.toFixed(5) : null;
        });
        return row;
      }),
      live: Array.from({length:301}, (_,i) => {
        const k = (i/300)*Math.PI;
        const g = gRate(k, A, B, eps);
        return {kpi:+(k/Math.PI).toFixed(4), g: isFinite(g)?+g.toFixed(5):null};
      }),
      epsList, colors,
      labels: epsList.map(e=>`ε=${e.toFixed(4)}`),
    };
  }, [A, B, eps, ec]);

  // ── Bifurcation data ──────────────────────────────────────────────
  const bifData = useMemo(() => {
    if (!ec) return [];
    return Array.from({length:600}, (_,i) => {
      const e = 0.001 + (i/599)*(Math.min(ec*4, 0.92)-0.001);
      if (e < ec) return {eps:+e.toFixed(5), stable:1, kPlus:null, kMinus:null};
      const cv = cosKstar(A, B, e);
      const kth = cv!==null ? Math.acos(cv)/Math.PI : 1;
      return {eps:+e.toFixed(5), stable:null, kPlus:kth, kMinus:-kth, unstable:1};
    });
  }, [A, B, ec]);

  // ── Curvature data ────────────────────────────────────────────────
  const curvData = useMemo(() => {
    if (!ec) return [];
    return Array.from({length:400}, (_,i) => {
      const e = 0.005 + (i/399)*(Math.min(ec*3.5, 0.47)-0.005);
      const c = gCurv(A, B, e);
      return {
        eps:+e.toFixed(4),
        curv: isFinite(c)?+c.toFixed(5):null,
        t1:+(A/(B-A)).toFixed(5),
        t2:Math.abs(1-2*e)>1e-9?+((2*e)/(1-2*e)).toFixed(5):null,
      };
    });
  }, [A, B, ec]);

  // ── Scaling: k*(ε) and ξ ─────────────────────────────────────────
  const scalingData = useMemo(() => {
    if (!ec) return {kstar:[], xi:[]};
    const kstar = Array.from({length:400}, (_,i) => {
      const e = 0.001 + (i/399)*(Math.min(ec*4, 0.9)-0.001);
      const cv = e>ec ? cosKstar(A,B,e) : null;
      return {eps:+e.toFixed(4), kstar: cv!==null ? +(Math.acos(cv)/Math.PI).toFixed(5) : (e<ec?1:null)};
    });
    const xi = [];
    for (let i=1; i<=120; i++) {
      const de = i*0.001;
      if (ec-de>0) xi.push({de:-de, xi:+(1/Math.sqrt(de)).toFixed(3)});
    }
    for (let i=1; i<=120; i++) {
      const de = i*0.001;
      if (ec+de<0.9) xi.push({de, xi:+(1/Math.sqrt(de)).toFixed(3)});
    }
    return {kstar, xi:xi.sort((a,b)=>a.de-b.de)};
  }, [A, B, ec]);

  const TABS = [
    {id:"sim",  label:"CA Simulation"},
    {id:"grate",label:"Growth Rate"},
    {id:"bif",  label:"Bifurcation"},
    {id:"curv", label:"Curvature"},
    {id:"phase",label:"Phase Diagram"},
    {id:"scale",label:"Scaling"},
  ];

  // ── Layout ────────────────────────────────────────────────────────
  return (
    <div style={{background:C.bg, minHeight:"100vh", color:C.text,
      fontFamily:"'Courier New', monospace"}}>

      {/* HEADER */}
      <div style={{background:C.panel, borderBottom:`1px solid ${C.border}`, padding:"14px 26px"}}>
        <div style={{fontSize:8, letterSpacing:"0.25em", color:C.amberD, textTransform:"uppercase", marginBottom:5}}>
          Frustrated Coupled-Map Lattice · Critical Phase Transition
        </div>
        <h1 style={{margin:0, fontSize:18, fontWeight:900, color:C.white, fontFamily:"monospace"}}>
          Incommensurate Order Transition via Projective Normalization
        </h1>
        <div style={{marginTop:6, display:"flex", gap:20, flexWrap:"wrap", fontSize:9, color:C.dim}}>
          <span>Def 2.2: A≡u₂₁√2, B≡u₂₂</span>
          <span style={{color:C.border2}}>·</span>
          <span>Thm 5.2: εc = A/[2(2A−B)]</span>
          <span style={{color:C.border2}}>·</span>
          <span>Thm 6.1: cos k* = −(A+2εB)/(4εA)</span>
          <span style={{color:C.border2}}>·</span>
          <span>ν = 1/2 (mean-field exact)</span>
        </div>
      </div>

      {/* CONTROLS */}
      <div style={{background:C.panel, borderBottom:`1px solid ${C.border}`, padding:"12px 26px"}}>
        <div style={{display:"flex", gap:20, alignItems:"flex-end", flexWrap:"wrap"}}>
          <Slider label="A (hopping)" value={A} min={0.1} max={2.0} step={0.01} onChange={setA} color={C.amber}/>
          <Slider label="B (on-site)" value={B} min={-2.0} max={2.0} step={0.001} onChange={setB} color={C.cyan}/>
          <Slider label="ε (coupling)" value={eps} min={0.001} max={0.6} step={0.001} onChange={setEps} color={C.green}/>
          <div style={{display:"flex", gap:8, flexWrap:"wrap", paddingBottom:2}}>
            <button onClick={()=>{setA(1);setB(-1/Math.SQRT2);setEps(0.12);}}
              style={{background:C.amberD+"35",border:`1px solid ${C.amberD}`,color:C.amber,borderRadius:5,padding:"4px 10px",cursor:"pointer",fontSize:8,fontFamily:"monospace"}}>
              Hadamard (ε&lt;εc)
            </button>
            <button onClick={()=>{setA(1);setB(-1/Math.SQRT2);setEps(0.28);}}
              style={{background:C.greenD+"35",border:`1px solid ${C.greenD}`,color:C.green,borderRadius:5,padding:"4px 10px",cursor:"pointer",fontSize:8,fontFamily:"monospace"}}>
              Hadamard (ε&gt;εc)
            </button>
            <button onClick={()=>{setA(1.5);setB(-0.5);setEps(0.15);}}
              style={{background:C.border,border:`1px solid ${C.border2}`,color:C.dim,borderRadius:5,padding:"4px 10px",cursor:"pointer",fontSize:8,fontFamily:"monospace"}}>
              A=1.5 B=-0.5
            </button>
          </div>
        </div>
        {/* Stats bar */}
        <div style={{display:"flex", gap:8, marginTop:10, flexWrap:"wrap", alignItems:"center"}}>
          <Badge label={phase} color={phCol}/>
          <div style={{fontSize:9, color:C.dim, fontFamily:"monospace"}}>
            εc = {ec?ec.toFixed(6):"n/a"}
          </div>
          <div style={{fontSize:9, color:C.dim}}>·</div>
          <div style={{fontSize:9, color:C.dim, fontFamily:"monospace"}}>
            ε/εc = {ec?(eps/ec).toFixed(4):"—"}
          </div>
          <div style={{fontSize:9, color:C.dim}}>·</div>
          <div style={{fontSize:9, color:C.dim, fontFamily:"monospace"}}>
            k*/π = {kStar?(kStar/Math.PI).toFixed(5):"1.00000 (AFM)"}
          </div>
          <div style={{fontSize:9, color:C.dim}}>·</div>
          <div style={{fontSize:9, color:(curv>0.01?C.green:curv<-0.01?C.rose:C.amber), fontFamily:"monospace"}}>
            g''(π,ε) = {isFinite(curv)?curv.toFixed(5):"∞"}
          </div>
        </div>
      </div>

      {/* TABS */}
      <div style={{background:C.panel, borderBottom:`1px solid ${C.border}`, display:"flex", padding:"0 26px", overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            background:"none", border:"none", cursor:"pointer", padding:"10px 16px",
            fontFamily:"monospace", fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase",
            whiteSpace:"nowrap",
            color:tab===t.id?C.amber:C.dim,
            borderBottom:tab===t.id?`2px solid ${C.amber}`:"2px solid transparent",
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{padding:"20px 26px", maxWidth:1400}}>

        {/* ══ SIMULATION TAB ══════════════════════════════════════════ */}
        {tab==="sim" && (
          <div style={{display:"grid", gridTemplateColumns:"2fr 1fr", gap:16}}>

            <div style={{display:"flex", flexDirection:"column", gap:14}}>

              {/* Space-time heatmap */}
              <Card>
                <SecLabel color={C.amber}>Space-Time Evolution  ψᵢ(t)</SecLabel>
                <div style={{fontSize:9, color:C.dim, lineHeight:1.7, marginBottom:10}}>
                  {phase==="Antiferromagnetic"
                    ? `AFM phase: alternating-sign pattern (k=π). Staggered ↑↓↑↓ order dominates.`
                    : phase==="Incommensurate"
                    ? `Incommensurate phase: longer-wavelength modulation at k*=${kStar?(kStar/Math.PI).toFixed(4)+"π":"n/a"}.`
                    : `Phase: ${phase}. ε/εc = ${ec?(eps/ec).toFixed(3):"n/a"}.`}
                  {" "}Orange = positive, Blue = negative amplitude. L={L} sites, T={T} steps.
                </div>
                <Heatmap data={history} width={L} height={260} colorFn={divColor}/>
              </Card>

              {/* Fourier power spectrum evolution */}
              <Card>
                <SecLabel color={C.violet}>Fourier Power Spectrum  P(k) = |ψ̃ₖ|²  at 4 Snapshots</SecLabel>
                <div style={{fontSize:9, color:C.dim, marginBottom:10, lineHeight:1.7}}>
                  Spectrum narrows around dominant mode as t→∞. Power law 5.1: state concentrates on
                  K*(ε) = argmax g(k,ε). {kStar?`Expected peak: k* = ${(kStar/Math.PI).toFixed(4)}π`:"Expected peak: k = π (AFM)"}
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={specData} margin={{top:8,right:20,bottom:36,left:20}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid}/>
                    <XAxis dataKey="kpi" type="number" domain={[0,1]} stroke={C.dim}
                      tick={{fontSize:8,fill:C.dim}} tickFormatter={v=>`${v}π`}
                      label={{value:"Wavevector k/π", position:"insideBottom", offset:-10, fill:C.dim, fontSize:9}}/>
                    <YAxis stroke={C.dim} tick={{fontSize:8,fill:C.dim}}
                      label={{value:"P(k)", angle:-90, position:"insideLeft", fill:C.dim, fontSize:9}}/>
                    <Tooltip contentStyle={tt} formatter={(v,n)=>[v?.toFixed(6),n]}
                      labelFormatter={v=>`k/π=${(+v).toFixed(4)}`}/>
                    {kStar && <ReferenceLine x={kStar/Math.PI} stroke={C.green} strokeDasharray="4 3"
                      label={{value:"k*",fill:C.green,fontSize:9}}/>}
                    <ReferenceLine x={1} stroke={C.cyan} strokeDasharray="4 3"
                      label={{value:"k=π",fill:C.cyan,fontSize:9}}/>
                    {["t0","t1","t2","t3"].map((k,i)=>(
                      <Line key={k} type="monotone" dataKey={k} dot={false} connectNulls
                        stroke={[C.border2,C.violet,C.amber,C.green][i]} strokeWidth={i===3?2.5:1.5}
                        name={["early","early-mid","late","final"][i]}/>
                    ))}
                    <Legend wrapperStyle={{fontSize:9,fontFamily:"monospace",paddingTop:8}}/>
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </div>

            {/* Sidebar */}
            <div style={{display:"flex", flexDirection:"column", gap:12}}>
              <Card>
                <SecLabel>Evolution Protocol (Def 2.2)</SecLabel>
                {[
                  {n:"Step 1", c:C.cyan, eq:"φ¹ᵢ = (ψᵢ₋₁+ψᵢ₊₁)/√2", note:"Spatial mixing"},
                  {n:"Step 2", c:C.amber, eq:"ψᵁᵢ = (A/2)(ψᵢ₋₁+ψᵢ₊₁)+Bψᵢ", note:"Coin op → λc=Acosk+B"},
                  {n:"Step 3", c:C.green, eq:"ψ″ᵢ = ψᵁᵢ+ε(ψᵁᵢ₋₁+ψᵁᵢ₊₁)", note:"NN coupling → λε=1+2εcosk"},
                  {n:"Step 4", c:C.violet, eq:"ψ(t+1)=ψ″/‖ψ″‖", note:"Projective normalization"},
                ].map(({n,c,eq,note})=>(
                  <div key={n} style={{borderLeft:`2px solid ${c}`, paddingLeft:10, marginBottom:10}}>
                    <div style={{fontSize:9, color:c, fontWeight:700}}>{n}</div>
                    <div style={{fontSize:10, color:C.white, margin:"3px 0"}}>{eq}</div>
                    <div style={{fontSize:8, color:C.dim}}>{note}</div>
                  </div>
                ))}
              </Card>

              <Card>
                <SecLabel>NNN Structure (Eq. 6)</SecLabel>
                <div style={{fontSize:9, color:C.dim, lineHeight:1.7, marginBottom:8}}>
                  Composing Steps 2+3 generates effective interactions:
                </div>
                <div style={{background:C.bg, borderRadius:6, padding:"8px 10px", fontSize:9, lineHeight:2, border:`1px solid ${C.border}`}}>
                  <div><span style={{color:C.amber}}>On-site:</span> {`(B+2εA)ψᵢ`}</div>
                  <div><span style={{color:C.cyan}}>NN:</span> {`(A+εB)(ψᵢ₋₁+ψᵢ₊₁)`}</div>
                  <div><span style={{color:C.green}}>NNN:</span> {`εA(ψᵢ₋₂+ψᵢ₊₂)`}</div>
                </div>
                <div style={{marginTop:10, display:"grid", gridTemplateColumns:"1fr 1fr", gap:6}}>
                  <Stat small label="J¹eff=A+εB" value={(A+eps*B).toFixed(4)} color={A+eps*B>0?C.green:C.rose}/>
                  <Stat small label="J²eff=εA" value={(eps*A).toFixed(4)} color={C.cyan}/>
                  <Stat small label="κ=J²/J¹" value={Math.abs(A+eps*B)>1e-9?((eps*A)/(A+eps*B)).toFixed(4):"∞"} color={C.violet}/>
                  <Stat small label="L sites" value={L} color={C.dim}/>
                </div>
              </Card>

              <Card>
                <SecLabel>Parameters</SecLabel>
                <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:6}}>
                  <Stat small label="A" value={A.toFixed(5)} color={C.amber}/>
                  <Stat small label="B" value={B.toFixed(5)} color={C.cyan}/>
                  <Stat small label="εc" value={ec?ec.toFixed(6):"N/A"} color={C.rose}/>
                  <Stat small label="ε" value={eps.toFixed(5)} color={C.green}/>
                  <Stat small label="ε/εc" value={ec?(eps/ec).toFixed(4):"—"} color={C.amber}/>
                  <Stat small label="k*/π" value={kStar?(kStar/Math.PI).toFixed(5):"1 (AFM)"} color={C.green}/>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ══ GROWTH RATE TAB ══════════════════════════════════════════ */}
        {tab==="grate" && (
          <div style={{display:"flex", flexDirection:"column", gap:16}}>

            <Card>
              <SecLabel color={C.amber}>Def 4.1 — Logarithmic Growth Rate  g(k,ε) = log|Acosk+B| + log|1+2εcosk|</SecLabel>
              <div style={{fontSize:9, color:C.dim, lineHeight:1.7, marginBottom:14}}>
                Under projective dynamics, the state concentrates on K*(ε) = argmax g(k,ε).
                Five curves at ε = 0.25εc, 0.6εc, εc (critical), 1.5εc, 2.5εc.
                At εc: curvature g″(π,εc) = 0 → flat plateau. Above εc: peak splits to ±k*.
              </div>
              {!ec ? (
                <div style={{color:C.rose, fontSize:11, padding:20}}>Set frustrated parameters: sgn(A) ≠ sgn(B).</div>
              ) : (
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={growthData.curves} margin={{top:10,right:24,bottom:40,left:24}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid}/>
                    <XAxis dataKey="kpi" type="number" domain={[0,1]} stroke={C.dim}
                      tick={{fontSize:8,fill:C.dim}} tickFormatter={v=>`${v}π`}
                      label={{value:"Wavevector k/π",position:"insideBottom",offset:-10,fill:C.dim,fontSize:10}}/>
                    <YAxis stroke={C.dim} tick={{fontSize:8,fill:C.dim}}
                      label={{value:"g(k,ε)",angle:-90,position:"insideLeft",fill:C.dim,fontSize:10}}/>
                    <Tooltip contentStyle={tt} formatter={(v,n)=>[v?.toFixed(5),n]}
                      labelFormatter={v=>`k/π=${(+v).toFixed(4)}`}/>
                    <ReferenceLine x={1} stroke={C.border2} strokeDasharray="3 3"/>
                    {kStar && <ReferenceLine x={kStar/Math.PI} stroke={C.green} strokeWidth={1} strokeDasharray="5 3"
                      label={{value:`k*=${(kStar/Math.PI).toFixed(3)}π`,fill:C.green,fontSize:8}}/>}
                    {growthData.epsList.map((e,i)=>(
                      <Line key={i} type="monotone" dataKey={`e${i}`} stroke={growthData.colors[i]}
                        strokeWidth={i===2?3:1.8} dot={false} name={growthData.labels[i]} connectNulls/>
                    ))}
                    <Legend wrapperStyle={{fontSize:9,fontFamily:"monospace",paddingTop:8}}/>
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Annotation cards */}
            {ec && (
              <div style={{display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10}}>
                {[
                  {label:"ε = 0.25εc", col:C.cyanD, note:"Sharp peak at k=π. AFM strongly dominant. g″<0 (stable)."},
                  {label:"ε = 0.6εc",  col:C.cyan,  note:"Peak still at k=π, curvature less negative. AFM weakening."},
                  {label:"ε = εc",     col:C.rose,  note:"g″(π,εc)=0. Flat plateau. Bifurcation inflection — critical."},
                  {label:"ε = 1.5εc",  col:C.amber, note:"k=π is now a LOCAL MINIMUM. Split maxima at ±k* appear."},
                  {label:"ε = 2.5εc",  col:C.green, note:"Incommensurate phase. k* peaks separate, evolve with ε."},
                ].map(({label,col,note},i)=>{
                  const e = growthData.epsList[i];
                  const gc = e ? gCurv(A,B,e) : null;
                  const cv = e>ec ? cosKstar(A,B,e) : null;
                  const ks = cv!==null ? Math.acos(cv)/Math.PI : null;
                  return (
                    <div key={label} style={{background:C.bg, border:`1px solid ${col}33`,
                      borderRadius:8, padding:"10px 12px"}}>
                      <div style={{fontSize:9, color:col, fontWeight:700, marginBottom:5}}>{label}</div>
                      <div style={{fontSize:8, color:C.dim, lineHeight:1.6, marginBottom:6}}>{note}</div>
                      <div style={{fontSize:8, color:C.dim}}>g″(π) = {gc&&isFinite(gc)?gc.toFixed(3):"n/a"}</div>
                      {ks&&<div style={{fontSize:8,color:C.amber}}>k*/π = {ks.toFixed(4)}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Live curve */}
            <Card>
              <SecLabel>Live g(k,ε) at Current ε = {eps.toFixed(5)}</SecLabel>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={growthData.live||[]} margin={{top:8,right:20,bottom:36,left:24}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid}/>
                  <XAxis dataKey="kpi" stroke={C.dim} tick={{fontSize:8,fill:C.dim}}
                    tickFormatter={v=>`${v}π`}
                    label={{value:"k/π",position:"insideBottom",offset:-10,fill:C.dim,fontSize:9}}/>
                  <YAxis stroke={C.dim} tick={{fontSize:8,fill:C.dim}}/>
                  <Tooltip contentStyle={tt} formatter={v=>[v?.toFixed(5),"g"]}/>
                  {kStar && <ReferenceLine x={kStar/Math.PI} stroke={C.green} strokeDasharray="4 3"
                    label={{value:`k*`,fill:C.green,fontSize:9}}/>}
                  <ReferenceLine x={1} stroke={C.cyan} strokeDasharray="4 3"
                    label={{value:"π",fill:C.cyan,fontSize:9}}/>
                  <Line type="monotone" dataKey="g" stroke={phCol} strokeWidth={2.5} dot={false}/>
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </div>
        )}

        {/* ══ BIFURCATION TAB ══════════════════════════════════════════ */}
        {tab==="bif" && (
          <div style={{display:"grid", gridTemplateColumns:"1fr 280px", gap:16}}>
            <div style={{display:"flex", flexDirection:"column", gap:16}}>

              <Card>
                <SecLabel color={C.amber}>Fig 1 — Supercritical Pitchfork: k*/π vs ε (Thm 6.1)</SecLabel>
                <div style={{fontSize:9, color:C.dim, lineHeight:1.7, marginBottom:12}}>
                  Below εc: unique stable fixed point k*=π (Néel AFM, cyan). At εc: Z₂ symmetry breaks.
                  Above εc: degenerate pair ±k*(ε) (Eq. 19) emerges continuously — supercritical pitchfork.
                  Width Δk ~ √|ε−εc|, giving ξ ~ |ε−εc|^(−1/2), ν=1/2.
                </div>
                {!ec ? <div style={{color:C.rose,fontSize:11,padding:20}}>Set frustrated parameters.</div> : (
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart data={bifData} margin={{top:10,right:20,bottom:40,left:20}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid}/>
                      <XAxis dataKey="eps" type="number" domain={["dataMin","dataMax"]}
                        stroke={C.dim} tick={{fontSize:8,fill:C.dim}}
                        label={{value:"Coupling ε",position:"insideBottom",offset:-10,fill:C.dim,fontSize:10}}/>
                      <YAxis domain={[-1.1,1.1]} stroke={C.dim} tick={{fontSize:8,fill:C.dim}}
                        label={{value:"k*/π",angle:-90,position:"insideLeft",fill:C.dim,fontSize:10}}/>
                      <Tooltip contentStyle={tt} formatter={(v,n)=>[v?.toFixed(5),n]}
                        labelFormatter={v=>`ε=${(+v).toFixed(5)}`}/>
                      <ReferenceLine y={0} stroke={C.border2}/>
                      <ReferenceLine x={ec} stroke={C.rose} strokeWidth={2} strokeDasharray="6 3"
                        label={{value:`εc=${ec.toFixed(4)}`,fill:C.rose,fontSize:9,position:"top"}}/>
                      <ReferenceLine x={eps} stroke={C.amber} strokeWidth={1.5} strokeOpacity={0.6}
                        label={{value:"ε",fill:C.amber,fontSize:8}}/>
                      <Line type="monotone" dataKey="stable" stroke={C.cyan} strokeWidth={3}
                        dot={false} name="k=π stable (AFM)" connectNulls={false}/>
                      <Line type="monotone" dataKey="unstable" stroke={C.cyanD} strokeWidth={1.5}
                        strokeDasharray="5 4" dot={false} name="k=π unstable" connectNulls={false}/>
                      <Line type="monotone" dataKey="kPlus" stroke={C.amber} strokeWidth={2.5}
                        dot={false} name="+k*/π (incommensurate)" connectNulls={false}/>
                      <Line type="monotone" dataKey="kMinus" stroke={C.green} strokeWidth={2.5}
                        dot={false} name="−k*/π (incommensurate)" connectNulls={false}/>
                      <Legend wrapperStyle={{fontSize:9,fontFamily:"monospace",paddingTop:8}}/>
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* k* formula verification */}
              {ec && eps>ec && kStar && (
                <Card>
                  <SecLabel>Thm 6.1 Verification: cos k* = −(A+2εB)/(4εA)</SecLabel>
                  <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8}}>
                    <Stat label="A+2εB" value={(A+2*eps*B).toFixed(5)} color={C.dim}/>
                    <Stat label="4εA" value={(4*eps*A).toFixed(5)} color={C.dim}/>
                    <Stat label="cos k*" value={(-(A+2*eps*B)/(4*eps*A)).toFixed(6)} color={C.amber}/>
                    <Stat label="k*/π" value={(kStar/Math.PI).toFixed(6)} color={C.green}/>
                  </div>
                </Card>
              )}
            </div>

            <div style={{display:"flex", flexDirection:"column", gap:12}}>
              <Card>
                <SecLabel>Bifurcation Theory</SecLabel>
                <div style={{fontSize:9, color:C.text, lineHeight:1.8}}>
                  <div style={{padding:"8px 10px",background:C.bg,borderRadius:6,border:`1px solid ${C.border}`,marginBottom:10,fontSize:9,lineHeight:1.9}}>
                    <div style={{color:C.amber}}>K*(ε):</div>
                    <div>{"ε < εc: {π}"}</div>
                    <div>{"ε > εc: {±k*(ε)}"}</div>
                  </div>
                  <div style={{marginBottom:8}}>
                    Z₂ symmetry k → −k: both ±k* emerge simultaneously. Hallmark of supercritical pitchfork.
                  </div>
                  <div style={{padding:"6px 10px",background:C.bg,borderRadius:6,fontSize:9,lineHeight:1.7,border:`1px solid ${C.border}`}}>
                    <div>g(k,ε) ≈ g₀ − a·δε·(δk)² − b·(δk)⁴</div>
                    <div>Δk ~ √|ε−εc|</div>
                    <div style={{color:C.violet,fontWeight:700}}>ξ ~ |ε−εc|^(−1/2)</div>
                  </div>
                </div>
              </Card>
              <Card>
                <SecLabel>Sign Table (Tbl 1)</SecLabel>
                {[
                  {r:"ε < εc",c:C.cyan,s:"< 0",n:"k=π local MAX — AFM stable"},
                  {r:"ε = εc",c:C.rose,s:"= 0",n:"inflection — bifurcation point"},
                  {r:"ε > εc",c:C.green,s:"> 0",n:"k=π local MIN — incommensurate"},
                ].map(({r,c,s,n})=>(
                  <div key={r} style={{borderLeft:`3px solid ${c}`,paddingLeft:10,marginBottom:10}}>
                    <div style={{fontSize:9,color:c,fontWeight:700}}>{r}</div>
                    <div style={{fontSize:9,color:C.text}}>{"g″(π,ε) "}{s}</div>
                    <div style={{fontSize:8,color:C.dim}}>{n}</div>
                  </div>
                ))}
              </Card>
              <Card>
                <SecLabel>Corollary 6.1 (Continuity)</SecLabel>
                <div style={{fontSize:9, color:C.text, lineHeight:1.7}}>
                  k* → π as ε → εc⁺. At ε=εc, cos k*=−1 (k*=π). Bifurcation is continuous.
                  As ε→∞: k* → arccos(−B/2A) = {(Math.acos(Math.max(-1,Math.min(1,-B/(2*A))))/Math.PI).toFixed(4)}π
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ══ CURVATURE TAB ══════════════════════════════════════════ */}
        {tab==="curv" && (
          <div style={{display:"grid", gridTemplateColumns:"1fr 280px", gap:16}}>
            <div style={{display:"flex", flexDirection:"column", gap:16}}>

              <Card>
                <SecLabel color={C.violet}>Thm 5.1 — g″(π,ε) = A/(B−A) + 2ε/(1−2ε)  vs  ε</SecLabel>
                <div style={{fontSize:9, color:C.dim, lineHeight:1.7, marginBottom:12}}>
                  Zero crossing at ε=εc signals the phase transition. Lemma 5.1: curvature of log|C cosk+D| at k=π
                  is C/(D−C). Applied separately to coin (g₁) and coupling (g₂) terms.
                </div>
                {!ec ? <div style={{color:C.rose,fontSize:11}}>Set frustrated parameters.</div> : (
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={curvData} margin={{top:10,right:24,bottom:40,left:24}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid}/>
                      <XAxis dataKey="eps" stroke={C.dim} tick={{fontSize:8,fill:C.dim}}
                        label={{value:"Coupling ε",position:"insideBottom",offset:-10,fill:C.dim,fontSize:10}}/>
                      <YAxis stroke={C.dim} tick={{fontSize:8,fill:C.dim}}
                        label={{value:"g″(π,ε)",angle:-90,position:"insideLeft",fill:C.dim,fontSize:10}}/>
                      <Tooltip contentStyle={tt} formatter={v=>[v?.toFixed(5)]}
                        labelFormatter={v=>`ε=${(+v).toFixed(4)}`}/>
                      <ReferenceLine y={0} stroke={C.white} strokeWidth={1.5}/>
                      <ReferenceLine x={ec} stroke={C.rose} strokeWidth={2} strokeDasharray="6 3"
                        label={{value:"εc",fill:C.rose,fontSize:10,position:"top"}}/>
                      <ReferenceLine x={eps} stroke={C.amber} strokeOpacity={0.6} strokeWidth={1.5}
                        label={{value:"ε",fill:C.amber,fontSize:9}}/>
                      <Line type="monotone" dataKey="t1" stroke={C.amber} strokeWidth={1.5}
                        strokeDasharray="5 3" dot={false} name="Term1: A/(B−A) [const]"/>
                      <Line type="monotone" dataKey="t2" stroke={C.cyan} strokeWidth={1.5}
                        dot={false} name="Term2: 2ε/(1−2ε) [growing]"/>
                      <Line type="monotone" dataKey="curv" stroke={C.violet} strokeWidth={2.5}
                        dot={false} name="g″(π,ε) = T1+T2"/>
                      <Legend wrapperStyle={{fontSize:9,fontFamily:"monospace",paddingTop:8}}/>
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </Card>

              <Card>
                <SecLabel>Thm 5.2 — Critical Coupling Derivation</SecLabel>
                <div style={{background:C.bg, borderRadius:8, padding:"12px 16px",
                  border:`1px solid ${C.border}`, fontSize:10, lineHeight:2.0, fontFamily:"monospace"}}>
                  <div style={{color:C.dim}}>Set g″(π,εc) = 0:</div>
                  <div>A/(B−A) + 2εc/(1−2εc) = 0</div>
                  <div style={{color:C.dim, fontSize:9}}>→  2εc(A−B) = A(1−2εc)</div>
                  <div style={{color:C.dim, fontSize:9}}>→  4εcA − 2εcB = A</div>
                  <div style={{color:C.amber, fontWeight:700}}>→  εc = A/[2(2A−B)]</div>
                  {ec && <div style={{color:C.green, marginTop:8}}>
                    At (A={A.toFixed(3)}, B={B.toFixed(3)}):  εc = {ec.toFixed(8)}
                  </div>}
                </div>
              </Card>
            </div>

            <div style={{display:"flex", flexDirection:"column", gap:12}}>
              <Card>
                <SecLabel>Live Values</SecLabel>
                <div style={{display:"flex", flexDirection:"column", gap:7}}>
                  <Stat label="A/(B−A)  [Term 1]" value={(A/(B-A)).toFixed(6)} color={C.amber}/>
                  <Stat label="2ε/(1−2ε)  [Term 2]" value={Math.abs(1-2*eps)>1e-9?((2*eps)/(1-2*eps)).toFixed(6):"∞"} color={C.cyan}/>
                  <Stat label="g″(π,ε)  [Sum]" value={isFinite(curv)?curv.toFixed(6):"∞"}
                    color={curv>0.01?C.green:curv<-0.01?C.rose:C.amber}/>
                  <Stat label="Status" value={curv>0.01?"AFM UNSTABLE":curv<-0.01?"AFM stable":"CRITICAL"}
                    color={curv>0.01?C.green:curv<-0.01?C.cyan:C.rose}/>
                  <Stat label="εc" value={ec?ec.toFixed(8):"N/A"} color={C.rose}/>
                </div>
              </Card>
              <Card>
                <SecLabel>Lem 5.1 — Curvature Formula</SecLabel>
                <div style={{fontSize:9, color:C.text, lineHeight:1.8}}>
                  For f(k)=log|C cosk+D| with D≠C:
                  <div style={{padding:"6px 10px",background:C.bg,borderRadius:6,margin:"8px 0",
                    border:`1px solid ${C.border}`,fontSize:10,color:C.amber}}>
                    f″(π) = C/(D−C)
                  </div>
                  Proof: f″(π) = [−C cosπ·h(π) − C² sin²π] / h(π)² where h=C cosk+D.
                  At k=π: cosπ=−1, sin²π=0 → f″(π) = C/(D−C). □
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ══ PHASE DIAGRAM TAB ══════════════════════════════════════════ */}
        {tab==="phase" && (
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:16}}>

            <Card>
              <SecLabel color={C.amber}>Phase Diagram in (A, B) Plane at ε = {eps.toFixed(4)}</SecLabel>
              <div style={{fontSize:9, color:C.dim, lineHeight:1.7, marginBottom:10}}>
                Color key: <span style={{color:C.blueD}}>■ FM</span>{" "}(sgn A=sgn B),{" "}
                <span style={{color:C.amberD}}>■ AFM</span>{" "}(frustrated, ε&lt;εc),{" "}
                <span style={{color:C.greenD}}>■ Incomm.</span>{" "}(ε&gt;εc),{" "}
                <span style={{color:C.roseD}}>■ Critical</span>{" "}(ε≈εc).
                Axes: A∈[−2,2], B∈[−2,2]. White lines = coordinate axes.
                Current (A,B) shown in controls.
              </div>
              <div style={{height:360, position:"relative"}}>
                <PhaseDiagram eps={eps}/>
                {/* Axis labels */}
                <div style={{position:"absolute",bottom:4,left:"50%",transform:"translateX(-50%)",
                  fontSize:9,color:C.dim,fontFamily:"monospace"}}>A →</div>
                <div style={{position:"absolute",top:"50%",left:4,transform:"translateY(-50%) rotate(-90deg)",
                  fontSize:9,color:C.dim,fontFamily:"monospace"}}>B →</div>
              </div>
              <div style={{marginTop:10, fontSize:9, color:C.dim, lineHeight:1.7}}>
                The frustrated region (sgn A ≠ sgn B) occupies quadrants II and IV (A&gt;0,B&lt;0 and A&lt;0,B&gt;0).
                Within the frustrated region, the phase boundary (the critical line ε=εc(A,B)) separates AFM from Incommensurate.
                This boundary moves as ε changes — drag the ε slider to see it shift.
              </div>
            </Card>

            <div style={{display:"flex", flexDirection:"column", gap:14}}>
              <Card>
                <SecLabel>Tbl 2 — Complete Phase Classification</SecLabel>
                <table style={{width:"100%", borderCollapse:"collapse", fontFamily:"monospace", fontSize:9}}>
                  <thead>
                    <tr style={{borderBottom:`1px solid ${C.border2}`}}>
                      {["Phase","Condition","k*","Pattern"].map(h=>(
                        <th key={h} style={{padding:"5px 8px",textAlign:"left",color:C.dim,
                          fontSize:8,letterSpacing:"0.1em",textTransform:"uppercase"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {ph:"Ferromagnetic",cond:"sgn A=sgn B",k:"0",pat:"↑↑↑",col:C.blue},
                      {ph:"AFM (Néel)",cond:"frustrated, ε<εc",k:"π",pat:"↑↓↑↓",col:C.amber},
                      {ph:"Critical",cond:"ε=εc",k:"π (marg.)",pat:"flat curv.",col:C.rose},
                      {ph:"Incommensurate",cond:"frustrated, ε>εc",k:"±k*(ε)",pat:"spiral",col:C.green},
                      {ph:"Trivial",cond:"A=0 or B=0",k:"0",pat:"decoupled",col:C.muted},
                    ].map(({ph,cond,k,pat,col})=>(
                      <tr key={ph} style={{borderBottom:`1px solid ${C.border}`}}>
                        <td style={{padding:"6px 8px",color:col,fontWeight:700}}>{ph}</td>
                        <td style={{padding:"6px 8px",color:C.dim,fontSize:8}}>{cond}</td>
                        <td style={{padding:"6px 8px",color:C.text}}>{k}</td>
                        <td style={{padding:"6px 8px",color:C.text}}>{pat}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <Card>
                <SecLabel>Tbl 3 — Benchmark εc Values</SecLabel>
                <table style={{width:"100%", borderCollapse:"collapse", fontFamily:"monospace", fontSize:9}}>
                  <thead>
                    <tr style={{borderBottom:`1px solid ${C.border2}`}}>
                      {["Coin","A","B","εc"].map(h=>(
                        <th key={h} style={{padding:"5px 8px",textAlign:"left",color:C.dim,fontSize:8,textTransform:"uppercase"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {coin:"Hadamard", A:"1", B:"−1/√2", ec:`1/(4+√2) ≈ ${(1/(4+Math.SQRT2)).toFixed(5)}`, hi:true},
                      {coin:"A=1.5, B=−0.5", A:"1.5", B:"−0.5", ec:"3/14 ≈ 0.21429"},
                      {coin:"A=0.8, B=−0.4", A:"0.8", B:"−0.4", ec:"0.2"},
                      {coin:"Pauli-X", A:"√2", B:"0", ec:"undefined (B=0)"},
                      {coin:"Pauli-Z / I", A:"0", B:"±1", ec:"undefined (A=0)"},
                    ].map(({coin,A:a,B:b,ec:e,hi})=>(
                      <tr key={coin} style={{borderBottom:`1px solid ${C.border}`,
                        background:hi?C.amberD+"15":undefined}}>
                        <td style={{padding:"6px 8px",color:hi?C.amber:C.text}}>{coin}</td>
                        <td style={{padding:"6px 8px",color:C.dim}}>{a}</td>
                        <td style={{padding:"6px 8px",color:C.dim}}>{b}</td>
                        <td style={{padding:"6px 8px",color:hi?C.amber:C.text}}>{e}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>
        )}

        {/* ══ SCALING TAB ══════════════════════════════════════════════ */}
        {tab==="scale" && (
          <div style={{display:"flex", flexDirection:"column", gap:16}}>

            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:16}}>

              {/* k*(ε) continuous evolution */}
              <Card>
                <SecLabel color={C.green}>k*(ε)/π — Continuous Mode Evolution (Cor. 6.1)</SecLabel>
                <div style={{fontSize:9, color:C.dim, lineHeight:1.7, marginBottom:10}}>
                  k*(ε) decreases continuously from π at ε=εc toward arccos(−B/2A) as ε→∞.
                  Continuity at εc: cos k*(εc) = −1. As ε→∞: k*→{(Math.acos(Math.max(-1,Math.min(1,-B/(2*A))))/Math.PI).toFixed(4)}π
                </div>
                {!ec?<div style={{color:C.rose}}>Set frustrated parameters.</div>:(
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={scalingData.kstar} margin={{top:8,right:20,bottom:36,left:20}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid}/>
                      <XAxis dataKey="eps" stroke={C.dim} tick={{fontSize:8,fill:C.dim}}
                        label={{value:"ε",position:"insideBottom",offset:-10,fill:C.dim,fontSize:10}}/>
                      <YAxis domain={[0,1.05]} stroke={C.dim} tick={{fontSize:8,fill:C.dim}}
                        label={{value:"k*/π",angle:-90,position:"insideLeft",fill:C.dim,fontSize:10}}/>
                      <Tooltip contentStyle={tt} formatter={v=>[v?.toFixed(5),"k*/π"]}
                        labelFormatter={v=>`ε=${(+v).toFixed(4)}`}/>
                      <ReferenceLine x={ec} stroke={C.rose} strokeWidth={2} strokeDasharray="6 3"
                        label={{value:"εc",fill:C.rose,fontSize:9}}/>
                      <ReferenceLine x={eps} stroke={C.amber} strokeOpacity={0.6}
                        label={{value:"ε",fill:C.amber,fontSize:9}}/>
                      <Line type="monotone" dataKey="kstar" stroke={C.green} strokeWidth={2.5}
                        dot={false} name="k*(ε)/π" connectNulls={false}/>
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* Correlation length */}
              <Card>
                <SecLabel color={C.violet}>Correlation Length  ξ ~ |ε−εc|^(−1/2)  (ν=1/2)</SecLabel>
                <div style={{fontSize:9, color:C.dim, lineHeight:1.7, marginBottom:10}}>
                  Mean-field exponent ν=1/2 is exact due to infinite-range projective constraint.
                  Symmetric divergence on both sides confirms continuous second-order transition.
                  ξ = 1/Δk ~ 1/√|ε−εc|.
                </div>
                {!ec?<div style={{color:C.rose}}>Set frustrated parameters.</div>:(
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={scalingData.xi} margin={{top:8,right:20,bottom:36,left:20}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid}/>
                      <XAxis dataKey="de" type="number" stroke={C.dim} tick={{fontSize:8,fill:C.dim}}
                        label={{value:"ε − εc",position:"insideBottom",offset:-10,fill:C.dim,fontSize:10}}/>
                      <YAxis stroke={C.dim} tick={{fontSize:8,fill:C.dim}}
                        label={{value:"ξ (arb.)",angle:-90,position:"insideLeft",fill:C.dim,fontSize:10}}/>
                      <Tooltip contentStyle={tt} formatter={v=>[v?.toFixed(3),"ξ"]}
                        labelFormatter={v=>`ε−εc=${(+v).toFixed(4)}`}/>
                      <ReferenceLine x={0} stroke={C.rose} strokeWidth={2} strokeDasharray="6 3"
                        label={{value:"εc",fill:C.rose,fontSize:10}}/>
                      <Line type="monotone" dataKey="xi" stroke={C.violet} strokeWidth={2.5}
                        dot={false} name="ξ ~ |ε−εc|^(−1/2)"/>
                      <Legend wrapperStyle={{fontSize:9,fontFamily:"monospace",paddingTop:8}}/>
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>

            {/* ANNNI mapping */}
            <Card>
              <SecLabel color={C.amber}>§9.1 — ANNNI Mapping: κeff = J²eff/J¹eff = εA/(A+εB)</SecLabel>
              <div style={{fontSize:9, color:C.dim, lineHeight:1.7, marginBottom:14}}>
                The ANNNI Lifshitz point at κ=1/2 exactly coincides with εc: κ(εc) = εcA/(A+εcB) = 1/2.
                Verification: εc(2A−B)=A → 2εcA=A+εcB → εcA/(A+εcB)=1/2. □
                {ec && ` At current εc=${ec.toFixed(5)}: κ(εc)=${((ec*A)/(A+ec*B)).toFixed(6)} ${Math.abs((ec*A)/(A+ec*B)-0.5)<0.0001?"✓":"≠ 1/2"}`}
              </div>
              {ec && (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart
                    data={Array.from({length:400},(_,i)=>{
                      const e=0.001+(i/399)*(Math.min(ec*4,0.6)-0.001);
                      const J1=A+e*B, J2=e*A;
                      const kappa=Math.abs(J1)>1e-9?J2/J1:null;
                      return {eps:+e.toFixed(4),
                        kappa:kappa!==null&&Math.abs(kappa)<4?+kappa.toFixed(5):null,
                        J1:+J1.toFixed(5), J2:+J2.toFixed(5)};
                    })}
                    margin={{top:8,right:24,bottom:36,left:20}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid}/>
                    <XAxis dataKey="eps" stroke={C.dim} tick={{fontSize:8,fill:C.dim}}
                      label={{value:"ε",position:"insideBottom",offset:-10,fill:C.dim,fontSize:10}}/>
                    <YAxis stroke={C.dim} tick={{fontSize:8,fill:C.dim}} domain={[-0.5,3]}/>
                    <Tooltip contentStyle={tt} formatter={v=>[v?.toFixed(5)]}
                      labelFormatter={v=>`ε=${(+v).toFixed(4)}`}/>
                    <ReferenceLine y={0.5} stroke={C.rose} strokeDasharray="6 3"
                      label={{value:"κ=0.5 (Lifshitz)",fill:C.rose,fontSize:9,position:"insideTopRight"}}/>
                    <ReferenceLine y={0} stroke={C.border2}/>
                    <ReferenceLine x={ec} stroke={C.rose} strokeWidth={1.5} strokeDasharray="5 4"
                      label={{value:"εc",fill:C.rose,fontSize:9,position:"top"}}/>
                    <ReferenceLine x={eps} stroke={C.amber} strokeOpacity={0.5}/>
                    <Line type="monotone" dataKey="kappa" stroke={C.amber} strokeWidth={2.5}
                      dot={false} name="κ = J²/J¹" connectNulls={false}/>
                    <Line type="monotone" dataKey="J1" stroke={C.cyan} strokeWidth={1.5}
                      strokeDasharray="4 3" dot={false} name="J¹eff = A+εB"/>
                    <Line type="monotone" dataKey="J2" stroke={C.green} strokeWidth={1.5}
                      strokeDasharray="4 3" dot={false} name="J²eff = εA"/>
                    <Legend wrapperStyle={{fontSize:9,fontFamily:"monospace",paddingTop:8}}/>
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>
        )}

      </div>

      {/* FOOTER */}
      <div style={{borderTop:`1px solid ${C.border}`, padding:"8px 26px", display:"flex",
        justifyContent:"space-between", alignItems:"center"}}>
        <span style={{fontSize:8,letterSpacing:"0.14em",color:C.muted,textTransform:"uppercase"}}>
          Frustrated CML · εc=A/[2(2A-B)] · cosk*=−(A+2εB)/(4εA) · ν=1/2 exact
        </span>
        <span style={{fontSize:8,color:C.muted,fontFamily:"monospace"}}>
          L={L} · T={T} · A={A.toFixed(3)} · B={B.toFixed(3)} · ε={eps.toFixed(4)}
        </span>
      </div>
    </div>
  );
}