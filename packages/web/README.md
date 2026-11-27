# @mostlovedproduct/web

The browser feedback widget. It has three layers, and each one works without the others:

1. **Headless controller.** Use `createFeedback(config)` to build your own UI on the shared capture client.
2. **Default UI.** `<mlp-feedback>` is a custom element rendered in shadow DOM. It inherits your page's font and light/dark scheme, and you theme it with CSS variables and `::part()`.
3. **Script-tag loader.** `mlp.js` is one self-contained file that exposes `window.mlp(...)`, with a queue so you can call it before the script has loaded.

It sends nothing until someone submits feedback: no passive events, no cookies, no storage, and no network request before submit. It never throws into your page.

## Quick start

### Script tag

```html
<script>window.mlp=window.mlp||function(){(mlp.q=mlp.q||[]).push(arguments)}</script>
<script async src="https://cdn.mostlovedproduct.com/mlp.js" data-key="mlp_pk_…"></script>
<script>
  mlp('identify', { id: 'usr_8f3a2c', tier: 'pro' });   // your opaque id, never an email
  mlp('setFlags', { checkout_v2: true });
</script>
```

`/mlp.js` is always the latest release, so fixes reach your site without a deploy. Browsers and caches recheck it every 5 minutes. To control upgrades, pin a release and add Subresource Integrity. Each release is published once at `/v<version>/mlp.js` and never changes:

```html
<script async src="https://cdn.mostlovedproduct.com/v0.1.0/mlp.js"
  integrity="sha384-…" crossorigin="anonymous" data-key="mlp_pk_…"></script>
```

[CHANGELOG.md](CHANGELOG.md) lists the pinned URL and `integrity` value for each version. You can also serve `dist/mlp.js` from the npm package yourself.

With only `data-key`, the widget initializes itself. Call `mlp('init', {...})` when you need options that `data-*` attributes can't express. Values passed to `init` override the `data-*` values.

| Attribute | Effect |
|---|---|
| `data-key` | Capture key (required) |
| `data-endpoint` | Intake base URL |
| `data-position` | `bottom-end` (default), `bottom-start`, `top-end`, `top-start` (`-right`/`-left` are aliases) |
| `data-label` | Trigger label |
| `data-trigger="false"` | No floating button |
| `data-kinds="broken,idea"` / `"false"` | Kind chips to show |
| `data-badge="false"` | Hide the badge |
| `data-privacy-url`, `data-terms-url` | Link the data notice to your policies |
| `data-legal="false"` | Hide the data notice |
| `data-page="false"` | No automatic page context |
| `data-scheme`, `data-accent` | Theme shortcuts |
| `data-title`, `data-placeholder`, `data-locale` | Strings and `lang` |
| `data-app-version`, `data-app-env` | `app.version`, `app.env` |
| `data-follow-ups="0..2"` | Maximum follow-up questions |

Commands are `init`, `open`, `close`, `toggle`, `attach`, `setContext`, `identify` (alias `setUser`), `setFlags`, `setApp`, `destroy`, and `ready(fn)`. `ready` runs `fn(widget)` once the widget is initialized. After the script loads, `mlp.createFeedback` and `mlp.createWidget` are also available.

### npm

```ts
import { init } from '@mostlovedproduct/web';

const feedback = init({
  key: 'mlp_pk_…',
  user: { id: currentUser.id, tier: currentUser.plan },
  app: { version: import.meta.env.VITE_VERSION, env: import.meta.env.MODE },
});
feedback.attach('#help-button', { kind: 'confusing' });
```

`init` is idempotent: a second call returns the same widget, and a different `key` replaces it. `destroy()` removes the element and every listener. You can import the package during SSR because it does nothing at module top level and creates no UI without a DOM. You can also call it before `<body>` exists, and it will mount on `DOMContentLoaded`.

## Config reference (`init` / `createWidget`)

