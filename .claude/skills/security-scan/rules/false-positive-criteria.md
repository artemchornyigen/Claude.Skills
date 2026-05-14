# False-positive criteria

A noisy security report destroys trust. Every scanner agent and the `false-positive-validator` agent apply this file before reporting a finding.

## The two questions you ask before listing a finding

1. **Is this code reachable from a real input?** Tests, fixtures, examples, scripts under `/docs`, and `__mocks__` are not user-facing. A `dangerouslySetInnerHTML` in a Storybook story is not XSS.
2. **Would a fix actually change behavior?** If the only "fix" is to add a comment saying `# safe`, it was never a bug.

If the answer to either is "no", dismiss it — and record the dismissal in the agent's `False-positive notes` section so the orchestrator can see the work was done.

---

## Path-based exclusions

Treat a hit as a false positive (or downgrade to `info`) when the file is under any of these paths, UNLESS the user has explicitly scoped the scan to one of them.

| Path pattern | Reason |
|---|---|
| `**/test/**`, `**/tests/**`, `**/__tests__/**`, `**/*.test.*`, `**/*.spec.*`, `**/spec/**` | Test code — uses dummy creds, mocked sinks, intentional injection-shaped strings |
| `**/__mocks__/**`, `**/__fixtures__/**`, `**/fixtures/**`, `**/testdata/**` | Fixture data, not exec'd in prod |
| `**/.storybook/**`, `**/*.stories.*` | Component preview code |
| `**/examples/**`, `**/example/**`, `**/sample/**`, `**/samples/**`, `**/demo/**`, `**/playground/**` | Example apps, not shipped |
| `**/docs/**`, `**/documentation/**`, `**/*.md`, `**/*.mdx` | Docs — code blocks are illustrative |
| `**/node_modules/**`, `**/vendor/**`, `**/packages/*/dist/**`, `**/.venv/**`, `**/venv/**`, `**/site-packages/**` | Vendored third-party code — file as a *dependency* finding, not a code finding |
| `**/build/**`, `**/dist/**`, `**/out/**`, `**/.next/**`, `**/.nuxt/**`, `**/target/**`, `**/bin/**`, `**/obj/**` | Build artifacts |
| `**/migrations/**`, `**/db/migrate/**` | One-shot DDL — different threat model; only flag actual data leakage |
| `**/.env.example`, `**/.env.sample`, `**/.env.template`, `**/.env.dist` | Template files — must still check that placeholders are obviously placeholder values |
| `**/coverage/**`, `**/.coverage/**`, `**/htmlcov/**`, `**/reports/**` | Coverage / report artifacts |

A finding under one of these paths is reportable only if it is one of:
- A real secret in a `.example` file (the template was committed with a real value).
- A test that exercises a production code path with a vulnerable input AND no fix has been applied to production.
- A `migrations/` file that grants overly broad permissions on shipped tables.

---

## Pattern-level dismissals

### "Secret" patterns that aren't secrets

- The value matches a regex but is obviously a placeholder: `your_key_here`, `<changeme>`, `xxxxxx`, `0000…`, `aaaaaaaa…`, `secret`, `password`, `null`, `undefined`, `TODO`, `REPLACE_ME`, `example.com`, `localhost`, `127.0.0.1` host segments.
- The value is a known test-double: `test_`, `dummy_`, `fake_`, `mock_`, `noop_` prefixes on tokens/keys.
- The value is a public asset by definition: `-----BEGIN CERTIFICATE-----` not paired with a private key, JWKS public keys, OAuth `client_id` (NOT `client_secret`), publishable Stripe keys (`pk_live_…` / `pk_test_…` — the `pk_` prefix means publishable).
- The value is short enough (< 12 chars), all uppercase, and matches an enum / constant naming pattern.
- The token-like string is a UUID, a Git SHA, a content hash, a CSS class hash, a webpack chunk hash, or a sourcemap reference.

### "Injection" hits that aren't injection

