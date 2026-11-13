import assert from "node:assert/strict";
import { it } from "node:test";
import { contactDestination } from "../server/src/lib/homeContact.ts";

it("normalizes email and dialer contacts without permitting extra URI actions", () => {
  assert.equal(contactDestination("email", " hello@example.com "), "mailto:hello@example.com");
  assert.equal(contactDestination("email", "mailto:hello@example.com"), "mailto:hello@example.com");
  assert.equal(contactDestination("phone", "tel:+1 (212) 555-1234"), "tel:+12125551234");
  for (const value of ["hello@example.com?bcc=other@example.com", "hello@example.com%0A", "not-an-email"]) {
    assert.equal(contactDestination("email", value), null);
  }
  for (const value of ["+12125551234;123", "tel:*123#", "javascript:alert(1)"]) {
    assert.equal(contactDestination("phone", value), null);
  }
});

it("accepts Spotify profiles/playlists and preserves existing http(s) contacts", () => {
  for (const path of ["user/listener", "playlist/1234?si=shared", "artist/1234", "intl-en/playlist/1234"]) {
    const url = `https://open.spotify.com/${path}`;
    assert.equal(contactDestination("spotify", url), url);
  }
  for (const url of ["https://open.spotify.com.evil.example/playlist/123", "https://example.com", "spotify:playlist:123"]) {
    assert.equal(contactDestination("spotify", url), null);
  }
  assert.equal(contactDestination("other", "https://example.com/page"), "https://example.com/page");
  assert.equal(contactDestination("other", "http://example.com"), "http://example.com");
  assert.equal(contactDestination("other", "javascript:alert(1)"), null);
  assert.equal(contactDestination("other", "mailto:hello@example.com"), null);
});
