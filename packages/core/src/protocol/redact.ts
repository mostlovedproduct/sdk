/**
 * Secret redaction (contracts.md section 5). Runs in the SDK before send and again at intake.
 *
 * Every built-in pattern is linear-time: no nested unbounded quantifiers, no
 * overlapping alternatives under a repeat. Input is additionally capped at
 * MAX_SCAN_CHARS per string; anything beyond is cut (the contract's own limits
 * are far lower, so this only affects payloads that fail validation anyway).
 */

import type { Answer, Props, Report } from "./types.js";

export const MAX_SCAN_CHARS = 16_384;
const TRUNCATED = "[truncated]";

export interface RedactPattern {
  /** Label used in the replacement: `[redacted:<type>]`. */
  type: string;
  /** Matched text is replaced. The `g` flag is added if missing. */
  pattern: RegExp;
}

export interface RedactOptions {
  /** Extra customer patterns. A bare RegExp is labelled "custom". */
  patterns?: Array<RegExp | RedactPattern>;
  /** Redact email addresses in free text. Default false. `contact.email` is always exempt. */
  emails?: boolean;
}

export interface Redacted<T> {
  value: T;
  /** Number of replacements made. */
  count: number;
}

interface Rule {
  type: string;
  re: RegExp;
  /** Optional post-match check on the redacted part (after `keep`). Returning false keeps the match. */
  check?: (secret: string) => boolean;
}

// Named group `keep` is preserved before the replacement (e.g. "Bearer ", "password=").
const BUILTIN: Rule[] = [
  {
    type: "private_key",
    re: /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----(?:[^-]|-(?!----END ))*(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----)?/g,
  },
  { type: "jwt", re: /\beyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g },
  {
    type: "authorization",
    re: /(?<keep>\bauthorization["']?\s{0,5}[:=]\s{0,5}["']?(?:(?:basic|bearer|token|digest)\s{1,5})?)[^\s"',;]{6,}/gi,
    check: looksSecret,
  },
  { type: "bearer", re: /(?<keep>\bbearer\s{1,5})[A-Za-z0-9._~+/=-]{8,}/gi, check: looksSecret },
  { type: "mlp_key", re: /\bmlp_sk_[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]+)?/g },
  { type: "api_key", re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { type: "api_key", re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { type: "github_token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g },
  { type: "aws_key", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { type: "slack_token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { type: "google_key", re: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  {
    type: "secret",
    re: /(?<keep>\b(?:[A-Za-z0-9]{1,32}[_-]){0,4}(?:password|passwd|pwd|secret|token|api[_-]?key)\s{0,5}=\s{0,5}["']?)[^\s"'&,;]+/gi,
  },
  {
    type: "secret",
    re: /(?<keep>"(?:[A-Za-z0-9]{1,32}[_-]){0,4}(?:password|passwd|pwd|secret|token|api[_-]?key)"\s{0,5}:\s{0,5}")[^"]+/gi,
  },
  // Card-like runs: 13–19 digits, optionally single space/dash separated, issuer prefix 2–6, Luhn-valid.
  { type: "card", re: /\b[2-6](?:[ -]?\d){12,18}\b/g, check: (m) => luhn(m.replace(/\D/g, "")) },
];

const EMAIL_RULE: Rule = {
  type: "email",
  re: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}\b/g,
};

/**
 * Keeps ordinary words after "Bearer"/"Authorization:" in prose ("Bearer authentication").
 * Real credentials contain a digit, a symbol, or mixed case beyond a capitalized word.
 */
function looksSecret(s: string): boolean {
  return /[0-9._~+/=-]/.test(s) || (/[a-z]/.test(s) && /[A-Z]/.test(s) && !/^[A-Z][a-z]+$/.test(s));
}

/** Luhn checksum over a digit string. */
export function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return digits.length > 0 && sum % 10 === 0;
}

function rulesFor(opts: RedactOptions): Rule[] {
  const rules = opts.emails ? [...BUILTIN, EMAIL_RULE] : BUILTIN.slice();
  for (const p of opts.patterns ?? []) {
    const { type, pattern } = p instanceof RegExp ? { type: "custom", pattern: p } : p;
    const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
    rules.push({ type, re: new RegExp(pattern.source, flags) });
  }
  return rules;
}

function apply(text: string, rules: Rule[]): Redacted<string> {
  let out = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) + TRUNCATED : text;
  let count = 0;
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, (...args: unknown[]) => {
      const match = args[0] as string;
      const last = args[args.length - 1];
      const groups = typeof last === "object" && last !== null ? (last as Record<string, string | undefined>) : undefined;
      if (match.length === 0) return match;
      const keep = groups?.keep ?? "";
      if (rule.check && !rule.check(match.slice(keep.length))) return match;
      count++;
      return keep + `[redacted:${rule.type}]`;
    });
  }
  return { value: out, count };
}

/** Redact one free-text string. */
export function redactText(text: string, opts: RedactOptions = {}): Redacted<string> {
  return apply(text, rulesFor(opts));
}

function redactProps(props: Props, rules: Rule[], counter: { n: number }): Props {
  const out: Props = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === "string") out[k] = run(v, rules, counter);
    else if (Array.isArray(v)) out[k] = v.map((s) => (typeof s === "string" ? run(s, rules, counter) : s));
    else out[k] = v;
  }
  return out;
}

