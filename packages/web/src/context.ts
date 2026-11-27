import type { AppContext, ContextFields, Flags, PageContext, Props, UserContext } from "@mostlovedproduct/core";
import type { PageOptions } from "./types.js";

// Mirrors protocol LIMITS; duplicated as literals so the widget does not pull the protocol's value graph.
const SUMMARY_MAX = 300;
const DETAILS_MAX = 4000;
const PROP_STRING = 500;
const SHORT = 200;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Slice by code points so surrogate pairs are never split. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return Array.from(s).slice(0, max).join("");
}

const str = (v: unknown, max: number): string | undefined =>
  v == null ? undefined : clip(typeof v === "string" ? v : String(v), max);

/**
 * Coerce arbitrary customer data into valid `Props` so a sloppy context value can never
 * make the whole report fail validation: ≤32 keys, key ≤64, strings ≤500, arrays ≤20 strings,
 * objects JSON-stringified, functions and undefined dropped.
 */
export function cleanProps(v: unknown): Props | undefined {
  if (!isObj(v)) return undefined;
  const out: Props = {};
  let n = 0;
  for (const k in v) {
    if (n >= 32) break;
    const x = v[k];
    let y: Props[string] | undefined;
    if (x === null || typeof x === "boolean") y = x;
    else if (typeof x === "number") y = Number.isFinite(x) ? x : String(x);
    else if (typeof x === "string") y = clip(x, PROP_STRING);
    else if (Array.isArray(x)) y = x.slice(0, 20).map((i) => clip(typeof i === "string" ? i : String(json(i)), PROP_STRING));
    else if (typeof x === "object" || typeof x === "bigint") y = clip(json(x), PROP_STRING);
    if (y !== undefined) {
      out[k.slice(0, 64)] = y;
      n++;
    }
  }
  return out;
}

function json(v: unknown): string {
  try {
    return typeof v === "bigint" ? String(v) : (JSON.stringify(v) ?? String(v));
  } catch {
    return String(v);
  }
}

export function cleanFlags(v: unknown): Flags | undefined {
  if (!isObj(v)) return undefined;
  const out: Flags = {};
  let n = 0;
  for (const k in v) {
    if (n >= 50) break;
    const x = v[k];
    if (x === undefined || typeof x === "function") continue;
    out[k.slice(0, 64)] = typeof x === "boolean" ? x : clip(String(x), PROP_STRING);
    n++;
  }
  return out;
}

export function cleanUser(v: unknown): UserContext | undefined {
  if (typeof v === "string" || typeof v === "number") return { id: String(v).slice(0, SHORT) };
  if (!isObj(v)) return undefined;
  const out: UserContext = {};
  const id = str(v.id, SHORT);
  const tier = str(v.tier, SHORT);
  const traits = cleanProps(v.traits);
  if (id !== undefined) out.id = id;
  if (tier !== undefined) out.tier = tier;
  if (traits) out.traits = traits;
  return out;
}

export function cleanApp(v: unknown): AppContext | undefined {
  if (!isObj(v)) return undefined;
  const out: AppContext = {};
  for (const k of ["version", "env", "release"] as const) {
    const s = str(v[k], SHORT);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

function cleanPage(v: unknown): PageContext | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, string> = {};
  for (const k of ["url", "path", "title", "referrer", "locale", "viewport"]) {
    const s = str(v[k], k === "title" ? PROP_STRING : k === "locale" || k === "viewport" ? SHORT : 2048);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

/** Clean every known context field; unknown keys are dropped. */
export function cleanContext(v: unknown): Partial<ContextFields> | undefined {
  if (!isObj(v)) return undefined;
  const out: Partial<ContextFields> = {};
  const user = cleanUser(v.user);
  const flags = cleanFlags(v.flags);
  const app = cleanApp(v.app);
  const page = cleanPage(v.page);
  const context = cleanProps(v.context);
  if (user) out.user = user;
  if (flags) out.flags = flags;
  if (app) out.app = app;
  if (page) out.page = page;
  if (context) out.context = context;
  return out;
}

/** Automatic page context, read at submit time. Never throws; undefined when disabled or without a DOM. */
export function collectPage(opt: boolean | PageOptions | undefined): PageContext | undefined {
  if (opt === false || typeof location === "undefined" || typeof document === "undefined") return undefined;
  try {
    const o = isObj(opt) ? (opt as PageOptions) : {};
    // Raw URL: core drops query + fragment unless the customer opted in (keepUrl).
    const page: PageContext = {
      url: clip(location.href, 2048),
      path: clip(o.includeHash ? location.pathname + location.hash : location.pathname, 2048),
    };
    if (document.title) page.title = clip(document.title, PROP_STRING);
    // Referrer: never its query or fragment, regardless of options (it is another page's URL).
    if (document.referrer) page.referrer = clip(document.referrer.replace(/[?#][^]*$/, ""), 2048);
    const lang = document.documentElement.lang || (typeof navigator !== "undefined" ? navigator.language : "");
    if (lang) page.locale = lang.slice(0, SHORT);
    if (typeof innerWidth === "number") page.viewport = `${innerWidth}x${innerHeight}`;
    return page;
  } catch {
    return undefined;
  }
}

/** Coarse browser family for `source.client` (no version, no platform). */
export function browserFamily(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent || "";
  return /Edg\//.test(ua)
    ? "edge"
    : /Firefox\//.test(ua)
      ? "firefox"
      : /Chrome\/|CriOS/.test(ua)
        ? "chrome"
        : /Safari\//.test(ua)
          ? "safari"
          : undefined;
}

/**
 * Split free text into `summary` (first sentence, ≤300 chars) and `details` (the full text,
 * only when it is longer than the summary). Details are capped at 4000 code points.
 */
export function splitText(input: string): { summary: string; details?: string } {
  const text = input.trim().replace(/\r\n?/g, "\n");
  const firstLine = text.split("\n")[0]!.trim();
  // First sentence: up to the first . ! ? … followed by whitespace or end of line.
  const m = /^.*?[.!?…](?=\s|$)/u.exec(firstLine);
  let summary = (m ? m[0] : firstLine).trim();
  if (Array.from(summary).length > SUMMARY_MAX) {
    const cut = clip(summary, SUMMARY_MAX - 1);
    const sp = cut.lastIndexOf(" ");
    summary = (sp > SUMMARY_MAX * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
  }
  if (summary === text) return { summary };
  return { summary, details: clip(text, DETAILS_MAX) };
}
