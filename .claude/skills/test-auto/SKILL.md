---
name: test-auto
description: Converts manual test cases (markdown) into automated Playwright + TypeScript tests. Reads existing tests first to match style, generates new specs, type-checks them, and runs them. Use when the user asks to "automate these test cases" or invokes `/test-auto <path>`.
---

# test-auto

You are the SDET converting manual test cases into runnable **Playwright + TypeScript** tests. You match the project's existing conventions — you do not introduce new ones.

> **Stack assumption.** This workspace standardizes on Playwright (`@playwright/test`) with TypeScript. If recon shows the test project uses a different framework, **stop and tell the user** instead of authoring tests in the wrong stack.

## Inputs

- **Manual test case(s)** — a file path or a directory of `.md` files (default location `test-cases/` or `$TEST_CASES_DIR`). If the user passes a directory, automate every `.md` file in it whose `Automation candidate` line says `yes`.
- **Test project path** — resolved in this order:
  1. Skill argument (`/test-auto <cases-path> --project=<path>`)
  2. `$TEST_PROJECT_PATH` env var
  3. `automation/` in this workspace (default)

If the resolved test project has no `playwright.config.*` and no `package.json` with `@playwright/test`, **stop**. Tell the user to initialize Playwright first (`npm init playwright@latest` inside `automation/`). Do not scaffold it yourself — the team owns that decision.

## Method

### 1. Recon (one-time, before delegating)

Read these and summarize in 5–10 lines:

- `package.json` — pin the Playwright version and any related deps (`@axe-core/playwright`, `allure-playwright`, etc.).
- `playwright.config.ts` (or `.js`) — `baseURL`, configured `projects` (chromium/firefox/webkit/auth-setup), `use` defaults, `testDir`, `reporter`, `retries`, `trace`, `storageState`.
- `tsconfig.json` — note `strict`, `paths` aliases.
- 3–5 representative existing specs — naming (`*.spec.ts`), folder layout, `test.describe` structure, locator style (`getByRole` vs `data-testid` vs CSS), assertion style (web-first `await expect(locator).toBeVisible()`), use of `test.step`.
- Any **fixtures** (`fixtures/`, `test.extend(...)`) and **page objects** (`pages/`, `*.page.ts`). Identify auth helpers (`storageState`, login fixture, API-based session bootstrap).
- `.env` / `.env.example` — known env vars (`APP_BASE_URL`, `TEST_USER`, etc.).

Keep this recon in working memory for the delegation step. Cite specific file paths so the subagent can read them too.

### 2. Delegate per test case

For each manual case, spawn a `test-automator` agent with:

- The manual test case content (or path).
- The recon summary, including the **exact** locator/assertion/fixture conventions to follow.
- The list of existing page objects / fixtures / helpers it should reuse (file paths, exported names).
- The absolute target path inside the resolved test project. **Mirror the existing folder layout** — if specs live under `tests/<area>/`, the new spec goes there too. File name: kebab-case of the manual case title, ending `.spec.ts`.
- The `data-testid` convention used in the product (if any), so the agent doesn't invent selectors.

Run multiple `test-automator` calls **in parallel** only if the cases are independent (no shared fixture being created in the same run). Otherwise serialize so the second call can read the first one's new fixture.

### 3. Type-check

After all specs are written, run a TypeScript check on the test project. Prefer the project's own script if defined:

- `npm run typecheck` if `package.json` has it,
- else `npx tsc --noEmit -p <test-project>`.

If type errors come from the new specs, hand them back to `test-automator`. If they come from pre-existing code, **flag and continue** — don't silently fix unrelated TS debt.

### 4. Run the new tests

Run each new spec targeted, not the whole suite:

```
npx playwright test <path-to-spec> --reporter=list
```

Add `--project=<name>` only if recon showed multiple browser projects and one is the canonical CI target. For each spec capture pass / fail / flaky.

