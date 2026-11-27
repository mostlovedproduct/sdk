import type { FeedbackController } from "./controller.js";
import { safe } from "./controller.js";
import { KIND_ORDER } from "./kinds.js";
import { CSS } from "./styles.js";
import type { FeedbackConfig, FeedbackState, Kind, TriggerOptions } from "./types.js";

export const ELEMENT_NAME = "mlp-feedback";
const BADGE_URL = "https://mostlovedproduct.com/?ref=widget";

/** Public surface of `<mlp-feedback>`. */
export interface FeedbackElement extends HTMLElement {
  /** Bind a controller and UI options (defaults to the controller's config). Calling again rebuilds. */
  setup(controller: FeedbackController, options?: FeedbackConfig): void;
  /** Element to return focus to on close (defaults to whatever had focus when the panel opened). */
  opener: Element | null;
}

type Kid = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, unknown> | null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (typeof v === "function") el.addEventListener(k, v as EventListener);
    else if (v === true) el.setAttribute(k, "");
    else if (v != null && v !== false) el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

const NS = "http://www.w3.org/2000/svg";
function icon(d: string): SVGSVGElement {
  const s = document.createElementNS(NS, "svg");
  const p = document.createElementNS(NS, "path");
  const a = "viewBox|0 0 24 24|fill|none|stroke|currentColor|stroke-width|1.8|stroke-linecap|round|stroke-linejoin|round|aria-hidden|true".split("|");
  for (let i = 0; i < a.length; i += 2) s.setAttribute(a[i]!, a[i + 1]!);
  p.setAttribute("d", d);
  s.append(p);
  return s;
}
const I_CHAT = "M20 14.5a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2zM8.5 9h7M8.5 12h4";
const I_X = "M17 7 7 17M7 7l10 10";
const I_CHECK = "M20 6 9 17l-5-5";

/** Absolute http(s) URL, or undefined. Keeps `javascript:` and friends out of hrefs. */
function httpUrl(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u, document.baseURI);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

let sheet: CSSStyleSheet | undefined;

