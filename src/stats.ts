/* ================================================================
   Local-first focus log. Completed focus sessions are appended to
   localStorage; weekly totals, per-day minutes and the daily streak
   are derived from that log. Nothing leaves this device.
   ================================================================ */

export interface LogEntry {
  ts: number;
  minutes: number;
}

const KEY = "pomo.pf25.log.v1";
const MAX_ENTRIES = 500;

export function loadLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const j: unknown = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    return j.filter(
      (e): e is LogEntry =>
        !!e &&
        typeof (e as LogEntry).ts === "number" &&
        typeof (e as LogEntry).minutes === "number",
    );
  } catch {
    return [];
  }
}

function save(log: LogEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch {
    /* full or blocked — the timer keeps working without the log */
  }
}

export function recordFocus(minutes: number): LogEntry[] {
  const next = [...loadLog(), { ts: Date.now(), minutes }].slice(-MAX_ENTRIES);
  save(next);
  return next;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export interface DayStats {
  today: number;
  week: number;
  perDay: number[]; // oldest → today, minutes of focus
  streak: number;
  sessions: number;
}

export function computeStats(log: LogEntry[]): DayStats {
  const now = new Date();
  const keys: string[] = [];
  const perDay = new Array<number>(7).fill(0);
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - (6 - i));
    keys.push(dayKey(d));
  }
  const idx = new Map<string, number>(keys.map((k, i) => [k, i]));
  for (const e of log) {
    const i = idx.get(dayKey(new Date(e.ts)));
    if (i !== undefined) perDay[i] += e.minutes;
  }

  const days = new Set(log.map((e) => dayKey(new Date(e.ts))));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    today: perDay[6],
    week: perDay.reduce((a, b) => a + b, 0),
    perDay,
    streak,
    sessions: log.length,
  };
}

export function dayLetters(): string[] {
  const letters = "SMTWTFS";
  const now = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (6 - i));
    return letters[d.getDay()];
  });
}

export function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