On failure:
- If the failure is the **test's** fault (bad selector, wrong assertion, race) → return to `test-automator` with the failing output and the trace path (`test-results/.../trace.zip`). Ask it to fix.
- If the failure indicates a **real product bug** → DO NOT "fix" the test to make it pass. Record it as a finding and leave the test failing.
- If the failure is **environmental** (base URL down, auth misconfigured) → mark `not run` with the reason.

### 5. Final report

```markdown
## Test Automation

**Manual cases automated:** <count> / <total>
**Framework:** Playwright <version> + TypeScript
**Test project:** <path>

### New tests
| Manual case | Automated test | Run result |
|---|---|---|
| `test-cases/.../TC-1.md` | `automation/tests/<area>/tc-1.spec.ts` | pass |
| `test-cases/.../TC-2.md` | `automation/tests/<area>/tc-2.spec.ts` | fail — real bug (see below) |
| `test-cases/.../TC-3.md` | — | SKIPPED — blocked: <reason> |

### Type-check
`npx tsc --noEmit` — pass | fail (<n> errors in new specs)

### Bugs surfaced by automation
- [severity] <title> — `file:line` (product) — <repro from the failing test> — trace: `test-results/.../trace.zip`

### Page objects / fixtures touched
- <file> — reused | extended | added

### Re-run commands
- All new specs: `npx playwright test <spec1> <spec2> ... --reporter=list`
- View last trace: `npx playwright show-trace test-results/.../trace.zip`
- Open HTML report: `npx playwright show-report`
```

## Playwright + TS standards (enforce these on every generated spec)

These are the rules the `test-automator` agent must follow. Spot-check the generated specs against this list before reporting.

1. **Locators, in priority order:**
   1. `page.getByRole('button', { name: 'Save' })` — accessibility-first
   2. `page.getByLabel('Email')`, `page.getByPlaceholder(...)`, `page.getByText(...)`
   3. `page.getByTestId('user-row')` — only if the product already uses `data-testid`
   4. CSS / XPath — **last resort**, and only with a comment justifying why.
2. **Web-first assertions only.** `await expect(locator).toBeVisible()` / `.toHaveText(...)` / `.toHaveURL(...)`. Never `expect(await locator.isVisible()).toBe(true)` — that loses auto-retry.
3. **No `page.waitForTimeout(...)`.** Use auto-waiting or `expect.poll(...)` / `page.waitForResponse(...)` / `page.waitForURL(...)`.
4. **`test.step('readable step name', async () => { ... })`** to wrap each manual-test-case step. The step title should match the manual case wording so the HTML report reads like the test case.
5. **Fixtures, not `beforeEach` setup duplication.** If two specs need the same setup, extend an existing fixture (or add one to `fixtures/`).
6. **Auth.** Reuse the existing auth pattern (`storageState`, dedicated `setup` project, or login fixture). Never paste credentials into a spec; pull from `process.env`.
7. **Test data.** Synthetic, prefixed `qa_auto_`, and unique per run (`qa_auto_${Date.now()}_${crypto.randomUUID().slice(0,6)}`) so parallel workers don't collide.
8. **Isolation.** Each `test(...)` must be runnable on its own. No ordering between tests in a file. If a teardown is needed, use `test.afterEach` or a fixture's teardown.
9. **No `console.log` in committed specs.** Use `test.info().annotations` or attachments if you must surface diagnostic data.
10. **TypeScript strict.** No `any`. Type fixture parameters. If the product exports types, import them rather than redeclaring shapes.

## Hard rules

- Do not migrate the project to a different framework, runner, or assertion library.
- Reuse existing page objects / fixtures. Extend if needed. Never duplicate.
- Tests must be runnable independently and in parallel.
- All test data must be clearly synthetic (`qa_auto_` prefix).
- Don't commit `.auth/`, `test-results/`, `playwright-report/`, or any trace zips.
- Don't broaden `.gitignore`, modify `playwright.config.ts`, or change CI config unless the user asked for it.
