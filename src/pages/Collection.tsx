import gatesArtwork from '../assets/gates3.jpeg'
import './Collection.css'

type CollectionProps = {
  title: string
  blurb: string
}

const PLACEHOLDER_POSITIONS = [
  '10% 20%',
  '35% 60%',
  '60% 30%',
  '85% 70%',
  '25% 85%',
  '70% 10%',
]

export default function Collection({ title, blurb }: CollectionProps) {
  return (
    <main className="collection">
      <header className="collection__header">
        <h1 className="collection__title">{title}</h1>
        <p className="collection__blurb">{blurb}</p>
      </header>

      <ul className="collection__grid">
        {PLACEHOLDER_POSITIONS.map((position) => (
          <li key={position} className="collection__item">
            <img
              className="collection__image"
              src={gatesArtwork}
              alt=""
              style={{ objectPosition: position }}
            />
          </li>
        ))}
      </ul>
    </main>
  )
}
