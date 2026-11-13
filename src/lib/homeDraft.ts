import type { HomeContent, HomeImage, HomeNews, HomeShowcase, HomeContact } from "./api";
import { isRichContent } from "../../server/src/lib/richContent.ts";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function image(value: unknown): value is HomeImage {
  return record(value) && typeof value.id === "string" && /^[a-f\d]{24}$/i.test(value.id)
    && typeof value.url === "string" && typeof value.width === "number" && typeof value.height === "number";
}

function showcase(value: unknown): value is HomeShowcase {
  return record(value) && image(value.image) && typeof value.title === "string" && typeof value.url === "string";
}

function news(value: unknown): value is HomeNews {
  return record(value) && typeof value.id === "string" && typeof value.date === "string"
    && typeof value.preview === "string" && isRichContent(value.body)
    && (value.previewImage === null || image(value.previewImage))
    && Array.isArray(value.images) && value.images.every(image);
}

function contact(value: unknown): value is HomeContact {
  return record(value) && typeof value.id === "string" && typeof value.title === "string" && typeof value.url === "string";
}

function content(value: unknown): value is HomeContent {
  return record(value) && typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision >= 0
    && isRichContent(value.aboutMe)
    && Array.isArray(value.projects) && value.projects.length <= 4 && value.projects.every(showcase)
    && Array.isArray(value.artwork) && value.artwork.length <= 4 && value.artwork.every(showcase)
    && Array.isArray(value.news) && value.news.every(news)
    && Array.isArray(value.contacts) && value.contacts.every(contact);
}

export function readHomeDraft(serialized: string): HomeContent {
  const value: unknown = JSON.parse(serialized);
  if (!record(value) || value.version !== 1 || !content(value.home)) {
    throw new Error("The browser's home recovery draft could not be read.");
  }
  return value.home;
}

export function writeHomeDraft(home: HomeContent): string {
  return JSON.stringify({ version: 1, home });
}

export function homeImageIds(home: HomeContent): string[] {
  return [...new Set([
    ...home.projects.map((item) => item.image.id),
    ...home.artwork.map((item) => item.image.id),
    ...home.news.flatMap((item) => [
      ...(item.previewImage ? [item.previewImage.id] : []), ...item.images.map((entry) => entry.id),
    ]),
  ])];
}

export function refreshHomeImages(home: HomeContent, images: HomeImage[]): HomeContent {
  const byId = new Map(images.map((entry) => [entry.id, entry]));
  const resolve = (entry: HomeImage) => {
    const refreshed = byId.get(entry.id);
    if (!refreshed) throw new Error("A recovered upload is no longer available. Your draft has been kept.");
    return refreshed;
  };
  return {
    ...home,
    projects: home.projects.map((entry) => ({ ...entry, image: resolve(entry.image) })),
    artwork: home.artwork.map((entry) => ({ ...entry, image: resolve(entry.image) })),
    news: home.news.map((entry) => ({
      ...entry, previewImage: entry.previewImage ? resolve(entry.previewImage) : null,
      images: entry.images.map(resolve),
    })),
  };
}
