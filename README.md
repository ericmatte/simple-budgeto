# Simple Budgeto

A tiny, no-build web app for reconciling personal transactions from your bank
and credit-card CSV exports. It reads the files in the browser, removes
duplicates across statements, matches Splitwise expenses to the bank line that
paid them, and lays everything out in one table.

![The transactions list, grouped by month, with each row's source logo](docs/screenshots/transactions-light.jpg)

🔗 **Live app:** https://ericmatte.github.io/simple-budgeto/
🔍 **Demo (fake data):** https://ericmatte.github.io/simple-budgeto/?demo

## What it does

- Reads **CIBC**, **Tangerine**, **Wealthsimple** and **Splitwise** exports, plus
  a generic CSV fallback.
- **Deduplicates** across statements, so re-importing an overlapping export does
  not create doubles.
- **Reconciles Splitwise**: pairs an expense with the bank transaction that
  settled it, even a few days apart, and flags the gap when there is one.
- Opens any row to show the **original CSV line** it came from.
- Filters by date range and free text, grouped by month.
- Copies a row as an Excel term: `+amount+N("note")`.
- Light and dark theme, remembered between visits.

## Your data stays in the browser

Everything happens in the page. There is no server, no account and no upload —
the transactions live in memory for the length of the session and are gone on
reload. Only your theme and the date range you picked are kept, in
`localStorage`.

## Run it

Requires Node 22+. No build step, no dependencies at runtime.

```bash
npm install   # dev tooling only (tests, linter, dead-code check)
npm start     # http://localhost:5173
```

A static server is needed because ES modules do not load over `file://`.
`serve.js` is a dependency-free one for exactly that.

## Checks

```bash
npm test        # node:test
npm run lint    # eslint
npm run deadcode  # knip: unused files and dependencies
```

All three run in GitHub Actions on every push and pull request.

## Deployment

Plain static files with no build step, served from the repository root by
GitHub Pages. Everything resolves through relative paths, so it works unchanged
from any sub-path or other static host.

## Tech

Vanilla JavaScript ES modules. No framework, no bundler, no third-party runtime
code.
