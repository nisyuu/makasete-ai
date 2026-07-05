// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { resolveServerUrl } from "./serverUrl";

function createScript(attrs: {
  src?: string;
  serverUrl?: string;
}): HTMLScriptElement {
  const script = document.createElement("script");
  if (attrs.src !== undefined) {
    script.setAttribute("src", attrs.src);
  }
  if (attrs.serverUrl !== undefined) {
    script.setAttribute("data-server-url", attrs.serverUrl);
  }
  return script;
}

describe("resolveServerUrl", () => {
  const fallbackOrigin = "http://fallback.example";

  it("should use the data-server-url attribute when present", () => {
    const script = createScript({
      src: "https://cdn.example/public/widget.js",
      serverUrl: "https://api.example.com",
    });
    expect(resolveServerUrl({ currentScript: script, fallbackOrigin })).toBe(
      "https://api.example.com",
    );
  });

  it("should normalize data-server-url with trailing slash or path to its origin", () => {
    const withSlash = createScript({ serverUrl: "https://api.example.com/" });
    expect(
      resolveServerUrl({ currentScript: withSlash, fallbackOrigin }),
    ).toBe("https://api.example.com");

    const withPath = createScript({
      serverUrl: "https://api.example.com/some/path",
    });
    expect(resolveServerUrl({ currentScript: withPath, fallbackOrigin })).toBe(
      "https://api.example.com",
    );
  });

  it("should fall through to the script src when data-server-url is invalid", () => {
    const script = createScript({
      src: "https://my-service.a.run.app/public/widget.js",
      serverUrl: "not a url",
    });
    expect(resolveServerUrl({ currentScript: script, fallbackOrigin })).toBe(
      "https://my-service.a.run.app",
    );
  });

  it("should derive the origin from the current script src", () => {
    const script = createScript({
      src: "https://my-service.a.run.app/public/widget.js",
    });
    expect(resolveServerUrl({ currentScript: script, fallbackOrigin })).toBe(
      "https://my-service.a.run.app",
    );
  });

  it("should resolve a relative src against the page origin", () => {
    // demo.html は `/public/widget.js` を相対パスで読み込む。
    // .src プロパティはブラウザによってページ origin で絶対化される。
    const script = createScript({ src: "/public/widget.js" });
    expect(resolveServerUrl({ currentScript: script, fallbackOrigin })).toBe(
      window.location.origin,
    );
  });

  it("should scan for a widget.js script when currentScript is unavailable", () => {
    const other = createScript({ src: "https://cdn.example/analytics.js" });
    const widget = createScript({
      src: "https://backend.example/public/widget.js",
    });
    expect(
      resolveServerUrl({
        currentScript: null,
        scripts: [other, widget],
        fallbackOrigin,
      }),
    ).toBe("https://backend.example");
  });

  it("should pick the last matching script when multiple widget.js tags exist", () => {
    const first = createScript({ src: "https://old.example/widget.js" });
    const second = createScript({ src: "https://new.example/widget.js" });
    expect(
      resolveServerUrl({
        currentScript: null,
        scripts: [first, second],
        fallbackOrigin,
      }),
    ).toBe("https://new.example");
  });

  it("should return the fallback origin when nothing matches", () => {
    const other = createScript({ src: "https://cdn.example/analytics.js" });
    expect(
      resolveServerUrl({
        currentScript: null,
        scripts: [other],
        fallbackOrigin,
      }),
    ).toBe(fallbackOrigin);
    expect(
      resolveServerUrl({ currentScript: null, scripts: [], fallbackOrigin }),
    ).toBe(fallbackOrigin);
  });

  it("should default to window.location.origin as the last resort", () => {
    expect(resolveServerUrl({ currentScript: null, scripts: [] })).toBe(
      window.location.origin,
    );
  });

  it("should fall back when the current script is inline (no src, no attribute)", () => {
    const inline = document.createElement("script");
    expect(
      resolveServerUrl({ currentScript: inline, scripts: [], fallbackOrigin }),
    ).toBe(fallbackOrigin);
  });

  it("should honor data-server-url on an inline current script", () => {
    const inline = createScript({ serverUrl: "https://api.example.com" });
    expect(resolveServerUrl({ currentScript: inline, fallbackOrigin })).toBe(
      "https://api.example.com",
    );
  });

  it("should ignore a non-script element passed as currentScript", () => {
    const div = document.createElement("div");
    const widget = createScript({
      src: "https://backend.example/public/widget.js",
    });
    expect(
      resolveServerUrl({
        currentScript: div,
        scripts: [widget],
        fallbackOrigin,
      }),
    ).toBe("https://backend.example");
  });
});
