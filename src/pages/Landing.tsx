import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BottomNav from '../components/BottomNav'
import Home from './Home'
import gatesArtwork from '../assets/gates2.jpeg'
import './Landing.css'

const DISSOLVE_DURATION = 2000
const MASK_ID = 'landing-dissolve-mask'

/* Splotches bloom outward from the button in the centre. Delay roughly tracks
   distance from centre, but each patch is jittered so some areas dissolve
   noticeably faster than their neighbours. Coordinates and radii are fractions
   of the viewport (the mask uses objectBoundingBox units). */
const SPLOTCHES = [
  { x: 0.5, y: 0.5, r: 0.075, scale: 2.6, delay: 0, duration: 780 },
  { x: 0.42, y: 0.45, r: 0.05, scale: 2.85, delay: 115, duration: 930 },
  { x: 0.59, y: 0.56, r: 0.055, scale: 2.36, delay: 179, duration: 690 },
  { x: 0.56, y: 0.4, r: 0.045, scale: 3.1, delay: 346, duration: 1050 },
  { x: 0.39, y: 0.6, r: 0.055, scale: 2.48, delay: 269, duration: 780 },
  { x: 0.27, y: 0.37, r: 0.065, scale: 2.73, delay: 576, duration: 900 },
  { x: 0.72, y: 0.63, r: 0.06, scale: 3.22, delay: 499, duration: 1170 },
  { x: 0.67, y: 0.28, r: 0.05, scale: 2.42, delay: 768, duration: 720 },
  { x: 0.32, y: 0.73, r: 0.055, scale: 2.98, delay: 691, duration: 1080 },
  { x: 0.14, y: 0.55, r: 0.065, scale: 2.54, delay: 998, duration: 840 },
  { x: 0.86, y: 0.44, r: 0.06, scale: 2.91, delay: 922, duration: 1020 },
  { x: 0.47, y: 0.14, r: 0.055, scale: 2.48, delay: 1075, duration: 780 },
  { x: 0.54, y: 0.87, r: 0.06, scale: 3.16, delay: 1037, duration: 1140 },
  { x: 0.09, y: 0.15, r: 0.055, scale: 2.67, delay: 1344, duration: 810 },
  { x: 0.91, y: 0.83, r: 0.055, scale: 2.79, delay: 1267, duration: 900 },
  { x: 0.89, y: 0.09, r: 0.05, scale: 2.36, delay: 1459, duration: 720 },
  { x: 0.11, y: 0.89, r: 0.05, scale: 2.6, delay: 1421, duration: 840 },
]

export default function Landing() {
  const [isDissolving, setIsDissolving] = useState(false)
  const navigate = useNavigate()
  const timeoutRef = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timeoutRef.current), [])

  const dissolve = () => {
    if (isDissolving) return
    setIsDissolving(true)
    timeoutRef.current = window.setTimeout(
      () => navigate('/home'),
      DISSOLVE_DURATION,
    )
  }

  return (
    <main className={`landing${isDissolving ? ' is-dissolving' : ''}`}>
      {/* The destination page, revealed through the holes the dissolve opens. */}
      <div className="landing__beneath" aria-hidden="true" inert>
        <div className="siteLayout">
          <div className="siteLayout__content">
            <Home />
          </div>
          <BottomNav />
        </div>
      </div>

      <svg className="landing__maskDefs" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="landing-blob-gradient">
            <stop offset="0%" stopColor="#000" stopOpacity="1" />
            <stop offset="72%" stopColor="#000" stopOpacity="1" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </radialGradient>

          <mask
            id={MASK_ID}
            maskUnits="objectBoundingBox"
            maskContentUnits="objectBoundingBox"
          >
            {/* white keeps the artwork, black eats it away */}
            <rect x="0" y="0" width="1" height="1" fill="#fff" />
            {SPLOTCHES.map((splotch, index) => (
              <circle
                key={index}
                className="landing__blob"
                cx={splotch.x}
                cy={splotch.y}
                r={splotch.r}
                fill="url(#landing-blob-gradient)"
                style={{
                  ['--blob-scale' as string]: splotch.scale,
                  animationDelay: `${splotch.delay}ms`,
                  animationDuration: `${splotch.duration}ms`,
                }}
              />
            ))}
            {/* closes over whatever the splotches missed */}
            <rect
              className="landing__blobSweep"
              x="0"
              y="0"
              width="1"
              height="1"
              fill="#000"
            />
          </mask>
        </defs>
      </svg>

      <div
        className="landing__art"
        style={{
          ['--art-image' as string]: `url(${gatesArtwork})`,
          maskImage: `url(#${MASK_ID})`,
          WebkitMaskImage: `url(#${MASK_ID})`,
        }}
        aria-hidden="true"
      />

      <button
        type="button"
        className="landing__button"
        onClick={dissolve}
        disabled={isDissolving}
      >
        gates
      </button>
    </main>
  )
}
