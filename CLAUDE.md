# CLAUDE.md — QA Standard template

Project-level guidance for Claude Code running inside this template. Read this before invoking any skill.

## Role of this workspace

This is an **SDET workspace**, not the product codebase. Skills here reason *about* a product under test. The product source may be:
- In a sibling directory (set `PROJECT_UNDER_TEST` env var, or pass the path as a skill argument), or
- The current directory (if you copied the template into the product repo).

Always confirm the product path before reading code. Never assume `./src` is the product.

## First run — bind this template to your product

Before invoking any other skill, run `/bind-project <absolute-path-to-product>` once. It is the **adapter** that converts this template into a workspace bound to one specific product:

- Spawns parallel recon agents (`project-mapper`) to map the product's stack, app surface (UI routes + API), test infrastructure, and integrations.
- Writes a canonical fact pack to `.claude/project-facts.md` that every downstream skill relies on for real selectors, endpoints, base URLs, and conventions.
- Appends a `## Project-specific context` block to this `CLAUDE.md` (between auto-managed markers — see end of file after the first run).
- Fills the non-secret `env` defaults in `.claude/settings.json` (`PROJECT_UNDER_TEST`, `APP_BASE_URL`, `API_BASE_URL`, `TEST_PROJECT_PATH` where detected). Secret-shaped values (`*_PAT`, `*_TOKEN`, passwords) are surfaced in chat for the user to add to `.env` manually — the skill never writes them.

Re-run `/bind-project` whenever the product changes meaningfully (new framework, new test project, new portal). Previous facts are archived with a timestamp; the canonical files are merged idempotently.

If `/bind-project` has not been run, other skills will still work but they'll be operating against template defaults and will be noisier (more `unknown` and `SKIPPED` markers).

## House rules

1. **Skills coordinate, agents execute.** A skill must not directly Read/Grep the product to produce findings — it spawns subagents and synthesizes their structured reports. This keeps each agent's context focused and the main thread clean. (Pre-flight detection — confirming a manifest exists, listing top-level files — is the one exception and is allowed.)
2. **Run agents in parallel** when their work is independent. The default mental model: one Skill turn = one batch of parallel Agent calls.
3. **No false positives.** A bug, security issue, or coverage gap must be reproducible or have a clear code-anchor (file + line). If unsure, file it as a *question* in `questions/`, not as a bug.
4. **Verdicts are blunt.** `test-feature` produces a binary `READY_TO_CLOSE: yes/no` line. If `no`, the report must list the specific blockers.
5. **Outputs go to disk.** Skills must write their final artifact to the project (test cases, automated tests, HTML report, questions) — not just summarize in chat. The chat summary points to the file path.
6. **Naming and timestamps.** Output files use ISO timestamps (`YYYY-MM-DD-HHmm`) and kebab-case slugs. Never overwrite a previous run silently.
7. **Read the fact pack first.** If `.claude/project-facts.md` exists (created by `/bind-project`), skills should read it before doing recon — it already has the answers about stack, selectors, auth, routes, and CI. Treat it as the canonical product description for this workspace; re-do recon only if a section is marked `unknown` or `conflict`.

## Integrations (configure as needed)

The skills are tool-agnostic. They probe for what's available and adapt:

| Need | Looks for | Env vars |
|---|---|---|
| Pull a PR / user story | MCP server for ADO / Jira / GitHub; falls back to `gh`, `az`, `curl` | `AZDO_PAT`, `AZDO_ORG`, `AZDO_PROJECT`, `JIRA_TOKEN`, `JIRA_BASE_URL`, `GH_TOKEN` |
| Drive a UI | Playwright MCP or Chrome DevTools MCP | `APP_BASE_URL`, `TEST_USER`, `TEST_PASSWORD` |
| Hit an API | REST / OpenAPI MCP, or `curl` | `API_BASE_URL`, `API_TOKEN` |
| Run unit tests | local toolchain (`npm test`, `dotnet test`, `pytest`, …) | — |
| Write automated tests | `automation/` in this workspace (default), or an external test project | `TEST_PROJECT_PATH` (overrides the default) |
| Manual test case storage | local folder, or external system (TestRail, Xray, ADO Test Plans) | `TEST_CASES_DIR` (default `test-cases/`) |

If a required integration is missing, the skill must say so explicitly in its report rather than silently skipping the check.

## Output conventions

- **Bugs** — `[severity] short title — file:line — repro steps — expected vs actual`. Severities: `blocker`, `major`, `minor`, `nit`.
- **Questions** — markdown files in `questions/<topic>.md`, one question per `##` heading, with a `Context:` block citing file + line.
- **Test cases** — markdown in `${TEST_CASES_DIR:-test-cases/}<feature>-<id>.md`, structured as Preconditions / Steps / Expected, ready to feed `test-auto`.
- **Automation** — code files go into `automation/` by default (the SDET-owned test project in this workspace), or into `$TEST_PROJECT_PATH` if set. Match the existing language, framework, folder layout, and conventions of whichever test project is in use. Do not invent a new framework or scatter tests into ad-hoc folders.
- **Security report** — single self-contained HTML file in `security/`, no external assets.

## What NOT to do

- Don't push, commit, or open PRs unless the user explicitly asks.
- Don't post findings to Slack, Jira, ADO, or any chat. Write to disk only.
- Don't run destructive shell commands against a real environment without confirmation (DB resets, deletes, force pushes, etc.).
- Don't invent test data that resembles real PII. Use clearly synthetic values.
