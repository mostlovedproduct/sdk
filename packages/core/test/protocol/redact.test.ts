import { describe, expect, it } from "vitest";
import { MAX_SCAN_CHARS, luhn, redactAnswer, redactReport, redactText, stripUrl, type Answer, type Report } from "../../src/protocol/index.js";

const r = (text: string, opts = {}) => redactText(text, opts);

describe("redactText: secrets", () => {
  it.each([
    ["bearer", "curl -H 'Authorization: Bearer abcDEF123456789xyz'", "[redacted:authorization]"],
    ["bearer alone", "sent Bearer eyabc123def456ghi to it", "Bearer [redacted:bearer]"],
    ["authorization basic", "authorization=Basic dXNlcjpwYXNzd29yZA==", "[redacted:authorization]"],
    ["jwt", "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U ok", "[redacted:jwt]"],
    ["openai", "key sk-proj-abcdefghijklmnopqrstuvwxyz0123", "[redacted:api_key]"],
    ["anthropic", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz", "[redacted:api_key]"],
    ["stripe", "sk_live_abcdefghijklmnop1234", "[redacted:api_key]"],
    ["github", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "[redacted:github_token]"],
    ["github pat", "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz", "[redacted:github_token]"],
    ["aws", "AKIAIOSFODNN7EXAMPLE is the id", "[redacted:aws_key]"],
    ["slack", "xoxb-1234567890-abcdefghij", "[redacted:slack_token]"],
    ["mlp sk", "using mlp_sk_eyJrIjoiMSJ9.abcDEF123_- now", "[redacted:mlp_key]"],
    ["google", "AIzaSyA1234567890abcdefghijklmnopqrstuv", "[redacted:google_key]"],
    ["password=", "db url password=hunter2&x=1", "password=[redacted:secret]"],
    ["DB_PASSWORD=", "DB_PASSWORD = s3cr3t!", "DB_PASSWORD = [redacted:secret]"],
    ["token=", "?token=abc123", "token=[redacted:secret]"],
    ["secret= quoted", "client_secret='zzz'", "client_secret='[redacted:secret]'"],
    ["json", '{"api_key": "abc"}', '"api_key": "[redacted:secret]"'],
    ["visa", "card 4111 1111 1111 1111 exp", "[redacted:card]"],
    ["visa dashed", "4111-1111-1111-1111", "[redacted:card]"],
    ["mastercard", "5555555555554444", "[redacted:card]"],
    ["amex", "378282246310005", "[redacted:card]"],
  ])("%s", (_name, input, expected) => {
    const out = r(input);
    expect(out.value).toContain(expected);
    expect(out.count).toBeGreaterThanOrEqual(1);
  });

  it("redacts a private key block, including an unterminated one", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nIBAAK\n-----END RSA PRIVATE KEY-----";
    expect(r(`here: ${pem} done`)).toEqual({ value: "here: [redacted:private_key] done", count: 1 });
    expect(r("-----BEGIN PRIVATE KEY-----\nMIIEow...").value).toBe("[redacted:private_key]");
  });

  it("counts every replacement", () => {
    expect(r("ghp_abcdefghijklmnopqrstuvwxyz0123456789 and AKIAIOSFODNN7EXAMPLE").count).toBe(2);
  });
});

describe("redactText: no false positives on ordinary prose", () => {
  it.each([
    "The export button does nothing when I click it twice.",
    "Bearer authentication is confusing in the docs.",
    "Authorization: required for this endpoint",
    "The token expired and I had to sign in again.",
    "My password reset email never arrived.",
    "Call me at 555-123-4567 or +44 20 7946 0958.",
    "Order 1731500000000 failed on 2026-11-13 at 12:00.",
    "Version 4.1.12 broke the build; 1234 5678 is not a card.",
    "Use sk- prefixed keys? The task-force asked about risk-adjusted costs.",
    "4111 1111 1111 1112 fails Luhn",
    "Contact jane@example.com about it.",
    "akia is a word; AKIA123 is too short.",
  ])("%s", (text) => {
    expect(r(text)).toEqual({ value: text, count: 0 });
  });
});

describe("redactText: options", () => {
  it("redacts emails only when enabled", () => {
    expect(r("mail jane.doe+x@example.co.uk now").count).toBe(0);
    expect(r("mail jane.doe+x@example.co.uk now", { emails: true }).value).toBe("mail [redacted:email] now");
  });

  it("applies extra patterns, with or without the g flag", () => {
    expect(r("order ORD-12345 and ORD-99999", { patterns: [/ORD-\d+/] })).toEqual({
      value: "order [redacted:custom] and [redacted:custom]",
      count: 2,
    });
    expect(r("acct 42-42", { patterns: [{ type: "account", pattern: /\d+-\d+/g }] }).value).toBe("acct [redacted:account]");
  });
});

