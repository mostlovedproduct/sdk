import { CAPTURE_STREAM_TYPE, captureFrame } from "@mostlovedproduct/core/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWidget, getWidget, init } from "../src/widget.js";
import strings from "../src/i18n/en-US.json";
import type { FeedbackConfig } from "../src/types.js";
import { KEY, followUp, mockFetch, tick, withFollowUp } from "./helpers.js";

function setup(extra: Partial<FeedbackConfig> = {}, ...replies: Parameters<typeof mockFetch>) {
  const m = mockFetch(...(replies.length ? replies : [{}]));
  const w = init({ key: KEY, endpoint: "https://in.test", fetch: m.fetch, ...extra });
  const root = w.element!.shadowRoot!;
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T | null;
  const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
  return { w, root, $, $$, ...m };
}

afterEach(() => {
  getWidget()?.destroy();
  document.body.innerHTML = "";
});

const type = (el: HTMLTextAreaElement | HTMLInputElement, v: string) => {
  el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const key = (el: Element, k: string, extra: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, composed: true, cancelable: true, ...extra }));

describe("default UI", () => {
  it("mounts a trigger and a labelled dialog in shadow DOM", () => {
    const { w, $, $$ } = setup();
    expect(document.querySelector("mlp-feedback")).toBe(w.element);
    const trigger = $("[part=trigger]")!;
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toBe("Feedback");
    const dialog = $("dialog")!;
    expect(dialog.getAttribute("aria-labelledby")).toBe("mlp-title");
    expect($("#mlp-title")!.textContent).toBe("Send feedback");
    // labelled controls
    expect($("label[for=mlp-text]")!.textContent).toBe("Your feedback");
    expect($("[part=close]")!.getAttribute("aria-label")).toBe("Close");
    expect($("[part=chips]")!.getAttribute("role")).toBe("group");
    expect($("[part=chips]")!.getAttribute("aria-label")).toBeTruthy();
    expect($$("[part=chip]").map((c) => c.textContent)).toEqual(["Broken", "Confusing", "Missing", "Idea", "Love it"]);
    expect($("[role=status]")!.getAttribute("aria-live")).toBe("polite");
    expect($("[part=badge]")!.textContent).toBe("Feedback by Most Loved Product");
  });

  it("opens from the trigger, focuses the textarea, Esc closes and returns focus", async () => {
    const { w, $ } = setup();
    const trigger = $<HTMLButtonElement>("[part=trigger]")!;
    trigger.focus();
    trigger.click();
    await tick();
    const dialog = $<HTMLDialogElement>("dialog")!;
    expect(dialog.open).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(w.element!.shadowRoot!.activeElement).toBe($("textarea"));
    key($("textarea")!, "Escape");
    await tick();
    expect(w.controller.getState().status).toBe("idle");
    expect(dialog.open).toBe(false);
    expect(w.element!.shadowRoot!.activeElement).toBe(trigger);
  });

  it("returns focus to a custom opener", async () => {
    const btn = document.createElement("button");
    btn.textContent = "Report a problem";
    document.body.append(btn);
    const { w } = setup({ trigger: false });
    w.attach(btn);
    btn.focus();
    btn.click();
    await tick();
    expect(w.controller.getState().status).toBe("open");
    w.close();
    expect(document.activeElement).toBe(btn);
  });

  it("leaves Tab navigation between the panel and the host page", async () => {
    const { w, $, root } = setup();
    w.open();
    await tick();
    const close = $<HTMLButtonElement>("[part=close]")!;
    const badge = $<HTMLAnchorElement>("[part=badge] a")!;
    expect($("dialog")!.hasAttribute("aria-modal")).toBe(false);
    badge.focus();
    expect(key(badge, "Tab")).toBe(true);
    expect(root.activeElement).toBe(badge);
    close.focus();
    expect(key(close, "Tab", { shiftKey: true })).toBe(true);
    expect(root.activeElement).toBe(close);
  });

  it("keeps focus on the page when a follow-up arrives and the widget closes", async () => {
    const opener = document.createElement("button");
    const output = document.createElement("pre");
    output.tabIndex = 0;
    document.body.append(opener, output);
    const { w } = setup({}, withFollowUp(followUp("impact")));
    opener.focus();
    w.open();
    await tick();
    w.controller.setField("text", "Export fails");
    const sent = w.controller.submit();
    output.focus();
    await sent;
    expect(w.controller.getState().status).toBe("follow_up");
    expect(document.activeElement).toBe(output);
    w.close();
    expect(document.activeElement).toBe(output);
  });

  it("full flow: chip, text, send, follow-up option, thanks", async () => {
    const { w, $, $$, calls } = setup({}, withFollowUp(followUp("impact")), {});
    w.open();
    await tick();
    const chip = $$("[part=chip]")[0]!;
    chip.click();
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    chip.click();
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    chip.click();
    type($("textarea") as HTMLTextAreaElement, "Upload fails. It shows a spinner forever.");
    $<HTMLFormElement>("[part=form]")!.requestSubmit();
    await tick(10);
    expect(calls[0]!.body.report).toMatchObject({
      kind: "broken",
      summary: "Upload fails.",
      details: "Upload fails. It shows a spinner forever.",
    });
    expect($("[part=form]")!.hidden).toBe(true);
    expect($("[part=follow-up]")!.hidden).toBe(false);
    expect($("[part=saved]")!.textContent).toContain("Saved");
    expect($("[part=question]")!.textContent).toBe("Q:impact");
    const options = $$("[part=option]");
    expect(options.map((o) => o.textContent)).toEqual(["It stopped me", "Minor annoyance"]);
    expect($("[part=options]")!.getAttribute("aria-labelledby")).toBe("mlp-q");
    expect($("[part=skip]")!.hidden).toBe(false);
    await tick();
    expect(w.element!.shadowRoot!.activeElement).toBe(options[0]);
    options[1]!.click();
    await tick(10);
    expect(calls[1]!.body.answer).toMatchObject({ option_id: "friction" });
    expect($("[part=done]")!.hidden).toBe(false);
    expect(w.element!.shadowRoot!.activeElement).toBe($("button[part~=done]"));
  });

  it("text follow-up and skip", async () => {
    const { w, $, calls } = setup({ followUps: 2 }, withFollowUp(followUp("task", "text")), withFollowUp(followUp("expected", "text")), {});
    w.open();
    await tick();
    type($("textarea") as HTMLTextAreaElement, "confusing settings");
    $<HTMLFormElement>("[part=form]")!.requestSubmit();
    await tick(10);
    const answer = $<HTMLInputElement>("[part=answer]")!;
    expect(answer.getAttribute("aria-labelledby")).toBe("mlp-q");
    expect($("[part=options]")!.hidden).toBe(true);
    answer.value = "Change my plan";
    answer.form!.requestSubmit();
    await tick(10);
    expect(calls[1]!.body.answer).toMatchObject({ follow_up_id: "task", text: "Change my plan" });
    expect($("[part=question]")!.textContent).toBe("Q:expected");
    $("[part=skip]")!.click();
    await tick(10);
    expect(calls[2]!.body.answer).toMatchObject({ skipped: true });
    expect($("[part=done]")!.hidden).toBe(false);
  });

  it("keeps the saved panel in place while progressively revealing a generated question", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let reportId!: string;
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      reportId = JSON.parse(String(init?.body)).id;
      const body = new ReadableStream<Uint8Array>({ start: (controller) => { stream = controller; } });
      return new Response(body, { status: 202, headers: { "Content-Type": CAPTURE_STREAM_TYPE } });
    };
    let reveal: FrameRequestCallback | undefined;
    const frame = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      reveal = callback;
      return 1;
    });
    try {
      const { w, $ } = setup({ fetch });
      w.open();
      w.controller.setField("text", "Export fails");
      const sent = w.controller.submit();
      await vi.waitFor(() => expect(stream).toBeDefined());
      stream.enqueue(captureFrame("captured", { report_id: reportId, status: "captured", duplicate: false, message: "Saved" }));
      await vi.waitFor(() => expect(w.controller.getState().status).toBe("accepted"));
      const saved = $("[part=saved]")!;
      const body = $("[part=result-body]")!;
      const pending = $("[part=follow-up-pending]")!;
      const preparing = $("[part=follow-up-pending] span:last-child")!;
      expect($("[part=result]")!.hidden).toBe(false);
      expect(pending.hidden).toBe(false);
      expect(pending.querySelector('.spinner[aria-hidden="true"]')).toBeTruthy();
      expect(preparing.hidden).toBe(true);
      expect($("[part=done]")!.hidden).toBe(true);

      stream.enqueue(captureFrame("follow_up_pending", {}));
      await vi.waitFor(() => expect(preparing.hidden).toBe(false));
      expect(preparing.textContent).toBe(strings.preparingFollowUp);
      expect($("[part=saved]")).toBe(saved);
      expect($("[part=result-body]")).toBe(body);

      const question = "What appears after you click Export?";
      stream.enqueue(captureFrame("follow_up", { ...followUp("open", "text"), question }));
      stream.close();
      await sent;
      expect($("[part=saved]")).toBe(saved);
      expect($("[part=result-body]")).toBe(body);
      expect(pending.hidden).toBe(true);
      expect($("#mlp-q")!.textContent).toBe(question);
      expect($("[part=question]")!.textContent).toBe(question);
      const first = $("[part=question-text]")!.textContent!;
      expect(first.length).toBeGreaterThan(0);
      expect(first.length).toBeLessThan(question.length);
      reveal!(performance.now() + 200);
      expect($("[part=question-text]")!.textContent).toBe(question);
    } finally {
      frame.mockRestore();
    }
  });

  it("error keeps the text, shows an alert, and the button becomes Try again", async () => {
    const { w, $ } = setup({}, { status: 503 });
    w.open();
    await tick();
    type($("textarea") as HTMLTextAreaElement, "my words");
    $<HTMLFormElement>("[part=form]")!.requestSubmit();
    await tick(10);
    expect(($("textarea") as HTMLTextAreaElement).value).toBe("my words");
    expect($("[part=error]")!.getAttribute("role")).toBe("alert");
    expect($("[part=error]")!.textContent).toMatch(/still here/);
    expect($("[part=submit]")!.textContent).toBe("Try again");
  });

  it("empty submit marks the textarea invalid", async () => {
    const { w, $ } = setup();
    w.open();
    await tick();
    $<HTMLFormElement>("[part=form]")!.requestSubmit();
    await tick();
    expect($("textarea")!.getAttribute("aria-invalid")).toBe("true");
    expect($("#mlp-err")!.textContent).toBe("Write a few words first.");
  });

  it("legal: notice by default, links only for http(s) URLs, false hides it", () => {
    const a = setup();
    expect(a.$("[part=notice]")!.textContent).toBe("Some account and page details may be sent with your feedback to help fix problems.");
    expect(a.$("[part=notice] a")).toBeNull();
    expect(a.$("[part=submit]")!.getAttribute("aria-describedby")).toBe("mlp-notice");
    a.w.destroy();

    const b = setup({ legal: { privacyUrl: "/privacy", termsUrl: "javascript:alert(1)" }, strings: { privacy: "Privacy" } });
    const links = [...b.root.querySelectorAll<HTMLAnchorElement>("[part=notice] a")];
    expect(links.map((l) => l.textContent)).toEqual(["Privacy"]);
    expect(links[0]!.href).toBe(new URL("/privacy", document.baseURI).href);
    expect(links[0]!.target).toBe("_blank");
    b.w.destroy();

    const c = setup({ legal: false });
    expect(c.$("[part=notice]")).toBeNull();
    expect(c.$("[part=submit]")!.hasAttribute("aria-describedby")).toBe(false);
  });

  it("options: kinds subset, no chips, no badge, no trigger, strings", () => {
    const a = setup({ kinds: ["idea", "praise"], badge: false, strings: { title: "Ideas?", kinds: { idea: "Suggestion" } } });
    expect(a.$$("[part=chip]").map((c) => c.textContent)).toEqual(["Suggestion", "Love it"]);
    expect(a.$("[part=badge]")).toBeNull();
    expect(a.$("#mlp-title")!.textContent).toBe("Ideas?");
    a.w.destroy();
    const b = setup({ kinds: false, trigger: false, key: KEY + "x" });
    expect(b.$("[part=chips]")).toBeNull();
    expect(b.$("[part=trigger]")!.hidden).toBe(true);
  });

  it("theme sets public variables on the host; scheme is applied", () => {
    const { w, $ } = setup({ theme: { accent: "#5b4cff", radius: "6px", fontFamily: "Inter", scheme: "dark" } });
    expect(w.element!.style.getPropertyValue("--mlp-accent")).toBe("#5b4cff");
    expect(w.element!.style.getPropertyValue("--mlp-radius")).toBe("6px");
    expect(w.element!.style.getPropertyValue("--mlp-font-family")).toBe("Inter");
    expect($(".w")!.getAttribute("data-scheme")).toBe("dark");
  });

  it("trigger position and compact mode", () => {
    const { $ } = setup({ trigger: { position: "top-left", compact: true, label: "Help us" } });
    expect($(".w")!.getAttribute("data-pos")).toBe("ts");
    expect($("[part=trigger]")!.getAttribute("aria-label")).toBe("Help us");
  });
});

