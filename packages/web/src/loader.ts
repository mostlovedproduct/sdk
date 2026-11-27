// Script-tag build: exposes window.mlp, a command function with a pre-load queue.
//
//   <script>window.mlp=window.mlp||function(){(mlp.q=mlp.q||[]).push(arguments)}</script>
//   <script async src=".../mlp.js" data-key="mlp_pk_..."></script>
//   <script>mlp('init',{...}); mlp('identify',{id:'u_123'})</script>
import { createFeedback } from "./controller.js";
import { defineElement } from "./element.js";
import { KIND_ORDER } from "./kinds.js";
import type { FeedbackConfig, Kind } from "./types.js";
import { WEB_VERSION } from "./version.js";
import { createWidget, init, type FeedbackWidget } from "./widget.js";

type Args = [string, ...unknown[]];
export interface MlpFunction {
  (command: string, ...args: unknown[]): unknown;
  q?: ArrayLike<unknown>[];
  loaded?: boolean;
  version?: string;
  init?: typeof init;
  createFeedback?: typeof createFeedback;
  createWidget?: typeof createWidget;
  defineElement?: typeof defineElement;
}

/** Zero-JS setup from `data-*` attributes on the script tag. */
export function configFromScript(s: HTMLOrSVGScriptElement | null | undefined): Partial<FeedbackConfig> {
  const d = (s as HTMLElement | null)?.dataset;
  if (!d) return {};
  const c: Partial<FeedbackConfig> = {};
  const no = (v: string | undefined) => v === "false" || v === "none" || v === "0";
  if (d.key) c.key = d.key;
  if (d.endpoint) c.endpoint = d.endpoint;
  if (no(d.trigger)) c.trigger = false;
  else if (d.position || d.label) c.trigger = { position: d.position as never, label: d.label };
  if (d.kinds) c.kinds = no(d.kinds) ? false : (d.kinds.split(/[\s,]+/).filter((k) => KIND_ORDER.includes(k as Kind)) as Kind[]);
  if (no(d.badge)) c.badge = false;
  if (no(d.legal)) c.legal = false;
  else if (d.privacyUrl || d.termsUrl) c.legal = { privacyUrl: d.privacyUrl, termsUrl: d.termsUrl };
  if (no(d.page)) c.page = false;
  if (d.locale) c.locale = d.locale;
  if (d.followUps) c.followUps = Math.min(2, Math.max(0, parseInt(d.followUps, 10) || 0)) as 0 | 1 | 2;
  if (d.scheme || d.accent) c.theme = { scheme: d.scheme as never, accent: d.accent };
  if (d.title || d.placeholder) c.strings = { title: d.title, placeholder: d.placeholder };
  if (d.appVersion || d.appEnv) c.app = { version: d.appVersion, env: d.appEnv };
  return c;
}

export function installLoader(win: Window & { mlp?: MlpFunction }): MlpFunction | undefined {
  const prev = win.mlp;
  if (prev?.loaded) return prev;
  const doc = win.document;
  const script = doc.currentScript ?? doc.querySelector("script[data-key][src*='mlp']");
  const base = configFromScript(script);
  let inst: FeedbackWidget | undefined;
  const pending: Args[] = [];
  const ready: ((w: FeedbackWidget) => void)[] = [];

  function run(name: string, ...a: unknown[]): unknown {
    try {
      if (name === "init") {
        const cfg = { ...base, ...(a[0] as object) } as FeedbackConfig;
        inst = init(cfg);
        for (const p of pending.splice(0)) run(...p);
        for (const f of ready.splice(0)) run("ready", f);
        return inst;
      }
      if (name === "ready") {
        if (typeof a[0] !== "function") return;
        if (inst) (a[0] as (w: FeedbackWidget) => void)(inst);
        else ready.push(a[0] as (w: FeedbackWidget) => void);
        return;
      }
      if (!inst || inst.destroyed) {
        if (name !== "destroy") pending.push([name, ...a]);
        return;
      }
      const fn = (inst as unknown as Record<string, unknown>)[name];
      if (typeof fn === "function") return (fn as (...x: unknown[]) => unknown).apply(inst, a);
      console.warn("[mlp] unknown command", name);
    } catch (e) {
      try {
        console.warn("[mlp]", e);
      } catch {
        /* nothing */
      }
    }
    return undefined;
  }

  const api: MlpFunction = (command: string, ...args: unknown[]) => run(command, ...args);
  api.loaded = true;
  api.version = WEB_VERSION;
  api.init = init;
  api.createFeedback = createFeedback;
  api.createWidget = createWidget;
  api.defineElement = defineElement;
  const queue = Array.from(prev?.q ?? [], (x) => Array.from(x) as Args);
  win.mlp = api;
  const i = queue.findIndex((c) => c[0] === "init");
  if (i >= 0) run(...queue.splice(i, 1)[0]!);
  else if (base.key) run("init", {});
  for (const c of queue) run(...c);
  return api;
}
