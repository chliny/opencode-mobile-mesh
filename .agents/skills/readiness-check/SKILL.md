---
name: readiness-check
description: Verify OpenCode Mobile is PRODUCTION READY end-to-end. Triggers like "check production readiness", "are we ready to ship", "readiness check", "is opencode-mobile live", "is the app published". Runs a script that confirms both Google Play and F-Droid (self-hosted + mainline) are PUBLISHED and the app/site are healthy.
category: release
version: 1.1.0
---

# OpenCode Mobile — Readiness Check

Single command that answers one question: **is OpenCode Mobile production ready?**

"Production ready" has a precise definition of done:

- The app is **PUBLISHED on Google Play** (`cc.agentlabs.opencode`).
- The app is **PUBLISHED on F-Droid mainline** (`f-droid.org/packages/cc.agentlabs.opencode`).
- The **self-hosted F-Droid repo** serves the latest APK.
- The **app builds and tests green** (typecheck + node:test suite).
- The **web presence** (landing, guide, privacy, sitemap, robots, OG image, QR codes) is all live.

If, and only if, every REQUIRED gate passes, the verdict is `PRODUCTION READY`.

## How to run

From the repo root (the check is a TypeScript file run directly by Node — no build, no deps):

```bash
node .agents/skills/readiness-check/check.ts
```

Fast mode — skip the slow npm app-health gates, only check live published-status URLs:

```bash
node .agents/skills/readiness-check/check.ts --quick
```

Requires **Node ≥ 23.6** (this repo runs Node 26), which executes `.ts` files natively via
type-stripping — no transpile or extra dependencies. HTTP checks use the built-in `fetch`
and JSON parsing is native, so there is no `curl`/`jq`/`python3` dependency. `git` is used to
locate the repo root and `gh` for the optional repo-discoverability gate; both degrade
gracefully if missing (gate reports `WARN`/`UNKNOWN`, never crashes).

## What it checks

Gates are grouped. REQUIRED gates decide the verdict; nice-to-have gates only WARN.

- **A. App health** (REQUIRED, skipped with `--quick`)
  - `npm run typecheck` exits clean.
  - `npm test` passes.
- **B. GitHub Releases LIVE** (REQUIRED)
  - `https://github.com/chliny/opencode-mobile-zerotier/releases/latest` returns 200/3xx.
- **F. Repo discoverability** (nice-to-have, WARN only)
  - `gh repo view chliny/opencode-mobile-zerotier --json repositoryTopics,homepageUrl` shows topics + homepage. Skipped gracefully if `gh` is missing/unauthenticated.

## Interpreting results

Each gate prints one line: `[PASS] / [FAIL] / [WARN] / [UNKNOWN] <gate> — <detail>`.

The summary at the bottom is the answer:

- **`PRODUCTION READY ✅`** — every REQUIRED gate passed. The app and GitHub release channel are healthy. Script exits `0`.
- **`NOT READY ❌`** — at least one REQUIRED gate failed; the failing gates are listed. Script exits `1`.

The supported release channel for this repository is GitHub Releases with signed APKs.

`UNKNOWN` means a network/tool problem prevented the check (e.g. offline). UNKNOWN on a
REQUIRED gate is treated as not-passing, so the verdict will be NOT READY.
