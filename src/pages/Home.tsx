import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import contactArtwork from "../assets/homeContact.webp";
import socialMark from "../assets/homeSocial.webp";
import { api, type HomePageContent } from "../lib/api";
import "./Home.css";

/* Keep the content revealed on the landing while the router mounts /home. */
let cachedHome: HomePageContent | null = null;

export default function Home() {
  /* The landing already rendered this page behind its dissolve, so replaying
     the entrance here would blank the artwork the visitor is looking at and
     fade it back in — which reads as the site reloading. */
  const location = useLocation();
  const settled =
    (location.state as { fromLanding?: boolean } | null)?.fromLanding === true;
  const [home, setHome] = useState(cachedHome);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void api.getHome().then(({ home: loaded }) => {
      cachedHome = loaded;
      if (active) {
        setHome(loaded);
        setError(null);
      }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Could not load home");
    });
    return () => { active = false; };
  }, [attempt]);

  return (
    <main className={settled ? "home is-settled" : "home"}>
      <PageHeader title="coyv" />

      <header className="home__welcome">
        <p>welcome to my castle</p>
      </header>

      {error ? (
        <p className="home__empty" role="alert">
          {error}{" "}
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>retry</button>
        </p>
      ) : null}
      {!home ? (
        <p className="home__empty" role="status">{error ? "Home is unavailable right now." : "loading…"}</p>
      ) : (
      <>
      <section className="home__section" aria-labelledby="home-about">
        <h2 id="home-about" className="home__heading">about me</h2>
        <p className="home__about">{home.aboutMe}</p>
      </section>

      <div className="home__showcases">
        {(["projects", "artwork"] as const).map((title) => (
          <section
            className="home__section"
            aria-labelledby={`home-${title}`}
            key={title}
          >
            <h2 id={`home-${title}`} className="home__heading">{title}</h2>
            <ol className="home__tiles" aria-label={title}>
              {home[title].map(({ image, title: caption, url }, index) => (
                <li className="home__tile" key={`${image.id}-${index}`}>
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <img src={image.url} alt={caption || `${title} ${index + 1}`}
                        width={image.width} height={image.height} />
                    </a>
                  ) : (
                    <img src={image.url} alt={caption || `${title} ${index + 1}`}
                      width={image.width} height={image.height} />
                  )}
                </li>
              ))}
            </ol>
            {home[title].length === 0 ? <p className="home__empty">new work on the way</p> : null}
          </section>
        ))}
      </div>

      <section className="home__section" aria-labelledby="home-news">
        <h2 id="home-news" className="home__heading">news</h2>
        <div className="home__news">
          <ul className="home__newsList">
            {home.news.map(({ id, date, preview, previewImage }) => (
              <li key={id}>
                <a className="home__newsLink" href={`/news/${id}`} target="_blank" rel="noopener noreferrer">
                  <time dateTime={date}>
                    {new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC" })}
                  </time>
                  <div className="home__newsPreview">
                    {previewImage ? <img src={previewImage.url} alt="" width={previewImage.width}
                      height={previewImage.height} loading="lazy" /> : null}
                    <p>{preview}</p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
          {home.news.length === 0 ? <p className="home__empty">no news just yet</p> : null}
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
            {home.contacts.map(({ id, title, url }) => (
              <li key={id}>
                <a
                  className="home__social"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img src={socialMark} width={346} height={169} alt="" />
                  <span>{title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
      </>
      )}
    </main>
  );
}
