import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ambient, type ChannelKey, type NoiseColor } from "./audio";
import { NoisePanel } from "./NoisePanel";
import { loadLog, recordFocus, type LogEntry } from "./stats";
import { AmbientCanvas } from "./AmbientCanvas";
import { Plant, type PlantPhase } from "./Plant";
import { StatsPanel } from "./StatsPanel";
import { usePip } from "./usePip";
import { useWakeLock } from "./useWakeLock";
import { YtInput, YoutubePlayer } from "./YoutubePlayer";

/* ================================================================
   PF-25 — a split-flap pomodoro instrument.
   Monochrome by discipline: every value is a neutral grey; state is
   carried by value (light/dark), weight and motion — never by hue.
   ================================================================ */

type Mode = "focus" | "short" | "long";

interface Settings {
  focus: number;
  short: number;
  long: number;
  rounds: number;
  sound: boolean;
  pipAuto: boolean;
  ambienceOn: boolean;
  noiseColor: NoiseColor | null;
  noiseVolume: number;
  rain: number;
  drone: number;
  wind: number;
  ytId: string | null;
  ytTitle: string | null;
  ytVol: number;
}

const DEFAULTS: Settings = {
  focus: 25,
  short: 5,
  long: 15,
  rounds: 4,
  sound: true,
  pipAuto: false,
  ambienceOn: false,
  noiseColor: null,
  noiseVolume: 0.5,
  rain: 0.45,
  drone: 0.25,
  wind: 0.3,
  ytId: null,
  ytTitle: null,
  ytVol: 0.7,
};

const LIMITS: Record<"focus" | "short" | "long" | "rounds", [number, number]> = {
  focus: [1, 90],
  short: [1, 30],
  long: [1, 45],
  rounds: [1, 15],
};

const LABEL: Record<Mode, string> = {
  focus: "Focus",
  short: "Short break",
  long: "Long break",
};

const SCENE: { key: "rain" | "drone" | "wind"; label: string }[] = [
  { key: "rain", label: "Rain" },
  { key: "drone", label: "Deep drone" },
  { key: "wind", label: "Wind" },
];

const NOISE_COLORS: NoiseColor[] = ["white", "pink", "brown", "blue", "violet"];

const STORAGE_KEY = "pomo.pf25.v1";

const pad = (n: number) => (n < 10 ? "0" : "") + n;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

function loadSettings(): Settings {
  const s: Settings = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<Settings> & { longEvery?: number };
      (Object.keys(LIMITS) as (keyof typeof LIMITS)[]).forEach((k) => {
        const v = j[k];
        if (typeof v === "number" && Number.isFinite(v)) {
          s[k] = clamp(Math.round(v), LIMITS[k][0], LIMITS[k][1]);
        }
      });
      /* migrate the older "long break after" preference into rounds */
      if (
        j.rounds === undefined &&
        typeof j.longEvery === "number" &&
        Number.isFinite(j.longEvery)
      ) {
        s.rounds = clamp(Math.round(j.longEvery), LIMITS.rounds[0], LIMITS.rounds[1]);
      }
      s.sound = j.sound !== false;
      s.pipAuto = j.pipAuto === true;
      s.ambienceOn = j.ambienceOn === true;
      (["rain", "drone", "wind"] as const).forEach((k) => {
        const v = j[k];
        if (typeof v === "number" && Number.isFinite(v)) s[k] = clamp01(v);
      });
      /* focus noise — one color at a time */
      if (j.noiseColor && NOISE_COLORS.includes(j.noiseColor)) s.noiseColor = j.noiseColor;
      if (typeof j.noiseVolume === "number" && Number.isFinite(j.noiseVolume))
        s.noiseVolume = clamp01(j.noiseVolume);
      /* migrate the older per-color sliders into the single selection,
         keeping whichever shade the listener had dialed loudest */
      if (s.noiseColor === null) {
        let best: NoiseColor | null = null;
        let bestV = 0;
        NOISE_COLORS.forEach((k) => {
          const v = (j as Record<string, unknown>)[k];
          if (typeof v === "number" && Number.isFinite(v) && v > bestV) {
            bestV = v;
            best = k;
          }
        });
        if (best !== null) {
          s.noiseColor = best;
          s.noiseVolume = clamp01(bestV);
        }
      }
      if (typeof j.ytId === "string" && /^[\w-]{11}$/.test(j.ytId)) s.ytId = j.ytId;
      if (typeof j.ytTitle === "string" && j.ytTitle.length <= 140) s.ytTitle = j.ytTitle;
      if (typeof j.ytVol === "number" && Number.isFinite(j.ytVol)) s.ytVol = clamp01(j.ytVol);
    }
  } catch {
    /* private mode — run on defaults */
  }
  return s;
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function announce(text: string) {
  const el = document.getElementById("announcer");
  if (!el) return;
  el.textContent = "";
  requestAnimationFrame(() => {
    el.textContent = text;
  });
}

