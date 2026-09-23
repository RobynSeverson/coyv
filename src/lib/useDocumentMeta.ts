import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ADMIN_PATH } from "../config";

const SITE = "coyv";
const ORIGIN = "https://coyvcastle.com";

const SITE_TITLE = `${SITE} — art, prints & a print of the month`;
const SITE_DESCRIPTION =
  "coyv's castle: original artwork, limited prints, and a print-of-the-month subscription. Step past the threshold and wander the vault and the memories.";

type PageMeta = {
  readonly title: string;
  readonly description: string;
};

/* Longest paths first so /subscribe/print-of-the-month is not claimed by a
   shorter prefix that happens to match. */
const PAGES: ReadonlyArray<readonly [string, PageMeta]> = [
  [
    "/manage-subscription",
    {
      title: `${SITE} | manage subscription`,
      description: SITE_DESCRIPTION,
    },
  ],
  [
    "/memories",
    {
      title: `${SITE} | memories — scraps from the studio`,
      description:
        "Memories from coyv's studio: photographs, sketches and scraps of the work in progress behind the prints.",
    },
  ],
  [
    "/subscribe",
    {
      title: `${SITE} | subscribe`,
      description:
        "Subscribe to coyv's print of the month: a new limited print, posted to you, every month.",
    },
  ],
  ["/checkout", { title: `${SITE} | checkout`, description: SITE_DESCRIPTION }],
  [
    "/vault",
    {
      title: `${SITE} | vault — original art & limited prints`,
      description:
        "The vault: original artwork and limited prints by coyv, plus the print-of-the-month subscription.",
    },
  ],
  ["/order", { title: `${SITE} | order`, description: SITE_DESCRIPTION }],
  /* The landing and /home are the same document, so they share the site's own
     title rather than a page-specific one. */
  ["/home", { title: SITE_TITLE, description: SITE_DESCRIPTION }],
];

function matchForPath(pathname: string) {
  return PAGES.find(
    ([path]) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function metaForPath(pathname: string) {
  const match = matchForPath(pathname);
  return {
    ...(match?.[1] ?? { title: SITE_TITLE, description: SITE_DESCRIPTION }),
    /* Deep links such as /vault/some-print or /memories/memory_001 open the
       page they belong to with one item already selected, so they point at
       that page rather than offering Google a second URL for one document. */
    canonical: `${ORIGIN}${match?.[0] ?? "/"}`,
  };
}

function setMeta(selector: string, attribute: string, content: string) {
  const tag = document.head.querySelector(selector);
  if (tag) tag.setAttribute(attribute, content);
}

/* A single-page app never reloads, so the document keeps whatever title and
   description it started with unless something changes them. Beyond being
   wrong in the tab and in bookmarks, it left every analytics page_view
   reporting the same title, and left every crawled route — Google renders the
   app before indexing it — sharing the landing page's snippet. */
export default function useDocumentMeta() {
  const location = useLocation();

  useEffect(() => {
    /* The admin panel sets and restores its own title. */
    if (location.pathname.startsWith(ADMIN_PATH)) return;

    const { title, description, canonical } = metaForPath(location.pathname);

    document.title = title;
    setMeta('meta[name="description"]', "content", description);
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[property="og:url"]', "content", canonical);
    setMeta('meta[name="twitter:title"]', "content", title);
    setMeta('meta[name="twitter:description"]', "content", description);
    setMeta('link[rel="canonical"]', "href", canonical);
  }, [location.pathname]);
}
