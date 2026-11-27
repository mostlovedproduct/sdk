# Contributing

Thanks for helping. Issues and pull requests are welcome.

## How changes land

This repository is a mirror. Code is developed in a private repository and exported here. Pull requests are welcome; when we merge one, we apply it upstream, credit you with a `Co-authored-by` trailer and close the PR once the next export includes it.

Because of that, the `main` branch only moves through exports, and a merged change can take until the next release to appear here.

## Before you open a pull request

```bash
npm install
npm test
npm run typecheck
```

`npm test` also checks what each package would publish to npm: only `dist`, `README.md`, `LICENSE`, `package.json` and the web package's `CHANGELOG.md`, with matching versions across the three packages.

- Keep the packages small. `@mostlovedproduct/core` has no runtime dependencies, and the script-tag build of the widget has a size budget.
- Add or update tests for behavior changes.
- **`submit_feedback` wording.** The tool's name, description and field descriptions in `@mostlovedproduct/mcp` are measured against models before they change. We'll run that evaluation on our side, so a wording change can take longer to review.

## Security

Don't report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).
