---
name: auto-enhance
description: Audits an existing Playwright + TypeScript automation project, identifies architectural weak spots (POM duplication, env scatter, missing API/E2E separation, brittle locators, missing fixtures, weak config), and produces a prioritized remediation plan. Spawns parallel `automation-auditor` agents across six lenses, synthesizes findings, writes `automation/audit-<timestamp>.md`, and — only on explicit user approval — delegates fixes to the `playwright-architect` agent. Use when the user invokes `/auto-enhance` or asks to "review / improve the Playwright project architecture".
---

# auto-enhance

You are the **architecture reviewer** for an existing Playwright + TypeScript test project. Your job is to tell the team exactly where the project's architecture is hurting them and what to do about it — ordered by impact, anchored in code.

You coordinate. You spawn `automation-auditor` agents in parallel — one per lens — synthesize their findings, and write a single remediation plan to disk. You do NOT read the project files yourself to make findings (that's the auditors' job). You do NOT apply fixes by default — fixes happen only after the user reviews the plan and approves.

## What "enhance" means here

The skill exists because a Playwright project that started clean rarely stays clean. Tests proliferate, env vars get pasted everywhere, POMs grow duplicated helpers, API tests get bolted into the E2E project, and someone adds `waitForTimeout(3000)` because "we'll come back to it". `auto-enhance` finds those drifts and proposes the smallest set of surgical fixes that re-anchor the architecture.

**Six lenses, each delegated to a parallel `automation-auditor`:**

1. `config-and-projects` — `playwright.config.ts`, project matrix, parallelism, retries, reporters, traces, timeouts, baseURL handling
2. `pom-and-locators` — base POM presence and reuse, locator hygiene, duplication across pages, selector brittleness
3. `fixtures-and-auth` — fixture centralization, auth strategy (storageState vs. per-test), test data factories, teardown
4. `env-management` — `.env.*` strategy, scattered `process.env`, validation at startup, multi-env (`TEST_ENV`), CI secrets handling
5. `api-vs-e2e-separation` — API tests exist? separate Playwright project? shared client layer? typed contracts? API-bootstrap for E2E?
6. `test-quality-and-antipatterns` — `waitForTimeout`, non-web-first assertions, `console.log`, hard-coded creds/URLs, missing `test.step`, missing tags, ordering, real PII, skipped tests

## Inputs (confirm before doing anything)

1. **Target test project path** — resolved in order:
   1. Skill argument (`/auto-enhance --target=<abs path>`)
   2. `$TEST_PROJECT_PATH` env var
   3. `automation/` in this workspace
2. **Optional product facts** — read `.claude/project-facts.md` if it exists; pass relevant snippets (auth flow, baseURL, data-testid convention) to the auditors so they can distinguish "violates the architecture" from "deliberate trade-off".
3. **Mode** — `audit-only` (default) or `audit-and-apply`. In auto mode, default to `audit-only` even if the user is operating autonomously — fixes touch shared code and the user should sign off on the plan first.

## Pre-flight (you, deterministic)

Before spawning auditors, run these checks. They're cheap and they prevent six agents from producing six "this isn't a Playwright project" reports.

1. `ls -la <target>` — confirm it exists.
2. Read `<target>/package.json` — confirm `@playwright/test` is in `devDependencies` (or `dependencies`). If absent, **stop** and route the user to `/auto-setup`.
3. Confirm `playwright.config.ts` (or `.js`) exists. If only `.js`, note it — `pom-and-locators` and `test-quality` lenses will need to look at JS too.
4. Get a rough size: `git -C <target> ls-files | wc -l` (or `find <target> -type f -name '*.ts' | wc -l`). If > 2000 test files, warn the user the audit will be slower and ask if they want to scope it (e.g. `--scope=tests/orders/`). In auto mode, proceed with full scope and note the runtime caveat.
5. Glob for `.env*` files (without reading values) — pass the list of filenames to the `env-management` auditor.

Capture as a **shared baseline** all auditors will receive:

```
Target: <abs path>
Playwright version: <from package.json>
Config file: <playwright.config.ts | .js>
Test file count: <n .spec.ts files>
.env files present: <list of filenames, values NOT read>
Product facts available: yes | no  (path)
```

## Method

### 1. Parallel recon (one message, six agents)

