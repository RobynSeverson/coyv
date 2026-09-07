/* Every image in assets/memories is picked up automatically, so dropping a
   new file into the folder is all it takes to add it to the page.

   Two passes over the same folder: a small webp used for the grid, and the
   untouched original which is only fetched for the lightbox and downloads. */
const previews = import.meta.glob<string>(
  '../assets/memories/*.{jpg,jpeg,png,webp}',
  {
    eager: true,
    query: { w: 900, format: 'webp', quality: 72 },
    import: 'default',
  },
)

/* No query, so vite-imagetools leaves these alone (it only claims imports
   that carry one) and the file is served exactly as it was uploaded. */
const originals = import.meta.glob<string>(
  '../assets/memories/*.{jpg,jpeg,png,webp}',
  { eager: true, import: 'default' },
)

export type Artwork = {
  /* lightweight webp shown in the grid */
  preview: string
  /* original file, loaded only when opened or downloaded */
  full: string
  downloadName: string
}

export const MEMORIES: Artwork[] = Object.keys(originals)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((path, index) => {
    const extension = path.split('.').pop()?.toLowerCase() ?? 'jpg'
    return {
      preview: previews[path] ?? originals[path],
      full: originals[path],
      downloadName: `coyv-memory-${index + 1}.${extension}`,
    }
  })
