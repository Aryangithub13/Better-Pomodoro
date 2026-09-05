import { useEffect, useRef, useState } from "react";

/* ================================================================
   YouTube audio slot — paste any YouTube link and its audio plays
   through an embedded player while you focus. The video id and
   volume persist with the rest of the settings.
   ================================================================ */

interface YTPlayerIface {
  setVolume(v: number): void;
  playVideo(): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (el: HTMLElement, opts: unknown) => YTPlayerIface;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace | null> | null = null;

function loadYouTubeApi(): Promise<YTNamespace | null> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT ?? null);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return ytApiPromise;
}

export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (u.pathname === "/watch") {
        const v = u.searchParams.get("v");
        return v && /^[\w-]{11}$/.test(v) ? v : null;
      }
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchTitle(videoId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`,
      )}&format=json`,
    );
    if (!res.ok) return "YouTube audio";
    const j = (await res.json()) as { title?: string };
    return j.title || "YouTube audio";
  } catch {
    return "YouTube audio";
  }
}

/* ------------------------------ input row ------------------------------ */
export function YtInput({
  onLoad,
}: {
  onLoad: (id: string, title: string) => void;
}) {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = async () => {
    const id = parseYouTubeId(value);
    if (!id) {
      setInvalid(true);
      window.setTimeout(() => setInvalid(false), 900);
      return;
    }
    const title = await fetchTitle(id);
    onLoad(id, title);
  };

  return (
    <div className="yt-row">
      <input
        className={"yt-input" + (invalid ? " invalid" : "")}
        type="text"
        value={value}
        placeholder="Paste a YouTube link…"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
          /* keep the global space shortcut from hijacking typing */
          e.stopPropagation();
        }}
        aria-label="YouTube video link"
      />
      <button className="yt-load" onClick={() => void submit()} aria-label="Load YouTube audio">
        Load
      </button>
    </div>
  );
}

/* ------------------------------ embedded player ------------------------------ */
export function YoutubePlayer({
  videoId,
  title,
  volume,
  onVolume,
  onClear,
}: {
  videoId: string;
  title: string | null;
  volume: number;
  onVolume: (v01: number) => void;
  onClear: () => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerIface | null>(null);
  const [ready, setReady] = useState(false);
  const volRef = useRef(volume);
  volRef.current = volume;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void (async () => {
      const YT = await loadYouTubeApi();
      if (cancelled || !YT || !holderRef.current) return;
      const inner = document.createElement("div");
      holderRef.current.appendChild(inner);
      playerRef.current = new YT.Player(inner, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: { playsinline: 1, rel: 0, iv_load_policy: 3, color: "white" },
        events: {
          onReady: () => {
            if (cancelled) return;
            setReady(true);
            const p = playerRef.current;
            if (!p) return;
            p.setVolume(Math.round(volRef.current * 100));
            /* Load was pressed moments ago — still inside the activation
               window, so unmuted playback is allowed to start. */
            p.playVideo();
          },
        },
      });
    })();
    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* already gone */
      }
      playerRef.current = null;
    };
  }, [videoId]);

  useEffect(() => {
    if (ready) playerRef.current?.setVolume(Math.round(volume * 100));
  }, [volume, ready]);

  return (
    <div className="yt-box">
      <div className="yt-frame">
        <div ref={holderRef} className="yt-holder" />
      </div>
      <div className="yt-meta">
        <span className="yt-title" title={title ?? "YouTube audio"}>
          {title ?? "YouTube audio"}
        </span>
        <div className="mixer yt-vol">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => onVolume(Number(e.target.value) / 100)}
            aria-label="YouTube audio volume"
          />
          <output className="mix-val">
            {Math.round(volume * 100)}
            <span className="u">%</span>
          </output>
        </div>
        <button className="yt-clear" onClick={onClear} aria-label="Remove YouTube audio">
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
    </div>
  );
}
