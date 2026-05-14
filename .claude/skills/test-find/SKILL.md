---
name: test-find
description: Sweeps the codebase for issues in a specific category (e.g. performance, accessibility, error-handling, data-integrity) using a team of DEV and QA agents, then routes their open questions to a BA agent. Writes the questions to `questions/<category>.md` so the BA / product team can answer them. Use when the user invokes `/test-find <category>` or asks "find all the <category> problems".
---

# test-find

You coordinate a multi-agent investigation of the codebase for a specific category of issues. The DEV and QA agents surface findings + questions; the BA agent answers what they can; remaining questions get written to disk for a human.

## Inputs

- **Category** (required) — e.g. `performance`, `accessibility`, `error-handling`, `logging`, `data-integrity`, `concurrency`, `i18n`, `dead-code`, `test-coverage`, or a custom one the user names.
- **Scope** (optional) — a path. Defaults to the full source under `$PROJECT_UNDER_TEST` (or the current project).
- **Trigger** (optional) — what prompted this investigation (recent incident, oncall pain, code-review concern). Pass this on to agents — it sharpens their focus.

If the category is fuzzy ("clean up the code"), ask the user to pick a specific category from the list above or define one.

## Orchestration

### Phase 1 — Parallel investigation
Spawn two agents in parallel:

1. `code-investigator` agent — DEV perspective. Pass the category, scope, and trigger.
2. `qa-reviewer` agent — QA perspective on the same category (what would the user actually notice? what test scenarios would catch this?). Skip if the category is purely internal (e.g. `dead-code`).

Both produce findings + open questions.

### Phase 2 — BA pass
Merge the open questions from both agents. Spawn a `ba-analyst` agent with:
- The merged question list
- The user story / spec / requirements doc (if available)
- Code snippets cited in the questions, for context

The BA either answers each question or marks it `still open`.

### Phase 3 — Write the artifact
Append (don't overwrite) to `questions/<category>.md`. If the file exists, add a new dated section to the bottom.

```markdown
# Questions — <category>

## Investigation <YYYY-MM-DD-HHmm>

**Scope:** <path>
**Trigger:** <if any>

### Findings (for reference)
- [severity] <title> — `file:line` — <one-line summary>
- ...

### Questions answered by BA
- **Q:** <question> (`file:line`)
  **A:** <answer> (Source: <spec / "assumption">)
- ...

### Still open — need human BA / product input
- **Q:** <question>
  **Context:** `file:line` — <what triggers this question, what decision depends on it>
  **Asked by:** dev | qa
  **Status:** OPEN
- ...
```

## Final report (chat output)

```markdown
## Investigation — <category>

**Scope:** <path>
**Findings:** <count> (critical: <n>, major: <n>, minor: <n>)
**Questions raised:** <count>
**Answered by BA agent:** <count>
**Still open for human:** <count>

### Top findings
1. [severity] <title> — `file:line`
2. ...

### Output
Questions written to: `questions/<category>.md`

### Next step
Review the OPEN questions in `questions/<category>.md` with the product BA. Once answered, re-run `/test-find <category>` to confirm closure.
```

## Hard rules

- The investigation must produce **findings** AND **questions**. If your agents only produced findings, you didn't probe deeply enough — re-prompt them for ambiguities.
- Questions must include a code anchor (`file:line` or feature name). A question without a context anchor is useless to a BA.
- Never close a question on the BA agent's word alone if the BA prefixed the answer with `Assumption:`. Those stay OPEN until a human confirms.
- Never delete prior investigation entries in `questions/<category>.md`. Append.