- The "user input" actually comes from a hard-coded list / enum / config file, not from any HTTP request, queue, or file system path.
- The query string is built from `?` placeholders and the values arg, but the agent's regex flagged the `+` between literal SQL fragments. Open the file — if all variable values pass through `?` / `@p1` / `$1`, it's parameterized.
- ORM methods that look raw but aren't: `Model.objects.raw()` with `%s` placeholders and a `params=[…]` arg, `Sequelize.query(sql, { replacements: {…} })`, `knex.raw('… ?', [val])`, `DbContext.Database.SqlQueryRaw($"… {EF.Functions…}")` (interpolated handler is parameterized).
- `eval` / `Function()` called with a string that comes from a configuration constant or a build-time variable, not runtime input. Note: build-time vars from a CI env can still be user-controlled — verify.
- Path operations that look traversal-prone but use a hardened helper (`path.resolve(base, name).startsWith(base)`, `Path.GetFullPath` + StartsWith check, `os.path.commonpath` check).
- `HTML` insertion of a value that is provably constant or sanitized one line above (`DOMPurify.sanitize`, framework-level escaping that the agent's regex couldn't see).

### "Crypto" hits that aren't crypto risks

- `MD5` / `SHA1` used for a non-security purpose: ETag generation, cache keys, content-addressed file naming, deduplication, change detection. Look for the call site — if the hash output is never compared to anything security-sensitive, downgrade to `info`.
- `Math.random()` used for visuals (animation jitter, particle effects), test data, UI ordering — not security tokens.
- `DES` / `ECB` referenced in a legacy-interop adapter where the protocol is fixed by an external system. File as `info` with an interop note.

### "Header / cookie" hits that aren't risks

- The cookie without `Secure` is being set in a local-development branch (`if (env === 'development')`).
- The CORS `*` is on a deliberately-public read-only endpoint (e.g. a public health check, a public RSS feed) AND no credentials are accepted.
- The `Access-Control-Allow-Origin: *` is on an `OPTIONS` preflight only; verify the actual response policy.

### "Auth" hits that aren't auth gaps

- A route without an explicit `@requires_auth` is mounted under a path that has a router-level auth middleware (`app.use('/api', authMiddleware)`). Open the router config.
- A "missing CSRF" finding on an endpoint that uses bearer-token auth from a non-browser client — CSRF doesn't apply when there's no cookie session.
- A "JWT decode without verify" pattern inside a logging / inspection utility that explicitly does NOT make trust decisions.

### "Logging" hits that aren't PII leaks

- A debug logger that is wrapped by a redactor (`logger.debug(redact(req))`) — read the wrapper.
- A log line that includes `userId` (an opaque identifier) — not PII unless the system treats it as such.

---

## Confidence downgrades

If you cannot fully verify the path is reachable, downgrade severity by one tier and mark `confidence: suspected` instead of dismissing. The HTML report shows confidence so the reader can triage.

Examples:
- The grep hit lives in a class you cannot trace to a route → `high` becomes `medium`, confidence `suspected`.
- The dependency advisory affects a transitive package that is only loaded in a code path you can't find used → `high` becomes `medium`, confidence `suspected`.

The `false-positive-validator` agent then runs a second read and either confirms or kills the finding.

---

## How to document a dismissal

In your agent output, add a `False-positive notes` section:

```
### False-positive notes
- 14 `Math.random()` matches in `src/ui/animations/**` — used for visual jitter, not security tokens. Dismissed.
- 6 `MD5` calls in `src/cache/etag.ts` — used for ETag generation. Dismissed.
- 1 hard-coded `AKIA…` in `tests/fixtures/aws.json` — value is `AKIAIOSFODNN7EXAMPLE`, the documented AWS test placeholder. Dismissed.
- 1 `eval` in `scripts/build/compile.js` — runs at build time on a literal template. Dismissed.
```

Every dismissal must name (a) the pattern, (b) the location(s), (c) the reason. That's how the next reviewer audits your audit.

## When in doubt

File it as a **question** in the agent's `Questions` section, not as a finding. The `security-lead` agent or a human will adjudicate. Questions are free; false positives are expensive.