| Option | Type | Default | Notes |
|---|---|---|---|
| `key` | `string` | required | Publishable `mlp_pk_…` key |
| `endpoint`, `fallbackEndpoint` | `string` | production | Passed to core |
| `timeoutMs` | `number` | 4000 | Total deadline per call |
| `user` | `{ id?, tier?, traits? }` | | Your opaque user id |
| `flags` | `Record<string, string \| boolean>` | | Experiments, A/B variants |
| `app` | `{ version?, env?, release? }` | | |
| `context` | `Props` | | Anything else |
| `getContext` | `() => Partial<{user,flags,app,page,context}>` | | Runs at submit time, may be async. Capped at 500 ms. If it throws or is too slow, only its result is dropped: automatic page context and everything else is still sent |
| `page` | `boolean \| { includeQuery?, includeHash? }` | `true` | Automatic `page` context. `page.url` (and any `page.url`/`page.referrer` you supply) drops its query string and fragment unless you opt in; core does the stripping. The automatic referrer never keeps either |
| `beforeSend` | `(report) => report \| null` | | Last look at the report. Return `null` to drop it |
| `redact` | `{ patterns?, emails? } \| false` | built-ins | Client-side redaction (the server redacts again) |
| `followUps` | `0 \| 1 \| 2` | `1` | Most follow-up questions the UI will show |
| `kinds` | `Kind[] \| false` | all five | Chips: `broken`, `confusing`, `missing`, `idea`, `praise` |
| `trigger` | `boolean \| { position?, label?, icon?, compact? }` | `true` | `icon: false` hides it. A string is SVG markup. `compact` makes a round icon button |
| `theme` | see Theming | | Sets `--mlp-*` variables plus `scheme` |
| `strings` | partial `Strings` | English | Every string, including `kinds` labels and `followUps[id]` |
| `locale` | `string` | page's | `lang` attribute of the panel |
| `legal` | `{ privacyUrl?, termsUrl? } \| false` | notice, no links | One line under the form: "Some account and page details may be sent with your feedback to help fix problems.", then links to your privacy policy and terms. Point them at **your** policies, since you are the one collecting the feedback; list Most Loved Product as a processor in your privacy policy. Only http(s) URLs are linked. `false` hides it |
| `badge` | `boolean` | `true` | "Feedback by Most Loved Product" |
| `autoCloseMs` | `number` | `0` | Closes the thank-you view automatically |
| `nonce` | `string` | | For the `<style>` fallback (see CSP) |
| `ui` | `boolean` | `true` | `false` skips the element entirely (headless) |
| `container` | `Element` | `document.body` | Where to mount |
| `onOpen`, `onClose`, `onSubmit(receipt)`, `onFollowUp(event)`, `onError(error)` | hooks | | Errors thrown or rejected by a hook are swallowed |

**Widget instance:** `open(options?)`, `close()`, `toggle()`, `attach(selectorOrElement, options?) → detach`, `setContext`, `identify`/`setUser` (pass `null` to clear), `setFlags`, `setApp`, `destroy()`, plus `controller`, `element`, `config`, and `destroyed`.

**`open` / `attach` options:** `{ kind?, prefill?, context?, subject? }`. `prefill` only fills an empty draft, so it never overwrites anything the user typed. `context` and `subject` apply to that one report only. A string `subject` is shorthand for `{ type: 'feature', name }`.

**Declarative triggers:** any element with `data-mlp-feedback` opens the widget, including elements added later, because the widget uses event delegation. Optional attributes are `data-mlp-kind`, `data-mlp-subject`, and `data-mlp-prefill`.

```html
<button data-mlp-feedback data-mlp-kind="idea" data-mlp-subject="Reports">Suggest a feature</button>
```

## Theming

By default the widget follows your page:

- **Font:** `font-family` is inherited from the page.
- **Scheme:** taken from the page background, then `color-scheme`, then `prefers-color-scheme`. It updates when `class`, `style`, `data-theme`, or `data-mode` changes on `<html>`/`<body>`, and again each time the panel opens.
- **Accent:** your `accent-color`, otherwise a neutral ink (near-black in light mode, near-white in dark mode).