Spawn six `automation-auditor` agents in a **single batch**. Each gets the shared baseline and one lens. Don't serialize — they're independent.

Prompt template:

```
You are running as the `automation-auditor` agent.

Read your persona at: .claude/agents/automation-auditor.md
Follow it precisely.

## Lens
<one of: config-and-projects | pom-and-locators | fixtures-and-auth | env-management | api-vs-e2e-separation | test-quality-and-antipatterns>

## Project root
<abs path>

## Shared baseline
- Playwright version: <...>
- Config file: <playwright.config.ts | .js>
- Test file count: <n>
- .env files present: <names only>
- Product facts: <path or "not available">

## Product context (excerpted from project-facts.md, if available)
- APP_BASE_URL (dev): <...>
- API_BASE_URL (dev): <...>
- Auth flow: <...>
- data-testid in use: <yes/no, attribute name>

Return the standard output block. Do not modify any files.
```

Wait for all six. If any returns `BLOCKED`, re-prompt it once with the missing input. If still blocked, record the lens as `incomplete` and continue — five lenses is still actionable.

### 2. Synthesis (you)

Merge the six reports into a single plan. Rules:

1. **Deduplicate.** The same anti-pattern may surface in multiple lenses (e.g. `waitForTimeout` shows up in both `test-quality` and `pom-and-locators`). Keep it once, under the lens that owns the fix.
2. **Rank globally.** Reorder findings across lenses by severity (`blocker` > `major` > `minor` > `nit`) and then by blast radius (touches 40 files > touches 1 file). The top of the list is "what to fix first to feel a difference".
3. **Cluster systemic problems into themes.** If five findings all point at "no central fixture module", that's one theme, not five tickets.
4. **Resolve conflicts.** If `config-and-projects` says `retries: 2` is fine and `test-quality` says retries mask flake, record both observations — pick a side only with code-anchored justification, otherwise mark `conflict — needs human call`.
5. **Distinguish architecture from quality.** Architecture themes get a "refactor" plan (multi-file change); quality findings get a "cleanup" plan (per-file). The two have very different effort profiles.

### 3. Write the remediation plan

Write to:

```
<target>/audit-<YYYY-MM-DD-HHmm>.md
```

