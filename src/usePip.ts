import { useCallback, useEffect, useRef, useState } from "react";
import { LEAVES, THRESHOLDS, LEAF_PATH, TOP_PATH } from "./Plant";

/* ================================================================
   usePip — a genuinely advanced floating timer.

   Preferred path: the Document Picture-in-Picture API. The floating
   window receives a real miniature of the instrument — stylesheet
   and fonts copied across, live split-flap digits that flip with
   the same two-stage animation, the growing plant, session dots,
   the hairline progress rule, and working play/pause, reset and
   skip controls wired back to the opener page.

   Fallback (Firefox/Safari): element PiP fed by a canvas that
   renders the card faces, seam, a simulated weighted flap-fall per
   digit, dots and the progress rule — re-reading the page's grey
   tokens so break-state inversion shows up there too.
   ================================================================ */

export interface PipState {
  mm: string;
  ss: string;
  label: string;
  round: number;
  rounds: number;
  progress: number; // 0..1
  running: boolean;
  mode: string;
  plant: number; // 0..1
}

export interface PipActions {
  onToggle: () => void;
  onReset: () => void;
  onSkip: () => void;
}

interface DocumentPictureInPicture {
  requestWindow(opts?: { width?: number; height?: number }): Promise<Window>;
}

const docPip = (): DocumentPictureInPicture | null => {
  const w = window as unknown as { documentPictureInPicture?: DocumentPictureInPicture };
  return w.documentPictureInPicture ?? null;
};

const elemPip = () =>
  typeof document !== "undefined" &&
  "pictureInPictureEnabled" in document &&
  document.pictureInPictureEnabled;

/* ------------------------------ icons ------------------------------ */
const SVG_PLAY =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.4v13.2L19 12z" fill="currentColor"/></svg>';
const SVG_PAUSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5v13M15.5 5.5v13" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const SVG_RESET =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
const SVG_SKIP =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.2v11.6L15 12z" fill="currentColor"/><path d="M17.5 6.5v11" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>';

/* ================================================================
   Document PiP — a living miniature in its own window
   ================================================================ */

interface DocHandle {
  update: (s: PipState) => void;
}

function copyStyles(from: Document, to: Document) {
  /* font + compiled stylesheet links */
  from.head.querySelectorAll('link[rel="stylesheet"]').forEach((l) => {
    to.head.appendChild(l.cloneNode(true));
  });
  /* injected style tags (vite dev) */
  from.head.querySelectorAll("style").forEach((s) => {
    to.head.appendChild(s.cloneNode(true));
  });
}

function buildDigit(doc: Document) {
  const unit = doc.createElement("div");
  unit.className = "unit";
  unit.setAttribute("aria-hidden", "true");
  unit.innerHTML = `
    <div class="card">
      <div class="half static-top"><span class="num">0</span></div>
      <div class="half static-bottom bottom-h"><span class="num">0</span></div>
      <div class="seam"></div>
      <div class="half flap flap-top"><span class="num">0</span></div>
      <div class="half flap flap-bottom bottom-h"><span class="num">0</span></div>
    </div>`;
  const nums = Array.from(unit.querySelectorAll<HTMLElement>(".num"));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let cur = "0";
  let timer: number | null = null;

  const set = (ch: string) => {
    if (ch === cur) return;
    const from = cur;
    cur = ch;
    if (reduced) {
      unit.classList.remove("flipping");
      nums.forEach((n) => (n.textContent = ch));
      return;
    }
    if (timer !== null) {
      window.clearTimeout(timer);
      unit.classList.remove("flipping");
    }
    nums[0].textContent = ch; // new value revealed up top
    nums[1].textContent = from; // old value below until covered
    nums[2].textContent = from; // falling flap carries the old value
    nums[3].textContent = ch; // landing flap carries the new one
    void unit.offsetWidth;
    unit.classList.add("flipping");
    timer = window.setTimeout(() => {
      nums[1].textContent = ch;
      unit.classList.remove("flipping");
      timer = null;
    }, 520);
  };
  return { root: unit, set };
}