/* ================================================================
   FlipDigit — one split-flap unit. Declarative two-stage flip:
   the old top card falls away while the new bottom card lands.
   ================================================================ */
function FlipDigit({
  char,
  reduced,
  fast = false,
}: {
  char: string;
  reduced: boolean;
  fast?: boolean;
}) {
  const [display, setDisplay] = useState(char);
  const [anim, setAnim] = useState<{ from: string; to: string; id: number } | null>(null);
  const displayRef = useRef(char);
  const idRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const cur = displayRef.current;
    if (cur === char) return;

    if (reduced) {
      displayRef.current = char;
      setDisplay(char);
      setAnim(null);
      return;
    }

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    idRef.current += 1;
    displayRef.current = char;
    setAnim({ from: cur, to: char, id: idRef.current });

    timerRef.current = window.setTimeout(
      () => {
        setDisplay(char);
        setAnim(null);
        timerRef.current = null;
      },
      fast ? 260 : 520,
    );

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [char, reduced, fast]);

  const flipping = anim !== null;
  const staticTop = flipping ? anim.to : display;
  const staticBottom = display;
  const flapTop = flipping ? anim.from : display;
  const flapBottom = flipping ? anim.to : display;

  const unitClass = "unit" + (flipping ? " flipping" : "") + (fast ? " fast" : "");

  return (
    <div className={unitClass} aria-hidden="true">
      <div className="card">
        <div className="half static-top">
          <span className="num">{staticTop}</span>
        </div>
        <div className="half static-bottom bottom-h">
          <span className="num">{staticBottom}</span>
        </div>
        <div className="seam" />
        <div className="half flap flap-top" key={flipping ? "t" + anim.id : "t"}>
          <span className="num">{flapTop}</span>
        </div>
        <div className="half flap flap-bottom bottom-h" key={flipping ? "b" + anim.id : "b"}>
          <span className="num">{flapBottom}</span>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   Inline glyphs — single stroke weight, consistent geometry.
   ================================================================ */
const icon = (d: string, extra?: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
    {extra}
  </svg>
);

const ResetIcon = () => icon("M3 12a9 9 0 1 0 3-6.7", <path d="M3 4v5h5" />);
const GearIcon = () =>
  icon("M4 7h16M4 12h16M4 17h16", <path d="M9.5 5v4M14.5 10v4M7.5 15v4" />);
const CloseIcon = () => (
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
);
const MinusIcon = () => icon("M5 12h14");
const PlusIcon = () => icon("M12 5v14M5 12h14");
const StatsIcon = () => icon("M6 20v-5", <path d="M12 20v-9M18 20V7" />);
/* spectrum glyph — a slope that reads as "coloured noise" */
const NoiseIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M4 8l2.6 8L9.4 5l2.8 14L15 8.5 17.4 15 20 10.5" />
  </svg>
);
const PipIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <rect x="12.6" y="12" width="6" height="4.4" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

/* ================================================================
   App
   ================================================================ */
