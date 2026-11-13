const MAX_BYTES = 3 * 1024 * 1024;
const MAX_SIDE = 1600;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

/* Lambda's buffered request limit also includes base64 and multipart overhead.
   Home only displays 900px previews, so send a bounded display copy, not a
   full-resolution camera original. Product/print uploads are not changed. */
export async function prepareHomeImage(file: File, signal: AbortSignal): Promise<File> {
  if (!TYPES.has(file.type)) throw new Error("Choose a JPEG, PNG, WebP or AVIF image.");
  signal.throwIfAborted();
  const task = (async () => {
    const bitmap = await createImageBitmap(file);
    try {
      signal.throwIfAborted();
      if (Math.max(bitmap.width, bitmap.height) <= MAX_SIDE && file.size <= MAX_BYTES) return file;
      const scale = Math.min(1, MAX_SIDE / bitmap.width, MAX_SIDE / bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not prepare the image. Try a smaller image.");
      while (true) {
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.85, 0.65, 0.45]) {
          signal.throwIfAborted();
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
          signal.throwIfAborted();
          if (!blob) throw new Error("This browser could not encode the image. Try another image format.");
          if (blob.size <= MAX_BYTES) {
            const extension = blob.type === "image/webp" ? "webp" : "png";
            return new File([blob], `home-image.${extension}`, { type: blob.type });
          }
          /* Safari may return PNG when WebP encoding is unavailable. Quality
             has no effect on PNG, so reduce dimensions instead of retrying it. */
          if (blob.type !== "image/webp") break;
        }
        if (canvas.width === 1 && canvas.height === 1) {
          throw new Error("This browser could not prepare a valid image upload.");
        }
        canvas.width = Math.max(1, Math.floor(canvas.width * 0.7));
        canvas.height = Math.max(1, Math.floor(canvas.height * 0.7));
      }
    } finally {
      bitmap.close();
    }
  })();
  let cancel: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try {
    return await Promise.race([task, aborted]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
