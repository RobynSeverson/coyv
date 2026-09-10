import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ADMIN_PATH } from "../config";

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

/* Tag Manager only sees the first load of a single-page app: React Router
   changes the URL without a document load, so every page after the landing
   one would go uncounted. This pushes a page_view for each navigation,
   including the first.
   
   Because the first load is pushed here too, the GA4 tag in the container
   should fire on this custom event rather than on All Pages — pointing it at
   both would count the landing page twice.

   In development each page_view appears twice: StrictMode deliberately
   double-invokes effects to surface unsafe ones. Production builds fire
   once (verified against a preview of the real bundle), so there is no
   deduplication guard here. */
export default function useRouteAnalytics() {
  const location = useLocation();

  useEffect(() => {
    /* The admin panel is private, and its traffic is ours rather than a
       visitor's, so it stays out of the numbers entirely. */
    if (location.pathname.startsWith(ADMIN_PATH)) return;

    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({
      event: "page_view",
      page_path: `${location.pathname}${location.search}`,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [location.pathname, location.search]);
}
