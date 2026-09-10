import { Link } from "react-router-dom";
import gatesArtwork from "../assets/landingDesktop.jpg";
import PageHeader from "../components/PageHeader";
import "./Home.css";

const TILES = [
  {
    to: "/vault",
    label: "vault",
    blurb: "save me from salvation",
    /* different crops of the artwork so each tile reads distinctly */
    position: "18% center",
  },
  {
    to: "/memories",
    label: "memories",
    blurb: "don't forget me",
    position: "82% center",
  },
];

export default function Home() {
  return (
    <main className="home">
      <PageHeader title="coyv" />

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
  );
}
