import { useMemo } from "react";
import { computeStats, dayLetters, fmtMinutes, type LogEntry } from "./stats";

/* ================================================================
   StatsPanel — the local focus log. Four quiet figures and a
   seven-day bar strip drawn by hand in SVG; today reads brighter.
   ================================================================ */

export function StatsPanel({
  open,
  log,
  onClose,
}: {
  open: boolean;
  log: LogEntry[];
  onClose: () => void;
}) {
  const s = useMemo(() => computeStats(log), [log]);
  const letters = useMemo(() => dayLetters(), []);
  const max = Math.max(...s.perDay, 1);

  return (
    <div
      className={"scrim" + (open ? " open" : "")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel stats" role="dialog" aria-modal="true" aria-label="Focus log">
        <div className="p-head">
          <h2 id="statsTitle">Focus log</h2>
          <button className="x" onClick={onClose} aria-label="Close focus log">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="figures">
          <div className="fig">
            <b>{fmtMinutes(s.today)}</b>
            <span>today</span>
          </div>
          <div className="fig">
            <b>{fmtMinutes(s.week)}</b>
            <span>7 days</span>
          </div>
          <div className="fig">
            <b>{s.streak}d</b>
            <span>streak</span>
          </div>
          <div className="fig">
            <b>{s.sessions}</b>
            <span>rounds done</span>
          </div>
        </div>

        <svg className="bars" viewBox="0 0 280 100" role="img" aria-label="Focus minutes over the last seven days">
          {s.perDay.map((v, i) => {
            const h = v > 0 ? Math.max(3, (v / max) * 70) : 0;
            return (
              <g key={i}>
                {h > 0 && (
                  <rect
                    className={"bar" + (i === 6 ? " today" : "")}
                    x={i * 40 + 9}
                    y={84 - h}
                    width={22}
                    height={h}
                    rx={3}
                    style={{ animationDelay: `${i * 50}ms` }}
                  />
                )}
                <text className="bar-label" x={i * 40 + 20} y={96}>
                  {letters[i]}
                </text>
              </g>
            );
          })}
          <line x1="6" y1="84.5" x2="274" y2="84.5" stroke="#303030" strokeWidth="1" />
        </svg>

        <p className="p-note">Logged locally on this device only.</p>
      </div>
    </div>
  );
}
