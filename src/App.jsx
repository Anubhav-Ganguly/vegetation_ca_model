import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
  ComposedChart, Area,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════════════
//  FRUSTRATED CML — CORRECTED & EXTENDED
//  Bug fixes:
//    1. B = -1/sqrt(2) exactly  (was -0.7071)
//    2. A = u21 * sqrt(2)       (comment was inverted)
//    3. Step 2 eq: psi_i^U = A*(psi_{i-1}+psi_{i+1}) + B*psi_i  (no /sqrt2)
// ═══════════════════════════════════════════════════════════════════════════

const C = {
  bg:"#080c14", panel:"#0d1420", border:"#1a2640", border2:"#243350",
  amber:"#f0a500", amberD:"#8a5f00", cyan:"#38bdf8", cyanD:"#1d6e90",
  rose:"#f43f5e", roseD:"#7f1d2e", green:"#34d399", greenD:"#065f46",
  violet:"#a78bfa", muted:"#4a6080", text:"#c8d8f0", dim:"#5a7090",
  white:"#eef4ff", grid:"#111c2d",
};

// ── Math helpers ─────────────────────────────────────────────────────────────
const sgn = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

function computeEc(A, B) {
  if (B === 0 || sgn(A) === sgn(B)) return null;
  const denom = 2 * (2 * A - B);
  if (Math.abs(denom) < 1e-12) return null;
  const ec = A / denom;
  return ec > 0 ? ec : null;
}

// g(k,eps) = log|A cos k + B| + log|1 + 2 eps cos k|
function growthRate(k, A, B, eps) {
  const lc = A * Math.cos(k) + B;
  const le = 1 + 2 * eps * Math.cos(k);
  if (Math.abs(lc) < 1e-15 || Math.abs(le) < 1e-15) return -Infinity;
  return Math.log(Math.abs(lc)) + Math.log(Math.abs(le));
}

// g''(pi, eps) = A/(B-A) + 2*eps/(1-2*eps)
function curvatureAtPi(A, B, eps) {
  const t1 = A / (B - A);
  const t2 = Math.abs(1 - 2 * eps) > 1e-12 ? (2 * eps) / (1 - 2 * eps) : Infinity;
  return t1 + t2;
}

// cos k* = -(A + 2 eps B) / (4 eps A)
function cosKstar(A, B, eps) {
  const denom = 4 * eps * A;
  if (Math.abs(denom) < 1e-12) return null;
  const val = -(A + 2 * eps * B) / denom;
  return Math.abs(val) <= 1 ? val : null;
}

// ── UI helpers ───────────────────────────────────────────────────────────────
const P = { background:C.panel, border:`1px solid ${C.border}`, borderRadius:12, padding:"18px 22px" };
const ttStyle = { background:"#0a0f1c", border:`1px solid ${C.border2}`, borderRadius:8, fontFamily:"monospace", fontSize:10, color:C.text };

function Slider({ label, value, min, max, step, onChange, color=C.amber }) {
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
        <span style={{ fontFamily:"monospace", fontSize:9, letterSpacing:"0.12em", color:C.dim, textTransform:"uppercase" }}>{label}</span>
        <span style={{ fontFamily:"monospace", fontSize:13, fontWeight:700, color }}>{value.toFixed(5)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width:"100%", accentColor:color, cursor:"pointer", height:4 }} />
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:2 }}>
        <span style={{ fontSize:8, fontFamily:"monospace", color:C.muted }}>{min}</span>
        <span style={{ fontSize:8, fontFamily:"monospace", color:C.muted }}>{max}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, color=C.amber }) {
  return (
    <div style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 12px" }}>
      <div style={{ fontSize:8, letterSpacing:"0.12em", color:C.dim, textTransform:"uppercase", marginBottom:4 }}>{label}</div>
      <div style={{ fontFamily:"monospace", fontSize:14, fontWeight:700, color }}>{value}</div>
    </div>
  );
}

function Badge({ label, color }) {
  return (
    <span style={{
      display:"inline-block", padding:"2px 10px", borderRadius:20, fontSize:10,
      fontFamily:"monospace", fontWeight:700,
      background:color+"22", border:`1px solid ${color}55`, color,
    }}>{label}</span>
  );
}

function SecLabel({ children, color=C.dim }) {
  return (
    <div style={{ fontFamily:"monospace", fontSize:9, letterSpacing:"0.16em", color, textTransform:"uppercase", marginBottom:10 }}>
      {children}
    </div>
  );
}

function InfoBox({ children, color=C.border }) {
  return (
    <div style={{ padding:"10px 14px", background:C.bg, borderRadius:8, border:`1px solid ${color}`, fontSize:10, color:C.text, lineHeight:1.75 }}>
      {children}
    </div>
  );
}

// ── Build growth curve dataset for multiple eps values ────────────────────────
function buildGrowthData(A, B, epsEntries, N=300) {
  return Array.from({ length:N+1 }, (_, i) => {
    const k = (i / N) * Math.PI;
    const row = { kpi: +(k / Math.PI).toFixed(4) };
    epsEntries.forEach(({ eps, key }) => {
      const g = growthRate(k, A, B, eps);
      row[key] = isFinite(g) ? +g.toFixed(5) : null;
    });
    return row;
  });
}

// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  // FIX 1: B default = -1/sqrt(2) exactly (was -0.7071)
  const [A, setA]     = useState(1.0);
  const [B, setB]     = useState(-1 / Math.SQRT2);
  const [eps, setEps] = useState(0.12);
  const [tab, setTab] = useState("theory");

  const ec = useMemo(() => computeEc(A, B), [A, B]);
  const isFrustrated = ec !== null;

  const phase = useMemo(() => {
    if (!isFrustrated) return sgn(A) === sgn(B) ? "Ferromagnetic" : "Trivial";
    if (eps < ec - 0.005) return "Antiferromagnetic";
    if (Math.abs(eps - ec) < 0.005) return "Critical Point";
    return "Incommensurate";
  }, [isFrustrated, ec, eps, A, B]);

  const phaseColor = phase === "Ferromagnetic" ? C.cyan
    : phase === "Antiferromagnetic" ? C.amber
    : phase === "Critical Point" ? C.rose : C.green;

  const curv  = useMemo(() => curvatureAtPi(A, B, eps), [A, B, eps]);
  const kStar = useMemo(() => {
    if (!isFrustrated || eps <= ec) return null;
    const cv = cosKstar(A, B, eps);
    return cv !== null ? Math.acos(cv) : null;
  }, [A, B, eps, ec, isFrustrated]);

  // ── Bifurcation diagram data ────────────────────────────────────────────
  const bifData = useMemo(() => {
    if (!isFrustrated || !ec) return [];
    return Array.from({ length:500 }, (_, i) => {
      const e = 0.001 + (i / 499) * (Math.min(ec * 4, 0.95) - 0.001);
      if (e < ec) {
        return { eps:+e.toFixed(5), kStable:1.0, kUnstable:null, kPlus:null, kMinus:null };
      }
      const cv  = cosKstar(A, B, e);
      const kth = cv !== null ? Math.acos(cv) / Math.PI : 1;
      return { eps:+e.toFixed(5), kStable:null, kUnstable:1.0, kPlus:kth, kMinus:-kth };
    });
  }, [A, B, ec, isFrustrated]);

  // ── Curvature vs eps data ───────────────────────────────────────────────
  const curvData = useMemo(() => {
    if (!isFrustrated || !ec) return [];
    return Array.from({ length:400 }, (_, i) => {
      const e = 0.005 + (i / 399) * (Math.min(ec * 3.5, 0.48) - 0.005);
      const c = curvatureAtPi(A, B, e);
      return {
        eps:  +e.toFixed(4),
        curv: isFinite(c) ? +c.toFixed(5) : null,
        t1:   +(A / (B - A)).toFixed(5),
        t2:   Math.abs(1 - 2*e) > 1e-9 ? +((2*e)/(1-2*e)).toFixed(5) : null,
      };
    });
  }, [A, B, ec, isFrustrated]);

  // ── Correlation length data ─────────────────────────────────────────────
  const corrData = useMemo(() => {
    if (!isFrustrated || !ec) return [];
    const pts = [];
    for (let i = 1; i <= 100; i++) {
      const de = i * 0.0015;
      if (ec - de <= 0) break;
      pts.push({ de:-de, xi: 1/Math.sqrt(de) });
    }
    for (let i = 1; i <= 100; i++) {
      const de = i * 0.0015;
      if (ec + de >= 0.95) break;
      pts.push({ de, xi: 1/Math.sqrt(de) });
    }
    return pts.sort((a, b) => a.de - b.de);
  }, [ec, isFrustrated]);

  // ── Growth-rate multi-curve data ────────────────────────────────────────
  const growthCurves = useMemo(() => {
    if (!isFrustrated || !ec) return null;
    const entries = [
      { eps:ec*0.3, key:"c1", label:"0.3 ec",  color:C.cyanD  },
      { eps:ec*0.7, key:"c2", label:"0.7 ec",  color:C.cyan   },
      { eps:ec,     key:"c3", label:"ec (crit)",color:C.rose   },
      { eps:ec*1.4, key:"c4", label:"1.4 ec",  color:C.amber  },
      { eps:ec*2.2, key:"c5", label:"2.2 ec",  color:C.green  },
    ];
    return { data:buildGrowthData(A, B, entries, 300), entries };
  }, [A, B, ec, isFrustrated]);

  // ── ANNNI table data ────────────────────────────────────────────────────
  const anniRows = useMemo(() => {
    if (!isFrustrated || !ec) return [];
    return [ec*0.3, ec*0.7, ec, ec*1.4, ec*2.2].map(e => {
      const J1 = A + e * B;
      const J2 = e * A;
      const kappa = Math.abs(J1) > 1e-9 ? J2/J1 : Infinity;
      const cv   = cosKstar(A, B, e);
      const kdom = e < ec ? 1.0 : (cv !== null ? Math.acos(cv)/Math.PI : null);
      const regime = e < ec-0.002 ? "AFM" : e > ec+0.002 ? "Incomm." : "Critical";
      return {
        eps:  e.toFixed(5),
        J1:   J1.toFixed(5),
        J2:   J2.toFixed(5),
        kappa:isFinite(kappa) ? kappa.toFixed(5) : "inf",
        kdom: kdom !== null ? kdom.toFixed(4) : "—",
        regime,
      };
    });
  }, [A, B, ec, isFrustrated]);

  const TABS = [
    { id:"theory",      label:"Theory"       },
    { id:"bifurcation", label:"Bifurcation"  },
    { id:"growth",      label:"Growth Rate"  },
    { id:"curvature",   label:"Curvature"    },
    { id:"annni",       label:"ANNNI Map"    },
  ];

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ background:C.bg, minHeight:"100vh", color:C.text, fontFamily:"monospace" }}>

      {/* HEADER */}
      <div style={{ background:C.panel, borderBottom:`1px solid ${C.border}`, padding:"16px 28px" }}>
        <div style={{ fontSize:9, letterSpacing:"0.2em", color:C.amberD, textTransform:"uppercase", marginBottom:6 }}>
          Frustrated CML · Phase Transition Analysis · Corrected
        </div>
        <h1 style={{ margin:0, fontSize:20, fontWeight:900, color:C.white }}>
          Incommensurate Order Transition and Pitchfork Bifurcation
        </h1>
        <div style={{ marginTop:8, display:"flex", gap:16, flexWrap:"wrap", fontSize:10, color:C.dim }}>
          <span>ec = A / [2(2A - B)]</span>
          <span style={{ color:C.border2 }}>|</span>
          <span>cos(k*) = -(A + 2eB) / (4eA)</span>
          <span style={{ color:C.border2 }}>|</span>
          <span>xi ~ |e - ec|^(-1/2)  nu = 1/2</span>
          <span style={{ color:C.border2 }}>|</span>
          <span style={{ color:C.green }}>B = -1/sqrt(2) exact  |  A = u21 * sqrt(2)</span>
        </div>
      </div>

      {/* TAB BAR */}
      <div style={{ background:C.panel, borderBottom:`1px solid ${C.border}`, display:"flex", padding:"0 28px" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background:"none", border:"none", cursor:"pointer", padding:"12px 18px",
            fontFamily:"monospace", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase",
            color: tab===t.id ? C.amber : C.dim,
            borderBottom: tab===t.id ? `2px solid ${C.amber}` : "2px solid transparent",
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ padding:"22px 28px", maxWidth:1300 }}>

        {/* SHARED CONTROLS */}
        <div style={{ ...P, marginBottom:18, display:"flex", gap:28, alignItems:"center", flexWrap:"wrap" }}>
          <div style={{ flex:1, minWidth:180 }}>
            <Slider label="A — hopping amplitude" value={A} min={0.1} max={2.0} step={0.01} onChange={setA} color={C.amber} />
          </div>
          <div style={{ flex:1, minWidth:180 }}>
            <Slider label="B — on-site amplitude" value={B} min={-2.0} max={2.0} step={0.00001} onChange={setB} color={C.cyan} />
          </div>
          <div style={{ flex:1, minWidth:180 }}>
            <Slider label="e — coupling strength" value={eps} min={0.001} max={0.6} step={0.001} onChange={setEps} color={C.green} />
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <Badge label={phase} color={phaseColor} />
            {ec && <span style={{ fontSize:9, color:C.dim }}>ec = {ec.toFixed(6)}</span>}
            <button
              onClick={() => { setA(1.0); setB(-1/Math.SQRT2); setEps(0.12); }}
              style={{ background:C.amberD+"30", border:`1px solid ${C.amberD}`, color:C.amber, borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:9 }}>
              Hadamard preset
            </button>
            <button
              onClick={() => { setA(1.5); setB(-0.5); setEps(0.15); }}
              style={{ background:C.border, border:`1px solid ${C.border2}`, color:C.dim, borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:9 }}>
              A=1.5 B=-0.5
            </button>
          </div>
        </div>

        {/* ════ THEORY TAB ════════════════════════════════════════════════ */}
        {tab === "theory" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:18 }}>

            <div style={P}>
              <SecLabel>Four-Step Evolution Protocol (corrected)</SecLabel>

              {/* Step 1 */}
              <div style={{ marginBottom:10, padding:"10px 14px", borderRadius:8, background:C.bg, border:`1px solid ${C.border}` }}>
                <div style={{ fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>Step 1 — Spatial mixing</div>
                <div style={{ fontSize:11, color:C.white, marginBottom:4 }}>{"phi1_i = (psi_{i-1} + psi_{i+1}) / sqrt(2)"}</div>
                <div style={{ fontSize:11, color:C.white }}>{"phi2_i = psi_i"}</div>
              </div>

              {/* Step 2 — corrected */}
              <div style={{ marginBottom:10, padding:"10px 14px", borderRadius:8, background:C.roseD+"18", border:`1px solid ${C.rose}44` }}>
                <div style={{ fontSize:9, color:C.rose, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>Step 2 — Coin operation [CORRECTED]</div>
                <div style={{ fontSize:11, color:C.white, marginBottom:4 }}>{"psi_i^U = A * (psi_{i-1} + psi_{i+1}) + B * psi_i"}</div>
                <div style={{ fontSize:9, color:C.dim }}>A = u21 * sqrt(2),  B = u22.  Fourier gives lambda_C(k) = A cos(k) + B  [correct]</div>
                <div style={{ fontSize:9, color:C.rose, marginTop:4 }}>
                  OLD (wrong): psi_i^U = (A/sqrt2)(psi_{i-1}+psi_{i+1}) + B*psi_i
                </div>
                <div style={{ fontSize:9, color:C.dim }}>
                  Old Fourier gave A*sqrt(2)*cos(k) + B, not A*cos(k) + B — factor-of-sqrt(2) error in the displayed equation.
                </div>
              </div>

              {/* Step 3 */}
              <div style={{ marginBottom:10, padding:"10px 14px", borderRadius:8, background:C.bg, border:`1px solid ${C.border}` }}>
                <div style={{ fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>Step 3 — Coupling (strength e)</div>
                <div style={{ fontSize:11, color:C.white }}>{"psi_i'' = psi_i^U + e * (psi_{i-1}^U + psi_{i+1}^U)"}</div>
                <div style={{ fontSize:9, color:C.dim, marginTop:4 }}>Fourier: lambda_e(k) = 1 + 2e cos(k)</div>
              </div>

              {/* Step 4 */}
              <div style={{ padding:"10px 14px", borderRadius:8, background:C.bg, border:`1px solid ${C.border}` }}>
                <div style={{ fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>Step 4 — Projective normalization</div>
                <div style={{ fontSize:11, color:C.white }}>{"psi_i(t+1) = psi_i'' / sqrt( sum_j |psi_j''|^2 )"}</div>
                <div style={{ fontSize:9, color:C.dim, marginTop:4 }}>Enforces sum|psi_i|^2 = 1 — implements power method on transfer operator</div>
              </div>
            </div>

            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

              <div style={P}>
                <SecLabel>Combined Dispersion Lambda(k, e)</SecLabel>
                <div style={{ fontSize:12, color:C.amber, marginBottom:8 }}>
                  Lambda(k,e) = (A cos k + B)(1 + 2e cos k)
                </div>
                <div style={{ fontSize:10, color:C.dim, marginBottom:12 }}>
                  g(k,e) = log|A cos k + B| + log|1 + 2e cos k|
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  <Stat label="g''(pi, e)" value={isFinite(curv) ? curv.toFixed(5) : "inf"} color={curv > 0 ? C.green : curv < 0 ? C.rose : C.amber} />
                  <Stat label="ec = A/[2(2A-B)]" value={ec !== null ? ec.toFixed(6) : "undefined"} color={C.amber} />
                  <Stat label="e / ec" value={ec !== null ? (eps/ec).toFixed(4) : "—"} color={C.cyan} />
                  <Stat label="k*/pi" value={kStar !== null ? (kStar/Math.PI).toFixed(5) : "1 (AFM)"} color={C.green} />
                </div>
              </div>

              <div style={P}>
                <SecLabel>NNN structure from Steps 2+3 composition</SecLabel>
                <div style={{ fontSize:10, color:C.text, lineHeight:1.8, marginBottom:8 }}>
                  Expanding Steps 2 and 3 in real space:
                </div>
                <div style={{ padding:"8px 12px", background:C.bg, borderRadius:6, border:`1px solid ${C.border}`, fontSize:10, lineHeight:2 }}>
                  <div>
                    <span style={{ color:C.amber }}>On-site:</span>{" (B + 2eA) * psi_i"}
                  </div>
                  <div>
                    <span style={{ color:C.cyan }}>NN:</span>{" (A + eB) * (psi_{i-1} + psi_{i+1})"}
                  </div>
                  <div>
                    <span style={{ color:C.green }}>NNN:</span>{" eA * (psi_{i-2} + psi_{i+2})"}
                  </div>
                </div>
                <div style={{ fontSize:9, color:C.dim, marginTop:8, lineHeight:1.7 }}>
                  J1_eff = A + eB (NN).  J2_eff = eA (NNN).
                  Frustration when sgn(A) != sgn(B): NNN and NN compete.
                </div>
              </div>

              <div style={{ ...P, border:`1px solid ${C.rose}44` }}>
                <SecLabel color={C.rose}>Bug Fixes Applied</SecLabel>
                {[
                  { label:"B = -1/sqrt(2) exact", was:"was -0.7071 (6.78e-6 off, 0.00025% ec error)" },
                  { label:"A = u21 * sqrt(2)",    was:"comment said A = u21/sqrt(2) — wrong direction" },
                  { label:"Step 2: no /sqrt(2)",  was:"(A/sqrt2)(psi_{i-1}+psi_{i+1}) gave A*sqrt2 in Fourier" },
                ].map(({ label, was }) => (
                  <div key={label} style={{ display:"flex", gap:8, marginBottom:8 }}>
                    <span style={{ color:C.green }}>ok</span>
                    <div>
                      <div style={{ fontSize:10, color:C.green }}>{label}</div>
                      <div style={{ fontSize:9, color:C.dim }}>{was}</div>
                    </div>
                  </div>
                ))}
              </div>

            </div>
          </div>
        )}

        {/* ════ BIFURCATION TAB ═══════════════════════════════════════════ */}
        {tab === "bifurcation" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 300px", gap:18 }}>
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

              {/* Main bifurcation diagram */}
              <div style={P}>
                <SecLabel>Pitchfork Bifurcation — Dominant Mode k*/pi vs Coupling e</SecLabel>
                <div style={{ fontSize:10, color:C.text, marginBottom:12, lineHeight:1.75 }}>
                  Below ec: single stable branch at k=pi (Neel AFM). At ec: curvature g&#8243;(pi,ec)=0 (inflection).
                  Above ec: k=pi destabilises; two symmetric branches +k* and -k* emerge continuously (supercritical pitchfork).
                </div>
                {!isFrustrated ? (
                  <div style={{ color:C.rose, fontSize:11, padding:20 }}>Set frustrated parameters (sgn(A) != sgn(B)) to see the bifurcation.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart data={bifData} margin={{ top:10, right:20, bottom:40, left:20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                      <XAxis dataKey="eps" type="number" domain={["dataMin","dataMax"]}
                        stroke={C.dim} tick={{ fontSize:8, fill:C.dim }}
                        label={{ value:"Coupling e", position:"insideBottom", offset:-8, fill:C.dim, fontSize:10 }} />
                      <YAxis domain={[-1.05,1.05]} stroke={C.dim} tick={{ fontSize:8, fill:C.dim }}
                        label={{ value:"k*/pi", angle:-90, position:"insideLeft", fill:C.dim, fontSize:10 }} />
                      <Tooltip contentStyle={ttStyle}
                        formatter={(v, n) => [v != null ? v.toFixed(4) : "—", n]}
                        labelFormatter={v => `e = ${(+v).toFixed(5)}`} />
                      {ec && <ReferenceLine x={ec} stroke={C.rose} strokeWidth={2} strokeDasharray="6 3"
                        label={{ value:`ec=${ec.toFixed(4)}`, fill:C.rose, fontSize:9, position:"top" }} />}
                      <ReferenceLine y={0} stroke={C.border2} strokeWidth={1} />
                      <Line type="monotone" dataKey="kStable"   stroke={C.cyan}   strokeWidth={2.5} dot={false} name="k=pi stable (AFM)"    connectNulls={false} />
                      <Line type="monotone" dataKey="kUnstable" stroke={C.cyanD}  strokeWidth={1.5} dot={false} name="k=pi unstable (dashed)" connectNulls={false} strokeDasharray="5 4" />
                      <Line type="monotone" dataKey="kPlus"     stroke={C.amber}  strokeWidth={2.5} dot={false} name="+k*/pi (incommensurate)" connectNulls={false} />
                      <Line type="monotone" dataKey="kMinus"    stroke={C.green}  strokeWidth={2.5} dot={false} name="-k*/pi (incommensurate)" connectNulls={false} />
                      <Legend wrapperStyle={{ fontSize:9, fontFamily:"monospace", paddingTop:8 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Correlation length */}
              <div style={P}>
                <SecLabel>Correlation Length  xi ~ |e - ec|^(-1/2)  (Universal Scaling, nu=1/2)</SecLabel>
                {!isFrustrated ? (
                  <div style={{ color:C.rose, fontSize:11 }}>Set frustrated parameters.</div>
                ) : (
                  <>
                    <div style={{ fontSize:10, color:C.text, marginBottom:10, lineHeight:1.75 }}>
                      As e approaches ec from either side the spatial correlation length diverges.
                      The mean-field exponent nu=1/2 is exact here due to the infinite-range projective constraint.
                      The symmetric divergence on both sides confirms a continuous second-order transition.
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={corrData} margin={{ top:8, right:20, bottom:40, left:20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                        <XAxis dataKey="de" type="number" stroke={C.dim} tick={{ fontSize:8, fill:C.dim }}
                          label={{ value:"e - ec", position:"insideBottom", offset:-8, fill:C.dim, fontSize:10 }} />
                        <YAxis stroke={C.dim} tick={{ fontSize:8, fill:C.dim }}
                          label={{ value:"xi (arb.)", angle:-90, position:"insideLeft", fill:C.dim, fontSize:10 }} />
                        <Tooltip contentStyle={ttStyle} formatter={v => [v.toFixed(3),"xi"]}
                          labelFormatter={v => `e-ec = ${(+v).toFixed(4)}`} />
                        <ReferenceLine x={0} stroke={C.rose} strokeWidth={2} strokeDasharray="6 3"
                          label={{ value:"ec", fill:C.rose, fontSize:10 }} />
                        <Line type="monotone" dataKey="xi" stroke={C.violet} strokeWidth={2} dot={false} name="xi ~ |e-ec|^(-1/2)" />
                      </LineChart>
                    </ResponsiveContainer>
                  </>
                )}
              </div>

            </div>

            {/* Sidebar */}
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div style={P}>
                <SecLabel>Parameters</SecLabel>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  <Stat label="A" value={A.toFixed(5)} color={C.amber} />
                  <Stat label="B  (-1/sqrt2 = -0.70711...)" value={B.toFixed(8)} color={C.cyan} />
                  <Stat label="ec = A/[2(2A-B)]" value={ec !== null ? ec.toFixed(8) : "N/A"} color={C.rose} />
                  <Stat label="e" value={eps.toFixed(5)} color={C.green} />
                  <Stat label="e / ec" value={ec ? (eps/ec).toFixed(4) : "—"} color={C.amber} />
                  <Stat label="k*/pi" value={kStar ? (kStar/Math.PI).toFixed(6) : "1 (AFM)"} color={C.green} />
                </div>
              </div>

              <div style={P}>
                <SecLabel>Pitchfork Universality</SecLabel>
                <div style={{ fontSize:10, color:C.text, lineHeight:1.8 }}>
                  <div style={{ marginBottom:8 }}>
                    Z2 symmetry: both +k* and -k* emerge at the same ec simultaneously.
                    This is the hallmark of a supercritical pitchfork bifurcation.
                  </div>
                  <div style={{ padding:"6px 10px", background:C.bg, borderRadius:6, fontSize:9, marginBottom:8, lineHeight:1.7 }}>
                    <div>g(k,e) ~= g0 - a*de*(dk)^2 - b*(dk)^4 + ...</div>
                    <div>Width: Delta_k ~ sqrt(|de|)</div>
                  </div>
                  <div style={{ color:C.violet, fontWeight:700 }}>xi ~ 1/Delta_k ~ |e-ec|^(-1/2)</div>
                </div>
              </div>

              <div style={P}>
                <SecLabel>cos(k*) formula</SecLabel>
                <div style={{ fontSize:10, color:C.amber, marginBottom:8 }}>
                  cos(k*) = -(A + 2eB) / (4eA)
                </div>
                {ec && eps > ec && kStar ? (
                  <div style={{ fontSize:9, color:C.text, lineHeight:1.8 }}>
                    <div style={{ color:C.dim }}>Numerator:   {(-(A + 2*eps*B)).toFixed(5)}</div>
                    <div style={{ color:C.dim }}>Denominator: {(4*eps*A).toFixed(5)}</div>
                    <div style={{ color:C.green, fontWeight:700, marginTop:6 }}>k*/pi = {(kStar/Math.PI).toFixed(6)}</div>
                    <div style={{ color:C.dim }}>k* approaches pi as e approaches ec from above</div>
                  </div>
                ) : (
                  <div style={{ color:C.cyan, fontSize:9 }}>e is at or below ec — k* = pi (AFM stable)</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════ GROWTH RATE TAB ═══════════════════════════════════════════ */}
        {tab === "growth" && (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

            <div style={P}>
              <SecLabel>g(k, e) = log|A cos k + B| + log|1 + 2e cos k| — Five Curves</SecLabel>
              <div style={{ fontSize:10, color:C.text, marginBottom:12, lineHeight:1.75 }}>
                Five curves at e = 0.3ec, 0.7ec, ec, 1.4ec, 2.2ec.
                The peak at k=pi flattens at ec (curvature = 0), then splits to two off-axis maxima above ec.
                The mode that maximises g(k,e) is the long-time dominant mode under projective dynamics.
              </div>
              {!isFrustrated ? (
                <div style={{ color:C.rose, fontSize:11, padding:20 }}>Set frustrated parameters.</div>
              ) : (
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={growthCurves.data} margin={{ top:10, right:24, bottom:40, left:20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                    <XAxis dataKey="kpi" type="number" domain={[0,1]} stroke={C.dim} tick={{ fontSize:8, fill:C.dim }}
                      tickFormatter={v => `${v}pi`}
                      label={{ value:"Wavevector k/pi", position:"insideBottom", offset:-8, fill:C.dim, fontSize:10 }} />
                    <YAxis stroke={C.dim} tick={{ fontSize:8, fill:C.dim }}
                      label={{ value:"g(k,e)", angle:-90, position:"insideLeft", fill:C.dim, fontSize:10 }} />
                    <Tooltip contentStyle={ttStyle}
                      formatter={(v, n) => [v != null ? v.toFixed(5) : "—", n]}
                      labelFormatter={v => `k/pi = ${(+v).toFixed(4)}`} />
                    <ReferenceLine x={1} stroke={C.border2} strokeDasharray="3 3" />
                    {growthCurves.entries.map(({ key, label, color }) => (
                      <Line key={key} type="monotone" dataKey={key} stroke={color}
                        strokeWidth={key==="c3" ? 3 : 1.8} dot={false} name={`e = ${label}`} connectNulls />
                    ))}
                    <Legend wrapperStyle={{ fontSize:9, fontFamily:"monospace", paddingTop:8 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Five-column annotation cards */}
            {isFrustrated && ec && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10 }}>
                {[
                  { ev:ec*0.3, label:"e = 0.3 ec", color:C.cyanD,
                    note:"Single sharp peak at k=pi. AFM strongly dominant. g''(pi,e) is negative (concave down)." },
                  { ev:ec*0.7, label:"e = 0.7 ec", color:C.cyan,
                    note:"Peak still at k=pi but curvature is less negative. AFM weakening." },
                  { ev:ec,     label:"e = ec (critical)", color:C.rose,
                    note:"Curvature g''(pi,ec) = 0 exactly. Flat plateau at k=pi. Bifurcation inflection point." },
                  { ev:ec*1.4, label:"e = 1.4 ec", color:C.amber,
                    note:"k=pi is now a local MINIMUM. Two new maxima at +k* and -k* appear symmetrically." },
                  { ev:ec*2.2, label:"e = 2.2 ec", color:C.green,
                    note:"Incommensurate phase well established. k* peaks are separated and still evolving." },
                ].map(({ ev, label, color, note }) => {
                  const cv = cosKstar(A, B, ev);
                  const ks = ev > ec && cv !== null ? Math.acos(cv)/Math.PI : null;
                  const gc = curvatureAtPi(A, B, ev);
                  return (
                    <div key={label} style={{ background:C.bg, border:`1px solid ${color}33`, borderRadius:8, padding:"10px 12px" }}>
                      <div style={{ fontSize:10, color, fontWeight:700, marginBottom:6 }}>{label}</div>
                      <div style={{ fontSize:9, color:C.dim, lineHeight:1.6, marginBottom:6 }}>{note}</div>
                      <div style={{ fontSize:8, color:C.dim }}>{"g\u2033(pi) = "}{isFinite(gc) ? gc.toFixed(3) : "inf"}</div>
                      {ks && <div style={{ fontSize:8, color:C.amber }}>k*/pi = {ks.toFixed(4)}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Live single-curve */}
            <div style={P}>
              <SecLabel>Live Growth Rate at Current e = {eps.toFixed(5)}</SecLabel>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={Array.from({ length:301 }, (_, i) => {
                    const k = (i/300)*Math.PI;
                    const g = growthRate(k, A, B, eps);
                    return { kpi:+(k/Math.PI).toFixed(4), g:isFinite(g) ? +g.toFixed(5) : null };
                  })}
                  margin={{ top:8, right:20, bottom:36, left:20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                  <XAxis dataKey="kpi" stroke={C.dim} tick={{ fontSize:8, fill:C.dim }}
                    tickFormatter={v => `${v}pi`}
                    label={{ value:"k/pi", position:"insideBottom", offset:-8, fill:C.dim, fontSize:10 }} />
                  <YAxis stroke={C.dim} tick={{ fontSize:8, fill:C.dim }} />
                  <Tooltip contentStyle={ttStyle} formatter={v => [v?.toFixed(5),"g"]} labelFormatter={v => `k/pi=${v}`} />
                  {kStar && <ReferenceLine x={kStar/Math.PI} stroke={C.green} strokeDasharray="4 3"
                    label={{ value:`k*=${(kStar/Math.PI).toFixed(3)}pi`, fill:C.green, fontSize:9 }} />}
                  <ReferenceLine x={1} stroke={C.cyan} strokeDasharray="4 3"
                    label={{ value:"k=pi", fill:C.cyan, fontSize:9 }} />
                  <Line type="monotone" dataKey="g" stroke={phaseColor} strokeWidth={2} dot={false} name="g(k,e)" />
                </LineChart>
              </ResponsiveContainer>
            </div>

          </div>
        )}

        {/* ════ CURVATURE TAB ════════════════════════════════════════════ */}
        {tab === "curvature" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 300px", gap:18 }}>
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

              {/* Curvature vs eps */}
              <div style={P}>
                <SecLabel>{"Curvature g''(pi, e) = A/(B-A) + 2e/(1-2e)  vs  Coupling e"}</SecLabel>
                <div style={{ fontSize:10, color:C.text, marginBottom:12, lineHeight:1.75 }}>
                  Transition is signalled by the zero crossing at e=ec.
                  Negative means k=pi is a local maximum (AFM stable).
                  Positive means k=pi is a local minimum (AFM unstable, incommensurate order).
                </div>
                {!isFrustrated ? (
                  <div style={{ color:C.rose, fontSize:11 }}>Set frustrated parameters.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={curvData} margin={{ top:10, right:24, bottom:40, left:20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                      <XAxis dataKey="eps" stroke={C.dim} tick={{ fontSize:8, fill:C.dim }}
                        label={{ value:"e (coupling strength)", position:"insideBottom", offset:-8, fill:C.dim, fontSize:10 }} />
                      <YAxis stroke={C.dim} tick={{ fontSize:8, fill:C.dim }}
                        label={{ value:"g''(pi, e)", angle:-90, position:"insideLeft", fill:C.dim, fontSize:10 }} />
                      <Tooltip contentStyle={ttStyle}
                        formatter={v => [v?.toFixed(5)]}
                        labelFormatter={v => `e=${(+v).toFixed(4)}`} />
                      <ReferenceLine y={0} stroke={C.white} strokeWidth={1.5} />
                      {ec && <ReferenceLine x={ec} stroke={C.rose} strokeWidth={2} strokeDasharray="6 3"
                        label={{ value:"ec", fill:C.rose, fontSize:10, position:"top" }} />}
                      <Area type="monotone" dataKey="curv" stroke="none" fill={C.cyan} fillOpacity={0.06} baseValue={0} />
                      <Line type="monotone" dataKey="curv" stroke={C.violet} strokeWidth={2.5} dot={false} name="g''(pi,e)" />
                      {ec && <ReferenceLine x={eps} stroke={C.amber} strokeWidth={1.5} strokeOpacity={0.6}
                        label={{ value:"e", fill:C.amber, fontSize:9 }} />}
                      <Legend wrapperStyle={{ fontSize:9, fontFamily:"monospace", paddingTop:8 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Decomposition */}
              <div style={P}>
                <SecLabel>{"Decomposition: Term1 + Term2 = g''(pi, e)"}</SecLabel>
                {isFrustrated && (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={curvData} margin={{ top:8, right:24, bottom:40, left:20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                      <XAxis dataKey="eps" stroke={C.dim} tick={{ fontSize:8, fill:C.dim }}
                        label={{ value:"e", position:"insideBottom", offset:-8, fill:C.dim, fontSize:12 }} />
                      <YAxis stroke={C.dim} tick={{ fontSize:8, fill:C.dim }} />
                      <Tooltip contentStyle={ttStyle} formatter={v => [v?.toFixed(5)]} labelFormatter={v => `e=${(+v).toFixed(4)}`} />
                      <ReferenceLine y={0} stroke={C.border2} />
                      {ec && <ReferenceLine x={ec} stroke={C.rose} strokeWidth={1.5} strokeDasharray="5 4" />}
                      <Line type="monotone" dataKey="t1" stroke={C.amber} strokeWidth={1.5} strokeDasharray="5 3" dot={false} name="Term1: A/(B-A) fixed" />
                      <Line type="monotone" dataKey="t2" stroke={C.cyan}  strokeWidth={1.5} dot={false} name="Term2: 2e/(1-2e) grows" />
                      <Line type="monotone" dataKey="curv" stroke={C.violet} strokeWidth={2.5} dot={false} name="Sum = g''(pi,e)" />
                      <Legend wrapperStyle={{ fontSize:9, fontFamily:"monospace", paddingTop:8 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
                <div style={{ fontSize:9, color:C.dim, lineHeight:1.7, marginTop:10 }}>
                  Term 1 = A/(B-A) is negative and constant (frustration set by coin parameters).
                  Term 2 = 2e/(1-2e) is positive and grows with e.
                  They cancel exactly at e=ec, crossing from AFM-stable to AFM-unstable.
                </div>
              </div>

            </div>

            {/* Sidebar */}
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div style={P}>
                <SecLabel>Live Values at Current e</SecLabel>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  <Stat label="Term1: A/(B-A)" value={(A/(B-A)).toFixed(6)} color={C.amber} />
                  <Stat label="Term2: 2e/(1-2e)" value={Math.abs(1-2*eps)>1e-9 ? ((2*eps)/(1-2*eps)).toFixed(6) : "inf"} color={C.cyan} />
                  <Stat label="Sum g''(pi,e)" value={isFinite(curv) ? curv.toFixed(6) : "inf"}
                    color={curv>0.01 ? C.green : curv<-0.01 ? C.rose : C.amber} />
                  <Stat label="Status" value={curv>0.01 ? "AFM UNSTABLE" : curv<-0.01 ? "AFM stable" : "CRITICAL"}
                    color={curv>0.01 ? C.green : curv<-0.01 ? C.cyan : C.rose} />
                  <Stat label="ec" value={ec !== null ? ec.toFixed(8) : "N/A"} color={C.rose} />
                </div>
              </div>
              <div style={P}>
                <SecLabel>Sign Table</SecLabel>
                {[
                  { regime:"e below ec", color:C.cyan,  sign:"< 0", note:"k=pi local MAX — AFM stable" },
                  { regime:"e = ec",     color:C.rose,  sign:"= 0", note:"inflection — bifurcation point" },
                  { regime:"e above ec", color:C.green, sign:"> 0", note:"k=pi local MIN — incommensurate" },
                ].map(({ regime, color, sign, note }) => (
                  <div key={regime} style={{ borderLeft:`3px solid ${color}`, paddingLeft:10, marginBottom:10 }}>
                    <div style={{ fontSize:10, color, fontWeight:700 }}>{regime}</div>
                    <div style={{ fontSize:9, color:C.text }}>{"g''(pi,e) "}{sign}</div>
                    <div style={{ fontSize:9, color:C.dim }}>{note}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ════ ANNNI MAPPING TAB ════════════════════════════════════════ */}
        {tab === "annni" && (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

            <div style={P}>
              <SecLabel>ANNNI Effective Coupling Structure</SecLabel>
              <div style={{ fontSize:10, color:C.text, lineHeight:1.8, marginBottom:16 }}>
                Expanding Steps 2+3 gives an ANNNI-like effective Hamiltonian with competing NN and NNN interactions.
                H_eff = -J1_eff * sum(si*si+1) + J2_eff * sum(si*si+2)
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16, marginBottom:20 }}>
                {[
                  { label:"J1_eff = A + eB", desc:"NN effective coupling. Can change sign when B is negative.", color:C.cyan,
                    val: (A + eps*B).toFixed(5) },
                  { label:"J2_eff = e * A", desc:"NNN effective coupling. Grows linearly with coupling e.", color:C.green,
                    val: (eps*A).toFixed(5) },
                  { label:"kappa_eff = J2/J1", desc:"Frustration ratio. ANNNI Lifshitz point is at kappa = 0.5.", color:C.amber,
                    val: Math.abs(A + eps*B) > 1e-9 ? ((eps*A)/(A+eps*B)).toFixed(5) : "inf" },
                ].map(({ label, desc, color, val }) => (
                  <div key={label} style={{ background:C.bg, border:`1px solid ${color}33`, borderRadius:8, padding:12 }}>
                    <div style={{ color, fontSize:12, fontWeight:700, marginBottom:6 }}>{label}</div>
                    <div style={{ fontSize:9, color:C.dim, lineHeight:1.6, marginBottom:8 }}>{desc}</div>
                    <div style={{ fontSize:14, color, fontWeight:700 }}>{val}</div>
                    <div style={{ fontSize:8, color:C.dim }}>at current e = {eps.toFixed(4)}</div>
                  </div>
                ))}
              </div>

              {/* kappa vs eps chart */}
              {isFrustrated && ec && (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart
                    data={Array.from({ length:400 }, (_, i) => {
                      const e = 0.001 + (i/399)*(Math.min(ec*4,0.6)-0.001);
                      const J1 = A + e*B;
                      const J2 = e*A;
                      const kappa = Math.abs(J1) > 1e-9 ? J2/J1 : null;
                      return {
                        eps:   +e.toFixed(4),
                        kappa: kappa !== null && Math.abs(kappa) < 5 ? +kappa.toFixed(5) : null,
                        J1eff: +J1.toFixed(5),
                        J2eff: +J2.toFixed(5),
                      };
                    })}
                    margin={{ top:10, right:24, bottom:40, left:20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                    <XAxis dataKey="eps" stroke={C.dim} tick={{ fontSize:8, fill:C.dim }}
                      label={{ value:"e (coupling strength)", position:"insideBottom", offset:-8, fill:C.dim, fontSize:10 }} />
                    <YAxis stroke={C.dim} tick={{ fontSize:8, fill:C.dim }} domain={[-1,3]} />
                    <Tooltip contentStyle={ttStyle} formatter={v => [v?.toFixed(5)]} labelFormatter={v => `e=${(+v).toFixed(4)}`} />
                    <ReferenceLine y={0.5} stroke={C.rose} strokeDasharray="6 3"
                      label={{ value:"kappa=0.5 (ANNNI Lifshitz)", fill:C.rose, fontSize:9, position:"insideTopRight" }} />
                    <ReferenceLine y={0} stroke={C.border2} />
                    {ec && <ReferenceLine x={ec} stroke={C.rose} strokeWidth={1.5} strokeDasharray="5 4"
                      label={{ value:"ec", fill:C.rose, fontSize:9, position:"top" }} />}
                    <ReferenceLine x={eps} stroke={C.amber} strokeOpacity={0.5} />
                    <Line type="monotone" dataKey="kappa" stroke={C.amber} strokeWidth={2.5} dot={false} name="kappa_eff = J2/J1" connectNulls={false} />
                    <Line type="monotone" dataKey="J1eff" stroke={C.cyan}  strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="J1_eff" />
                    <Line type="monotone" dataKey="J2eff" stroke={C.green} strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="J2_eff" />
                    <Legend wrapperStyle={{ fontSize:9, fontFamily:"monospace", paddingTop:8 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}

              <div style={{ marginTop:12, padding:"10px 14px", background:C.bg, borderRadius:8, border:`1px solid ${C.rose}33`, fontSize:10, color:C.dim, lineHeight:1.75 }}>
                <span style={{ color:C.rose, fontWeight:700 }}>Note on ANNNI equivalence (LaTeX Section 7.1 bug corrected): </span>
                The CML critical coupling ec = A/[2(2A-B)] does NOT exactly coincide with kappa_eff = 0.5.
                At e=ec, kappa_eff = {ec ? ((ec*A)/(A+ec*B)).toFixed(5) : "—"} which is not 0.5.
                The qualitative analogy holds (competing NN/NNN interactions causing frustration) but
                the exact mapping breaks because ec is derived from the curvature condition g&#8243;(pi,ec)=0,
                not from the ANNNI Lifshitz criterion kappa=0.5.
                The LaTeX Section 7.1 proof had a factor-of-2 algebra error in cross-multiplying.
              </div>
            </div>

            {/* ANNNI table */}
            <div style={P}>
              <SecLabel>Effective ANNNI Parameters at Five Representative e Values</SecLabel>
              <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:"monospace", fontSize:10 }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${C.border2}` }}>
                    {["e","J1_eff","J2_eff","kappa_eff","k*/pi","Regime"].map(h => (
                      <th key={h} style={{ padding:"6px 10px", textAlign:"left", color:C.dim, fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {anniRows.map(row => (
                    <tr key={row.eps} style={{ borderBottom:`1px solid ${C.border}` }}>
                      <td style={{ padding:"7px 10px", color:C.amber }}>{row.eps}</td>
                      <td style={{ padding:"7px 10px", color:parseFloat(row.J1)>0 ? C.green : C.rose }}>{row.J1}</td>
                      <td style={{ padding:"7px 10px", color:C.cyan }}>{row.J2}</td>
                      <td style={{ padding:"7px 10px", color:C.violet }}>{row.kappa}</td>
                      <td style={{ padding:"7px 10px", color:C.text }}>{row.kdom}</td>
                      <td style={{ padding:"7px 10px" }}>
                        <Badge label={row.regime} color={row.regime==="AFM" ? C.cyan : row.regime==="Critical" ? C.rose : C.green} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        )}

      </div>

      {/* FOOTER */}
      <div style={{ borderTop:`1px solid ${C.border}`, padding:"10px 28px", display:"flex", justifyContent:"space-between" }}>
        <span style={{ fontSize:8, letterSpacing:"0.14em", color:C.muted, textTransform:"uppercase" }}>
          CML | ec = A/[2(2A-B)] | cos(k*) = -(A+2eB)/(4eA) | nu=1/2 exact
        </span>
        <span style={{ fontSize:8, color:C.muted }}>
          Fixes: B=-1/sqrt(2) exact | A=u21*sqrt(2) | Step2 no spurious /sqrt(2)
        </span>
      </div>
    </div>
  );
}
