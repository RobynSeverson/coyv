import { useLocation } from "react-router-dom";
import contactArtwork from "../assets/homeContact.webp";
import socialMark from "../assets/homeSocial.webp";
import "./Home.css";

const SHOWCASES = [
  { title: "projects", item: "project" },
  { title: "artwork", item: "artwork" },
];

const NEWS = [
  {
    title: "from the studio",
    text: "A space for notes, experiments, and little things worth sharing.",
  },
  {
    title: "new projects",
    text: "Future photo and video projects will find a home here.",
  },
  {
    title: "artwork & prints",
    text: "A place to announce new pieces and print releases.",
  },
  {
    title: "upcoming events",
    text: "Exhibitions, gatherings, and other news will appear here.",
  },
];

const SOCIALS = ["instagram", "youtube", "tiktok", "pinterest"];

export default function Home() {
  /* The landing already rendered this page behind its dissolve, so replaying
     the entrance here would blank the artwork the visitor is looking at and
     fade it back in — which reads as the site reloading. */
  const location = useLocation();
  const settled =
    (location.state as { fromLanding?: boolean } | null)?.fromLanding === true;

  return (
    <main className={settled ? "home is-settled" : "home"}>
      <header className="home__welcome">
        <h1>welcome to my castle</h1>
      </header>

      <section className="home__section" aria-labelledby="home-about">
        <h2 id="home-about" className="home__heading">about me</h2>
        <p className="home__about">
          I make artwork and photographs that wander between the familiar and
          the imagined. Drawn figures, quiet places, and fragments of memory
          come together in a world that is always a little unfinished. This
          castle is a home for those experiments, and an invitation to look
          closer, get lost, and keep trying something new.
        </p>
      </section>

      <div className="home__showcases">
        {SHOWCASES.map(({ title, item }) => (
          <section
            className="home__section"
            aria-labelledby={`home-${title}`}
            key={title}
          >
            <h2 id={`home-${title}`} className="home__heading">{title}</h2>
            <ol className="home__tiles" aria-label={`${title} preview placeholders`}>
              {[1, 2, 3, 4].map((number) => (
                <li className="home__tile" key={number}>
                  <span>{item} 0{number}</span>
                  <span className="home__tileNote">coming soon</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <section className="home__section" aria-labelledby="home-news">
        <h2 id="home-news" className="home__heading">news</h2>
        <div className="home__news">
          <p className="home__previewNote">studio noticeboard / layout preview</p>
          <ul className="home__newsList">
            {NEWS.map(({ title, text }) => (
              <li key={title}>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="home__section" aria-labelledby="home-contact">
        <h2 id="home-contact" className="home__heading">contact</h2>
        <div className="home__contact">
          <img
            className="home__contactArtwork"
            src={contactArtwork}
            width={402}
            height={359}
            alt="Two illustrated figures sitting together in a drifting, painted world"
          />
          <ul className="home__socials">
            {SOCIALS.map((social) => (
              <li key={social}>
                <button
                  type="button"
                  className="home__social"
                  disabled
                  aria-label={`${social}: link coming soon`}
                  title="Link coming soon"
                >
                  <img src={socialMark} width={346} height={169} alt="" />
                  <span>{social}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <p className="home__previewNote home__contactNote">
          social links coming soon
        </p>
      </section>
    </main>
  );
}
