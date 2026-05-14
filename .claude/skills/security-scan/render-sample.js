// One-shot helper: renders report-template.html with realistic sample data
// so a human can open the result and judge the visual.
// Run from the skill folder:  node render-sample.js
//
// This is also a reference implementation of the substitution rules the
// orchestrator must follow when rendering a real report.

const fs = require('fs');
const path = require('path');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'report-template.html'), 'utf8');

const esc = s =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function renderSections(tpl, ctx) {
  // {{#key}}...{{/key}} — array OR truthy scalar
  return tpl.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, inner) => {
    const v = ctx[key];
    if (Array.isArray(v)) {
      if (v.length === 0) return '';
      return v.map(item => renderScalars(renderSections(inner, item), { ...ctx, ...item })).join('');
    }
    if (v) {
      // truthy scalar — render block once with current ctx (so {{cwe}} inside resolves)
      return renderScalars(inner, ctx);
    }
    return '';
  });
}

function renderScalars(tpl, ctx) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in ctx)) return '';
    return esc(ctx[key]);
  });
}

function render(tpl, ctx) {
  return renderScalars(renderSections(tpl, ctx), ctx);
}

// === Sample data ====================================================

const findings = [
  {
    id: 'F-001',
    severity: 'critical',
    domain: 'secrets',
    confidence: 'confirmed',
    title: 'AWS access key hard-coded in src/config/aws.ts',
    file_line: 'src/config/aws.ts:14',
    cwe: 'CWE-798',
    cwe_num: '798',
    owasp: 'A02:2021',
    issue: 'A live-looking AWS access key ID and secret are committed in tracked source, not loaded from environment variables. Anyone with read access to the repository has these credentials.',
    evidence:
`export const awsConfig = {
  region: "us-east-1",
  accessKeyId: "AKIA****************",     // redacted
  secretAccessKey: "wJalr****************",// redacted
};`,
    impact: 'A reader of the repository can authenticate to the production AWS account. Depending on the IAM policy attached, this ranges from data exfiltration to full account takeover.',
    fix: 'Rotate the key in IAM immediately. Remove the literal from source and load via `process.env.AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Add `src/config/aws.ts` to `.gitignore` if it must hold secrets, or replace with an IAM role on the host. Note: the key remains compromised in git history — rotation is mandatory, history rewriting is optional.',
    severity_justification: 'Confirmed live credential in tracked source on a public-facing repo branch.',
    references: 'OWASP Secrets Management Cheat Sheet · CWE-798 · AWS IAM key rotation runbook',
    search_blob: 'aws access key hard-coded src/config/aws.ts cwe-798 a02 secrets',
  },
  {
    id: 'F-002',
    severity: 'critical',
    domain: 'injection',
    confidence: 'confirmed',
    title: 'SQL injection in /api/orders search filter',
    file_line: 'src/api/orders/search.ts:38',
    cwe: 'CWE-89',
    cwe_num: '89',
    owasp: 'A03:2021',
    issue: 'The `q` query parameter is concatenated into a raw SQL string and passed to `sequelize.query` without parameterisation. The route is authenticated but available to any standard user.',
    evidence:
`router.get("/api/orders", requireAuth, async (req, res) => {
  const q = req.query.q;
  const sql = \`SELECT * FROM orders WHERE customer_name LIKE '%\${q}%'\`;
  const rows = await sequelize.query(sql);
  res.json(rows);
});`,
    impact: 'Any authenticated user can read or modify arbitrary rows in the `orders` table (and any table reachable from the same DB user). Time-based blind SQLi works through the LIKE clause; UNION SELECT is reachable.',
    fix: 'Replace with parameterised query: `sequelize.query("SELECT ... WHERE customer_name LIKE :q", { replacements: { q: `%${q}%` } })`. Audit the other 4 controllers using `sequelize.query` (see theme T-001).',
    severity_justification: 'Direct user-controlled string interpolated into SQL; auth gate is present but does not constrain the input.',
    references: 'OWASP SQL Injection Prevention Cheat Sheet · CWE-89',
    search_blob: 'sql injection /api/orders search.ts cwe-89 a03 injection sequelize',
  },
  {
    id: 'F-003',
    severity: 'high',
    domain: 'auth',
    confidence: 'confirmed',
    title: 'IDOR on GET /api/users/:id — no ownership check',
    file_line: 'src/controllers/UserController.ts:42',
    cwe: 'CWE-639',
    cwe_num: '639',
    owasp: 'A01:2021',
    issue: 'The handler loads `User.findByPk(req.params.id)` and returns the record. There is no check that the requesting user is the same user, an admin, or otherwise authorized to read this profile.',
    evidence:
`router.get("/api/users/:id", requireAuth, async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).end();
  res.json(user);
});`,
    impact: 'Any authenticated user can enumerate sequential IDs and read every other user\'s profile, including the `email`, `phone`, and `address` columns returned in the JSON response.',
    fix: 'Either restrict to self (`if (req.user.id !== Number(req.params.id) && req.user.role !== "admin") return res.status(403).end();`) or load with the ownership predicate in the query.',
    severity_justification: 'Confirmed IDOR exposing PII fields; authenticated but unprivileged actors are sufficient.',
    references: 'OWASP IDOR Prevention · CWE-639',
    search_blob: 'idor users id ownership usercontroller.ts cwe-639 a01 auth',
  },
  {
    id: 'F-004',
    severity: 'high',
    domain: 'config',
    confidence: 'confirmed',
    title: 'TLS verification disabled in outbound payments client',
    file_line: 'src/integrations/payments/client.ts:9',
    cwe: 'CWE-295',
    cwe_num: '295',
    owasp: 'A02:2021',
    issue: 'The payments service HTTP client is constructed with `rejectUnauthorized: false`, disabling certificate validation for all outbound requests to the payments API.',
    evidence:
`export const paymentsClient = axios.create({
  baseURL: process.env.PAYMENTS_API_URL,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
});`,
    impact: 'An attacker positioned between the app and the payments API can present any TLS certificate and intercept or modify payment requests in flight, including amount, recipient, and authorization tokens.',
    fix: 'Remove `rejectUnauthorized: false`. If a private CA is required (rare), pass `ca: fs.readFileSync(...)` explicitly. Audit the rest of `src/integrations/**` — see theme T-002.',
    severity_justification: 'Disables a security control entirely on a money-handling path.',
    references: 'CWE-295 · Node TLS docs · OWASP Transport Layer Protection Cheat Sheet',
    search_blob: 'tls verification disabled rejectunauthorized payments client.ts cwe-295 a02 config',
  },
  {
    id: 'F-005',
    severity: 'medium',
    domain: 'config',
    confidence: 'confirmed',
    title: 'Auth cookie set without HttpOnly and without SameSite',
    file_line: 'src/middleware/session.ts:27',
    cwe: 'CWE-1004',
    cwe_num: '1004',
    owasp: 'A05:2021',
    issue: 'The session cookie is set without the `HttpOnly` flag and without an explicit `SameSite` directive. The `Secure` flag is conditional on `NODE_ENV === "production"`, but the deployed staging environment is not `production` and is internet-reachable.',
    evidence:
`res.cookie("sid", sessionId, {
  secure: process.env.NODE_ENV === "production",
  maxAge: 1000 * 60 * 60 * 24 * 30,
});`,
    impact: 'XSS anywhere in the SPA can read the cookie and exfiltrate the session. The missing `SameSite` allows cross-site requests to attach the cookie, enabling CSRF in browsers that default to None.',
    fix: 'Set `httpOnly: true` and `sameSite: "lax"` (or `strict` if no cross-site flows). Make `secure: true` unconditional and use a separate dev-only override file rather than runtime branching.',
    severity_justification: 'Defense-in-depth — exploitation requires a second bug (XSS or CSRF), but those are cheap to find.',
    references: 'OWASP Session Management Cheat Sheet · MDN: Set-Cookie',
    search_blob: 'cookie httponly samesite session.ts cwe-1004 a05 config',
  },
  {
    id: 'F-006',
    severity: 'low',
    domain: 'config',
    confidence: 'confirmed',
    title: 'CSP missing `frame-ancestors`; relies only on X-Frame-Options',
    file_line: 'src/middleware/headers.ts:11',
    cwe: 'CWE-1021',
    cwe_num: '1021',
    owasp: 'A05:2021',
    issue: 'CSP is configured but does not include a `frame-ancestors` directive. `X-Frame-Options: DENY` is set as a fallback, which works for modern browsers but is the legacy mechanism.',
    evidence:
`app.use(helmet.contentSecurityPolicy({
  directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"] }
}));
app.use(helmet.frameguard({ action: "deny" }));`,
    impact: 'A spec-compliant CSP should include `frame-ancestors`. Current behaviour is correct for now but is implicit on a deprecated header.',
    fix: 'Add `frameAncestors: ["\\\'none\\\'"]` to the helmet CSP directives.',
    severity_justification: 'Hardening gap; not exploitable in current code.',
    references: '',
    search_blob: 'csp frame-ancestors headers.ts cwe-1021 a05 config helmet',
  },
  {
    id: 'F-007',
    severity: 'info',
    domain: 'design',
    confidence: 'confirmed',
    title: 'Custom crypto wrapper present in src/utils/crypto.ts',
    file_line: 'src/utils/crypto.ts:1',
    cwe: '',
    cwe_num: '',
    owasp: '',
    issue: 'The codebase contains a custom AES-GCM wrapper around `node:crypto`. The implementation appears correct (random IV per message, AEAD tag check) but custom crypto warrants a peer review on principle.',
    evidence:
`export function encrypt(plain, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  ...
}`,
    impact: 'No exploit identified. Flagged for visibility — refactors of this file should be reviewed by security.',
    fix: 'Annotate the file with a `// security:reviewed YYYY-MM-DD by NAME` marker; route future PRs through a security review.',
    severity_justification: 'Informational — observation, not a vulnerability.',
    references: '',
    search_blob: 'custom crypto wrapper utils crypto.ts design info',
  },
];