function buildPlant(doc: Document) {
  const wrap = doc.createElement("div");
  wrap.className = "pip-plant";
  wrap.setAttribute("aria-hidden", "true");
  const leafMarkup = LEAVES.map(
    (L) =>
      `<g transform="translate(${L.x} ${L.y}) scale(${L.side} 1)"><path class="leaf" d="${LEAF_PATH}"/></g>`,
  ).join("");
  wrap.innerHTML = `
    <svg class="plant grow" viewBox="0 0 64 264">
      <path class="pot" d="M18 228h28v6H18Z"/>
      <path class="pot" d="M21 234h22l-3.4 22H24.4Z"/>
      <path class="stem" d="M32 228 C 31 200, 34 184, 32 158 C 30 132, 33 112, 32 88 C 31.5 74, 32 64, 32 52" pathLength="100"/>
      ${leafMarkup}
      <g transform="translate(32 58)"><path class="leaf" d="${TOP_PATH}"/></g>
    </svg>`;
  const stem = wrap.querySelector<SVGPathElement>(".stem");
  const leaves = Array.from(wrap.querySelectorAll<SVGPathElement>(".leaf"));
  /* staggered unfurl, matching the main clock */
  leaves.forEach((l, i) => {
    l.style.transitionDelay = `${i * 60}ms`;
  });
  const update = (p: number) => {
    if (stem) stem.style.strokeDashoffset = String(100 - 100 * p);
    leaves.forEach((l, i) => {
      const th = i < THRESHOLDS.length ? THRESHOLDS[i] : 0.9;
      l.classList.toggle("on", p >= th);
    });
  };
  return { root: wrap, update };
}

function buildDocPip(pw: Window, actions: () => PipActions): DocHandle {
  const doc = pw.document;
  doc.title = "PF-25";
  copyStyles(document, doc);

  const body = doc.body;
  body.style.margin = "0";

  const root = doc.createElement("div");
  root.className = "pip-root";
  root.innerHTML = `
    <div class="pip-card">
      <div class="pip-stage"></div>
      <div class="pip-meta">
        <span class="pip-label"></span>
        <span class="pip-round"></span>
      </div>
      <div class="rule"><span class="pip-fill"></span></div>
      <div class="pip-dots"></div>
      <div class="pip-controls">
        <button class="pip-ctl" data-act="reset" aria-label="Reset timer" title="Reset">${SVG_RESET}</button>
        <button class="pip-ctl primary" data-act="toggle" aria-label="Start or pause"></button>
        <button class="pip-ctl" data-act="skip" aria-label="Skip to next session" title="Skip">${SVG_SKIP}</button>
      </div>
    </div>`;
  body.appendChild(root);

  const stage = root.querySelector<HTMLElement>(".pip-stage") as HTMLElement;
  const plant = buildPlant(doc);
  stage.appendChild(plant.root);
  const unitsWrap = doc.createElement("div");
  unitsWrap.className = "units";
  stage.appendChild(unitsWrap);
  const digits = [0, 1, 2, 3].map(() => buildDigit(doc));
  digits.forEach((d, i) => {
    unitsWrap.appendChild(d.root);
    if (i === 1) {
      const colon = doc.createElement("div");
      colon.className = "colon";
      colon.setAttribute("aria-hidden", "true");
      colon.innerHTML = "<i></i><i></i>";
      unitsWrap.appendChild(colon);
    }
  });

  const labelEl = root.querySelector<HTMLElement>(".pip-label") as HTMLElement;
  const roundEl = root.querySelector<HTMLElement>(".pip-round") as HTMLElement;
  const fillEl = root.querySelector<HTMLElement>(".pip-fill") as HTMLElement;
  const dotsEl = root.querySelector<HTMLElement>(".pip-dots") as HTMLElement;
  const toggleBtn = root.querySelector<HTMLElement>('[data-act="toggle"]') as HTMLElement;

  root.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!t) return;
    const act = t.dataset.act;
    if (act === "toggle") actions().onToggle();
    else if (act === "reset") actions().onReset();
    else if (act === "skip") actions().onSkip();
  });

  let dotCount = -1;

  const update = (s: PipState) => {
    body.dataset.mode = s.mode;
    body.classList.toggle("running", s.running);
    [s.mm[0], s.mm[1], s.ss[0], s.ss[1]].forEach((ch, i) => digits[i].set(ch));
    labelEl.textContent = s.label + (s.running ? "" : " · paused");
    roundEl.textContent = `round ${s.round} of ${s.rounds}`;
    fillEl.style.width = `${Math.min(100, Math.max(0, s.progress * 100))}%`;
    if (dotCount !== s.rounds) {
      dotCount = s.rounds;
      dotsEl.innerHTML = Array.from({ length: s.rounds }, () => "<i></i>").join("");
    }
    const filled = s.mode === "long" ? s.rounds : s.round - 1;
    Array.from(dotsEl.children).forEach((d, i) => d.classList.toggle("on", i < filled));
    toggleBtn.innerHTML = s.running ? SVG_PAUSE : SVG_PLAY;
    plant.update(s.plant);
  };

  return { update };
}

/* ================================================================
   Canvas fallback — element PiP with simulated split-flap physics
   ================================================================ */

interface CanvasHandle {
  update: (s: PipState) => void;
  dispose: () => void;
}

const FLIP_MS = 460;

