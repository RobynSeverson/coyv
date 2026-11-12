import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { api, type HomeNewsArticle } from "../lib/api";
import { RichText } from "../lib/richText";
import "./Home.css";

export default function News() {
  const { id } = useParams<{ id: string }>();
  const [news, setNews] = useState<HomeNewsArticle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    void api.getHomeNews(id).then(({ news: loaded }) => {
      if (active) {
        setNews(loaded);
        setError(null);
      }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Could not load this news entry");
    });
    return () => { active = false; };
  }, [id]);

  return (
    <main className="home">
      <PageHeader title="news" />
      {error || !id ? <p role="alert">{error ?? "No such news entry"}</p> : news?.id === id ? (
        <article className="home__article">
          <h2>
            <time dateTime={news.date}>
              {new Date(`${news.date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC" })}
            </time>
          </h2>
          <p>{news.preview}</p>
          <RichText value={news.body} images={news.images.map((image) => ({ url: image.url }))} />
        </article>
      ) : <p role="status">loading…</p>}
      <p><Link to="/home">back to home</Link></p>
    </main>
  );
}
