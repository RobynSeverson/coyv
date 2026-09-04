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

- `src/assets/gates3.jpeg` — the only image asset, reused across every page
- `src/pages/Landing.tsx` / `Landing.css` — `/`, the artwork + dissolve transition
- `src/pages/Home.tsx` / `Home.css` — `/home`, prints & photos tiles
- `src/pages/Collection.tsx` / `Collection.css` — `/prints`, `/photos`, `/archive`
- `src/components/BottomNav.tsx` / `.css` — fixed bottom navigation
- `src/components/SiteLayout.tsx` / `.css` — shell that wraps the nested routes
- `src/App.tsx` — routes

## How the dissolve works

The destination page (`.landing__reveal`) sits *on top* of the artwork and is
hidden by a CSS mask built from a stack of `radial-gradient` layers — one per
blob. Each layer starts at zero size and grows, and because CSS masks are
alpha-based and composite with `add`, the growing blobs union together until the
page is fully revealed.

- `BLOBS` in `Landing.tsx` controls each blob's position, diameter (`vmax`),
  delay and duration — delay roughly tracks distance from the centre, with
  jitter so some patches clear faster than their neighbours. The last entry is
  an oversized sweep that clears anything the others missed.
- Each blob gets a registered `@property --landing-bN` (`syntax: "<number>"`)
  plus a matching keyframe, generated into `BLOB_CSS`. Registration is what makes
  the value *tween* — unregistered custom properties animate discretely.
- `DISSOLVE_DURATION` in `Landing.tsx` and `--dissolve-duration` in
  `Landing.css` must stay in sync; they set the total length (2s).

### Why not an SVG mask?

WebKit does not support `mask-image: url(#someSvgMask)` on HTML elements, so the
original SVG-mask version silently failed on every iOS browser. Gradient masks
work everywhere. `supportsBlobMask` feature-detects `CSS.registerProperty` and
falls back to a plain crossfade (`.is-plain`) on older engines.

Note: a mask does **not** create a containing block for `position: fixed`
descendants (unlike `filter`), so `.landing__revealInner` carries a
`transform: translateZ(0)` to keep the fixed bottom nav inside the mask.

## Responsive notes

- Under `768px` the landing sets `--art-width: 200vw` so only the left half of
  the artwork fills the screen instead of squashing the whole piece.
- Under `480px` the bottom nav drops to a tighter type scale so all four labels
  fit on a phone.
