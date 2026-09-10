import { useEffect, useMemo, useState } from "react";
import { api, type Memory } from "../lib/api";
import Collection, { type Artwork } from "./Collection";

/* The memories used to be bundled with the app. They now live in S3 and are
   fetched as short-lived signed URLs, so this wrapper exists only to load them
   and hand Collection the shape it already understood. */
export default function Memories() {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    api
      .listMemories(controller.signal)
      .then(({ memories: loaded }) => setMemories(loaded))
      .catch((error: unknown) => {
        /* An abort is this component unmounting, not a failure to show. */
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });

    return () => controller.abort();
  }, []);

  const images = useMemo<Artwork[] | undefined>(
    () =>
      memories?.map((memory) => ({
        preview: memory.previewUrl,
        full: memory.url,
        download: memory.downloadUrl,
        downloadName: memory.downloadName,
      })),
    [memories],
  );

  /* Collection already draws placeholder crops when it has no images, which
     doubles as the loading and empty state. */
  return (
    <Collection
      title="memories"
      notice={failed ? "these are lost for a moment" : null}
      images={images?.length ? images : undefined}
    />
  );
}
