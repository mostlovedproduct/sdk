# @mostlovedproduct/core

The capture client and wire protocol behind the [Most Loved Product](https://mostlovedproduct.com) SDKs. Use it when you build your own feedback UI or send reports from code. For the common cases, use a higher-level package:

- [`@mostlovedproduct/web`](https://www.npmjs.com/package/@mostlovedproduct/web): the browser widget, or a headless controller for your own UI.
- [`@mostlovedproduct/mcp`](https://www.npmjs.com/package/@mostlovedproduct/mcp): the `submit_feedback` tool for MCP servers.

It has no runtime dependencies and uses only `fetch`. It runs in browsers, Cloudflare Workers, Node 20+ and Lambda, and it is side-effect free.

## Install

```bash
npm i @mostlovedproduct/core
```

## Send a report

```ts
import { createClient } from "@mostlovedproduct/core";

const feedback = createClient({
  key: "mlp_pk_...", // publishable key, safe in a browser
  app: { version: BUILD_VERSION, env: "production" },
});

feedback.setUser({ id: account.opaqueId, tier: account.plan }); // an opaque id, never an email

const result = await feedback.submit({
  kind: "broken",
  impact: "blocked",
  summary: "Export times out for ranges over 90 days",
});

if (result.ok) {
  // result.followUp is set when intake has a question that would make the report more useful.
} else if (result.retry) {
  // The failure may be transient. retry() resends the identical body, so a send that
  // already arrived is counted once.
}
```

`createClient()` never throws and `submit()` never rejects. Each send has a total time budget of `timeoutMs` (default 4 s). Failures, including configuration problems, come back as `{ ok: false, error }`.

## What it does before sending

- **Redaction.** Common secrets (bearer tokens, JWTs, private keys, provider key shapes, card-like numbers, `password=` assignments) are replaced in free text before the report leaves your code. Add patterns with `redact: { patterns }`, or turn on email redaction with `redact: { emails: true }`.
- **URLs.** `page.url` and `page.referrer` are sent without query string or fragment unless you set `keepUrl`.
- **Last look.** `beforeSend(report)` can change the report or return `null` to drop it. A `beforeSend` that throws drops the report.
- **Context.** Static `user`, `flags`, `app`, `page` and `context` values, the matching setters, and `getContext` providers are merged at submit time. A slow or failing provider is skipped, and the report is still sent.

## Wire protocol

`@mostlovedproduct/core/protocol` exports the wire types, limits and helpers (`redactReport`, `uuidv7` and others) for code that builds or validates capture envelopes itself. The HTTP API is documented at [mostlovedproduct.com/docs/api](https://mostlovedproduct.com/docs/api).

## Keys

Capture keys are write-only. A publishable key (`mlp_pk_`) is origin-checked and safe to ship to browsers. A server key (`mlp_sk_`) belongs in a backend secret and must never reach a browser. Create both in the dashboard. Treat keys as opaque strings.

## License

MIT
