# PF-25 — Split-Flap Focus Timer

A monochrome pomodoro instrument: a mechanical split-flap countdown, configurable
rounds, an ambient noise mixer, a growing plant, a local focus log, wake lock,
Picture-in-Picture, and offline PWA support. Built with React + Vite + TypeScript.

## Run it on localhost

Requires [Node.js](https://nodejs.org) 18 or newer (npm ships with it).

```bash
# 1. install dependencies
npm install

# 2. start the dev server
npm run dev
```

Open the printed URL — usually **http://localhost:5173** — in your browser.
The dev server hot-reloads on every file change.

If port 5173 is taken, start on another port:

```bash
npm run dev -- --port 4200
```

## Production build

```bash
npm run build        # outputs the app to dist/
npx vite preview     # serves dist/ at http://localhost:4173
```

`dist/` is a static site — any static file server works as well, e.g.
`npx serve dist`. Note that opening `dist/index.html` via `file://` will *not*
work; the module script and the service worker both need an `http(s)` origin.

## Other scripts

| Command          | What it does                        |
| ---------------- | ----------------------------------- |
| `npm run dev`    | dev server on http://localhost:5173 |
| `npm run build`  | production build into `dist/`       |
| `npm run typecheck` | TypeScript check without emitting |

## Notes

- The PWA (manifest + service worker) activates on first visit over `http(s)`;
  subsequent visits work fully offline.
- All data — settings, round count, focus log — is stored in `localStorage`
  on the device. Nothing is sent anywhere.
- The only external dependency at runtime is the IBM Plex Mono font from
  Google Fonts; the app degrades to system monospace offline.
