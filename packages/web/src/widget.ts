import { createFeedback, type FeedbackController } from "./controller.js";
import { deepActive, defineElement, ELEMENT_NAME, type FeedbackElement } from "./element.js";
import { KIND_ORDER } from "./kinds.js";
import type { AppContext, FeedbackConfig, Flags, Kind, OpenOptions, Props, UserContext } from "./types.js";

export interface FeedbackWidget {
  readonly controller: FeedbackController;
  /** The `<mlp-feedback>` element, once mounted (null with `ui: false`, during SSR, or before `<body>` exists). */
  readonly element: FeedbackElement | null;
  readonly config: Readonly<FeedbackConfig>;
  open(options?: OpenOptions): void;
  close(): void;
  toggle(options?: OpenOptions): void;
  /**
   * Open the widget from your own button(s). A selector string uses event delegation, so it also
   * covers elements added later. Returns a function that detaches.
   */
  attach(target: string | Element, options?: OpenOptions): () => void;
  setContext(props: Props): void;
  /** Set (merge) the current user: your opaque id, tier, traits. `null` clears it. */
  identify(user: UserContext | string | null): void;
  setUser(user: UserContext | string | null): void;
  setFlags(flags: Flags): void;
  setApp(app: AppContext): void;
  /** Remove the element and every listener. */
  destroy(): void;
  readonly destroyed: boolean;
}

function warn(...a: unknown[]): void {
  try {
    console.warn("[mlp]", ...a);
  } catch {
    /* no console */
  }
}

function guard<A extends unknown[], R>(fn: (...a: A) => R, fallback?: R): (...a: A) => R {
  return (...a) => {
    try {
      return fn(...a);
    } catch (e) {
      warn(e);
      return fallback as R;
    }
  };
}

/** Options read from `data-mlp-*` attributes on a declarative trigger. */
function fromAttrs(el: Element): OpenOptions {
  const o: OpenOptions = {};
  const kind = el.getAttribute("data-mlp-kind") as Kind | null;
  if (kind && KIND_ORDER.includes(kind)) o.kind = kind;
  const prefill = el.getAttribute("data-mlp-prefill");
  if (prefill) o.prefill = prefill;
  const subject = el.getAttribute("data-mlp-subject");
  if (subject) o.subject = subject;
  return o;
}

/** Create an independent widget (no singleton). Most pages want `init()`. */
export function createWidget(config: FeedbackConfig): FeedbackWidget {
  const cfg = (config && typeof config === "object" ? config : {}) as FeedbackConfig;
  const controller = createFeedback(cfg);
  const hasDom = typeof document !== "undefined";
  const rules: { sel: string; opts: OpenOptions }[] = [];
  const cleanups: (() => void)[] = [];
  let element: FeedbackElement | null = null;
  let destroyed = false;

  const openFrom = (from: Element | null, opts?: OpenOptions) => {
    if (element && from) element.opener = from;
    controller.open(opts);
  };

  if (hasDom) {
    const onClick = (e: Event) => {
      if (destroyed) return;
      const path = typeof e.composedPath === "function" ? e.composedPath() : [e.target];
      for (const n of path) {
        if (!(n instanceof Element)) continue;
        if (n.hasAttribute("data-mlp-feedback")) {
          e.preventDefault();
          return openFrom(n, fromAttrs(n));
        }
        for (const r of rules) {
          let hit = false;
          try {
            hit = n.matches(r.sel);
          } catch {
            /* invalid selector */
          }
          if (hit) {
            e.preventDefault();
            return openFrom(n, { ...fromAttrs(n), ...r.opts });
          }
        }
      }
    };
    document.addEventListener("click", onClick);
    cleanups.push(() => document.removeEventListener("click", onClick));

    if (cfg.ui !== false) {
      const mount = () => {
        if (destroyed || element) return;
        try {
          const name = defineElement();
          const el = document.createElement(name) as FeedbackElement;
          if (typeof el.setup !== "function") return; // no custom elements support
          el.setup(controller, cfg);
          (cfg.container ?? document.body).append(el);
          element = el;
        } catch (e) {
          warn("could not mount the widget", e);
        }
      };
      if (document.body) mount();
      else {
        document.addEventListener("DOMContentLoaded", mount, { once: true });
        cleanups.push(() => document.removeEventListener("DOMContentLoaded", mount));
      }
    }
  }

  const w: FeedbackWidget = {
    controller,
    config: cfg,
    get element() {
      return element;
    },
    get destroyed() {
      return destroyed;
    },
    open: guard((o?: OpenOptions) => openFrom(deepActive(), o)),
    close: guard(() => controller.close()),
    toggle: guard((o?: OpenOptions) => (controller.getState().status === "idle" ? openFrom(deepActive(), o) : controller.close())),
    attach: guard(
      (target: string | Element, opts: OpenOptions = {}) => {
        if (destroyed) return () => {};
        if (typeof target === "string") {
          const rule = { sel: target, opts };
          rules.push(rule);
          return () => void rules.splice(rules.indexOf(rule) >>> 0, 1);
        }
        if (!target || typeof target.addEventListener !== "function") return () => {};
        const fn = (e: Event) => {
          e.preventDefault();
          openFrom(target, opts);
        };
        target.addEventListener("click", fn);
        const off = () => target.removeEventListener("click", fn);
        cleanups.push(off);
        return off;
      },
      () => {},
    ),
    setContext: guard((p: Props) => controller.setContext(p)),
    identify: guard((u: UserContext | string | null) => controller.setUser(u)),
    setUser: guard((u: UserContext | string | null) => controller.setUser(u)),
    setFlags: guard((f: Flags) => controller.setFlags(f)),
    setApp: guard((a: AppContext) => controller.setApp(a)),
    destroy: guard(() => {
      if (destroyed) return;
      controller.close();
      destroyed = true;
      for (const f of cleanups.splice(0)) f();
      rules.length = 0;
      element?.remove();
      element = null;
      controller.destroy();
      if (current === w) current = undefined;
    }),
  };
  return w;
}

let current: FeedbackWidget | undefined;

/**
 * Create the page's feedback widget. Idempotent: calling it again returns the existing widget
 * (a different `key` replaces it). Never throws; safe before `<body>` exists and during SSR.
 */
export function init(config: FeedbackConfig): FeedbackWidget {
  if (current && !current.destroyed) {
    if (current.config.key === config?.key) return current;
    current.destroy();
  }
  try {
    current = createWidget(config);
  } catch (e) {
    warn(e);
    current = createWidget({ ...config, ui: false });
  }
  return current;
}

/** The widget created by `init()`, if any. */
export function getWidget(): FeedbackWidget | undefined {
  return current;
}

export { ELEMENT_NAME };