describe("triggers", () => {
  it("declarative data-mlp-feedback, including elements added later", async () => {
    const { w, calls } = setup({ trigger: false });
    const later = document.createElement("a");
    later.href = "#";
    later.setAttribute("data-mlp-feedback", "");
    later.setAttribute("data-mlp-kind", "idea");
    later.setAttribute("data-mlp-subject", "Reports page");
    later.innerHTML = "<span>Suggest</span>";
    document.body.append(later);
    (later.firstChild as HTMLElement).click();
    expect(w.controller.getState()).toMatchObject({ status: "open", draft: { kind: "idea" } });
    w.controller.setField("text", "x");
    await w.controller.submit();
    expect(calls[0]!.body.report.subject).toEqual({ type: "feature", name: "Reports page" });
  });

  it("attach(selector) delegates; attach(element) binds; both detach", () => {
    const { w } = setup({ trigger: false });
    const off = w.attach(".help", { kind: "confusing", prefill: "I'm stuck on " });
    const b = document.createElement("button");
    b.className = "help";
    document.body.append(b);
    b.click();
    expect(w.controller.getState()).toMatchObject({ status: "open", draft: { kind: "confusing", text: "I'm stuck on " } });
    w.close();
    w.controller.reset();
    off();
    b.click();
    expect(w.controller.getState().status).toBe("idle");

    const c = document.createElement("div");
    document.body.append(c);
    const off2 = w.attach(c, { kind: "praise" });
    c.click();
    expect(w.controller.getState().draft.kind).toBe("praise");
    w.close();
    off2();
    c.click();
    expect(w.controller.getState().status).toBe("idle");
  });
});

