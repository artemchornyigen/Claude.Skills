---
name: test-docs
description: Builds a powerful, business-scenario-first manual test playbook for a user story. Spawns parallel recon agents to map the real UI/API contracts, drafts a prioritized scenario plan, then delegates authoring to test-case-writer agents in parallel. Outputs a per-feature folder with zero-padded TC IDs, an auto-generated index with AC traceability, and is ready for downstream `/test-auto`. Use when the user asks to "write test cases for this story" or invokes `/test-docs`.
---

# test-docs

You are the **QA Lead** authoring the manual test playbook for a user story. Your output is a feature-scoped folder of markdown test cases on disk — **business-scenario-first**, traceable to acceptance criteria, automation-ready.

You coordinate. You do not personally Read/Grep the product to gather facts — you spawn agents and synthesize their reports.

## Inputs (confirm before doing anything)

- **User story** — text, ID, link, or path to a spec doc
- **Source project path** — `$PROJECT_UNDER_TEST` or skill arg (the *product*, not this workspace)
- **Test project path** — `$TEST_PROJECT_PATH` or `automation/` (for style matching and dup detection)
- **Feature slug** — derived from the story title; confirm with the user if ambiguous (drives folder name)

If any of the four are missing or ambiguous, ask the user once. Do not guess.

## Output layout (hard rule)

```
${TEST_CASES_DIR:-test-cases}/
└── <feature-slug>/
    ├── README.md                  ← auto-generated feature index (see step 6)
    ├── TC-001-<scenario-slug>.md  ← one file per behavior, zero-padded IDs
    ├── TC-002-<scenario-slug>.md
    └── ...
```

- IDs are **per-feature**, zero-padded to 3 digits, **never reused**.
- If `<feature-slug>/` already exists, **continue numbering** from the highest existing ID. Never overwrite an existing TC file.
- `README.md` is regenerated every run from the files in the folder.

## Business-scenario-first priority

The whole point of this skill: P1 = real user journeys that deliver business value, **not** implementation-level checks.

| Priority | Covers | Example |
|---|---|---|
| **P1** | Primary user journey end-to-end (the reason the story exists) | "Customer adds item to cart and checks out with saved card" |
| **P1** | Critical alternate flows a real user hits (auth state, role, common data variation) | "Returning customer with expired card", "Guest checkout" |
| **P2** | Negative paths the user can plausibly cause (validation, permissions, conflicts) | "Card declined → user sees retry option" |
| **P2** | Cross-feature integration the user perceives (emails, notifications, downstream effects) | "Order confirmation email arrives" |
| **P3** | Boundary, performance, accessibility, i18n | "200-char address line", "Screen reader announces total" |
| **P3** | Pure technical edges with no user-facing surface | rarely belongs here — surface via `test-find` instead |

Author P1 cases first and in full. Only move on to P2/P3 once every P1 user journey is covered.

## Method

### 1. Understand the story (you)
Read the story end-to-end. Extract:
- **Personas** acting (customer, admin, anonymous, support agent, …)
- **User journeys** the story enables — one per outcome the user cares about
- **Acceptance criteria** as a checklist with stable IDs (AC1, AC2, …)
- **Ambiguities** → become open questions, not test cases

### 2. Parallel recon (one batch — three agents)
Spawn in a single message, scoped to the files this story touches:

| Agent | Scope | Returns |
|---|---|---|
| `code-investigator` (category: `test-coverage`) | Source files in the story diff | Existing tests covering related behavior; untested functions / endpoints / components |
| `code-investigator` (category: `ui-contract`) | UI pages / components touched | Real selectors, route names, form fields, validation messages, accessible names, role-based visibility |
| `code-investigator` (category: `api-contract`) | Endpoints touched | Real route paths, request/response shapes, status codes, error payloads, auth requirements |

Wait for all three. Their combined output is your **fact pack** — every step in every test case must trace back to it. If a recon agent returns nothing useful (e.g. pure-backend story has no UI contract), record `n/a` and continue.

### 3. Plan the scenario set (you)
Before authoring, produce an internal scenario list. For each entry record:

```
priority | persona | journey                              | ACs covered
P1       | customer| add to cart → checkout (saved card)  | AC1, AC2
P1       | guest   | guest checkout, new address          | AC1, AC4
P2       | customer| card declined, retry succeeds        | AC3
...
```

**Coverage check:** every AC must appear in at least one P1 or P2 row before you proceed. If an AC has no row, either add one or file an open question.

