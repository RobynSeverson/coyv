import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HomeContent } from "../src/lib/api";
import { homeImageIds, readHomeDraft, refreshHomeImages, writeHomeDraft } from "../src/lib/homeDraft.ts";

const image = { id: "000000000000000000000001", url: "https://expired.example/image", width: 900, height: 600 };
const draft: HomeContent = {
  revision: 3, aboutMe: "Unsaved about me\nwith a second line",
  projects: [{ image, title: "Work", url: "" }], artwork: [],
  news: [{
    id: "unpublished-news", date: "2026-11-12", preview: "Draft preview", previewImage: image,
    body: "**Unpublished text**\n\n[[image:1]]", images: [image],
  }],
  contacts: [{ id: "contact", title: "Social", url: "https://example.com" }],
};

describe("home recovery drafts", () => {
  it("preserves unsaved text, upload references and the original revision across reloads", () => {
    assert.deepEqual(readHomeDraft(writeHomeDraft(draft)), draft);
    assert.deepEqual(homeImageIds(draft), [image.id]);
  });

  it("rejects malformed or incompatible storage instead of silently losing content", () => {
    for (const stored of ["not json", "null", '{"version":2}', JSON.stringify({ version: 1, home: { ...draft, news: [{}] } })]) {
      assert.throws(() => readHomeDraft(stored));
    }
  });

  it("refreshes expired URLs for unpublished uploads without changing edits or hiding missing images", () => {
    const refreshedImage = { ...image, url: "https://fresh.example/image" };
    const refreshed = refreshHomeImages(draft, [refreshedImage]);
    assert.equal(refreshed.projects[0]?.image.url, refreshedImage.url);
    assert.equal(refreshed.news[0]?.previewImage?.url, refreshedImage.url);
    assert.equal(refreshed.news[0]?.images[0]?.url, refreshedImage.url);
    assert.equal(refreshed.news[0]?.body, draft.news[0]?.body);
    assert.equal(refreshed.revision, draft.revision);
    assert.throws(() => refreshHomeImages(draft, []), /draft has been kept/);
  });

  it("recovers crop offsets and unpublished custom contact icons alongside legacy drafts", () => {
    const customized: HomeContent = {
      ...draft,
      projects: [{ ...draft.projects[0]!, cropX: 15, cropY: 90 }],
      contacts: [{ ...draft.contacts[0]!, icon: { ...image, id: "000000000000000000000002" } }],
    };
    assert.deepEqual(readHomeDraft(writeHomeDraft(customized)), customized);
    assert.deepEqual(homeImageIds(customized), [image.id, "000000000000000000000002"]);
    const refreshed = refreshHomeImages(customized, [
      { ...image, url: "https://fresh.example/image" },
      { ...image, id: "000000000000000000000002", url: "https://fresh.example/icon" },
    ]);
    assert.equal(refreshed.projects[0]?.cropY, 90);
    assert.equal(refreshed.contacts[0]?.icon?.url, "https://fresh.example/icon");
    assert.throws(() => readHomeDraft(writeHomeDraft({
      ...customized, projects: [{ ...customized.projects[0]!, cropX: 101 }],
    })));
  });
});