(Inside the test project, not the QA-standard workspace — the plan lives with the code it's about. Use ISO timestamp; never overwrite a prior audit.)

Exact structure:

```markdown
# Playwright Architecture Audit — <project name>

> Generated by `/auto-enhance` on <YYYY-MM-DD HH:mm>
> Project root: `<abs path>`  •  Playwright <version>  •  <n> test files

## Executive summary

<3–6 sentences. Lead with the single most consequential finding. State the overall health verdict in one line: `Architecture health: solid | drifting | weak | needs-rebuild`. Drifting/weak/needs-rebuild require a brief explanation.>

**Top three things to fix first:**
1. <theme + one-line why>
2. <theme + one-line why>
3. <theme + one-line why>

## Findings — ranked globally

| # | Severity | Lens | Finding | Anchor | Effort | Risk |
|---|---|---|---|---|---|---|
| 1 | blocker | env-management | `process.env.X` read in 47 distinct files, no validation | `tests/**` | M | low |
| 2 | major | pom-and-locators | No `BasePage` — `goto + waitForLoadState` duplicated across 14 pages | `pages/*.page.ts` | M | low |
| 3 | major | api-vs-e2e-separation | API tests live in the E2E project; boot a Chromium they never use | `tests/api/` | S | low |
| ... |

## Themes (the real refactors)

### Theme 1 — Centralize env access and validate at startup
- **What's happening now:** <one paragraph, file:line anchors>
- **Why it hurts:** <runtime crashes mid-suite, no preflight, no env switching>
- **Target end state:** `env/load.ts` + `env/schema.ts` (zod), `TEST_ENV` selects file, single import everywhere
- **Files touched:** ~<n>
- **Effort:** <S/M/L>, **Risk:** <low/med/high>
- **Acceptance:** grep `process.env\.` across `tests/`, `pages/`, `fixtures/` returns only matches inside `env/`

### Theme 2 — Introduce `BasePage` and lift duplication
...

### Theme 3 — Split API tests into their own Playwright project
...

## Per-lens detail

### Config and projects
<paste auditor findings verbatim, deduplicated>

### POM and locators
...

### Fixtures and auth
...

### Env management
...

### API vs E2E separation
...

### Test quality and anti-patterns
...

## Quick wins (low effort, immediate value)
- [minor] Remove the 6 remaining `page.waitForTimeout(...)` calls — `<files>`
- [minor] Replace 3 `expect(await x.isVisible()).toBe(true)` with web-first assertions — `<files>`
- [minor] Add `forbidOnly: !!process.env.CI` to config — one-line change

## Open questions for the team
- <question> — `<file:line>` — <context>
- (or "None")

## Conflicts surfaced by auditors
- <conflict if any — record both sides, no silent winner>
- (or "None")

## Suggested execution order

1. **Quick wins** — half a day, immediately lifts trustworthiness of the suite.
2. **Theme N** — start with the highest-rank theme; it usually unblocks others.
3. **Theme M** — ...
4. **Lower-severity cleanup** — leave for backlog; not worth a focused sprint.

## How to apply

Re-run with `/auto-enhance --apply` after reviewing this plan. The skill will spawn the `playwright-architect` agent in `enhance` mode and apply only the themes you've checked off below (edit the file before re-running):

- [ ] Theme 1 — Centralize env access
- [ ] Theme 2 — Introduce BasePage
- [ ] Theme 3 — Split API project
- [ ] Quick wins
```

### 4. Chat report

Keep this short — the detail is on disk.

```markdown
## Architecture Audit Complete

**Project:** `<abs path>`  •  Playwright <version>  •  <n> test files
**Lenses audited:** 6 (<list any that came back `incomplete`>)
**Plan:** `<target>/audit-<YYYY-MM-DD-HHmm>.md`

**Architecture health:** <solid | drifting | weak | needs-rebuild>

### Top three to fix first
1. <theme>
2. <theme>
3. <theme>

### Findings by severity
- blocker: <n>
- major: <n>
- minor: <n>
- nit: <n>

### Quick wins available
<n> findings, total effort < half a day. See the "Quick wins" section in the plan.

### Conflicts to resolve with the team
- <one-liner>  (or "None")

### Next step
Review `<plan path>`, check the boxes under "How to apply", then re-run:
`/auto-enhance --apply`
```

### 5. Apply mode (only when explicitly requested)

If the user invoked `/auto-enhance --apply` (or said "apply the plan"):

1. Read the plan file. Verify checkboxes — only act on themes/quick-wins the user checked.
2. For each checked theme, build a **files-to-touch list** from the theme's "Files touched" section.
3. Spawn ONE `playwright-architect` agent in `enhance` mode with:
   - The checked themes' target end states (verbatim from the plan)
   - The combined files-to-touch list
   - The acceptance criteria for each theme
4. When the architect returns, verify:
   - `npx tsc --noEmit` — pass
   - `npx playwright test --list` — still enumerates the same number of tests (no test lost to the refactor)
   - Acceptance grep for each theme — passes
5. If any verification fails, **do not commit / push / claim success**. Surface the failure and stop.
6. Write a follow-up `audit-<timestamp>-applied.md` summarizing what changed.

If the user has not invoked `--apply`, **do not apply anything**, even if the audit is grim. The team owns the call.

## Hard rules

- **Coordinate, don't read.** The six auditors do the file reading. You only do pre-flight (file exists, package.json contains `@playwright/test`).
- **Six lenses, in parallel, one batch.** Do not serialize for "context efficiency" — the auditors are independent and parallel is faster.
- **Audit-only by default.** Never modify files without explicit `--apply` or "apply the plan".
- **Plan lives with the code.** Write to `<target>/audit-<ts>.md`, not the QA-standard workspace. Never overwrite a prior audit.
- **Code-anchored or omitted.** A finding without `file:line` is a vibe; cut it.
- **Conflicts stay visible.** If two auditors disagree, record both. No silent winner.
- **No framework migrations.** The team is on Playwright + TS by standard. "Switch to Cypress" is never a finding.
- **No portal posting.** Don't open issues, push commits, post to Slack. Disk + chat only.
- **`needs-rebuild` is a real verdict.** If the project is so far gone that surgical fixes won't help, say so — recommend a parallel rebuild via `/auto-setup` next to the existing project, with a phased migration plan. Don't bury the verdict in nicety.
