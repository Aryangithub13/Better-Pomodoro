import type { CSSProperties } from "react";

/* ================================================================
   Plant — a single-stroke line botanical that grows with the focus
   block. The stem draws itself in via stroke-dashoffset; each leaf
   unfurls as progress crosses its threshold. Complete the block and
   it blooms; abandon it early and it wilts. Pure linework, grey.
   ================================================================ */

export type PlantPhase = "grow" | "bloom" | "wilt";

interface Leaf {
  x: number;
  y: number;
  side: -1 | 1;
  top?: boolean;
}

const LEAVES: Leaf[] = [
  { x: 31.4, y: 212, side: -1 },
  { x: 32.9, y: 190, side: 1 },
  { x: 32.2, y: 168, side: -1 },
  { x: 31.2, y: 146, side: 1 },
  { x: 32.6, y: 124, side: -1 },
  { x: 32.1, y: 102, side: 1 },
];

const THRESHOLDS = [0.1, 0.23, 0.36, 0.49, 0.62, 0.75];

const LEAF_PATH = "M0 0 C 9 -1, 17 -9, 15.5 -21 C 7 -19, 1.5 -11, 0 0 Z";
const TOP_PATH = "M0 0 C -5 -8, -4 -18, 0 -24 C 4 -18, 5 -8, 0 0 Z";

export function Plant({ progress, phase }: { progress: number; phase: PlantPhase }) {
  const p = phase === "bloom" ? 1 : Math.max(0, Math.min(1, progress));
  const stemOffset = 100 - 100 * p;

  return (
    <svg className={`plant ${phase}`} viewBox="0 0 64 264" aria-hidden="true">
      {/* pot */}
      <path className="pot" d="M18 228h28v6H18Z" />
      <path className="pot" d="M21 234h22l-3.4 22H24.4Z" />

      {/* seed, visible before growth starts */}
      <circle
        className="seed"
        cx="32"
        cy="222"
        r="2.2"
        style={{ opacity: p < 0.05 ? 1 : 0 }}
      />

      {/* stem — draws in as the session progresses */}
      <path
        className="stem"
        d="M32 228 C 31 200, 34 184, 32 158 C 30 132, 33 112, 32 88 C 31.5 74, 32 64, 32 52"
        pathLength={100}
        style={{ strokeDashoffset: stemOffset }}
      />

      {/* leaves, each tied to a progress threshold */}
      {LEAVES.map((L, i) => (
        <g key={i} transform={`translate(${L.x} ${L.y}) scale(${L.side} 1)`}>
          <path
            className={`leaf${p >= THRESHOLDS[i] ? " on" : ""}`}
            d={LEAF_PATH}
            style={{ transitionDelay: `${i * 60}ms` } as CSSProperties}
          />
        </g>
      ))}

      {/* crown leaf */}
      <g transform="translate(32 58)">
        <path
          className={`leaf${p >= 0.9 ? " on" : ""}`}
          d={TOP_PATH}
          style={{ transitionDelay: "400ms" } as CSSProperties}
        />
      </g>
    </svg>
  );
}