const data = {
  project_name: 'Acme Orders API',
  generated_short: '2026-05-12 14:30',
  generated_long: 'Tuesday, May 12 2026 at 14:30 UTC+3',
  scope: 'C:/work/acme/orders-api/src',
  stack: 'TypeScript 5.4 · Node 20 · Express 4 · PostgreSQL 16',
  file_count: '438',
  depaudit_summary: 'npm: 1 critical, 4 high, 12 moderate, 31 low',

  grade_letter: 'F',
  grade_text: 'Critical issues present',

  executive_summary:
    'The audit found two critical issues that block release: a hard-coded AWS access key in tracked source (F-001), and a SQL-injection vector on /api/orders behind a normal-user authentication gate (F-002). Authorization is the dominant systemic weakness — four endpoints lack ownership checks (F-003 and three siblings). Dependency posture is moderate: 1 critical and 4 high advisories, all in directly imported packages. Header and cookie configuration is mostly in place but has a `Secure`-on-prod-only flag that does not match the deployed environments. Fix the two criticals in this PR; the rest fits in one sprint.',

  n_critical: 2, n_critical_confirmed: 2,
  n_high: 2, n_high_confirmed: 2,
  n_medium: 1, n_medium_confirmed: 1,
  n_low: 1, n_low_confirmed: 1,
  n_info: 1,
  n_total: 7,
  n_questions: 2,
  n_dismissals: 14,

  findings,

  themes: [
    { theme_title: 'T-001 · Raw `sequelize.query` used in 5 controllers', theme_detail: 'F-002 plus four siblings in src/api/{customers, products, invoices, refunds}/search.ts use the same pattern. Recommend a shared `safeQuery()` helper and an ESLint rule banning literal-template SQL.' },
    { theme_title: 'T-002 · TLS verification disabled in two outbound clients', theme_detail: 'F-004 (payments) and a similar pattern in `src/integrations/inventory/client.ts:11`. Centralise outbound HTTP via a single hardened factory and forbid `rejectUnauthorized: false` via lint.' },
    { theme_title: 'T-003 · `process.env.NODE_ENV === "production"` used as a security gate', theme_detail: 'Cookies, debug-error pages, and CORS all branch on this. Staging is not production but is internet-reachable — controls degrade silently there. Replace with explicit `SECURITY_PROFILE=strict|dev` resolved at boot.' },
  ],

  roadmap_now: [
    { id: 'F-001', title: 'Rotate AWS key, remove from source', effort: 'S', owner: 'devops' },
    { id: 'F-002', title: 'Parameterise /api/orders search SQL', effort: 'S', owner: 'dev' },
  ],
  roadmap_soon: [
    { id: 'F-003', title: 'Add ownership checks to /api/users/:id and siblings', effort: 'M', owner: 'dev' },
    { id: 'F-004', title: 'Re-enable TLS verification on payments client', effort: 'S', owner: 'dev' },
    { id: 'F-005', title: 'Tighten session cookie flags', effort: 'S', owner: 'dev' },
  ],
  roadmap_planned: [
    { id: 'F-006', title: 'Add CSP `frame-ancestors`', effort: 'S', owner: 'dev' },
    { id: 'F-007', title: 'Tag custom-crypto wrapper for security review', effort: 'S', owner: 'security' },
    { id: 'T-001', title: 'Introduce safeQuery() helper + ESLint rule', effort: 'M', owner: 'dev' },
    { id: 'T-003', title: 'Replace NODE_ENV gates with SECURITY_PROFILE', effort: 'M', owner: 'dev' },
  ],

  surfaces: [
    { surface: 'HTTP endpoints', count: '47', touched: 'yes (scanner-auth, scanner-injection)' },
    { surface: 'GraphQL resolvers', count: '0', touched: 'n/a' },
    { surface: 'Message-queue workers', count: '6', touched: 'partial (2 of 6)' },
    { surface: 'Helm / k8s manifests', count: '14', touched: 'NO — gap' },
    { surface: 'Terraform', count: '0', touched: 'n/a' },
    { surface: 'Custom crypto utils', count: '1', touched: 'yes (scanner-config)' },
    { surface: 'Configuration files', count: '23', touched: 'yes (scanner-secrets, scanner-config)' },
  ],

  coverage_gaps: [
    { priority: 'next-run', gap: 'Helm chart values not reviewed', action: 'Re-run `/security-scan helm/` after this PR ships' },
    { priority: 'follow-up', gap: '4 of 6 background workers not inspected for taint flow', action: 'Add `src/workers/**` to the next scan scope' },
    { priority: 'nice-to-have', gap: 'No GraphQL surface — confirm none is planned', action: 'No action needed unless the roadmap adds GraphQL' },
  ],

  questions: [
    { question: 'Is /api/public/feed intentionally unauthenticated?', context: 'src/routes/public.ts:8', asker: 'scanner-auth', owner: 'product BA' },
    { question: 'Is the `inventory` integration TLS endpoint a private internal service?', context: 'src/integrations/inventory/client.ts:11', asker: 'scanner-config', owner: 'platform team' },
  ],

  posture_recs: [
    { rec: 'Enable Dependabot for npm and Docker', why: 'No `.github/dependabot.yml` present; 17 advisories aged > 6 months' },
    { rec: 'Add `SECURITY.md` with disclosure policy', why: 'No public disclosure path; reporters currently have nowhere to send findings' },
    { rec: 'Add a `gitleaks` pre-commit hook', why: 'F-001 would have been caught locally before push' },
    { rec: 'Add `npm audit --omit=dev --audit-level=high` to CI', why: 'Currently no automated check for vulnerable packages on PR' },
  ],

  dismissals: [
    { severity: 'critical', title: 'AWS key in tests/fixtures/aws.json', source: 'scanner-secrets', reason: 'Value is `AKIAIOSFODNN7EXAMPLE` — documented AWS placeholder' },
    { severity: 'high', title: 'Missing auth on GET /healthz', source: 'scanner-auth', reason: 'Intentionally public liveness probe' },
    { severity: 'high', title: 'eval() in scripts/build/compile.js', source: 'scanner-injection', reason: 'Build-time only, runs on a literal template, never sees runtime input' },
    { severity: 'medium', title: 'MD5 usage in src/cache/etag.ts', source: 'scanner-config', reason: 'Used as ETag, no security purpose' },
    { severity: 'medium', title: '11 `Math.random()` calls in src/ui/animations/*', source: 'scanner-config', reason: 'Visual jitter, not security tokens' },
  ],
};

const html = render(TEMPLATE, data);
const outDir = path.join(__dirname, '..', '..', '..', 'security');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'security-report-sample.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('Wrote', outPath, '(' + html.length + ' chars)');
