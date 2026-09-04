# gates

A React + TypeScript (Vite) site. `/` is a full-bleed landing page showing the
artwork with a floating **gates** button. Clicking it plays a splotchy dissolve:
soft blobs bloom outward from the button and eat holes in the artwork, revealing
the real homepage underneath, then the router settles on `/home`.

## Run

```bash
npm install
npm run dev      # Vite prints the actual URL (5173 unless taken)
npm run build    # type-check + production build
npm run lint
```

## Structure

- `src/assets/gates2.jpeg` — the only image asset, reused across every page
- `src/pages/Landing.tsx` / `Landing.css` — `/`, the artwork + dissolve transition
- `src/pages/Home.tsx` / `Home.css` — `/home`, prints & photos tiles
- `src/pages/Collection.tsx` / `Collection.css` — `/prints`, `/photos`, `/archive`
- `src/components/BottomNav.tsx` / `.css` — fixed bottom navigation
- `src/components/SiteLayout.tsx` / `.css` — shell that wraps the nested routes
- `src/App.tsx` — routes

## How the dissolve works

The artwork layer is masked by an inline SVG `<mask>`: a white rect keeps it
visible, and a set of soft-edged black circles grow to punch holes through it.
The destination page is rendered behind the artwork, so the holes reveal real
content rather than a flat colour.

- `SPLOTCHES` in `Landing.tsx` controls each blob's position, radius, final
  scale, delay and duration — delay roughly tracks distance from the centre,
  with jitter so some patches clear faster than their neighbours.
- `DISSOLVE_DURATION` in `Landing.tsx` and `--dissolve-duration` in
  `Landing.css` must stay in sync; they set the total length (2s).
- `.landing__blobSweep` is a black rect that fades in over the last stretch to
  clear anything the blobs missed.

## Responsive notes

- Under `768px` the landing sets `--art-width: 200vw` so only the left half of
  the artwork fills the screen instead of squashing the whole piece.
- Under `480px` the bottom nav drops to a tighter type scale so all four labels
  fit on a phone.
