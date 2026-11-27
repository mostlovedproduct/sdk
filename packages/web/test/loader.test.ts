import { afterEach, describe, expect, it, vi } from "vitest";
import { configFromScript, installLoader, type MlpFunction } from "../src/loader.js";
import { getWidget } from "../src/widget.js";
import { KEY, mockFetch } from "./helpers.js";

type Win = Window & { mlp?: MlpFunction };
const win = window as Win;

function stub() {
  // The documented snippet.
  win.mlp = function (...a: unknown[]) {
    (win.mlp!.q = win.mlp!.q || []).push(a);
  } as MlpFunction;
}

function script(attrs: Record<string, string>) {
  const s = document.createElement("script");
  s.type = "text/plain"; // keep happy-dom from fetching it
  s.setAttribute("src", "https://cdn.example/mlp.js");
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.append(s);
  return s;
}

afterEach(() => {
  getWidget()?.destroy();
  delete win.mlp;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("script-tag loader", () => {
  it("replays the queue: init first, then commands in order", async () => {
    const m = mockFetch({});
    stub();
    win.mlp!("setContext", { cart: 3 });
    win.mlp!("identify", { id: "u_9", tier: "pro" });
    win.mlp!("init", { key: KEY, endpoint: "https://in.test", fetch: m.fetch });
    win.mlp!("setFlags", { checkout: "b" });
    win.mlp!("open", { kind: "idea" });
    installLoader(win);
    const w = getWidget()!;
    expect(w).toBeDefined();
    expect(w.controller.getState()).toMatchObject({ status: "open", draft: { kind: "idea" } });
    w.controller.setField("text", "x");
    await w.controller.submit();
    expect(m.calls[0]!.body.report).toMatchObject({
      context: { cart: 3 },
      user: { id: "u_9", tier: "pro" },
      flags: { checkout: "b" },
    });
  });

  it("works after load, and buffers commands until init", () => {
    installLoader(win);
    expect(win.mlp!.loaded).toBe(true);
    win.mlp!("setApp", { version: "2.0.0" });
    const ready = vi.fn();
    win.mlp!("ready", ready);
    expect(getWidget()).toBeUndefined();
    const w = win.mlp!("init", { key: KEY }) as ReturnType<typeof getWidget>;
    expect(w).toBe(getWidget());
    expect(ready).toHaveBeenCalledWith(w);
    win.mlp!("open");
    expect(w!.controller.getState().status).toBe("open");
    win.mlp!("close");
    expect(w!.controller.getState().status).toBe("idle");
  });

  it("auto-inits from data-* attributes with zero JS", () => {
    const s = script({ "data-key": KEY, "data-position": "bottom-left", "data-kinds": "broken, idea", "data-badge": "false", "data-app-version": "3.1.0", "data-privacy-url": "https://example.com/privacy" });
    expect(configFromScript(s)).toMatchObject({
      key: KEY,
      trigger: { position: "bottom-left" },
      kinds: ["broken", "idea"],
      badge: false,
      legal: { privacyUrl: "https://example.com/privacy" },
      app: { version: "3.1.0" },
    });
    installLoader(win);
    const w = getWidget()!;
    expect(w.config.key).toBe(KEY);
    expect(document.querySelector("mlp-feedback")).not.toBeNull();
  });

  it("data attributes are defaults under an explicit init", () => {
    script({ "data-key": KEY, "data-trigger": "false" });
    stub();
    win.mlp!("init", { strings: { title: "Hi" } });
    installLoader(win);
    const w = getWidget()!;
    expect(w.config).toMatchObject({ key: KEY, trigger: false, strings: { title: "Hi" } });
  });

  it("unknown commands and throwing callbacks never throw", () => {
    installLoader(win);
    win.mlp!("init", { key: KEY });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => win.mlp!("doesNotExist")).not.toThrow();
    expect(() =>
      win.mlp!("ready", () => {
        throw new Error("x");
      }),
    ).not.toThrow();
    warn.mockRestore();
  });

  it("loading twice keeps the first instance", () => {
    installLoader(win);
    const first = win.mlp;
    installLoader(win);
    expect(win.mlp).toBe(first);
  });

  it("destroy then init again", () => {
    installLoader(win);
    win.mlp!("init", { key: KEY });
    win.mlp!("destroy");
    expect(document.querySelector("mlp-feedback")).toBeNull();
    win.mlp!("init", { key: KEY });
    expect(document.querySelector("mlp-feedback")).not.toBeNull();
  });
});
