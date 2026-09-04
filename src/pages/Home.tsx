import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import gatesArtwork from '../assets/gates.jpg'
import './Home.css'

const GATE_OPEN_DURATION = 1700

export default function Home() {
  const [isOpening, setIsOpening] = useState(false)
  const navigate = useNavigate()
  const timeoutRef = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timeoutRef.current), [])

  const openGates = () => {
    if (isOpening) return
    setIsOpening(true)
    timeoutRef.current = window.setTimeout(
      () => navigate('/beyond'),
      GATE_OPEN_DURATION,
    )
  }

  return (
    <main className={`home${isOpening ? ' is-opening' : ''}`}>
      <div className="home__beyond" aria-hidden="true">
        <div className="home__beyondGlow" />
      </div>

      <div
        className="home__stage"
        style={{ ['--gate-image' as string]: `url(${gatesArtwork})` }}
        aria-hidden="true"
      >
        <div className="home__gate home__gate--left" />
        <div className="home__gate home__gate--right" />
        <div className="home__seam" />
      </div>

      <button
        type="button"
        className="home__button"
        onClick={openGates}
        disabled={isOpening}
      >
        gates
      </button>
    </main>
  )
}
