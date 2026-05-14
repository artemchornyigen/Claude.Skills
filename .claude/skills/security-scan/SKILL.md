---
name: security-scan
description: Runs a full security audit on the codebase and produces a self-contained HTML report under `security/`. Covers OWASP-style issues, secret leakage, dependency vulnerabilities, and weak crypto. Use when the user invokes `/security-scan` or asks for a security review of the project.
---

# security-scan

You are the orchestrator of a security audit. You do **not** read product code yourself to find bugs. You coordinate a team of specialist agents, validate their output, and emit a self-contained HTML report.

## Skill anatomy

```
security-scan/
├── SKILL.md                         ← this file (orchestration)
├── rules/
│   ├── security-rules.md            ← canonical list of what to look for + severity scale
│   └── false-positive-criteria.md   ← what NOT to flag, with reasons
├── agents/
│   ├── scanner-secrets.md           ← credential & secret leakage
│   ├── scanner-injection.md         ← SQLi, cmd, SSTI, XXE, SSRF, deser, path, eval, XSS
│   ├── scanner-auth.md              ← authn, authz, sessions, CSRF, IDOR, OAuth
│   ├── scanner-config.md            ← headers, cookies, CORS, TLS, crypto, deps, logging
│   ├── coverage-auditor.md          ← independent "what wasn't checked" pass
│   ├── false-positive-validator.md  ← second-pass kill noise
│   └── security-lead.md             ← final synthesis
└── report-template.html             ← self-contained HTML (no external assets)
```

The four scanners run **in parallel**. The validator and the security-lead run **sequentially** after them. The HTML renderer is the last step.

## Inputs

- **Scope** (optional) — a path. Defaults to `$PROJECT_UNDER_TEST` if set, otherwise the current project root.
- **Stack hint** (optional) — if the user names the primary language, pass it through.
- **Re-scope hint** (optional) — e.g. `/security-scan src/graphql/` to dedicate a follow-up run.

## Pipeline

### Step 1 — Pre-flight (orchestrator does this directly)

Quick, deterministic checks:

1. Detect primary language(s) and framework(s) by looking for `package.json`, `pnpm-lock.yaml`, `yarn.lock`, `*.csproj`, `*.sln`, `pyproject.toml`, `requirements*.txt`, `go.mod`, `Cargo.toml`, `Gemfile`, `composer.json`, `pom.xml`, `build.gradle*`.
2. List dependency manifests.
3. Count files in scope (`find … | wc -l` style). If > 5,000, plan to split the scan by directory in step 3.
4. Identify whether `git` is available and the scope is inside a git repo (enables the secrets history sweep).

### Step 2 — Native dependency audits

Run **only the ones that apply**, in parallel. Capture stdout/stderr. Do not fail the pipeline if a tool is missing — record it as `SKIPPED — tool not installed` and move on.

| Stack signal | Command |
|---|---|
| `package.json` + `package-lock.json` | `npm audit --json` |
| `package.json` + `pnpm-lock.yaml` | `pnpm audit --json` |
| `package.json` + `yarn.lock` | `yarn npm audit --json` (yarn 2+) or `yarn audit --json` |
| `requirements*.txt` / `pyproject.toml` | `pip-audit --format json` (preferred) or `safety check --json` |
| `*.csproj` | `dotnet list package --vulnerable --include-transitive` |
| `go.mod` | `govulncheck ./...` |
| `Cargo.toml` | `cargo audit --json` |
| `Gemfile.lock` | `bundle audit check` |
| `composer.lock` | `composer audit --format=json` |

