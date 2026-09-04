import { Link } from 'react-router-dom'
import gatesArtwork from '../assets/gates3.jpeg'
import './Home.css'

const TILES = [
  {
    to: '/prints',
    label: 'prints',
    blurb: 'Editions on paper',
    /* different crops of the artwork so each tile reads distinctly */
    position: '18% center',
  },
  {
    to: '/photos',
    label: 'photos',
    blurb: 'Shot and collected',
    position: '82% center',
  },
]

export default function Home() {
  return (
    <main className="home">
      <header className="home__header">
        <h1 className="home__title">gates</h1>
        <p className="home__subtitle">Past the threshold.</p>
      </header>

      <ul className="home__tiles">
        {TILES.map((tile) => (
          <li key={tile.to}>
            <Link to={tile.to} className="home__tile">
              <img
                className="home__tileImage"
                src={gatesArtwork}
                alt=""
                style={{ objectPosition: tile.position }}
              />
              <span className="home__tileBody">
                <span className="home__tileLabel">{tile.label}</span>
                <span className="home__tileBlurb">{tile.blurb}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