describe("init / destroy", () => {
  it("init is idempotent", () => {
    const a = init({ key: KEY });
    const b = init({ key: KEY });
    expect(a).toBe(b);
    expect(document.querySelectorAll("mlp-feedback")).toHaveLength(1);
  });

  it("a different key replaces the widget", () => {
    const a = init({ key: KEY });
    const b = init({ key: KEY + "2" });
    expect(a).not.toBe(b);
    expect(a.destroyed).toBe(true);
    expect(document.querySelectorAll("mlp-feedback")).toHaveLength(1);
  });

  it("destroy removes the element and every listener", () => {
    const w = init({ key: KEY, trigger: false });
    const spy = vi.spyOn(w.controller, "open");
    const el = document.createElement("button");
    el.setAttribute("data-mlp-feedback", "");
    document.body.append(el);
    w.destroy();
    expect(document.querySelector("mlp-feedback")).toBeNull();
    el.click();
    expect(spy).not.toHaveBeenCalled();
    expect(getWidget()).toBeUndefined();
    // and it can be created again
    const w2 = init({ key: KEY });
    expect(w2).not.toBe(w);
    expect(document.querySelectorAll("mlp-feedback")).toHaveLength(1);
  });

  it("ui: false creates no element but the controller and triggers work", () => {
    const w = createWidget({ key: KEY, ui: false });
    expect(w.element).toBeNull();
    expect(document.querySelector("mlp-feedback")).toBeNull();
    w.open({ kind: "idea" });
    expect(w.controller.getState().status).toBe("open");
    w.destroy();
  });

  it("waits for <body> when initialised early", () => {
    const body = document.body;
    body.remove();
    const w = createWidget({ key: KEY });
    expect(w.element).toBeNull();
    document.documentElement.append(body);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(w.element).not.toBeNull();
    expect(body.contains(w.element)).toBe(true);
    w.destroy();
  });

  it("instance methods never throw", () => {
    const w = init({ key: KEY });
    expect(() => {
      w.attach("::::bad selector");
      document.body.click();
      w.setContext(null as never);
      w.identify(undefined as never);
      w.setFlags("x" as never);
      w.open("nonsense" as never);
    }).not.toThrow();
  });
});