export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [mode, setMode] = useState<Mode>("focus");
  const [total, setTotal] = useState(() => settings.focus * 60000);
  const [remaining, setRemaining] = useState(total);
  const [running, setRunning] = useState(false);
  const [completedFocus, setCompletedFocus] = useState(0);
  const [scrimOpen, setScrimOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [noiseOpen, setNoiseOpen] = useState(false);
  const [log, setLog] = useState<LogEntry[]>(loadLog);
  const [everRun, setEverRun] = useState(false);
  const [plantPhase, setPlantPhase] = useState<PlantPhase>("grow");
  const [bootChars, setBootChars] = useState<string[] | null>(null);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const endAtRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  /* latest-value mirror so engine callbacks never read stale state */
  const stateRef = useRef({
    mode,
    settings,
    completedFocus,
    total,
    remaining,
    running,
    plantPhase,
  });
  useEffect(() => {
    stateRef.current = {
      mode,
      settings,
      completedFocus,
      total,
      remaining,
      running,
      plantPhase,
    };
  });

  /* screen stays awake while a block runs */
  useWakeLock(running);

  /* ------------------------------ audio ------------------------------ */
  const ensureAudio = useCallback(() => {
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
      return;
    }
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) audioCtxRef.current = new AC();
    } catch {
      audioCtxRef.current = null;
    }
  }, []);

  const chime = useCallback(() => {
    if (!stateRef.current.settings.sound) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    (
      [
        [587.33, 0],
        [392, 0.22],
      ] as const
    ).forEach(([freq, at]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.13, t0 + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.6);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t0 + at);
      o.stop(t0 + at + 0.6);
    });
  }, []);

  /* ------------------------------ engine ------------------------------ */
  const handleComplete = useCallback(() => {
    setRunning(false);
    chime();
    const s = stateRef.current;
    let nextMode: Mode;
    let nextCompleted = s.completedFocus;
    if (s.mode === "focus") {
      nextCompleted += 1;
      setLog(recordFocus(s.settings.focus));
      setPlantPhase("bloom");
      nextMode = nextCompleted % s.settings.rounds === 0 ? "long" : "short";
    } else {
      nextMode = "focus";
    }
    const newTotal = s.settings[nextMode] * 60000;
    setCompletedFocus(nextCompleted);
    setMode(nextMode);
    setTotal(newTotal);
    setRemaining(newTotal);
    if (nextMode === "focus") {
      const r = (nextCompleted % s.settings.rounds) + 1;
      announce(`Focus — round ${r} of ${s.settings.rounds}. Press space to start.`);
    } else if (nextMode === "short") {
      announce(`Short break — round ${nextCompleted} of ${s.settings.rounds} complete.`);
    } else {
      announce(`Long break — ${s.settings.rounds} rounds complete.`);
    }
  }, [chime]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const rem = endAtRef.current - Date.now();
      if (rem <= 0) {
        window.clearInterval(id);
        setRemaining(0);
        handleComplete();
      } else {
        setRemaining(rem);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [running, handleComplete]);

  const play = useCallback(() => {
    ensureAudio();
    ambient.wake(); /* starting a session also un-suspends the ambience */
    setEverRun(true);
    const s = stateRef.current;
    const rem = s.remaining <= 0 ? s.total : s.remaining;
    /* a fresh focus block plants a new seed */
    if (s.mode === "focus" && rem >= s.total) setPlantPhase("grow");
    endAtRef.current = Date.now() + rem;
    setRemaining(rem);
    setRunning(true);
    if (s.settings.pipAuto) pipOpenRef.current();
  }, [ensureAudio]);

  const pause = useCallback(() => {
    setRunning(false);
    setRemaining(Math.max(0, endAtRef.current - Date.now()));
  }, []);

  const toggle = useCallback(() => {
    if (stateRef.current.running) pause();
    else play();
  }, [pause, play]);

  /* leaving a focus block early wilts the plant */
  const abandonPlant = useCallback(() => {
    const s = stateRef.current;
    if (s.mode === "focus") {
      const p = s.total > 0 ? 1 - s.remaining / s.total : 0;
      setPlantPhase(p > 0.06 && s.plantPhase !== "bloom" ? "wilt" : "grow");
    }
  }, []);

  const reset = useCallback(() => {
    setRunning(false);
    const s = stateRef.current;
    const t = s.settings[s.mode] * 60000;
    setTotal(t);
    setRemaining(t);
    abandonPlant();
    announce(`${LABEL[s.mode]} reset. ${s.settings[s.mode]} minutes ready.`);
  }, [abandonPlant]);

  /* skip — advance without completing: no chime, no log entry, no round credit */
  const skip = useCallback(() => {
    setRunning(false);
    const s = stateRef.current;
    if (s.mode === "focus") abandonPlant();
    else setPlantPhase("grow");
    const nextMode: Mode = s.mode === "focus" ? "short" : "focus";
    const t = s.settings[nextMode] * 60000;
    setMode(nextMode);
    setTotal(t);
    setRemaining(t);
    announce(`${LABEL[nextMode]} — skipped ahead. Press space to start.`);
  }, [abandonPlant]);

  /* ------------------------------ settings ------------------------------ */
  const changeSetting = useCallback((key: keyof typeof LIMITS, delta: number) => {
    const s = stateRef.current;
    const [lo, hi] = LIMITS[key];
    const val = clamp(s.settings[key] + delta, lo, hi);
    setSettings({ ...s.settings, [key]: val });
    if (!s.running && key === s.mode) {
      const t = val * 60000;
      setTotal(t);
      setRemaining(t);
    }
  }, []);

  const setMixer = useCallback((key: "rain" | "drone" | "wind", v01: number) => {
    ambient.wake(); /* dragging a fader is a gesture — arm the audio here */
    setSettings((s) => ({ ...s, [key]: clamp01(v01) }));
  }, []);

  /* focus noise — selecting or moving the fader happens inside a click
     or drag, so waking here guarantees the sound actually starts */
  const selectNoise = useCallback((c: NoiseColor | null) => {
    ambient.wake();
    setSettings((s) => ({ ...s, noiseColor: c }));
  }, []);
  const setNoiseVol = useCallback((v01: number) => {
    ambient.wake();
    setSettings((s) => ({ ...s, noiseVolume: clamp01(v01) }));
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  /* ambience follows the persisted mix — intent only; the engine stays
     silent until a gesture calls wake() */
  useEffect(() => {
    SCENE.forEach(({ key }) => {
      ambient.setLevel(key, settings[key]);
      ambient.setChannelOn(key, settings.ambienceOn && settings[key] > 0);
    });
    NOISE_COLORS.forEach((k) => {
      ambient.setLevel(k, settings.noiseVolume);
      ambient.setChannelOn(k, settings.noiseColor === k);
    });
  }, [settings]);

  /* ------------------------------ side channels ------------------------------ */
  useEffect(() => {
    document.body.dataset.mode = mode;
  }, [mode]);

  useEffect(() => {
    document.body.classList.toggle("running", running);
  }, [running]);

  useEffect(() => {
    const secs = Math.max(0, Math.ceil(remaining / 1000));
    const mm = pad(Math.floor(secs / 60));
    const ss = pad(secs % 60);
    document.title = `${mm}:${ss} — ${LABEL[mode]}${everRun && !running ? " (paused)" : ""}`;
  }, [remaining, mode, running, everRun]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fn = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  /* keyboard: space toggles, R resets, Esc closes panels */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing =
        tag === "input" || tag === "textarea" || tag === "select" || !!target?.isContentEditable;
      if (e.code === "Space" && !typing) {
        if (tag === "button") return; /* let a focused button keep native space */
        e.preventDefault();
        toggle();
      } else if (
        (e.key === "r" || e.key === "R") &&
        !typing &&
        !scrimOpen &&
        !statsOpen &&
        !noiseOpen
      ) {
        reset();
      } else if (e.key === "Escape") {
        setScrimOpen(false);
        setStatsOpen(false);
        setNoiseOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle, reset, scrimOpen, statsOpen]);

  /* re-sync instantly when the tab wakes from background throttling */
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden && stateRef.current.running) {
        const rem = endAtRef.current - Date.now();
        if (rem <= 0) {
          setRemaining(0);
          handleComplete();
        } else {
          setRemaining(rem);
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [handleComplete]);

  /* boot: the board deals itself in with a short split-flap shuffle */
  const initialChars = useMemo(() => {
    const secs = Math.max(0, Math.ceil(remaining / 1000));
    return (pad(Math.floor(secs / 60)) + pad(secs % 60)).split("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    const timeouts: number[] = [];
    initialChars.forEach((target, i) => {
      const seq: string[] = [];
      const n = 2 + (i % 2);
      for (let k = 0; k < n; k++) seq.push(String(Math.floor(Math.random() * 10)));
      seq.push(target);
      seq.forEach((ch, k) => {
        timeouts.push(
          window.setTimeout(() => {
            if (cancelled) return;
            setBootChars((prev) => {
              const next = prev ? [...prev] : [...initialChars];
              next[i] = ch;
              return next;
            });
          }, 140 * i + 170 * k + 120),
        );
      });
    });
    timeouts.push(
      window.setTimeout(() => {
        if (!cancelled) setBootChars(null);
      }, 140 * 4 + 170 * 4 + 420),
    );
    return () => {
      cancelled = true;
      timeouts.forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------ derived ------------------------------ */
  const secs = Math.max(0, Math.ceil(remaining / 1000));
  const mm = pad(Math.floor(secs / 60));
  const ss = pad(secs % 60);
  const chars = (mm + ss).split("");
  const shown = bootChars ?? chars;
  const progress = total > 0 ? (1 - remaining / total) * 100 : 0;

  const dotsFilled = mode === "long" ? settings.rounds : completedFocus % settings.rounds;
  const roundTag =
    mode === "long"
      ? `${settings.rounds} / ${settings.rounds}`
      : `${(completedFocus % settings.rounds) + 1} / ${settings.rounds}`;

  const plantProgress = mode === "focus" ? (total > 0 ? 1 - remaining / total : 0) : 1;

  const roundNo = mode === "long" ? settings.rounds : (completedFocus % settings.rounds) + 1;

  /* action bridge so the floating window always drives the latest handlers */
  const pipActionsRef = useRef({ toggle, reset, skip });
  useEffect(() => {
    pipActionsRef.current = { toggle, reset, skip };
  });

  const pip = usePip(
    {
      mm,
      ss,
      label: LABEL[mode],
      round: roundNo,
      rounds: settings.rounds,
      progress: progress / 100,
      running,
      mode,
      plant: plantProgress,
    },
    {
      onToggle: () => pipActionsRef.current.toggle(),
      onReset: () => pipActionsRef.current.reset(),
      onSkip: () => pipActionsRef.current.skip(),
    },
  );

  /* auto pop-out fires from inside the gesture that starts playback */
  const pipOpenRef = useRef<() => void>(() => {});
  useEffect(() => {
    pipOpenRef.current = () => {
      if (!pip.active) void pip.open();
    };
  });

  const numericRows = [
    { key: "focus" as const, label: "Focus length", unit: "min" },
    { key: "short" as const, label: "Short break", unit: "min" },
    { key: "rounds" as const, label: "Rounds", unit: "" },
    { key: "long" as const, label: "Long break", unit: "min" },
  ];

  /* ------------------------------ render ------------------------------ */
  return (
    <>
      <AmbientCanvas mode={mode} running={running} reduced={reduced} />

      <main className="stage">
        {/* the instrument */}
        <div className="clock-row">
          <section className="board-frame" role="timer" aria-label="Pomodoro countdown timer">
            {pip.supported && (
              <button
                className="pip-btn"
                onClick={() => void pip.toggle()}
                aria-pressed={pip.active}
                aria-label={pip.active ? "Close floating timer" : "Pop out floating timer"}
                title={pip.active ? "Close floating timer" : "Pop out the mini timer"}
              >
                <PipIcon />
              </button>
            )}
            <div className="units">
              <FlipDigit char={shown[0]} reduced={reduced} fast={bootChars !== null} />
              <FlipDigit char={shown[1]} reduced={reduced} fast={bootChars !== null} />
              <div className="colon" aria-hidden="true">
                <i />
                <i />
              </div>
              <FlipDigit char={shown[2]} reduced={reduced} fast={bootChars !== null} />
              <FlipDigit char={shown[3]} reduced={reduced} fast={bootChars !== null} />
            </div>
            <div className="rule" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
          </section>

          {/* the companion — grows with each focus block */}
          <div className="plant-col" aria-hidden="true">
            <Plant progress={plantProgress} phase={plantPhase} />
          </div>
        </div>

        {/* session readout */}
        <div className="readout">
          <span>{LABEL[mode]}</span>
          <span className="round-tag">round {roundTag}</span>
          <span className="dots" aria-hidden="true">
            {Array.from({ length: settings.rounds }, (_, i) => (
              <i key={i} className={i < dotsFilled ? "on" : ""} />
            ))}
          </span>
        </div>

        {/* quiet control row */}
        <div className="controls">
          <button
            className="ctl"
            onClick={() => setStatsOpen(true)}
            aria-label="Open focus log"
            title="Focus log"
          >
            <StatsIcon />
          </button>
          <button
            className={"ctl" + (settings.noiseColor ? " live" : "")}
            onClick={() => setNoiseOpen(true)}
            aria-label="Focus noise"
            aria-expanded={noiseOpen}
            title="Focus noise"
          >
            <NoiseIcon />
          </button>
          <button className="ctl" onClick={reset} aria-label="Reset timer" title="Reset (R)">
            <ResetIcon />
          </button>
          <button
            className="ctl primary"
            onClick={toggle}
            aria-label={running ? "Pause timer" : "Start timer"}
          >
            <svg className="ic-play" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.5 5.4v13.2L19 12z" fill="currentColor" />
            </svg>
            <svg className="ic-pause" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M8.5 5.5v13M15.5 5.5v13"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
          <button
            className="ctl"
            onClick={() => setScrimOpen(true)}
            aria-label="Open settings"
            aria-expanded={scrimOpen}
            title="Settings"
          >
            <GearIcon />
          </button>
        </div>

        <p className="plate">PF-25 split-flap timer — space to start or pause</p>

        <div className="sr-only" id="announcer" aria-live="polite" />

        {/* settings */}
        <div
          className={"scrim" + (scrimOpen ? " open" : "")}
          onClick={(e) => {
            if (e.target === e.currentTarget) setScrimOpen(false);
          }}
        >
          <div className="panel" role="dialog" aria-modal="true" aria-labelledby="pTitle">
            <div className="p-head">
              <h2 id="pTitle">Timing</h2>
              <button className="x" onClick={() => setScrimOpen(false)} aria-label="Close settings">
                <CloseIcon />
              </button>
            </div>

            {numericRows.map(({ key, label, unit }) => {
              const [lo, hi] = LIMITS[key];
              const val = settings[key];
              return (
                <div className="row" key={key}>
                  <span className="lbl">{label}</span>
                  <div className="stepper">
                    <button
                      className="stp"
                      onClick={() => changeSetting(key, -1)}
                      disabled={val <= lo}
                      aria-label={`Decrease ${label}`}
                    >
                      <MinusIcon />
                    </button>
                    <output>
                      {val}
                      {unit && <span className="u">{unit}</span>}
                    </output>
                    <button
                      className="stp"
                      onClick={() => changeSetting(key, 1)}
                      disabled={val >= hi}
                      aria-label={`Increase ${label}`}
                    >
                      <PlusIcon />
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="row">
              <span className="lbl">Signal tone</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.sound}
                  onChange={(e) => setSettings((s) => ({ ...s, sound: e.target.checked }))}
                />
                <span className="tr" />
                <span className="sr-only">Signal tone on session end</span>
              </label>
            </div>

            {pip.supported && (
              <div className="row">
                <span className="lbl">Auto pop-out on start</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={settings.pipAuto}
                    onChange={(e) => setSettings((s) => ({ ...s, pipAuto: e.target.checked }))}
                  />
                  <span className="tr" />
                  <span className="sr-only">Open the floating timer window when a session starts</span>
                </label>
              </div>
            )}

            <div className="p-sub">
              <h3>Ambience</h3>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.ambienceOn}
                  onChange={(e) => {
                    ambient.wake(); /* resume inside the click's activation window */
                    setSettings((s) => ({ ...s, ambienceOn: e.target.checked }));
                  }}
                />
                <span className="tr" />
                <span className="sr-only">Ambient sound on</span>
              </label>
            </div>

            {SCENE.map(({ key, label }) => (
              <div className="row mix-row" key={key}>
                <span className="lbl">{label}</span>
                <div className="mixer">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(settings[key] * 100)}
                    onChange={(e) => setMixer(key, Number(e.target.value) / 100)}
                    aria-label={`${label} volume`}
                  />
                  <output className="mix-val">
                    {Math.round(settings[key] * 100)}
                    <span className="u">%</span>
                  </output>
                </div>
              </div>
            ))}

            <div className="p-sub">
              <h3>YouTube audio</h3>
            </div>

            {settings.ytId ? (
              <YoutubePlayer
                videoId={settings.ytId}
                title={settings.ytTitle}
                volume={settings.ytVol}
                onVolume={(v) => setSettings((s) => ({ ...s, ytVol: v }))}
                onClear={() => setSettings((s) => ({ ...s, ytId: null, ytTitle: null }))}
              />
            ) : (
              <>
                <YtInput
                  onLoad={(id, title) =>
                    setSettings((s) => ({ ...s, ytId: id, ytTitle: title }))
                  }
                />
                <p className="p-note yt-note">
                  Plays the audio of any YouTube video through the embedded player, even with
                  the panel closed.
                </p>
              </>
            )}

            <p className="p-note">
              One round = focus + short break; the long break follows the final round.
              Lengths apply to the next session of that kind. Saved on this device.
            </p>
          </div>
        </div>

        {/* focus log */}
        <StatsPanel open={statsOpen} log={log} onClose={() => setStatsOpen(false)} />

        {/* focus noise — the main-screen noise tab */}
        <NoisePanel
          open={noiseOpen}
          color={settings.noiseColor}
          volume={settings.noiseVolume}
          onSelect={selectNoise}
          onVolume={setNoiseVol}
          onClose={() => setNoiseOpen(false)}
        />
      </main>
    </>
  );
}