/** The deepest focused element, through open shadow roots. */
export function deepActive(): Element | null {
  let a = typeof document !== "undefined" ? document.activeElement : null;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

function parseRgb(c: string): number[] | undefined {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+)(%?))?/.exec(c);
  if (!m) return undefined;
  return [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4] / (m[5] ? 100 : 1)];
}
function luminance(c: number[]): number {
  const f = (i: number) => {
    const v = c[i]! / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(0) + 0.7152 * f(1) + 0.0722 * f(2);
}

/** "dark" | "light" as the host page currently looks: its background first, then color-scheme, then the OS. */
export function hostScheme(): "dark" | "light" {
  try {
    const de = document.documentElement;
    for (const el of [document.body, de]) {
      const c = el && parseRgb(getComputedStyle(el).backgroundColor);
      if (c && c[3]! > 0.5) return luminance(c) < 0.2 ? "dark" : "light";
    }
    const cs = getComputedStyle(de).colorScheme || "";
    if (/dark/.test(cs)) return !/light/.test(cs) || matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    /* no layout engine */
  }
  return "light";
}

const POS: Record<string, string> = {
  "bottom-end": "be",
  "bottom-right": "be",
  "bottom-start": "bs",
  "bottom-left": "bs",
  "top-end": "te",
  "top-right": "te",
  "top-start": "ts",
  "top-left": "ts",
};

/** Build the UI inside `host`'s shadow root and wire it to the controller. Returns a teardown. */
function mount(host: FeedbackElement, root: ShadowRoot, c: FeedbackController, o: FeedbackConfig): () => void {
  const s = c.strings;
  const off: (() => void)[] = [];
  const listen = (t: EventTarget, type: string, fn: EventListener) => {
    t.addEventListener(type, fn);
    off.push(() => t.removeEventListener(type, fn));
  };
  let prev: FeedbackState | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = (el: HTMLElement | null | undefined) => el && queueMicrotask(() => el.focus({ preventScroll: true }));

  if (!sheet && !root.querySelector("style")) root.append(h("style", { nonce: o.nonce }, CSS)); // CSP fallback, honours a nonce

  const trig: TriggerOptions = typeof o.trigger === "object" && o.trigger ? o.trigger : {};
  const showTrigger = o.trigger !== false;
  const label = trig.label || s.trigger;
  const th = o.theme ?? {};
  // Theme → public variables on the host element, so they win over values inherited from the page.
  for (const k in th) {
    const v = th[k as keyof typeof th];
    if (k !== "scheme" && v != null) host.style.setProperty("--mlp-" + k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()), String(v));
  }

  const send = (e: Event) => {
    e.preventDefault();
    if (c.getState().status !== "submitting") void c.submit();
  };

  let trigIcon: Node | null = trig.icon === false ? null : icon(I_CHAT);
  if (typeof trig.icon === "string") {
    try {
      const t = h("template");
      t.innerHTML = trig.icon;
      if (t.content.firstElementChild) trigIcon = t.content;
    } catch {
      /* Trusted Types or bad markup: keep the default icon */
    }
  }
  const trigger = h(
    "button",
    {
      type: "button",
      class: trig.compact ? "t c" : "t",
      part: "trigger",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      "aria-label": trig.compact && label,
      hidden: !showTrigger,
      click: () => {
        if (c.getState().status !== "idle") return c.close();
        host.opener = trigger;
        c.open();
      },
    },
    trigIcon,
    !trig.compact && h("span", null, label),
  );

  const kinds: Kind[] = o.kinds === false ? [] : Array.isArray(o.kinds) ? o.kinds.filter((k) => KIND_ORDER.includes(k)) : KIND_ORDER;
  const chips = kinds.map((k) =>
    h(
      "button",
      {
        type: "button",
        part: "chip",
        "data-kind": k,
        "aria-pressed": "false",
        click: () => c.setField("kind", c.getState().draft.kind === k ? undefined : k),
      },
      s.kinds[k],
    ),
  );

  const ta = h("textarea", {
    id: "mlp-text",
    part: "textarea",
    rows: 4,
    maxlength: 4000,
    placeholder: s.placeholder,
    "aria-describedby": "mlp-err",
    input: () => c.setField("text", ta.value),
    keydown: (e: KeyboardEvent) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && send(e),
  });
  const err = h("p", { id: "mlp-err", class: "er", part: "error", role: "alert" });
  const legal = o.legal === false ? undefined : (o.legal ?? {});
  const links = legal
    ? ([
        [legal.privacyUrl, s.privacy],
        [legal.termsUrl, s.terms],
      ] as const)
        .map(([u, t]) => (httpUrl(u) ? h("a", { href: httpUrl(u), target: "_blank", rel: "noopener" }, t) : null))
        .filter((a): a is HTMLAnchorElement => !!a)
    : [];
  const notice =
    legal &&
    h(
      "p",
      { id: "mlp-notice", class: "lg", part: "notice" },
      s.notice,
      ...links.flatMap((a, i) => [i ? " · " : " ", a]),
    );
  const submit = h("button", { type: "submit", class: "s", part: "submit", "aria-describedby": notice && "mlp-notice" }, s.submit);
  const compose = h(
    "form",
    { class: "v", part: "form", novalidate: true, submit: send },
    chips.length > 0 && h("div", { class: "k", role: "group", "aria-label": s.kindsLabel, part: "chips" }, ...chips),
    h("label", { class: "sr", for: "mlp-text" }, s.textLabel),
    ta,
    err,
    h("div", { class: "f", part: "footer" }, submit),
    notice,
  );

  const questionLabel = h("span", { id: "mlp-q", class: "sr" });
  const questionText = h("span", { part: "question-text" });
  const questionRemainder = h("span", { class: "question-remainder" });
  const q = h("p", { class: "q", part: "question", "aria-hidden": "true" }, questionText, questionRemainder);
  let questionFrame: number | undefined;
  const stopQuestionReveal = () => {
    if (questionFrame !== undefined) cancelAnimationFrame(questionFrame);
    questionFrame = undefined;
  };

  function showQuestion(text: string, generated: boolean) {
    stopQuestionReveal();
    questionLabel.textContent = text;
    if (!generated || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      questionText.textContent = text;
      questionRemainder.textContent = "";
      return;
    }

    const graphemes = typeof Intl.Segmenter === "function"
      ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), ({ segment }) => segment)
      : Array.from(text);
    const first = Math.max(1, Math.ceil(graphemes.length / 8));
    const started = performance.now();
    let shown = 0;
    const reveal = (now: number) => {
      questionFrame = undefined;
      const progress = Math.min(1, Math.max(0, (now - started) / 160));
      const count = Math.min(graphemes.length, first + Math.floor((graphemes.length - first) * progress));
      if (count !== shown) {
        shown = count;
        questionText.textContent = graphemes.slice(0, shown).join("");
        // Keep the complete line wrapping in place while the visible prefix grows.
        questionRemainder.textContent = graphemes.slice(shown).join("");
      }
      if (shown < graphemes.length) questionFrame = requestAnimationFrame(reveal);
    };
    questionText.textContent = questionRemainder.textContent = "";
    reveal(started);
  }
  const opts = h("div", { class: "o", role: "group", "aria-labelledby": "mlp-q", part: "options" });
  const answer = h("input", { class: "in", part: "answer", maxlength: 1000, "aria-labelledby": "mlp-q", "aria-describedby": "mlp-ferr" });
  const ferr = h("p", { id: "mlp-ferr", class: "er", part: "error", role: "alert" });
  const textForm = h(
    "form",
    {
      class: "ta",
      novalidate: true,
      submit: (e: Event) => {
        e.preventDefault();
        if (answer.value.trim()) void c.answerFollowUp({ text: answer.value });
        else answer.focus();
      },
    },
    answer,
    h("button", { type: "submit", class: "s", part: "submit answer-submit" }, s.answer),
  );
  const follow = h(
    "div",
    { class: "v", part: "follow-up", hidden: true },
    questionLabel,
    q,
    opts,
    textForm,
    ferr,
    h("button", { type: "button", class: "sk", part: "skip", click: () => void c.skipFollowUp() }, s.skip),
  );
  const doneBtn = h("button", { type: "button", class: "s", part: "submit done", click: () => c.close() }, s.done);
  const done = h(
    "div",
    { class: "v dn", part: "done", hidden: true },
    h("p", { class: "q" }, s.thanks),
    h("p", { class: "m" }, s.thanksDetail),
    doneBtn,
  );
  const closeBtn = h("button", { type: "button", class: "x", part: "close", "aria-label": s.close, click: () => c.close() }, icon(I_X));
  const preparing = h("span", { hidden: true }, s.preparingFollowUp);
  const pending = h(
    "div",
    { class: "pending m", part: "follow-up-pending", hidden: true },
    h("span", { class: "spinner", "aria-hidden": "true" }),
    preparing,
  );
  const resultBody = h("div", { class: "result-body", part: "result-body" }, pending, follow, done);
  const result = h(
    "div",
    { class: "v", part: "result", hidden: true },
    h("p", { class: "ok", part: "saved" }, icon(I_CHECK), s.saved),
    resultBody,
  );
  const live = h("p", { class: "sr", role: "status", "aria-live": "polite" });
  const panel = h(
    "div",
    { class: "p" },
    h(
      "div",
      { class: "h" },
      h("h2", { id: "mlp-title", part: "title" }, s.title),
      closeBtn,
    ),
    compose,
    result,
    o.badge !== false && h("p", { class: "b", part: "badge" }, h("a", { href: BADGE_URL, target: "_blank", rel: "noopener" }, s.badge)),
    live,
  );
  const dialog = h("dialog", { class: "d", part: "panel", "aria-labelledby": "mlp-title", lang: o.locale }, panel);
  const w = h("div", { class: "w", part: "root", "data-pos": POS[trig.position ?? ""] ?? "be", "data-nt": !showTrigger }, trigger, dialog);
  root.append(w);
  off.push(() => w.remove());

  // Esc: route through the controller so state, hooks and focus return stay consistent.
  listen(dialog, "cancel", (e) => {
    e.preventDefault();
    c.close();
  });
  listen(dialog, "keydown", (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key === "Escape") {
      e.preventDefault();
      c.close();
    }
  });

  /** Host scheme and accent-color → private variables. */
  const applyHost = () => {
    const sch = th.scheme;
    w.setAttribute("data-scheme", sch === "light" || sch === "dark" ? sch : hostScheme());
    try {
      const ac = getComputedStyle(document.body ?? document.documentElement).accentColor;
      if (ac && ac !== "auto") {
        w.style.setProperty("--_ha", ac);
        const rgb = parseRgb(ac);
        if (rgb) w.style.setProperty("--_hac", luminance(rgb) > 0.4 ? "#111" : "#fff");
      }
    } catch {
      /* ignore */
    }
  };
  applyHost();
  if ((th.scheme ?? "auto") === "auto") {
    // Re-read twice: hosts often transition their background, so the first read can be mid-fade.
    let t: ReturnType<typeof setTimeout> | undefined;
    let t2: ReturnType<typeof setTimeout> | undefined;
    const re = () => {
      clearTimeout(t);
      clearTimeout(t2);
      t = setTimeout(applyHost, 30);
      t2 = setTimeout(applyHost, 600);
    };
    off.push(() => (clearTimeout(t), clearTimeout(t2)));
    try {
      const mo = new MutationObserver(re);
      const mopts = { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-mode", "data-color-scheme"] };
      mo.observe(document.documentElement, mopts);
      if (document.body) mo.observe(document.body, mopts);
      off.push(() => mo.disconnect());
      const mq = matchMedia("(prefers-color-scheme: dark)");
      listen(mq, "change", re);
    } catch {
      /* no MutationObserver / matchMedia */
    }
  }

  const announce = (msg: string) => {
    live.textContent = "";
    setTimeout(() => (live.textContent = msg), 50);
  };

  const render = (st: FeedbackState) => {
    const p = prev;
    prev = st;
    const status = st.status;
    const isOpen = status !== "idle";
    const wasOpen = !!p && p.status !== "idle";
    const hadFocus = dialog.contains(root.activeElement);
    const busy = status === "submitting";
    const composing = busy || status === "open" || status === "error";
    const e = st.error;
    const d = st.draft;
    trigger.setAttribute("aria-expanded", String(isOpen));

    // Compose
    compose.hidden = !composing;
    if (ta.value !== d.text) ta.value = d.text;
    ta.readOnly = busy;
    for (const ch of chips) ch.setAttribute("aria-pressed", String(ch.dataset.kind === d.kind));
    submit.textContent = busy ? s.submitting : e?.phase === "submit" && e.retryable ? s.retry : s.submit;
    // aria-disabled, not disabled: a disabled button would drop focus out of the dialog.
    submit.setAttribute("aria-disabled", String(busy));
    const msg = !e
      ? ""
      : e.field === "text"
        ? e.message
        : e.code === "rate_limited"
          ? s.errorRateLimited
          : s.errorGeneric;
    const ea = e?.phase === "answer";
    if ((ea ? ferr : err).textContent !== msg) (ea ? ferr : err).textContent = msg;
    (ea ? err : ferr).textContent = "";
    ta.setAttribute("aria-invalid", String(e?.field === "text"));

    // Follow-up
    const fu = status === "follow_up" ? st.followUp : undefined;
    result.hidden = status !== "accepted" && status !== "done" && !fu;
    pending.hidden = status !== "accepted";
    preparing.hidden = !st.followUpPending;
    follow.hidden = !fu;
    follow.setAttribute("aria-busy", String(st.busy));
    const fresh = fu && (p?.followUp !== fu || p.status !== "follow_up");
    if (fu && fresh) {
      resultBody.scrollTop = 0;
      showQuestion(fu.question, fu.id === "open");
      opts.replaceChildren(
        ...(fu.input === "choice" && fu.options ? fu.options : []).map((op) =>
          h("button", { type: "button", part: "option", "data-id": op.id, click: () => void c.answerFollowUp({ optionId: op.id }) }, op.label),
        ),
      );
      opts.hidden = fu.input !== "choice";
      textForm.hidden = fu.input !== "text";
      answer.value = "";
      answer.placeholder = fu.placeholder ?? "";
    }
    if (fu) for (const b of follow.querySelectorAll("button,input")) b.setAttribute("aria-disabled", String(st.busy));

    if (!fu) stopQuestionReveal();
    done.hidden = status !== "done";

    // Open/close and focus management
    if (isOpen && !wasOpen) {
      applyHost();
      host.opener ??= deepActive();
      if (!dialog.open) {
        try {
          dialog.show();
        } catch {
          dialog.setAttribute("open", "");
        }
      }
      if (composing) later(ta);
    } else if (!isOpen && wasOpen) {
      clearTimeout(timer);
      try {
        dialog.close();
      } catch {
        /* not supported */
      }
      dialog.removeAttribute("open");
      const back = host.opener as HTMLElement | null;
      host.opener = null;
      if (hadFocus) {
        if (back?.isConnected && back !== document.body && back.focus) back.focus({ preventScroll: true });
        else if (showTrigger) trigger.focus({ preventScroll: true });
      }
    }
    if (!isOpen) return;

    if (busy && p?.status !== "submitting") announce(s.submitting);
    if (fu && fresh) {
      announce(fu.index === 1 ? s.saved : "");
      if (hadFocus) later(fu.input === "choice" ? (opts.firstElementChild as HTMLElement) : answer);
    }
    if (status === "accepted" && p?.status !== "accepted") {
      announce(st.followUpPending ? `${s.saved} ${s.preparingFollowUp}` : s.saved);
      if (hadFocus) later(closeBtn);
    } else if (status === "accepted" && st.followUpPending && !p?.followUpPending) {
      announce(s.preparingFollowUp);
    }
    if (status === "done" && p?.status !== "done") {
      announce(p?.status === "submitting" ? `${s.saved} ${s.thanks}` : s.thanks);
      if (hadFocus) later(doneBtn);
      if (o.autoCloseMs! > 0) timer = setTimeout(() => c.close(), o.autoCloseMs);
    }
    if (hadFocus && status === "error" && p?.status !== "error" && e?.field) later(ta);
  };

  off.push(c.subscribe(render));
  render(c.getState());
  off.push(() => {
    clearTimeout(timer);
    stopQuestionReveal();
    try {
      dialog.close();
    } catch {
      /* ignore */
    }
  });
  return () => {
    for (const f of off.splice(0)) safe(f);
  };
}