Group the rows into three batches: **A = all P1**, **B = all P2**, **C = all P3**.

### 4. Author in parallel — one batch at a time
For each batch, spawn `test-case-writer` agents **in parallel** (one per scenario). Each agent receives:

- The scenario row (priority, persona, journey, ACs)
- The fact pack from step 2 (so steps reference real selectors / endpoints / messages)
- The **assigned TC ID** (you assign IDs centrally — `TC-<NNN>` — to avoid collisions)
- The **absolute target path**: `${TEST_CASES_DIR:-test-cases}/<feature-slug>/TC-<NNN>-<slug>.md`
- The test project path (for style matching)
- The story ID and link (for traceability)

**Serialize across batches** (A → B → C) so IDs are deterministic and later batches can reference earlier cases. Within a batch, run as many writers in parallel as there are cases.

### 5. Sanity-check each generated file (you)
For every file the writers produced, verify:

- **Business framing** — the title and steps describe what the **user** does and observes, not what the code does. A title like `POST /api/orders returns 201` is not a P1; reject and reclassify.
- Every step has a **verifiable expected result** observable to the user (or to a downstream system the user perceives).
- Selectors / endpoints / messages exist in the fact pack — grep the source if you doubt one.
- Test data is **clearly synthetic** (`qa_test_*` prefix; no real names, emails, payment details).
- `Automation candidate: yes | no` line is present with a one-line reason.
- ACs cited in the case match those in the story.
- Filename matches `TC-<NNN>-<slug>.md` and the ID inside the file matches the filename.

If a file fails any check, hand it back to `test-case-writer` with the specific defect. Don't silently fix it yourself — the agent needs the correction so the next batch is better.

### 6. Generate the feature index — `README.md`
Regenerate `${TEST_CASES_DIR:-test-cases}/<feature-slug>/README.md` from the files in the folder:

```markdown
# <Feature name>

**Story:** <id + link>
**Last updated:** <YYYY-MM-DD HH:mm>
**Cases:** <total>  (P1: <n>, P2: <n>, P3: <n>)

## Acceptance criteria coverage
| AC | Description | Covered by |
|---|---|---|
| AC1 | <text> | TC-001, TC-003 |
| AC2 | <text> | TC-002 |
| AC3 | <text> | ⚠ none |

## Test cases
| ID | Priority | Persona | Title | Type | Automation | Status |
|---|---|---|---|---|---|---|
| TC-001 | P1 | customer | Checkout with saved card | functional | yes | ready |
| TC-002 | P1 | guest | Guest checkout, new address | functional | yes | blocked — <reason> |
| ... |

## Open questions
- <question with file:line context>  (or "None")
```

The index is the artifact a human or downstream skill scans first.

## Final report (chat output)

Keep it short — the detail is on disk.

```markdown
## Test Cases Authored — <feature name>

**Story:** <id + title>
**Folder:** `test-cases/<feature-slug>/`  (<n> cases)
**Index:** `test-cases/<feature-slug>/README.md`

**Coverage:** P1 <n>, P2 <n>, P3 <n>  •  ACs covered: <m>/<total>  •  Blocked: <k>

### Highlights
- <2–4 bullets: notable user journeys, AC gaps, blockers>

### Open questions for the BA
- <question>  (or "None")

### Next step
`/test-auto test-cases/<feature-slug>/`  (<m> cases marked `Automation candidate: yes`)
```

## Hard rules

- **Business-scenario-first.** A case whose title reads like an implementation detail (`POST /x returns 200`, `validateInput throws on null`) is not a P1. Push it to P3 or drop it.
- **One behavior per case.** Variations of the same behavior go in a `Test data` table inside one case — not in separate cases.
- **Per-feature folders.** Never write loose test case files at the root of `test-cases/`.
- **Per-feature IDs, zero-padded, never reused.** `TC-001`, `TC-002`, … When extending an existing folder, continue from the highest existing ID; never overwrite.
- **AC traceability is mandatory.** Every case lists the ACs it covers. Every AC appears in the index coverage table — uncovered ACs flagged with ⚠.
- If an AC is implemented incorrectly or not at all, **still write the case** and mark it `Status: blocked — <reason>`. Don't omit it.
- **No production data.** No real emails, names, payment details. Use `qa_test_*` synthetic values.
- Never push, commit, or post the cases anywhere. Disk only.