To change the look, set variables anywhere above the element (`:root` works) or pass `theme`:

| Variable | `theme` key | Default (light / dark) |
|---|---|---|
| `--mlp-accent` | `accent` | host `accent-color` or the text color |
| `--mlp-accent-contrast` | `accentContrast` | surface |
| `--mlp-surface` | `surface` | `#fff` / `#1c1d21` |
| `--mlp-text` | `text` | `#1b1c20` / `#ececef` |
| `--mlp-muted` | `muted` | `#5f616a` / `#a3a4ad` (AA on surface) |
| `--mlp-border` | `border` | 14% ink |
| `--mlp-success`, `--mlp-danger` | `success`, `danger` | green / red per scheme |
| `--mlp-radius` | `radius` | `12px` (controls use ⅔ of it) |
| `--mlp-font-family` | `fontFamily` | inherited |
| `--mlp-font-size` | `fontSize` | `14px` |
| `--mlp-shadow` | `shadow` | soft two-layer shadow |
| `--mlp-z-index` | `zIndex` | `2147483000` (the panel uses the top layer anyway) |
| `--mlp-space` | `space` | `4px` base unit. Paddings and gaps are multiples of it |
| `--mlp-offset` | `offset` | `16px` distance from the viewport edge |
| n/a | `scheme` | `'auto'`, `'light'`, or `'dark'` |

```css
:root { --mlp-accent: #5b4cff; --mlp-radius: 8px; }
mlp-feedback::part(trigger) { inset-block-end: 80px; }   /* clear a cookie bar */
mlp-feedback::part(submit)  { text-transform: uppercase; }
```

**Parts:** `root`, `trigger`, `panel`, `title`, `close`, `form`, `chips`, `chip`, `textarea`, `footer`, `submit` (also `answer-submit`, `done`), `error`, `follow-up`, `saved`, `question`, `options`, `option`, `answer`, `skip`, `done`, `notice`, `badge`. Chips expose `[aria-pressed]` and `[data-kind]`. Options expose `[data-id]`.

## Context injection

The widget merges context in this order, and later sources win: **`init` < setters (`setContext`/`identify`/`setFlags`/`setApp`) < `getContext()` < `open({ context })`**. Objects merge one level deep (`user.traits` merges two levels deep). Automatic `page` context is the lowest layer of `getContext()`, so your own `page` fields override it.

```js
mlp('init', {
  key: 'mlp_pk_…',
  user: { id: 'usr_8f3a2c', tier: 'pro', traits: { seats: 4 } },  // opaque ids only
  flags: { checkout_v2: true },
  app: { version: '2.4.1', env: 'production' },
  getContext: () => ({
    context: { route: router.current, cart_items: cart.length, plan: billing.plan },
  }),
});
mlp('setFlags', { pricing_page: experiments.variant('pricing') });
mlp('open', { kind: 'broken', context: { step: 'payment' }, subject: 'Checkout' });
```

The widget coerces values instead of rejecting them, so one bad context value can't lose a report. Nested objects are JSON-stringified, strings are capped at 500 characters, and at most 32 keys are kept. Functions and `undefined` are dropped.

## Headless

```ts
import { createFeedback } from '@mostlovedproduct/web';

const fb = createFeedback({ key: 'mlp_pk_…', followUps: 1 });
fb.subscribe((s) => render(s));   // s.status: idle | open | submitting | accepted | follow_up | done | error
fb.open({ kind: 'idea' });
fb.setField('text', 'Let me export to CSV');
await fb.submit();                 // never rejects
if (fb.getState().status === 'follow_up') await fb.answerFollowUp({ optionId: 'blocked' }); // or { text }, or fb.skipFollowUp()
```

