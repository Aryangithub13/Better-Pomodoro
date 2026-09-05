import { useCallback, useEffect, useRef, useState } from "react";

/* ================================================================
   usePip — paints the countdown onto an off-screen canvas and
   pushes it into a Picture-in-Picture window, so the clock floats
   above whatever else is on the screen.
   ================================================================ */

export interface PipFrame {
  mm: string;
  ss: string;
  label: string;
  progress: number; // 0..1
  running: boolean;
}

export function usePip(frame: PipFrame) {
  const [supported] = useState(
    () =>
      typeof document !== "undefined" &&
      "pictureInPictureEnabled" in document &&
      document.pictureInPictureEnabled,
  );
  const [active, setActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(frame);
  frameRef.current = frame;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { mm, ss, label, progress, running } = frameRef.current;
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = "#121212";
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1c1c1c");
    g.addColorStop(0.45, "#131313");
    g.addColorStop(1, "#101010");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '600 88px "IBM Plex Mono", monospace';
    ctx.fillStyle = "#e8e8e8";
    ctx.fillText(`${mm}:${ss}`, W / 2, H / 2 - 12);

    ctx.font = '400 17px "IBM Plex Mono", monospace';
    ctx.fillStyle = "#7c7c7c";
    ctx.fillText(label + (running ? "" : "  (paused)"), W / 2, H / 2 + 52);

    /* hairline progress rule */
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(26, H - 20, W - 52, 2);
    if (progress > 0) {
      ctx.fillStyle = "#9a9a9a";
      ctx.fillRect(26, H - 20, (W - 52) * Math.min(1, progress), 2);
    }
  }, []);

  useEffect(() => {
    if (active) draw();
  }, [active, frame, draw]);

  const toggle = useCallback(async () => {
    if (!supported) return;
    if (active) {
      try {
        await document.exitPictureInPicture();
      } catch {
        /* already closed */
      }
      setActive(false);
      return;
    }
    try {
      await document.fonts.ready;
      if (!canvasRef.current) {
        const c = document.createElement("canvas");
        c.width = 480;
        c.height = 270;
        canvasRef.current = c;
      }
      draw();
      if (!videoRef.current) {
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.srcObject = canvasRef.current.captureStream(10);
        v.addEventListener("leavepictureinpicture", () => setActive(false));
        videoRef.current = v;
      }
      await videoRef.current.play();
      await videoRef.current.requestPictureInPicture();
      setActive(true);
    } catch {
      setActive(false);
    }
  }, [active, supported, draw]);

  return { supported, active, toggle };
}