function run(text: string, rules: Rule[], counter: { n: number }): string {
  const r = apply(text, rules);
  counter.n += r.count;
  return r.value;
}

const FREE_TEXT = ["summary", "details", "task", "expected", "actual", "suggestion"] as const;
const PAGE_TEXT = ["url", "path", "title", "referrer"] as const;

/**
 * Redact a report. Returns a new object; the input is not mutated.
 *
 * Scanned: summary, details, task, expected, actual, suggestion, subject.name,
 * page.url/path/title/referrer, flag string values, and every string inside
 * Props (user.traits, context). Not scanned: enums, source, user.id/tier, app,
 * page.locale/viewport, and contact (contact.email is exempt by contract).
 */
export function redactReport(report: Report, opts: RedactOptions = {}): Redacted<Report> {
  const rules = rulesFor(opts);
  const counter = { n: 0 };
  const out: Report = { ...report };
  for (const f of FREE_TEXT) {
    const v = out[f];
    if (typeof v === "string") out[f] = run(v, rules, counter);
  }
  if (out.subject && typeof out.subject.name === "string") {
    out.subject = { ...out.subject, name: run(out.subject.name, rules, counter) };
  }
  if (out.page) {
    const page = { ...out.page };
    for (const f of PAGE_TEXT) {
      const v = page[f];
      if (typeof v === "string") page[f] = run(v, rules, counter);
    }
    out.page = page;
  }
  if (out.flags) {
    const flags: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(out.flags)) flags[k] = typeof v === "string" ? run(v, rules, counter) : v;
    out.flags = flags;
  }
  if (out.context) out.context = redactProps(out.context, rules, counter);
  if (out.user?.traits) out.user = { ...out.user, traits: redactProps(out.user.traits, rules, counter) };
  return { value: out, count: counter.n };
}

/**
 * Redact a follow-up answer: only `text` is free text. Returns a new object; the input is not mutated.
 */
export function redactAnswer(answer: Answer, opts: RedactOptions = {}): Redacted<Answer> {
  if (typeof answer.text !== "string") return { value: { ...answer }, count: 0 };
  const r = redactText(answer.text, opts);
  return { value: { ...answer, text: r.value }, count: r.count };
}

/** Which URL parts `stripUrl` keeps. Both default to false. */
export interface StripUrlOptions {
  query?: boolean;
  hash?: boolean;
}

/**
 * Drop the query string and fragment from a URL (the contract default for page.url).
 * `keep: true` returns the input unchanged; an object keeps the named parts only.
 */
export function stripUrl(url: string, keep: boolean | StripUrlOptions = false): string {
  if (keep === true) return url;
  const o = keep || {};
  const h = url.indexOf("#");
  const hash = h >= 0 ? url.slice(h) : "";
  let u = h >= 0 ? url.slice(0, h) : url;
  if (!o.query) {
    const q = u.indexOf("?");
    if (q >= 0) u = u.slice(0, q);
  }
  return o.hash ? u + hash : u;
}
