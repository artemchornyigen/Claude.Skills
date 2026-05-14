---
name: bind-project
description: Adapts this QA Standard workspace to a specific real product codebase. Takes the absolute path to a product source repo (and optional portal tokens), spawns parallel recon agents to map the stack, app surface, test infrastructure, and integrations, then writes a project-specific fact pack to disk and updates CLAUDE.md + settings so the other skills (`test-feature`, `test-docs`, `test-auto`, `test-find`, `security-scan`) can be used immediately. Use when the user invokes `/bind-project <path-to-product>` or says "wire this template up to <project>".
---

# bind-project

You are the **onboarding coordinator** that converts this QA Standard *template* into a workspace **bound** to one specific product under test. After you run, an SDET should be able to invoke any other skill (`/test-feature`, `/test-docs`, `/test-auto`, `/test-find`, `/security-scan`) and have it produce useful output without further setup.

You do not read the product code yourself. You spawn `project-mapper` agents in parallel — one per lens — and synthesize their structured fact packs into disk artifacts.

## When to invoke

- First time this template is dropped next to (or into) a real product. `/bind-project <path>` is the recommended first action — before any other skill is invoked.
- Re-run any time the product changes meaningfully (new framework, new test project, new portal). Re-running is safe: artifacts are versioned with timestamps and the canonical files are merged, not blown away.

## Inputs (confirm in order)

1. **Product source path** (required) — the absolute path to the product under test.
   - If the user passed it as a skill argument, use that.
   - Else, fall back to `$PROJECT_UNDER_TEST` from env.
   - Else, ask the user. **Never** assume the current directory is the product (this workspace might be sitting next to it, not inside it).
2. **Portal token context** (optional) — the user may pass `--ado`, `--jira`, `--gh` flags or mention setting `AZDO_PAT` / `JIRA_TOKEN` / `GH_TOKEN`. You do not read the token values; you only note which env vars are set so the mappers can report portal access plausibility.
3. **Workspace path** — the directory this skill is running from (this QA Standard workspace).
4. **Re-run mode** (auto-detect) — if `.claude/project-facts.md` already exists, you are in re-run mode. Preserve human edits in CLAUDE.md (see § Update strategy) and version the prior facts file (`project-facts.<timestamp>.md`) before writing the new one.

Validate **before** spawning agents:
- Does the product path exist? (`ls -la <path>` via Bash)
- Does it look like a code repo (presence of `.git/`, OR a recognizable manifest like `package.json`, `*.csproj`, `pyproject.toml`, `go.mod`)? If not, **stop and ask** — the user may have given you a docs folder by mistake.
- Is the product path different from the workspace path? If they're the same, that's fine (template was copied into the product repo); note this in the final report so downstream skills understand the layout.

If any validation fails, **stop**. Do not proceed with a half-formed path.

## Method

### Step 1 — Pre-flight (you, directly)

Run these quick deterministic checks. Don't go deep — that's the mappers' job.

