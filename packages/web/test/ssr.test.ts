// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("SSR safety", () => {
  it("imports and initialises without a DOM", async () => {
    expect(typeof document).toBe("undefined");
    const mod = await import("../src/index.js");
    expect(typeof mod.init).toBe("function");
    expect(mod.defineElement()).toBe("mlp-feedback");
    const w = mod.init({ key: "mlp_pk_x.y" });
    expect(w.element).toBeNull();
    w.open();
    w.setContext({ a: 1 });
    w.attach(".x");
    expect(w.controller.getState().status).toBe("open");
    w.destroy();
  });

  it("the controller submits without a DOM (no page context)", async () => {
    const { createFeedback } = await import("../src/index.js");
    const { KEY, mockFetch } = await import("./helpers.js");
    const m = mockFetch({});
    const c = createFeedback({ key: KEY, fetch: m.fetch });
    c.open();
    c.setField("text", "from a worker");
    await c.submit();
    expect(c.getState().status).toBe("done");
    expect(m.calls[0]!.body.report.page).toBeUndefined();
  });
});