- **The draft is never lost.** `error` keeps the draft, so calling `submit()` again retries. Closing during composing keeps the draft. Closing after the report is saved resets.
- **Retries never double-file.** After a transient failure (`network`, `timeout`, `unavailable`, `rate_limited`), calling `submit()` again with the draft unchanged resends the identical report (same id), so a send that actually arrived comes back as a duplicate and counts as success. If the draft was edited in between, it is filed as a new report.
- **Splitting text.** The widget splits the text into `summary` and `details`. The first sentence, or the first line, becomes `summary` (at most 300 characters, cut at a word boundary). The full text goes in `details` when it is longer than the summary.
- **Follow-ups.** The state exposes them as `followUp: { id, question, input, options?, placeholder?, index }`. They are already localized through `strings.followUps[id]`.
- **When to call `open()`.** Call it before `submit()`. A submit made while closed still files the report but skips follow-ups.

You can also mount the stock element on your own controller with `defineElement()`, then `document.createElement('mlp-feedback').setup(controller, options)`.

## Accessibility

- **Dialog:** a non-modal `<dialog>` labelled by its title. The host page stays interactive and scrollable while the widget is open.
- **Keyboard and focus:** Tab moves between the widget and the page. Escape closes the widget from inside the panel and returns focus to the opener or trigger. Cmd/Ctrl+Enter sends.
- **Labels and announcements:** every control is labelled. Errors use `role="alert"`. "Sending…", "Saved", and "Thanks" are announced through a polite live region.
- **Kind chips:** buttons with `aria-pressed`. The send button uses `aria-disabled` rather than `disabled` while sending, so focus doesn't drop.
- **Visual:** `:focus-visible` rings use the accent color. Default colors meet AA in both schemes. Motion respects `prefers-reduced-motion`, and `forced-colors` is supported.
- **Layout:** logical properties throughout, so RTL pages get a mirrored layout. Below 520px wide the panel becomes a bottom sheet, and inputs use 16px text to avoid iOS zoom.

## CSP

- **Scripts:** no `eval`, no inline handlers, no inline scripts required. The queue stub can live in your own bundle.
- **Styles:** the widget uses constructable stylesheets (`adoptedStyleSheets`), which `style-src` does not govern. Theme variables are set through CSSOM (`style.setProperty`), which CSP allows.
- **Fallback:** only browsers without constructable stylesheets get a `<style>` element. If your policy uses nonces, pass `nonce` and the widget adds it to that element.
- **Trusted Types:** the widget builds its DOM with `createElement`, so it works under Trusted Types. The one exception is a custom `trigger.icon` string, which needs `innerHTML`. If Trusted Types blocks it, the widget keeps the default icon.
- **Policy you need:** `connect-src` must allow the intake endpoint.

## Privacy

- **Nothing before filing:** no cookies, `localStorage`, beacons, or fingerprinting. Nothing is sent until someone files.
- **Page context:** URL without query string or fragment, path, title, referrer (always without its query or fragment), locale, and viewport size. Turn it off with `page: false`.
- **`source.client`:** a coarse browser family such as `chrome`, with no version.
- **Your identifiers:** whatever you pass as user, flags, or context. Use opaque ids.
- **Email:** the widget never asks for an email address.
- **Redaction:** runs in the browser before sending (tokens, keys, card numbers…) and again on the server.

## Development

```sh
npm run build      # ESM + d.ts (dist/index.*) and the IIFE dist/mlp.js (+ map)
npm test           # vitest + happy-dom
npm run typecheck
npm run size       # gzip/brotli size of dist/mlp.js with a per-module breakdown
npm run demo       # http://localhost:4400 (posts to http://localhost:8787); add ?mock=1 to work offline
```

By default the demo posts to an intake at `http://localhost:8787`. Add `?mock=1` to work without one, or `?endpoint=<intake URL>&key=<publishable key>` to send to a real product. A publishable key only works from the origins it allows, so add `http://localhost:4400` to it.