describe("redactText: linear time and caps", () => {
  it("caps scanned length", () => {
    const out = r("a".repeat(MAX_SCAN_CHARS + 10));
    expect(out.value.length).toBe(MAX_SCAN_CHARS + "[truncated]".length);
  });

  it.each([
    ["digits", "4".repeat(MAX_SCAN_CHARS)],
    ["digit groups", "4 ".repeat(MAX_SCAN_CHARS / 2)],
    ["dashes", "a-".repeat(MAX_SCAN_CHARS / 2)],
    ["underscored words", "a_".repeat(MAX_SCAN_CHARS / 2) + "token"],
    ["pem without end", "-----BEGIN PRIVATE KEY-----" + "-".repeat(MAX_SCAN_CHARS)],
    ["many begins", "-----BEGIN PRIVATE KEY-----".repeat(500)],
    ["email-ish", "a".repeat(MAX_SCAN_CHARS / 2) + "@" + "b.".repeat(MAX_SCAN_CHARS / 4)],
    ["bearer spaces", "bearer ".repeat(MAX_SCAN_CHARS / 7)],
    ["eyJ", "eyJ".repeat(MAX_SCAN_CHARS / 3)],
  ])("handles adversarial %s quickly", (_n, text) => {
    const start = performance.now();
    r(text, { emails: true });
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe("luhn", () => {
  it("validates", () => {
    expect(luhn("4111111111111111")).toBe(true);
    expect(luhn("4111111111111112")).toBe(false);
    expect(luhn("")).toBe(false);
    expect(luhn("12a4")).toBe(false);
  });
});

describe("redactReport", () => {
  const base: Report = {
    source: { kind: "human", surface: "web", client: { name: "sk-abcdefghijklmnopqrstuvwxyz" } },
    kind: "broken",
    summary: "Login fails with ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    details: "password=hunter2",
    task: "t",
    expected: "AKIAIOSFODNN7EXAMPLE",
    actual: "x",
    suggestion: "jane@example.com",
    subject: { type: "tool", name: "tool sk_test_abcdefghijklmnop1234" },
    user: { id: "user-AKIAIOSFODNN7EXAMPLE", traits: { note: "token=abc", list: ["4111111111111111", "ok"], n: 1 } },
    flags: { exp: "password=zzz", on: true },
    page: { url: "https://x.test/?token=abc", title: "t", locale: "en" },
    context: { auth: "Bearer abcdef0123456789" },
    contact: { email: "jane@example.com" },
  };

  it("redacts every free-text field and every string in Props without mutating", () => {
    const snapshot = structuredClone(base);
    const { value, count } = redactReport(base, { emails: true });
    expect(base).toEqual(snapshot);
    expect(value.summary).toBe("Login fails with [redacted:github_token]");
    expect(value.details).toBe("password=[redacted:secret]");
    expect(value.expected).toBe("[redacted:aws_key]");
    expect(value.suggestion).toBe("[redacted:email]");
    expect(value.subject?.name).toBe("tool [redacted:api_key]");
    expect(value.user?.traits).toEqual({ note: "token=[redacted:secret]", list: ["[redacted:card]", "ok"], n: 1 });
    expect(value.flags).toEqual({ exp: "password=[redacted:secret]", on: true });
    expect(value.page?.url).toBe("https://x.test/?token=[redacted:secret]");
    expect(value.context).toEqual({ auth: "Bearer [redacted:bearer]" });
    expect(count).toBe(10);
  });

  it("exempts contact.email, source and user.id", () => {
    const { value } = redactReport(base, { emails: true });
    expect(value.contact?.email).toBe("jane@example.com");
    expect(value.source).toEqual(base.source);
    expect(value.user?.id).toBe(base.user?.id);
  });

  it("returns count 0 on a clean report", () => {
    expect(redactReport({ source: { kind: "human", surface: "web" }, summary: "All good" }).count).toBe(0);
  });
});

describe("stripUrl", () => {
  it("drops query and fragment unless opted in", () => {
    expect(stripUrl("https://a.test/p?q=1#h")).toBe("https://a.test/p");
    expect(stripUrl("https://a.test/p#h")).toBe("https://a.test/p");
    expect(stripUrl("https://a.test/p?q=1", true)).toBe("https://a.test/p?q=1");
  });

  it("keeps query and fragment independently", () => {
    const u = "https://a.test/p?q=1#h";
    expect(stripUrl(u, { query: true })).toBe("https://a.test/p?q=1");
    expect(stripUrl(u, { hash: true })).toBe("https://a.test/p#h");
    expect(stripUrl(u, { query: true, hash: true })).toBe(u);
    expect(stripUrl("https://a.test/p#h?x", { query: true })).toBe("https://a.test/p");
  });
});

describe("redactAnswer", () => {
  const base: Answer = { report_id: "r", follow_up_id: "task", reply_token: "t" };
  it("redacts text and leaves the input untouched", () => {
    const input = { ...base, text: "use ghp_" + "a".repeat(36) };
    const r = redactAnswer(input);
    expect(r.value.text).toBe("use [redacted:github_token]");
    expect(r.count).toBe(1);
    expect(input.text).toContain("ghp_");
  });
  it("is a no-op for choice and skipped answers", () => {
    expect(redactAnswer({ ...base, option_id: "blocked" })).toEqual({ value: { ...base, option_id: "blocked" }, count: 0 });
    expect(redactAnswer({ ...base, skipped: true }).count).toBe(0);
  });
  it("honours custom patterns", () => {
    expect(redactAnswer({ ...base, text: "order ABC-123" }, { patterns: [/ABC-\d+/] }).value.text).toBe("order [redacted:custom]");
  });
});
