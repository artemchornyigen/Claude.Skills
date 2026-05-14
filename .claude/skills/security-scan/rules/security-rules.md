# Security rules — shared catalog

This file is the single source of truth for every scanner agent in the `security-scan` skill. Each scanner agent reads it and the section that maps to its domain. The orchestrator passes the file path; agents do not duplicate the patterns inline.

## Severity scale (canonical)

| Severity | Meaning | Example |
|---|---|---|
| `critical` | Exploitable in current code, no special pre-conditions, leads to RCE / full auth bypass / live secret leak / DB compromise | Hard-coded production AWS key in tracked source, `eval(req.body)` on a public endpoint |
| `high` | Exploitable with a realistic pre-condition; meaningful data exposure or privilege escalation | SQL string concatenation behind an authenticated endpoint, JWT verified with `none` algorithm allowed |
| `medium` | Real weakness, exploitable in some configurations or chained with another bug | Missing CSRF on a state-changing endpoint behind auth, weak password policy, MD5 for non-security purpose where intent is unclear |
| `low` | Defense-in-depth, hardening gap, best-practice deviation | Missing `SameSite` on a non-session cookie, missing security header on a static asset response |
| `info` | Observation worth recording, not a vulnerability | TODO-marked auth check that is currently correct, third-party dependency one minor version behind latest |

Every finding must justify its severity in one sentence. Padding a `low` to `medium` is a false positive of its own kind.

---

## Domain 1 — Secrets & credential leakage  (`scanner-secrets`)

### High-signal regex patterns

