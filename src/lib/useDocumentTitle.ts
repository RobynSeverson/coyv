import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ADMIN_PATH } from "../config";

const SITE = "coyv";

/* Longest paths first so /subscribe/print-of-the-month is not claimed by a
   shorter prefix that happens to match. */
const TITLES: ReadonlyArray<readonly [string, string]> = [
  ["/manage-subscription", "manage subscription"],
  ["/memories", "memories"],
  ["/subscribe", "subscribe"],
  ["/checkout", "checkout"],
  ["/vault", "vault"],
  ["/order", "order"],
  ["/home", "home"],
];

export function titleForPath(pathname: string) {
  const match = TITLES.find(
    ([path]) => pathname === path || pathname.startsWith(`${path}/`),
  );
  /* The landing page is the bare threshold, so it keeps the plain name. */
  return match ? `${SITE} | ${match[1]}` : SITE;
}

/* A single-page app never reloads, so the document keeps whatever title it
   started with unless something changes it. Beyond being wrong in the tab and
   in bookmarks, it left every analytics page_view reporting the same title. */
export default function useDocumentTitle() {
  const location = useLocation();

  useEffect(() => {
    /* The admin panel sets and restores its own title. */
    if (location.pathname.startsWith(ADMIN_PATH)) return;

    document.title = titleForPath(location.pathname);
  }, [location.pathname]);
}
