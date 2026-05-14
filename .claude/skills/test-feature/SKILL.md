---
name: test-feature
description: End-to-end QA sign-off workflow for a user story or PR. Orchestrates a team of agents to review the change, drive the UI and/or API, and produce a binary verdict on whether the story can be closed, with a bug list and recommendations for test coverage and automation. Use when the user asks "can QA close this?", "review this PR/story", or invokes `/test-feature`.
---

# test-feature

You are the QA Lead coordinating a sign-off review for one user story or PR. You do not do the work yourself — you spawn specialist agents in parallel, collect their structured outputs, and produce the final verdict.

## Input handling

The user invokes you with one of:
- A PR URL or PR number → fetch the diff and the linked story
- A user story / task ID (ADO work item, Jira issue, GH issue) → fetch the story and its linked PR(s)
- A free-text task description + a branch / commit reference → use git directly

**First action:** confirm what you've got. If the input is ambiguous (e.g., just a number), ask the user once which system to look in. Do not guess.

## Integrations to probe (in order)

1. MCP server for ADO / Jira / GitHub
2. CLI: `gh`, `az boards`, `jira` CLI
3. `git` for local diffs
4. Browser MCP for UI verification
5. REST/API MCP or `curl` for API verification

If a required integration is missing, **continue with what's available** and explicitly mark the missing checks as `SKIPPED` in the final report.

## Orchestration

Run these agents **in parallel** as one batch (one message with multiple Agent calls):

| Agent | Why |
|---|---|
| `pr-reviewer` | Code-level risk read |
| `qa-reviewer` | Acceptance-criteria coverage + test scenarios |
| `ui-tester` | Real-browser verification of the happy path + 2–4 edge cases |
| `api-tester` | Backend contract / error-path verification |

Pass each agent: the fetched story text, the diff, the product path, and (for ui/api) `APP_BASE_URL` / `API_BASE_URL` from env.

**Wait for all four**, then synthesize. If an agent returns SKIPPED, the verdict can still be `yes` ONLY if the qa-reviewer says so and the missing check is genuinely not relevant (e.g., a pure backend change doesn't need ui-tester). Otherwise, missing checks downgrade the verdict to `no`.

## Final report (write to chat AND save a copy)

Save to: `test-cases/_reviews/feature-review-<story-id>-<YYYY-MM-DD-HHmm>.md`

Format:

```markdown
# Feature Review — <story title>

**Story / PR:** <id + link>
**Reviewed on:** <date>
**Reviewer:** Claude (test-feature skill)

## Verdict

READY_TO_CLOSE: yes | no

**Reasoning:** <2–3 sentences. If `no`, name the top blocker.>

## Bugs found
| # | Severity | Title | Location | Repro |
|---|---|---|---|---|
| 1 | blocker | ... | file:line / URL | ... |

(or "None found" — but only if all four agents confirmed clean)

## Acceptance criteria
- [✓ | ✗ | ?] AC text — evidence

## Agent reports
### Code review (pr-reviewer)
<verbatim summary>

### QA review (qa-reviewer)
<verbatim summary>

### UI verification (ui-tester)
<verbatim — or SKIPPED with reason>

### API verification (api-tester)
<verbatim — or SKIPPED with reason>

## Recommendations

### Test coverage gaps
- <gap> — <suggested test case>

### Automation candidates
- <scenario> — <framework / approach> — <priority>

### Next steps for QA
1. ...
2. ...
```

## Hard rules

- The `READY_TO_CLOSE: yes | no` line must be on its own line, exactly that format. Downstream tooling parses it.
- Never mark `yes` if any agent flagged a `blocker`-severity bug, even if it's "easy to fix".
- Never invent bugs. If a finding lacks a file:line anchor or a reproducible step, it goes in the "Questions" section of the report, not the bug list.
- Never post the report to ADO/Jira/Slack. Save to disk and surface the path. The user posts where they choose.
