import type { NoiseColor } from "./audio";

/* ================================================================
   NoisePanel — the Focus noise tab. One color at a time, chosen
   with a click (a gesture, so playback is guaranteed to start),
   with a single level fader. The little spectrum glyph sketches
   each color's slope: flat, down, steep down, up, steep up.
   ================================================================ */

const ROWS: { key: NoiseColor; label: string; hint: string }[] = [
  { key: "white", label: "White", hint: "bright hiss — flat spectrum" },
  { key: "pink", label: "Pink", hint: "even, natural — −3 dB/oct" },
  { key: "brown", label: "Brown", hint: "deep rumble — −6 dB/oct" },
  { key: "blue", label: "Blue", hint: "crisp, present — +3 dB/oct" },
  { key: "violet", label: "Violet", hint: "airy, sharp — +6 dB/oct" },
];

const SLOPE: Record<NoiseColor, string> = {
  white: "M1 6 L23 6",
  pink: "M1 4 L23 8.5",
  brown: "M1 2.5 L23 10",
  blue: "M1 8 L23 3.5",
  violet: "M1 9.5 L23 2",
};

export function NoisePanel({
  open,
  color,
  volume,
  onSelect,
  onVolume,
  onClose,
}: {
  open: boolean;
  color: NoiseColor | null;
  volume: number;
  onSelect: (c: NoiseColor | null) => void;
  onVolume: (v01: number) => void;
  onClose: () => void;
}) {
  return (
    <div
      className={"scrim" + (open ? " open" : "")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel noise-panel" role="dialog" aria-modal="true" aria-label="Focus noise">
        <div className="p-head">
          <h2>Focus noise</h2>
          <button className="x" onClick={onClose} aria-label="Close focus noise">
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

        <div className="noise-rows">
          {ROWS.map(({ key, label, hint }) => {
            const on = color === key;
            return (
              <button
                key={key}
                className={"noise-row" + (on ? " on" : "")}
                onClick={() => onSelect(on ? null : key)}
                aria-pressed={on}
              >
                <svg className="spec" viewBox="0 0 24 12" aria-hidden="true">
                  <path d={SLOPE[key]} />
                </svg>
                <span className="noise-name">
                  <b>{label}</b>
                  <i>{hint}</i>
                </span>
                <span className="radio" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <div className="row noise-vol">
          <span className="lbl">Level</span>
          <div className="mixer">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              disabled={!color}
              onChange={(e) => onVolume(Number(e.target.value) / 100)}
              aria-label="Focus noise level"
            />
            <output className="mix-val">
              {Math.round(volume * 100)}
              <span className="u">%</span>
            </output>
          </div>
        </div>

        <p className="p-note">
          One color plays at a time; click the active color again to switch it off.
        </p>
      </div>
    </div>
  );
}
