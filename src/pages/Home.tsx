import PageHeader from "../components/PageHeader";
import blurbMobile from "../assets/homeBlurbMobile.webp";
import blurbMobile2x from "../assets/homeBlurbMobile@2x.webp";
import blurbDesktop from "../assets/homeBlurbDesktop.webp";
import blurbDesktop2x from "../assets/homeBlurbDesktop@2x.webp";
import "./Home.css";

/* The artwork is the writing, so the words have to reach screen readers and
   search engines some other way. This is a transcription, not a description. */
const BLURB_TEXT = [
  "welcome to my castle. i've opened the gates.",
  "i'm not perfect, but i want to try. try. try. try.",
  "if we all stop trying, what are we?",
  "humans, maybe, are tied to trying. to experimenting. to making something",
  "even when we don't know what it will become.",
  "even when you know it's futile, you still try.",
  "we live in an evil, corrupt, strange world.",
  "but if we stop trying, what's left?",
  "so — come inside. let's try something.",
].join(" ");

export default function Home() {
  return (
    <main className="home">
      <PageHeader title="coyv" />

      <picture>
        <source
          media="(min-width: 769px)"
          type="image/webp"
          srcSet={`${blurbDesktop} 1x, ${blurbDesktop2x} 2x`}
          width={1100}
          height={642}
        />
        <img
          className="home__blurb"
          src={blurbMobile}
          srcSet={`${blurbMobile} 1x, ${blurbMobile2x} 2x`}
          /* intrinsic size of the default source keeps the page from
             reflowing while the artwork loads */
          width={700}
          height={1013}
          alt={BLURB_TEXT}
          /* this is the page's main content, so it should never be deferred */
          fetchPriority="high"
        />
      </picture>
    </main>
  );
}
