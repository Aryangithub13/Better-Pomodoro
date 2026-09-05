import { useEffect } from "react";

/* ================================================================
   useWakeLock — keeps the screen awake while the timer runs, so a
   focus block is never interrupted by the display sleeping.
   Re-acquires automatically when the tab becomes visible again.
   ================================================================ */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (!("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void s.release();
          return;
        }
        sentinel = s;
        sentinel.addEventListener("release", () => {
          sentinel = null;
          if (!cancelled && !document.hidden) void acquire();
        });
      } catch {
        /* denied or unavailable — the timer simply runs as usual */
      }
    };

    void acquire();
    const onVis = () => {
      if (!document.hidden && !sentinel) void acquire();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      if (sentinel) void sentinel.release();
    };
  }, [active]);
}
