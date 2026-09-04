# gates

A React + TypeScript (Vite) site. The homepage shows the artwork as a pair of
gates; clicking the floating **gates** button splits the artwork down the middle
and swings both halves open in 3D, revealing the next page.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
npm run lint
```

## Structure

- `src/assets/gates.jpg` — the artwork used for both gate halves
- `src/pages/Home.tsx` / `Home.css` — gate halves, seam flare, floating button
- `src/pages/Beyond.tsx` / `Beyond.css` — the page behind the gates (`/beyond`)
- `src/App.tsx` — routes

Tune the animation length by changing `GATE_OPEN_DURATION` in `Home.tsx` and the
matching `--gate-open-duration` in `index.css`.