/**
 * Register `<mlp-feedback>` (idempotent). Safe to call during SSR: it does nothing without
 * `customElements`. Returns the element name.
 */
export function defineElement(name: string = ELEMENT_NAME): string {
  if (typeof customElements === "undefined" || customElements.get(name)) return name;

  class MlpFeedback extends HTMLElement {
    opener: Element | null = null;
    _r: ShadowRoot;
    _c?: FeedbackController;
    _o?: FeedbackConfig;
    _u?: () => void;

    constructor() {
      super();
      this._r = this.attachShadow({ mode: "open" });
      try {
        if (!sheet) {
          sheet = new CSSStyleSheet();
          sheet.replaceSync(CSS);
        }
        this._r.adoptedStyleSheets = [sheet];
      } catch {
        sheet = undefined;
      }
    }

    setup(controller: FeedbackController, options?: FeedbackConfig): void {
      this._c = controller;
      this._o = options ?? (controller.config as FeedbackConfig);
      this.disconnectedCallback();
      this.connectedCallback();
    }

    connectedCallback(): void {
      if (this._c && !this._u && this.isConnected) this._u = mount(this, this._r, this._c, this._o!);
    }

    disconnectedCallback(): void {
      this._u?.();
      this._u = undefined;
    }
  }

  try {
    customElements.define(name, MlpFeedback);
  } catch {
    /* defined concurrently */
  }
  return name;
}