| Pattern | What it matches | Default severity |
|---|---|---|
| `AKIA[0-9A-Z]{16}` | AWS access key ID | critical |
| `aws_secret_access_key\s*=\s*['"][A-Za-z0-9/+=]{40}['"]` | AWS secret | critical |
| `-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----` | Private key block | critical |
| `ghp_[A-Za-z0-9]{36}` | GitHub personal access token | critical |
| `gho_[A-Za-z0-9]{36}` | GitHub OAuth token | critical |
| `github_pat_[A-Za-z0-9_]{82}` | GitHub fine-grained PAT | critical |
| `xox[baprs]-[A-Za-z0-9-]{10,}` | Slack token | critical |
| `sk_live_[A-Za-z0-9]{24,}` | Stripe live secret | critical |
| `sk_test_[A-Za-z0-9]{24,}` | Stripe test secret | high |
| `SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}` | SendGrid API key | critical |
| `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` | JWT (verify it's not a placeholder) | high if real |
| `[A-Za-z0-9+/]{40,}={0,2}` near words `secret\|password\|token\|key` | Base64 secret in a config-y context | medium → high after read |
| `(password\|passwd\|pwd)\s*[=:]\s*['"][^'"]{6,}['"]` | Inline password assignment | high |
| `(api[_-]?key\|apikey\|client[_-]?secret)\s*[=:]\s*['"][^'"]{8,}['"]` | Inline API key | high |
| `mongodb(\+srv)?://[^:]+:[^@]+@` | MongoDB URI with embedded creds | critical |
| `postgres(ql)?://[^:]+:[^@]+@` | Postgres URI with embedded creds | critical |
| `mysql://[^:]+:[^@]+@` | MySQL URI with embedded creds | critical |
| `redis://[^:]*:[^@]+@` | Redis URI with embedded password | high |
| `Bearer\s+[A-Za-z0-9._-]{20,}` | Hard-coded bearer token | high |
| `-----BEGIN CERTIFICATE-----` near `PRIVATE KEY` | Combined cert+key bundle | critical |

### Locations to sweep

- All tracked source files (default).
- `.env`, `.env.*`, `*.config`, `*.yml`, `*.yaml`, `*.json`, `*.xml`, `*.properties`, `*.toml`, `appsettings*.json`, `web.config`, `application.properties`, `Dockerfile`, `docker-compose*.yml`, `*.tfvars`.
- Git history if `git` is available — sample the last 50 commits for added secrets (`git log -p -S 'AKIA' --all | head -500`). Mark history-only findings as `high` (not `critical`) unless the key is provably still valid.
- README / docs / wiki files — copy-paste of real secrets happens here too.

### What is NOT a secret leak

- Values in `.env.example` / `.env.sample` / `.env.template` IF they are obviously placeholders (`your_key_here`, `xxx`, `<changeme>`, all-same-character, `example.com`).
- Test fixtures with values like `test_secret_123`, `dummy_jwt`, `fake_key`.
- Public keys (`-----BEGIN PUBLIC KEY-----`, `-----BEGIN CERTIFICATE-----` alone).
- Algorithm constants, OIDs, or framework defaults that match a regex by coincidence.

Apply `false-positive-criteria.md` before reporting.

---

## Domain 2 — Injection & unsafe execution  (`scanner-injection`)

### SQL injection

- String concatenation or interpolation into a SQL string: `"SELECT … " + var`, `f"SELECT … {var}"`, `` `SELECT … ${var}` ``, `"...".format(var)`, `String.Format("SELECT … {0}", var)`.
- Raw query APIs called with non-parameterized strings: `cursor.execute(query)` where `query` is built from input, `db.Database.SqlQueryRaw`, `Sequelize.query` without `replacements`, `knex.raw` with interpolation, `EntityFrameworkCore.FromSqlRaw` with interpolation.
- ORM "escape hatches" are the highest-yield target — flag every call site and open the file.

Severity: `high` if user-reachable input flows in, `critical` if the endpoint is unauthenticated.

### Command / shell injection

- `os.system`, `subprocess.*(shell=True)`, `subprocess.Popen` with a single string + `shell=True`, `child_process.exec` (Node), `Runtime.exec(String)` (Java) with concatenation, `Process.Start(string)` (C#) with concatenation, `system()`, `` `…` `` backticks in shell-aware languages, `eval` of shell-quoted strings.
- Look for the string flowing from `req.`, `request.`, `query.`, `body.`, `params.`, `args[`, `ARGV`, `argv[`, an HTTP handler argument, a message-queue payload, or a file read.

### Template / SSTI injection

- Untrusted input into `render_template_string`, Jinja `Template(user_input).render()`, Handlebars `compile(user_input)`, Velocity, Thymeleaf inline expressions, Razor `@Html.Raw(user_input)`.

### Deserialization

- `pickle.loads`, `pickle.load`, `marshal.loads`, `yaml.load` without `SafeLoader`, `xml.etree` without `defusedxml`, `cPickle`, Java `ObjectInputStream`, .NET `BinaryFormatter`, `NetDataContractSerializer`, `LosFormatter`, `SoapFormatter`, Ruby `Marshal.load`, Node `serialize-javascript` reverse, `node-serialize` `unserialize`.

### XXE

- XML parsers built without disabling entity expansion: `DocumentBuilderFactory` without `setFeature("…disallow-doctype-decl", true)`, `XmlReader` (.NET) with `DtdProcessing = Parse`, `lxml.etree.parse` with default resolver, `libxml2` defaults.

### SSRF

- HTTP-client calls where the URL or host comes from user input: `requests.get(user_url)`, `http.get(req.body.url)`, `WebClient.DownloadString(input)`, `URL(input).openConnection()`, `fetch(req.body.target)`, image-resize / PDF / preview services taking a URL.
- Flag especially if no host allowlist is enforced and no metadata-IP blocklist (`169.254.169.254`, `127.0.0.1`, internal RFC1918 ranges).

### Path traversal / unsafe file ops

- `open(user_input)`, `fs.readFile(user_input)`, `File.ReadAllText(user_input)`, `Path.Combine(root, user_input)` (`Path.Combine` does not prevent `..\`), `new File(root, input)` in Java.
- Look for missing `Path.GetFullPath` + prefix check, missing `os.path.realpath` + `commonpath` check.
- Archive extraction without zip-slip protection (`ZipEntry.getName()` used without validation).

### Code execution sinks (last-resort)

- `eval`, `Function(string)`, `setTimeout(string, …)`, `setInterval(string, …)`, `vm.runInNewContext`, `vm.runInThisContext`, Python `exec`, Ruby `instance_eval(string)`, .NET `CSharpCodeProvider.CompileAssemblyFromSource` from input, JS `new Function(userInput)`, `dangerouslySetInnerHTML`, jQuery `.html(userInput)`.

### XSS

- React: `dangerouslySetInnerHTML={{__html: userValue}}`, `ref.current.innerHTML = …`, `document.write`, unsafe `eval` of templates.
- Server templates: any `{{ raw }}`, `|safe`, `@Html.Raw`, `<%= %>` in ERB without escaping helper, Razor unescaped output.
- Reflected: rendering query params straight back into HTML without escape.

---

## Domain 3 — Authn / authz / sessions  (`scanner-auth`)

### Authentication

- JWT verification:
  - `jwt.verify(token, key, { algorithms: ['none'] })` or no `algorithms` whitelist (lib defaults vary; flag it).
  - `jwt.decode` used as if it were `verify` (decode does NOT verify).
  - Signing secret pulled from a default / placeholder / very short string (`'secret'`, `'changeme'`).
- Password handling:
  - `MD5`, `SHA1`, `SHA256` without a salt-and-stretch (i.e. used as the raw password hash). Required: `bcrypt`, `scrypt`, `argon2`, `pbkdf2` with ≥ 100k iterations.
  - Plaintext password compare (`password === stored`).
  - Password length not validated, or upper-bound trivially low.
- Session fixation / lifecycle:
  - Session ID not regenerated on login (`req.session.regenerate` / framework equivalent).
  - Session without expiry, or expiry set to years.
  - Remember-me tokens not single-use / not rotated.
- MFA / 2FA bypass paths — backup-code endpoints without rate limit, "trust this device" cookies without binding to user/IP.

### Authorization

- Endpoints without an explicit authorization decorator / middleware / filter:
  - Flask routes without `@login_required` / `@requires_role`.
  - Express routes without an auth middleware in the chain (compare to neighbors).
  - ASP.NET Core actions without `[Authorize]` and not in a class-scoped `[Authorize]`.
  - Spring `@RestController` methods without `@PreAuthorize` and no global filter.
- IDOR — endpoints that take an ID parameter (`/users/:id`, `/orders/{orderId}`) and load by that ID without ownership check (`WHERE id = ? AND user_id = currentUserId`).
- Mass-assignment — accepting whole objects (`user.update(req.body)`) without an allow-list of fields. Risk: privilege escalation by including `role: 'admin'`.
- Vertical vs horizontal — flag separately:
  - Vertical: user accessing admin function. Look for `isAdmin` checks done client-side only.
  - Horizontal: user A accessing user B's resource.

### CSRF

- State-changing routes (`POST`, `PUT`, `PATCH`, `DELETE`) without CSRF token validation in cookie-auth contexts.
- `SameSite=None` cookies on auth tokens without explicit need.

### OAuth / OIDC pitfalls

- Implicit flow used for new code (deprecated).
- `state` parameter not generated, not validated, or globally constant.
- `redirect_uri` accepted from request and not validated against an allowlist.
- PKCE not used on public clients.

---

## Domain 4 — Misconfiguration, transport, headers, crypto, dependencies  (`scanner-config`)

### HTTP security headers (missing / wrong)

- `Content-Security-Policy` absent or `unsafe-inline` / `unsafe-eval` for scripts.
- `Strict-Transport-Security` absent on HTTPS responses, or `max-age` < 6 months.
- `X-Frame-Options` absent and no `frame-ancestors` directive.
- `X-Content-Type-Options: nosniff` absent.
- `Referrer-Policy` absent or `unsafe-url`.
- `Permissions-Policy` absent on sensitive apps (camera, mic, geolocation).

### Cookies

- Auth-related cookie without `HttpOnly` → high.
- Auth-related cookie without `Secure` on HTTPS app → high.
- Auth-related cookie without `SameSite` (or `SameSite=None` without justification) → medium.
- Cookie max-age extremely long for session contexts → low.

### CORS

- `Access-Control-Allow-Origin: *` combined with `Access-Control-Allow-Credentials: true` (browser rejects but indicates misconfig) → high.
- Origin reflected from request without an allowlist → high.
- Wildcard `*` on an authenticated API → medium.

### TLS / transport

- `verify=False` / `rejectUnauthorized: false` / `InsecureSkipVerify: true` / `ServicePointManager.ServerCertificateValidationCallback = (…) => true` — disables cert validation.
- `http://` URLs for OAuth callbacks, webhook endpoints, login forms, or any state-changing op.
- Outbound HTTP to an API that exists on HTTPS.

### Cryptography

- Algorithm primitives for security purposes:
  - `MD5`, `SHA1`, `SHA-1` for signatures, integrity-of-trust, password hashing.
  - `DES`, `3DES`, `RC4`, `Blowfish` for new code.
  - AES with `ECB` mode (`Cipher.getInstance("AES/ECB/…")`).
  - AES-CBC without an HMAC.
  - Static / hard-coded IVs.
- RNG misuse — `Math.random()`, `Random()` (Java), `rand()` (C/C++), `System.Random` for security tokens. Required: `crypto.randomBytes`, `SecureRandom`, `RNGCryptoServiceProvider` / `RandomNumberGenerator`, `secrets` (Python).
- Key derivation — using a password as a key directly without PBKDF2 / scrypt / argon2.

### Configuration & deploy

- Debug mode flags shipped: `DEBUG = True` (Django), `app.debug = True` (Flask), `NODE_ENV !== 'production'` guarded code that doesn't actually guard, `<customErrors mode="Off"/>` in `web.config`, `ASPNETCORE_ENVIRONMENT=Development` in prod compose files.
- Default credentials in code or config (`admin/admin`, `root/root`, `postgres/postgres` in a non-local compose).
- Permissive file permissions in setup (`chmod 777`, world-writable defaults).
- Verbose error pages that leak stack traces to the client.
- Exposed management endpoints — Spring Actuator `/actuator/*` without auth, Django admin reachable without IP allowlist, Swagger UI in production without auth.

### Dependencies (pre-fed to the agent by the skill)

- `npm audit` / `pnpm audit` / `yarn audit` output (parsed for high/critical advisories).
- `pip-audit` / `safety check`.
- `dotnet list package --vulnerable --include-transitive`.
- `govulncheck`.
- `cargo audit`.
- `bundle audit`.
- For each advisory: severity, package, installed version, fixed version, path to reach.

### Logging & monitoring

- Auth events (login success/fail, password reset, MFA enroll) not logged.
- PII or full request bodies logged at `info` / `debug`.
- Exceptions swallowed silently in security-relevant code paths (auth, payment, file upload).
- No request ID / correlation ID — observability gap, file as `info`.

---

## Cross-domain rules

- **Anchor every finding** to a `file:line`. No "somewhere in the repo".
- **Read context** before reporting — many regex hits are in comments, tests, or docs.
- **Confidence tier** on each finding:
  - `confirmed` — read the code, the bug is real.
  - `likely` — pattern matches, context suggests bug, but a runtime check would prove it.
  - `suspected` — pattern matches but the path may not be reachable; downgrade severity by one tier OR file as a question.
- **Group near-duplicates** — if the same anti-pattern appears 12 times in 12 controllers, file ONE finding with a list of locations, not 12 findings.
- **CWE / OWASP mapping** — include the CWE-ID and OWASP-A-N for every finding where one applies. The HTML report renders these as badges.

## OWASP Top 10 (2021) → domain mapping

| OWASP | Owner |
|---|---|
| A01 Broken Access Control | scanner-auth |
| A02 Cryptographic Failures | scanner-config (crypto), scanner-secrets (leaked keys) |
| A03 Injection | scanner-injection |
| A04 Insecure Design | coverage-auditor (systemic) |
| A05 Security Misconfiguration | scanner-config |
| A06 Vulnerable & Outdated Components | scanner-config (deps) |
| A07 ID & Auth Failures | scanner-auth |
| A08 Software & Data Integrity Failures | scanner-injection (deser), scanner-config (deps/integrity) |
| A09 Security Logging & Monitoring Failures | scanner-config (logging) |
| A10 SSRF | scanner-injection |