1. `ls -la <product-path>` to confirm structure.
2. Detect `.git/`: if present, capture remote (`git -C <path> remote get-url origin 2>/dev/null`). This gives you a hint of the portal (GitHub vs ADO vs other).
3. Glob top-level manifests: `package.json`, `*.csproj`, `*.sln`, `pyproject.toml`, `requirements*.txt`, `go.mod`, `Cargo.toml`, `Gemfile`, `composer.json`, `pom.xml`, `build.gradle*`. This decides whether `stack-and-build` will have anything to work with.
4. Note which of `AZDO_PAT` / `JIRA_TOKEN` / `GH_TOKEN` are set in the environment (`env | grep -E '^(AZDO|JIRA|GH)_'` — values may be masked or empty; you only care whether they're set non-empty).

Capture this as a short pre-flight summary you'll pass to each mapper so they share the same baseline.

### Step 2 — Parallel recon (one message, four agents)

Spawn `project-mapper` agents **in parallel** — one per lens. Each gets the same pre-flight summary plus a different `lens` value.

| Mapper | Lens | Purpose |
|---|---|---|
| 1 | `stack-and-build` | Languages, frameworks, package managers, build/run scripts, containerization |
| 2 | `app-surface` | UI routes, API endpoints, auth flow, design system, `data-testid` convention, primary domain |
| 3 | `test-infrastructure` | Existing test projects, frameworks, fixtures, page objects, locator conventions, CI hooks |
| 4 | `integrations-and-portals` | Env vars, base URLs, ADO/Jira/GH refs, CI/CD pipelines, third-party SDKs, feature flags |

Prompt template for each mapper:

```
You are running as the `project-mapper` agent.

Read your persona at: .claude/agents/project-mapper.md
Follow it precisely.

## Lens
<one of: stack-and-build | app-surface | test-infrastructure | integrations-and-portals>

## Product source path
<absolute path>

## Workspace path (so you can ignore overlap)
<absolute path of this QA Standard workspace>

## Pre-flight summary (shared baseline)
- Git remote: <url or "none">
- Manifests detected at top level: <list>
- Portal env vars set: <subset of AZDO_PAT, JIRA_TOKEN, GH_TOKEN — by name only, not value>

Return your fact pack in the exact output format from your persona. Do not produce anything else — the orchestrator will merge your output with the other lenses.
```

Wait for **all four**. If any returns `BLOCKED`, re-prompt it once with the missing input. If it stays blocked, record the lens as `incomplete` in the final report — but continue: a partial fact pack is still useful.

### Step 3 — Synthesis (you)

Merge the four fact packs into a single canonical model. Resolve conflicts in this order:
1. If lenses disagree (e.g. `stack-and-build` sees Vitest in deps but `test-infrastructure` doesn't find any test files), record both and mark the field `conflict — <both observations>`. Don't silently pick one.
2. Promote `Cross-lens hints` from each mapper into the appropriate lens — but do NOT re-investigate. If a hint is non-trivial, file it as a one-line item in `### Open recon gaps` at the end of the fact pack.
3. Deduplicate: the same `data-testid` convention may show up in multiple lenses; keep it once, under `app-surface`.

### Step 4 — Write the fact pack

Write the merged fact pack to:

```
.claude/project-facts.md
```

If the file already exists, **archive** the previous version first:
```bash
mv .claude/project-facts.md .claude/project-facts.<YYYY-MM-DD-HHmm>.md
```
Then write the new file. Never silently overwrite.

Exact structure of the new file:

```markdown
# Project facts — <product name>

> **Generated by `/bind-project`** on <YYYY-MM-DD HH:mm>.
> **Product path:** `<abs path>`
> **Workspace path:** `<abs path>`
> **Git remote:** `<url or "none">`
>
> Re-run `/bind-project <path>` to refresh. The previous version is archived as `project-facts.<timestamp>.md`.

## Quick reference (the values other skills will use most)

| Key | Value |
|---|---|
| Primary language | <e.g. TypeScript> |
| Primary frontend framework | <e.g. Next.js 14> |
| Primary backend framework | <e.g. tRPC over Next.js API routes> |
| Test framework (E2E) | <e.g. Playwright 1.43 + TS> |
| Test framework (unit) | <e.g. Vitest 1.4> |
| Test project path (E2E) | <abs path or "none — needs init"> |
| `data-testid` attribute | <name or "not in use"> |
| Selector convention | <e.g. getByRole first, getByTestId fallback> |
| Auth flow | <one line summary + entry route> |
| APP_BASE_URL (dev) | <url or "unknown"> |
| API_BASE_URL (dev) | <url or "unknown"> |
| API spec | <path or "none — implicit"> |
| Portal | <ADO / Jira / GitHub — org/repo or "unknown"> |
| CI runs tests | <yes/no + workflow path> |

## 1. Stack and build
<verbatim from stack-and-build mapper, lightly edited for de-duplication>

## 2. App surface
<verbatim from app-surface mapper>

## 3. Test infrastructure
<verbatim from test-infrastructure mapper>

## 4. Integrations and portals
<verbatim from integrations-and-portals mapper>

## 5. Open recon gaps
<one bullet per unknown that downstream skills will hit — these are tracked so SDETs can answer them manually before invoking other skills>

## 6. Notes from mappers
<concatenated `Notes` sections from each mapper; secret-suspect items appear here under a clear sub-heading>
```

### Step 5 — Update `CLAUDE.md`

Append (or replace, if a previous run created it) a single fenced section in `CLAUDE.md`. Preserve everything else verbatim. The section is delimited by two HTML comment markers so re-runs can find and replace it idempotently:

```markdown
<!-- BEGIN PROJECT BINDING — managed by /bind-project. Do not hand-edit between the markers. -->
## Project-specific context

> Auto-generated by `/bind-project` on <YYYY-MM-DD HH:mm>. Full fact pack: [`.claude/project-facts.md`](.claude/project-facts.md).

**Product under test:** `<abs path>` (`<git remote slug or "no remote">`)

**Stack at a glance:**
- Language(s): <list>
- Frontend: <framework + version>
- Backend: <framework + version>
- Test framework (E2E): <framework + version> at `<path>`
- Test framework (unit): <framework + version>

**Selector / locator policy for downstream skills:**
- `data-testid` in use: <yes/no — attribute name>
- Recommended order: <e.g. getByRole > getByLabel > getByTestId > CSS>

**Auth flow (for skills that drive the UI/API):**
- <one paragraph: how to log in, what cookie/header carries the session>
- Test credentials env vars: `TEST_USER`, `TEST_PASSWORD` — <set / unset>

**Base URLs:**
- `APP_BASE_URL` (dev): <url or "unknown">
- `API_BASE_URL` (dev): <url or "unknown">

**Portal binding:**
- System: <ADO org/project | Jira project | GitHub org/repo | none>
- Access: <plausible — token env var set | blocked — env var unset>

**Skill notes:**
- `/test-auto` will write into: `<TEST_PROJECT_PATH if detected, else "automation/ (template default — needs framework init")">`. <If detected: framework + version pin.>
- `/test-docs` will write into: `<TEST_CASES_DIR>` (default `test-cases/`).
- `/security-scan` baseline stack: <detected stack — drives which dependency audit tools the pre-flight will run>.

**Open recon gaps** (resolve before relying on the related skill):
- <bullet — e.g. "API spec not found; api-tester will fall back to ad-hoc curl probes against the routes listed in project-facts.md">

<!-- END PROJECT BINDING -->
```

#### Update strategy

- **First run** (no existing markers in CLAUDE.md): append the block at the bottom of `CLAUDE.md`, preceded by a blank line.
- **Re-run** (markers exist): replace everything between (and including) the two markers with the new block. Do **not** touch any text outside the markers. If a human added content inside the markers, it is overwritten — that's why the marker comment says "Do not hand-edit between the markers".

### Step 6 — Update `.claude/settings.json` env defaults

The settings file already has an `env` block with empty values. Fill in the **non-secret** values you confidently detected:

| Key | Source |
|---|---|
| `PROJECT_UNDER_TEST` | the absolute product path you confirmed |
| `TEST_PROJECT_PATH` | absolute path to the E2E test directory, IF detected and IF the team's tests already live in the product repo (not in this workspace's `automation/`) |
| `TEST_CASES_DIR` | only set if the team appears to already store manual test cases somewhere specific in the product repo (e.g. `<repo>/docs/test-cases/`) |
| `APP_BASE_URL` | detected dev URL (e.g. `http://localhost:3000`) |
| `API_BASE_URL` | detected dev URL |

Read the existing `settings.json`, parse it, update only the keys you're confident about, and write it back. Preserve `permissions` and any other top-level keys verbatim. If a field's current value is non-empty and disagrees with what you detected, **do not overwrite** — leave the human value and surface the conflict in the final report.

**Never** write secret-shaped keys here (`*_PAT`, `*_TOKEN`, passwords). Those go in `.env`, which the user owns.

### Step 7 — Surface `.env` additions to the user (in chat — do NOT write `.env`)

`.env` writes are denied by `settings.json` (deny rule `Write(**/.env*)`) — and that's correct. Don't try.

Instead, in the final chat report, present a copy-pasteable block of the env vars the user should add to their `.env`, with placeholders for the secret values:

```
# --- additions from /bind-project on <YYYY-MM-DD HH:mm> ---
# PROJECT_UNDER_TEST, TEST_PROJECT_PATH, APP_BASE_URL, API_BASE_URL — already set in .claude/settings.json
# Secrets the user still needs to provide:
TEST_USER=<your QA account email>
TEST_PASSWORD=<your QA account password>
AZDO_PAT=<personal access token>          # only if portal: ADO
AZDO_ORG=acmeco
AZDO_PROJECT=Warehouse
GH_TOKEN=<github PAT>                     # only if portal: GitHub
```

Only include the lines that apply to the detected portal / app shape. Don't ask the user to set vars they don't need.

### Step 8 — Final chat report

```markdown
## Project Binding Complete

**Product:** `<abs path>` (<git slug or "no remote">)
**Workspace:** `<abs path>`
**Mode:** first-run | re-run (previous facts archived as `.claude/project-facts.<timestamp>.md`)

### What was detected
- **Stack:** <one line>
- **Frontend:** <framework + version, or "none">
- **Backend:** <framework + version, or "none">
- **E2E tests:** <framework + version at path, or "none — needs init">
- **Unit tests:** <framework + version, or "none">
- **Portal:** <system + slug, or "none">
- **CI runs tests:** <yes — workflow path | no>

### Files written / updated
- `.claude/project-facts.md` — <new | updated, prev archived as project-facts.<ts>.md>
- `CLAUDE.md` — project-specific section <appended | replaced between markers>
- `.claude/settings.json` — env defaults filled: <list of keys set>

### Skill readiness
| Skill | Ready? | Note |
|---|---|---|
| `/test-feature` | <yes/partial/no> | <portal-access status + auth status> |
| `/test-docs` | <yes/partial/no> | <fact-pack completeness, story-fetch path> |
| `/test-auto` | <yes/partial/no> | <test framework detected? if no, points user to automation/README.md to init> |
| `/test-find` | yes | (always — pure source sweep) |
| `/security-scan` | <yes/partial/no> | <dependency-audit tool availability> |

### Action required before some skills work
1. <e.g. "Add `TEST_USER` and `TEST_PASSWORD` to `.env`">
2. <e.g. "Install Playwright in the product repo, OR initialize `automation/` per its README">
3. <e.g. "Set `AZDO_PAT` in `.env` to enable PR-fetching by `/test-feature`">

### Add to `.env` (paste this)
```
# additions from /bind-project on <YYYY-MM-DD HH:mm>
TEST_USER=...
TEST_PASSWORD=...
<other lines as applicable>
```

### Open recon gaps (worth resolving before heavy use)
- <bullet> — <which skill it affects>

### Next step
Try a smoke run: `/test-find dead-code` (lowest-risk, no auth/portal needed) to confirm the binding works end-to-end. After that, run `/test-feature <PR or story ID>` if portal access is set up.
```

## Hard rules

- **Coordinate, don't read.** The four mappers do the product reading. You only do pre-flight detection (manifests exist, git remote exists). Do not Grep through `src/` yourself to fill in a gap — re-prompt the relevant mapper or record the gap.
- **Idempotent.** Re-running `/bind-project` must not corrupt CLAUDE.md or settings.json. Use the BEGIN/END markers in CLAUDE.md. Preserve `permissions` in settings.json verbatim. Archive prior `project-facts.md` rather than overwriting.
- **Never write secrets.** No tokens, passwords, PATs in any file you write. Settings.json gets paths and base URLs only. Secrets are surfaced in the chat report for the user to add to their own `.env`.
- **Never overwrite human values silently.** If `settings.json` has a non-empty `APP_BASE_URL` and you detected a different one, leave the file alone and report the conflict.
- **Validate the path before agents fire.** A wrong product path will produce a confidently wrong fact pack. Better to stop and ask once than ship a poisoned project-facts.md.
- **The fact pack is the source of truth for other skills.** Make it accurate, concise, and code-anchored. If a downstream skill produces garbage tests, the first place to look is here.
- **Conflicts stay visible.** If mappers disagree, mark `conflict — <both>`. Don't pick a winner silently.
- **No portal posting.** Don't open issues, push commits, or notify Slack. Disk + chat only.