Persist outputs to memory (you'll pass them to `scanner-config`).

### Step 3 — Parallel scanner fan-out

In a **single message**, spawn five agents in parallel via the `Agent` tool. Each gets a self-contained brief.

For each scanner, the prompt template is:

```
You are running as the <scanner-name> agent. Your persona is fully defined in:

  .claude/skills/security-scan/agents/<scanner-name>.md

Read that file first and follow it precisely. You also have access to:

  .claude/skills/security-scan/rules/security-rules.md
  .claude/skills/security-scan/rules/false-positive-criteria.md

## Run parameters
- Scope: <absolute path>
- Detected stack: <e.g., "TypeScript / Node 20 / Express 4">
- File count in scope: <n>
- Git available: <yes/no>
- [scanner-config only] Pre-run dependency audit output:
  <verbatim JSON/text outputs from step 2, or "SKIPPED" with reason per tool>

Return your output in the exact format specified at the bottom of your persona file.
Do not produce anything else — your output is consumed by the false-positive-validator next.
```

Use `subagent_type: security-auditor` (the closest existing agent type) or `general-purpose`. The persona file defines the actual behavior. Spawn:

1. `scanner-secrets` — parallel
2. `scanner-injection` — parallel
3. `scanner-auth` — parallel
4. `scanner-config` — parallel (also gets the dependency audit feed)
5. `coverage-auditor` — parallel

For a very large codebase (> 5,000 files), spawn 2× of each scanner sharded by directory and merge their outputs before passing on to the validator.

Wait for all five to return.

### Step 4 — False-positive validation (sequential)

Spawn one `false-positive-validator` agent with:

- The concatenated outputs of all four domain scanners.
- The paths to `security-rules.md` and `false-positive-criteria.md`.

It returns a deduplicated, validated, recalibrated finding list.

### Step 5 — Security-lead synthesis (sequential)

Spawn one `security-lead` agent with:

- The validator's output.
- The coverage-auditor's output (from step 3).
- All open questions from upstream agents.
- Project metadata (name, stack, scope, file count, dependency-audit summary).

It returns the final structured payload defined in `agents/security-lead.md`.

### Step 6 — Render the HTML report

Read `report-template.html`. The template uses two kinds of placeholders:

1. **Scalar `{{name}}`** — direct substitution. Replace with the lead's value, HTML-escaped.
2. **Repeated blocks `{{#name}}…{{/name}}`** — render the inner snippet once per item in the corresponding list. Inside the snippet, scalar placeholders refer to fields of the current item.

The repeated blocks in the template are:
`{{#findings}}`, `{{#themes}}`, `{{#roadmap_now}}`, `{{#roadmap_soon}}`, `{{#roadmap_planned}}`, `{{#surfaces}}`, `{{#coverage_gaps}}`, `{{#questions}}`, `{{#posture_recs}}`, `{{#dismissals}}`, plus optional sections `{{#cwe}}`, `{{#owasp}}`, `{{#references}}` *inside* a finding (rendered only if the field is present).

If a list is empty, drop the entire repeated block AND emit the alternative `<!-- if empty: … -->` snippet that the template documents inline.

HTML-escape every substituted value (`& → &amp;`, `< → &lt;`, `> → &gt;`, `" → &quot;`, `' → &#39;`) before insertion, except where the lead's payload is pre-formatted as the `Evidence` code block — escape that too, then place it inside the `<pre><code>…</code></pre>` already in the template.

Also compute these derived fields that the lead does not produce directly:
- `grade_letter` and `grade_text` — overall posture grade from severity counts:
  | Condition | Grade | Label |
  |---|---|---|
  | `critical > 0` | F | Critical issues present |
  | `high >= 3` | D | Multiple high-severity issues |
  | `high in [1,2]` | C | High-severity issues present |
  | `medium >= 5` | C | Several medium issues |
  | `medium in [1..4]` | B | Minor issues |
  | none of the above | A | Clean |
- `grade_text` is the label.
- `search_blob` on each finding — concatenation of `title`, `file_line`, `cwe`, `owasp`, `domain`, `issue` lowercased, for the in-page search filter.
- `generated_short` — `YYYY-MM-DD HH:mm`. `generated_long` — locale-style date.
- `cwe_num` — the numeric part of the CWE-ID for the link (e.g. `CWE-89` → `89`).

Write to:

```
security/security-report-<YYYY-MM-DD-HHmm>.html
```

Never overwrite — the timestamp ensures uniqueness.

Optionally, also write the lead's raw payload to:

```
security/security-report-<YYYY-MM-DD-HHmm>.md
```

(That's the source-of-truth markdown that produced the HTML — handy for diffs.)

### Step 7 — Final chat summary

```markdown
## Security scan complete

**Project:** <name>
**Scope:** <path>
**Stack:** <detected>
**Files scanned:** <count>

### Risk overview
| Severity | Count |
|---|---|
| critical | <n> |
| high | <n> |
| medium | <n> |
| low | <n> |
| info | <n> |

### Top three to fix this PR
1. **F-001** — [critical] <title> — `file:line`
2. **F-002** — [critical] <title> — `file:line`
3. **F-003** — [high] <title> — `file:line`

### Coverage gaps
- <next-run gap>
- <follow-up gap>

### Reports
- HTML: `security/security-report-<YYYY-MM-DD-HHmm>.html`
- Source (markdown): `security/security-report-<YYYY-MM-DD-HHmm>.md`

### Next step
<one sentence, e.g. "Rotate the AWS key flagged in F-001 immediately; everything else can wait for the sprint.">
```

## Hard rules

- **Skill orchestrates, agents execute.** Do not Read/Grep the product yourself to produce findings. The closest you come to product code is the pre-flight detection in step 1.
- **HTML must be fully self-contained.** No `<link>` to a CDN, no `<script src="https://…">`, no `<img src="https://…">`, no `@import url(...)`. Everything inline. The file must open from disk in an airgapped browser.
- **HTML-escape every substituted field.** Code snippets, file paths, titles, descriptions. Use a single escape helper: `& → &amp;`, `< → &lt;`, `> → &gt;`, `" → &quot;`, `' → &#39;`. Apply BEFORE substitution.
- **Never include actual secret values in the report.** The `scanner-secrets` agent redacts; if a raw value slipped through, redact it here too (`AKIA…[20 chars]`).
- **Never auto-fix security issues.** This skill writes a report, period. Fixes require human judgment.
- **Never post the report off-disk.** No Slack, no Jira, no gist, no chat-platform upload. Save to `security/` and surface the path. The user posts where they choose.
- **Append, don't overwrite.** Timestamped filenames. Previous reports stay.
- **Missing tool = SKIPPED, not silent.** If `npm audit` isn't installed, the report explicitly says so. Silence implies "checked and clean".

## Failure modes to watch for

- A scanner returns 0 findings AND no `False-positive notes` section — that means it didn't actually look. Re-prompt it once with the explicit list of patterns from `security-rules.md`.
- The validator dismisses > 80% of findings — the scanners over-fired; the validator's own bias is masking real issues. Re-read the dismissals for plausibility.
- A scanner returns findings without `file:line` anchors — reject the output, re-prompt with "every finding must include `file:line`. Findings without an anchor go to your Questions section."
- Dependency audit hangs (some `npm audit` calls do on certain registries) — kill after 90s, mark as `SKIPPED — timeout`, continue.
