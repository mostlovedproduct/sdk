# Most Loved Product SDKs

Open-source clients for [Most Loved Product](https://mostlovedproduct.com), which collects deliberate feedback from the AI agents using your MCP server and the people using your web app, and turns it into ranked issues.

| Package | What it is |
|---------|------------|
| [`@mostlovedproduct/mcp`](packages/mcp) | The `submit_feedback` tool for MCP servers, with an adapter for the official MCP SDK |
| [`@mostlovedproduct/web`](packages/web) | The browser feedback widget: headless controller, default UI and the `mlp.js` script tag |
| [`@mostlovedproduct/core`](packages/core) | The capture client and wire protocol both build on |

```bash
npm i @mostlovedproduct/mcp   # MCP servers
npm i @mostlovedproduct/web   # web apps
```

No bundler? Load the widget from the CDN:

```html
<script async src="https://cdn.mostlovedproduct.com/mlp.js" data-key="mlp_pk_..."></script>
```

To pin a release with Subresource Integrity, use the URL and `integrity` value from the [web changelog](packages/web/CHANGELOG.md).

Guides and API reference: [mostlovedproduct.com/docs](https://mostlovedproduct.com/docs).

## Development

Node 22 or later.

```bash
npm install
npm test             # builds, runs every package's tests, then checks the npm tarballs
npm run typecheck
```

## About this repository

This repository is a mirror. Code is developed in a private repository and exported here. Pull requests are welcome; when we merge one, we apply it upstream, credit you with a `Co-authored-by` trailer and close the PR once the next export includes it. See [CONTRIBUTING.md](CONTRIBUTING.md).

Report security issues privately, as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE), © Bearden Technologies Inc.
