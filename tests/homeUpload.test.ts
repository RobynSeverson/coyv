import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { prepareHomeImage } from "../src/lib/homeUpload.ts";

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");

afterEach(() => {
  for (const [name, descriptor] of [["document", originalDocument], ["createImageBitmap", originalBitmap]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function browser(encoding: "image/png" | "image/webp", bytesPerPixel: number) {
  let closed = false;
  const attempts: { width: number; height: number; quality: number }[] = [];
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: async () => ({
    width: 8000, height: 6000, close() { closed = true; },
  }) });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement() {
      return {
        width: 0, height: 0,
        getContext: () => ({ drawImage() {} }),
        toBlob(callback: (blob: Blob) => void, _type: string, quality: number) {
          attempts.push({ width: this.width, height: this.height, quality });
          callback(new Blob([new Uint8Array(Math.ceil(this.width * this.height * bytesPerPixel))], { type: encoding }));
        },
      };
    },
  } });
  return { attempts, closed: () => closed };
}

describe("automatic home image preparation", () => {
  it("keeps shrinking PNG fallback dimensions when the browser cannot encode WebP", async () => {
    const stub = browser("image/png", 4);
    const file = new File(["camera source"], "camera.png", { type: "image/png" });
    const result = await prepareHomeImage(file, new AbortController().signal);
    assert.ok(result.size <= 3 * 1024 * 1024);
    assert.equal(result.type, "image/png");
    assert.equal(result.name, "home-image.png");
    assert.ok(stub.attempts.length > 1);
    assert.ok(stub.attempts[1]!.width < stub.attempts[0]!.width);
    assert.equal(stub.closed(), true);
  });

  it("reduces dimensions after exhausting quality attempts instead of returning the old size error", async () => {
    const stub = browser("image/webp", 4);
    const file = new File(["source"], "camera.jpg", { type: "image/jpeg" });
    const result = await prepareHomeImage(file, new AbortController().signal);
    assert.ok(result.size <= 3 * 1024 * 1024);
    assert.equal(result.type, "image/webp");
    assert.ok(stub.attempts.length > 3);
    assert.equal(stub.attempts[0]!.width, stub.attempts[2]!.width);
    assert.ok(stub.attempts[3]!.width < stub.attempts[2]!.width);
  });

  it("still respects cancellation and rejects unsupported formats explicitly", async () => {
    browser("image/png", 4);
    const controller = new AbortController();
    controller.abort(new DOMException("Cancelled", "AbortError"));
    await assert.rejects(prepareHomeImage(new File(["x"], "test.png", { type: "image/png" }), controller.signal), /Cancelled/);
    await assert.rejects(prepareHomeImage(new File(["x"], "test.txt", { type: "text/plain" }), new AbortController().signal), /Choose a JPEG/);
  });
});