function buildCanvasPip(video: HTMLVideoElement, canvas: HTMLCanvasElement): CanvasHandle {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const W = canvas.width;
  const H = canvas.height;

  interface DigitAnim {
    cur: string;
    from: string;
    start: number;
  }
  const digits: DigitAnim[] = "0000".split("").map((c) => ({ cur: c, from: c, start: 0 }));
  let state: PipState = {
    mm: "00",
    ss: "00",
    label: "Focus",
    round: 1,
    rounds: 4,
    progress: 0,
    running: false,
    mode: "focus",
    plant: 0,
  };

  const readTokens = () => {
    const cs = getComputedStyle(document.body);
    const g = (k: string, fb: string) => cs.getPropertyValue(k).trim() || fb;
    return {
      cardHi: g("--card-hi", "#303030"),
      cardLo: g("--card-lo", "#1e1e1e"),
      digit: g("--digit", "#ececec"),
      back: "#121212",
      panel: "#181818",
      line: "#2a2a2a",
      mid: "#8a8a8a",
      low: "#5c5c5c",
    };
  };
  let T = readTokens();

  const rr = (x: number, y: number, w: number, h: number, r: number | number[]) => {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.rect(x, y, w, h);
    }
  };

  const drawDigit = (x: number, y: number, w: number, h: number, d: DigitAnim, now: number) => {
    const hh = h / 2;
    const p = d.start ? Math.min(1, (now - d.start) / FLIP_MS) : 1;
    const flipping = d.start !== 0 && p < 1;
    const topVal = flipping && p < 0.5 ? d.from : d.cur;
    const botVal = flipping && p < 0.5 ? d.from : d.cur;

    /* static halves */
    rr(x, y, w, hh, [9, 9, 0, 0]);
    ctx.fillStyle = T.cardHi;
    ctx.fill();
    rr(x, y + hh, w, hh, [0, 0, 9, 9]);
    ctx.fillStyle = T.cardLo;
    ctx.fill();

    /* glyphs — full-height text, clipped per half */
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, hh);
    ctx.clip();
    ctx.fillStyle = T.digit;
    ctx.font = `600 ${Math.round(h * 0.62)}px "IBM Plex Mono", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(topVal, x + w / 2, y + hh);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y + hh, w, hh);
    ctx.clip();
    ctx.fillStyle = T.digit;
    ctx.font = `600 ${Math.round(h * 0.62)}px "IBM Plex Mono", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(botVal, x + w / 2, y + hh);
    ctx.restore();

    /* seam */
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x, y + hh, w, 1);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(x, y + hh + 1, w, 1);

    if (flipping) {
      const s = Math.abs(Math.cos(Math.PI * p));
      const seamY = y + hh;
      ctx.save();
      ctx.translate(0, seamY);
      ctx.scale(1, Math.max(0.02, s));
      if (p < 0.5) {
        /* old top card falling toward the seam */
        ctx.fillStyle = T.cardHi;
        ctx.fillRect(x, -hh, w, hh);
        ctx.fillStyle = T.digit;
        ctx.font = `600 ${Math.round(h * 0.62)}px "IBM Plex Mono", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(d.from, x + w / 2, -hh / 2);
        ctx.fillStyle = `rgba(0,0,0,${0.3 * Math.sin(Math.PI * p)})`;
        ctx.fillRect(x, -hh, w, hh);
      } else {
        /* its back lands over the bottom half, revealing the new value */
        ctx.fillStyle = T.cardLo;
        ctx.fillRect(x, 0, w, hh);
        ctx.fillStyle = T.digit;
        ctx.font = `600 ${Math.round(h * 0.62)}px "IBM Plex Mono", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(d.from, x + w / 2, hh / 2);
        ctx.fillStyle = `rgba(0,0,0,${0.24 * Math.sin(Math.PI * p)})`;
        ctx.fillRect(x, 0, w, hh);
      }
      ctx.restore();
    }
  };

  const draw = (now: number) => {
    T = readTokens();
    ctx.fillStyle = T.back;
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1d1d1d");
    g.addColorStop(0.5, "#141414");
    g.addColorStop(1, "#101010");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* digits */
    const dw = 78;
    const dh = 104;
    const colonW = 22;
    const gap = 8;
    const totalW = dw * 4 + colonW + gap * 4;
    let x = (W - totalW) / 2;
    const y = 30;
    const chars = (state.mm + state.ss).split("");
    chars.forEach((ch, i) => {
      const d = digits[i];
      if (d.cur !== ch) {
        d.from = d.cur;
        d.cur = ch;
        d.start = now;
      }
      drawDigit(x, y, dw, dh, d, now);
      x += dw + gap;
      if (i === 1) {
        /* colon */
        ctx.fillStyle = state.running ? T.mid : T.low;
        const r = 4;
        const cx = x + colonW / 2 - gap / 2;
        ctx.beginPath();
        ctx.arc(cx, y + dh / 2 - 14, r, 0, Math.PI * 2);
        ctx.moveTo(cx + r, y + dh / 2 + 14);
        ctx.arc(cx, y + dh / 2 + 14, r, 0, Math.PI * 2);
        ctx.fill();
        x += colonW + gap;
      }
    });

    /* meta line */
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '500 15px "IBM Plex Mono", monospace';
    ctx.fillStyle = T.mid;
    ctx.fillText(
      `${state.label} · round ${state.round} of ${state.rounds}${state.running ? "" : " · paused"}`,
      W / 2,
      158,
    );

    /* progress rule */
    const rx = 40;
    const rw = W - 80;
    ctx.fillStyle = T.line;
    ctx.fillRect(rx, 178, rw, 2);
    if (state.progress > 0) {
      ctx.fillStyle = "#8f8f8f";
      ctx.fillRect(rx, 178, rw * Math.min(1, state.progress), 2);
    }

    /* round dots */
    const dotGap = 14;
    const n = Math.min(15, state.rounds);
    const filled = state.mode === "long" ? n : state.round - 1;
    const dotsW = (n - 1) * dotGap;
    for (let i = 0; i < n; i++) {
      const cx = W / 2 - dotsW / 2 + i * dotGap;
      ctx.beginPath();
      ctx.arc(cx, 202, 3, 0, Math.PI * 2);
      if (i < filled) {
        ctx.fillStyle = "#d8d8d8";
        ctx.fill();
      } else {
        ctx.strokeStyle = T.low;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    /* keep animating while any flap is mid-fall */
    raf = requestAnimationFrame(draw);
  };

  let raf = requestAnimationFrame(draw);

  return {
    update: (s: PipState) => {
      state = s;
    },
    dispose: () => cancelAnimationFrame(raf),
  };
}

/* ================================================================
   the hook
   ================================================================ */
export function usePip(state: PipState, actions: PipActions) {
  const [supported] = useState(() => !!docPip() || elemPip());
  const [active, setActive] = useState(false);
  const [isDoc] = useState(() => !!docPip());

  const stateRef = useRef(state);
  stateRef.current = state;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const kindRef = useRef<"doc" | "video" | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const docHandleRef = useRef<DocHandle | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasHandleRef = useRef<CanvasHandle | null>(null);

  /* push every state change into whichever window is open */
  useEffect(() => {
    docHandleRef.current?.update(state);
    canvasHandleRef.current?.update(state);
  });

  const teardown = useCallback(() => {
    canvasHandleRef.current?.dispose();
    canvasHandleRef.current = null;
    docHandleRef.current = null;
    pipWindowRef.current = null;
    kindRef.current = null;
  }, []);

  const open = useCallback(async () => {
    if (kindRef.current) return;
    const dpp = docPip();
    if (dpp) {
      try {
        await document.fonts.ready;
        const pw = await dpp.requestWindow({ width: 420, height: 308 });
        pipWindowRef.current = pw;
        kindRef.current = "doc";
        docHandleRef.current = buildDocPip(pw, () => actionsRef.current);
        pw.addEventListener("pagehide", () => {
          teardown();
          setActive(false);
        });
        docHandleRef.current.update(stateRef.current);
        setActive(true);
      } catch {
        teardown();
        setActive(false);
      }
      return;
    }
    if (elemPip()) {
      try {
        await document.fonts.ready;
        const c = document.createElement("canvas");
        c.width = 480;
        c.height = 270;
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.srcObject = c.captureStream(30);
        v.addEventListener("leavepictureinpicture", () => {
          teardown();
          setActive(false);
        });
        canvasHandleRef.current = buildCanvasPip(v, c);
        canvasHandleRef.current.update(stateRef.current);
        videoRef.current = v;
        kindRef.current = "video";
        await v.play();
        await v.requestPictureInPicture();
        setActive(true);
      } catch {
        teardown();
        setActive(false);
      }
    }
  }, [teardown]);

  const close = useCallback(() => {
    if (kindRef.current === "doc" && pipWindowRef.current) {
      try {
        pipWindowRef.current.close();
      } catch {
        /* already gone */
      }
    } else if (kindRef.current === "video" && document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => undefined);
    }
    teardown();
    setActive(false);
  }, [teardown]);

  const toggle = useCallback(() => {
    if (kindRef.current) close();
    else void open();
  }, [close, open]);

  useEffect(() => () => close(), [close]);

  return { supported, active, isDoc, toggle, open, close };
}
