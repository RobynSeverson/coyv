import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ADMIN_PATH } from "../config";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/* Analytics only sees the first load of a single-page app: React Router
   changes the URL without a document load, so every page after the landing
   one would go uncounted. The gtag snippet in index.html is configured with
   send_page_view: false and this sends the page_view instead, once per
   route including the first.

   In development each one fires twice: StrictMode deliberately double-invokes
   effects to surface unsafe ones. Production builds fire once (verified
   against a preview of the real bundle), so there is no dedup guard here. */
export default function useRouteAnalytics() {
  const location = useLocation();

  useEffect(() => {
    /* The admin panel is private, and its traffic is ours rather than a
       visitor's, so it stays out of the numbers entirely. */
    if (location.pathname.startsWith(ADMIN_PATH)) return;

    /* gtag.js is loaded async, so on a cold start the first navigation can
       land before the script defines window.gtag. The inline snippet defines
       the queue-backed stub synchronously, but guard anyway rather than
       throw inside an effect. */
    window.gtag?.("event", "page_view", {
      page_path: `${location.pathname}${location.search}`,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [location.pathname, location.search]);
}
