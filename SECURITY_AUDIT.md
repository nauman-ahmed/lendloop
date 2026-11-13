# LendLoop: Security & Privacy Audit

| | |
| --- | --- |
| **Date** | 12 November 2026 (updated 13 November 2026) |
| **Commit audited** | `7683698` (`main`) |
| **Status** | Medium findings LL-01 to LL-04 and Low findings LL-05, LL-07 and LL-08 **resolved and re-tested**; the other Low and Informational findings are open (see [Remediation plan](#remediation-plan)) |
| **Scope** | Next.js app (`app/`, `components/`, `lib/`, `middleware.ts`), Convex backend (`convex/`), n8n workflows and deployment (`n8n/`), dependencies (`package-lock.json`) |
| **Out of scope** | Clerk, Convex and n8n platform internals; hosting and network configuration of a production deployment |

## Summary

No critical or high-severity issues were found in LendLoop's own code.
Authorization is enforced server-side in every public Convex function,
users cannot escalate their own role, and both directions of the n8n
integration are signed.

The findings are mostly hardening and operational issues around the n8n
deployment, abuse prevention, and a few places where the design is weaker
than the README's claims ("never fail silently", "nothing leaves n8n
unverified"). All four Medium findings have since been fixed and re-tested,
and so have three of the Low findings (LL-05, LL-07, LL-08). Each fixed
finding has a **Resolution** note below.

| Severity | Count | IDs | Status |
| --- | --- | --- | --- |
| Critical | 0 | | |
| High | 0 | | |
| Medium | 4 | LL-01, LL-02, LL-03, LL-04 | **Resolved** |
| Low | 7 | LL-05 to LL-11 | LL-05, LL-07, LL-08 **resolved**; LL-06, LL-09, LL-10, LL-11 open |
| Informational | 2 | LL-12, LL-13 | Open (LL-13 partly mitigated by the LL-01 fix) |

Severity reflects likelihood × impact *for this application as deployed by
the README*. The dependency scan reports one "high" advisory; for the
reasons in [LL-11](#ll-11-dependency-advisories-build--and-dev-time-only) it is rated Low here.

## Methodology

- **Manual review** of every public Convex query, mutation and HTTP action against its authorization check (see [Access-control matrix](#access-control-matrix)), plus all n8n Code nodes and the docker-compose file.
- **Dynamic testing** against a local Convex backend and n8n 2.47.5 in Docker:
  - signed, replayed, tampered, stale and unsigned webhook calls;
  - a reminder workflow run twice;
  - a simulated channel outage to exercise retries and the error workflow.
- **Targeted probes**: a throwaway `convex-test` case for cross-endpoint replay (LL-05), and a grep for HTML/JS injection sinks.
- **Automated checks**: `npm audit`, `npm outdated`, TypeScript strict typecheck, ESLint, and the test suite (`npm test`: 25 tests at audit time, 32 after the Medium fixes, 39 after the Low fixes).
- **Secret scan**: every tracked file was searched for the values in the local `.env` files. None found.

---

## Findings

### LL-01: Any n8n workflow editor can read every container secret, including the n8n encryption key

**Severity:** Medium · **Location:** `n8n/docker-compose.yml:24`

The Code nodes need `$env` to read the HMAC secrets, so env access is
re-enabled (`N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"`). That exposes the
*whole* container environment to anyone who can create or edit a workflow:

- both signing secrets;
- `N8N_ENCRYPTION_KEY`, which decrypts every credential stored in n8n.

The README says editors can read "them" (the signing secrets) but doesn't
mention the encryption key.

**Impact:** a compromised or over-privileged n8n editor account can forge
requests in both directions and decrypt every credential stored in n8n.

**Recommendation:**

- Pass the encryption key as a file instead (`N8N_ENCRYPTION_KEY_FILE` pointing at a Docker secret), so `$env` only reveals a path.
- Move the HMAC secrets to n8n External Secrets (`$secrets.*`) and set `N8N_BLOCK_ENV_ACCESS_IN_NODE` back to `true`.
- Limit workflow-edit rights to the owner account.

> **Resolution: resolved.**
>
> - The key is now a Docker secret file mounted via `N8N_ENCRYPTION_KEY_FILE` (`n8n/docker-compose.yml`, `n8n/secrets/`, git-ignored). It's no longer an environment variable, so `$env` and `docker inspect` don't show it.
> - Workflow-edit rights are documented as owner-only.
> - **Verified** with a probe workflow in a throwaway n8n 2.47.5 instance:
>   - `$env.N8N_ENCRYPTION_KEY` is empty and only the file path is visible.
>   - The Read/Write Files node is refused ("Access to the file is not allowed").
>   - `require('fs')` is disallowed in Code nodes.
>   - Existing credentials still decrypt.
> - **Residual risk:** the two HMAC secrets remain readable by workflow editors, because Code nodes need them. Moving them to n8n External Secrets is listed under production changes.

### LL-02: Suggested tunnel exposes the n8n editor to the internet

**Severity:** Medium · **Location:** `README.md:103`

For cloud Convex deployments the README suggests
`cloudflared tunnel --url http://localhost:5678`. That publishes the **whole**
n8n instance, including the editor and REST API, not just the webhook path
Convex needs. Compose binds n8n to `127.0.0.1` (`n8n/docker-compose.yml:59`),
but the tunnel undoes that protection.

**Impact:** the n8n login page and API are reachable by anyone. Combined
with a weak owner password, or with LL-01, this exposes everything n8n can
reach.

**Recommendation:** route only `/webhook/*` publicly, using a cloudflared
ingress rule with a `path` filter or a reverse proxy with an allow-list.
Keep the editor on localhost or a VPN. Alternatively use n8n Cloud.

> **Resolution: resolved.**
>
> - Added a `webhook-gateway` service (Caddy 2.11.9, `n8n/Caddyfile`) on `127.0.0.1:8080`. It forwards only `POST /webhook/lendloop-loan-events`, caps bodies at 64 KB, and returns 404 for everything else.
> - The README now says to expose the gateway, never port 5678.
> - **Verified live:**
>   - The signed webhook is delivered through the gateway.
>   - `/`, `/signin`, `/rest/settings`, `/api/v1/workflows`, other webhooks, `/webhook-test/…` and a `../` traversal all return 404.
>   - A 70 KB body returns 413.

### LL-03: No rate limiting on requests or listings, so notifications can be used for spam

**Severity:** Medium · **Location:** `convex/loans.ts:38` (`request`), `convex/tools.ts:128` (`create`)

Any signed-in user can create unlimited listings and unlimited
non-overlapping borrow requests. The only guard is overlap with the same
borrower's pending requests (`convex/loans.ts:53-58`). Each request triggers
an n8n notification to the lender. Once a real email channel replaces the
mock, a single account can flood a neighbour's inbox, burn the sending
quota and grow the database without bound.

**Impact:** harassment of individual users, cost and quota exhaustion, and
damage to the sender reputation of the email domain.

**Recommendation:**

- Add per-user limits in the mutations, e.g. `@convex-dev/rate-limiter`: about 10 requests per hour, a cap on open requests per borrower and per tool, and about 20 listings per user.
- Have n8n collapse bursts into a digest.
- Let lenders block a borrower.

> **Resolution: resolved.**
>
> - New `convex/lib/limits.ts`, enforced inside `loans.request` and `tools.create`, using indexed, bounded reads. The new `RATE_LIMITED` error is shown inline in the UI. Limits:
>   - per borrower: 10 requests per hour and 10 unanswered requests;
>   - per tool: 15 pending requests across *all* accounts, so several accounts can't flood one lender;
>   - per user: 10 new listings per hour and 50 in total.
> - **Verified** by four new tests, each isolating one limit and checking that it resets when the window passes or a request is cancelled.
> - **Residual risk:** a determined attacker with many accounts can still spread requests over many tools. Per-lender limits and blocking are listed under production changes.

### LL-04: Email verification fails open, and admin promotion is keyed on email

**Severity:** Medium · **Location:** `convex/users.ts:21`, `convex/admin.ts:118`

`ensureViewer` drops the email only when the token explicitly says
`email_verified: false`. If the claim is missing, which is the default with
Clerk's native Convex integration unless the session token is customised,
the email is stored unverified. That address then:

- receives loan notifications and reminders;
- is how `admin:setRole` finds the account to promote.

Clerk normally verifies addresses at sign-up, so exploitation depends on
the Clerk instance's settings. But the code shouldn't rely on that.

**Impact:** notifications can be pointed at an address the user doesn't
own. If an operator promotes "the user with email X" and the address was
never verified, the wrong account can become admin.

**Recommendation:**

- Fail closed: store the email only when `identity.emailVerified === true`.
- Change `setRole` to take the Convex user id (or Clerk `subject`), shown on the admin page, instead of an email.

> **Resolution: resolved.**
>
> - `ensureViewer` now stores an email only when `emailVerified === true`. A missing or false claim clears any stored address.
> - `admin:setRole` takes a `userId`, and a new internal query `admin:listAccounts` lists ids for the operator. The README documents both, and that the `email_verified` claim is required.
> - **Verified** by three new tests:
>   - verified, unverified and missing claims;
>   - an account whose address becomes unverified is cleared;
>   - promotion by id.

### LL-05: Signatures are not bound to the endpoint, allowing cross-endpoint replay (confirmed)

**Severity:** Low · **Location:** `convex/http.ts:31-46`, `convex/lib/signing.ts`

All three n8n → Convex endpoints share one secret and sign only
`timestamp.body`. Zod objects strip unknown keys by default, so a body
signed for one endpoint can validate on another. A probe confirmed it: a
body signed for `/n8n/reminders` was accepted by `/n8n/overdue-loans`, which
returned HTTP 200.

**Impact:** limited today. The only cross-endpoint replay that validates
returns the overdue-loan list, which is the same data the attacker could
get by replaying a captured `overdue-loans` call (see LL-06). It becomes
serious as soon as two endpoints accept overlapping bodies with different
side effects.

**Recommendation:**

- Sign `${timestamp}.${method}.${path}.${body}` and verify against the actual request path.
- Use `.strict()` on endpoint schemas so unexpected keys are rejected.

> **Resolution: resolved.**
>
> - Signatures are now `v2=HMAC_SHA256(secret, "<timestamp>\n<METHOD>\n<path>\n<body>")` in both directions (`convex/lib/signing.ts` and the three n8n workflows).
>   - Each Convex endpoint verifies against the method and path it is registered under, not values read from the request.
>   - The fields are separated by newlines rather than dots. A URL path can't contain a raw newline, so moving characters between path and body never produces the same signed string.
>   - The n8n Code nodes return the URL they signed, and the HTTP Request nodes post to it, so the signed path and the called path can't drift apart.
> - Endpoint bodies use `z.strictObject`: unknown keys return 400 instead of being dropped.
> - **Verified** by three new tests (cross-endpoint replay returns 401, unknown keys return 400, the field separator) and live against n8n 2.47.5 and a local Convex backend:
>   - the original probe (a body signed for `/n8n/reminders`, sent to `/n8n/overdue-loans`) now returns 401;
>   - `v1` signatures are rejected in both directions;
>   - a real loan request was delivered Convex → n8n with the new scheme (HTTP 200 on the first attempt), and the error workflow's signed report was recorded.
> - **Deployment note:** `v1` signatures are no longer accepted, so Convex and the n8n workflows must be updated together.

### LL-06: Five-minute replay window on the Convex endpoints

**Severity:** Low · **Location:** `convex/lib/signing.ts:11`, `convex/http.ts`

Stale timestamps are rejected, but within ±5 minutes the same signed
request can be replayed any number of times. Write endpoints are idempotent,
so replaying them is harmless. Replaying `/n8n/overdue-loans` returns
borrower first names and email addresses again. Exploitation requires
capturing a request in transit, which is hard over TLS.

**Recommendation:** store seen signatures in a Convex table and reject
repeats within the window, deleting them with a scheduled TTL cleanup. Or
include a single-use nonce in the signed material.

### LL-07: No HTTP security headers

**Severity:** Low · **Location:** `next.config.ts`

The Next.js config sets no `Content-Security-Policy`, `X-Frame-Options` /
`frame-ancestors`, `Strict-Transport-Security`, `X-Content-Type-Options` or
`Referrer-Policy`. React's escaping covers XSS today (no `dangerouslySetInnerHTML`,
`innerHTML` or `eval` anywhere), but the app could be framed for clickjacking,
for example on the "Approve" and "Remove listing" buttons, and has no defence
in depth if an XSS bug is introduced later.

**Recommendation:** add `headers()` in `next.config.ts` with:

- a CSP allowing self, Clerk's frontend API and the Convex URL;
- `frame-ancestors 'none'`;
- `nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- HSTS in production.

> **Resolution: resolved.**
>
> - `middleware.ts` enables Clerk's CSP support in **strict** mode: a fresh nonce per request plus `'strict-dynamic'`, so only nonced scripts (Next.js's and Clerk's) and the scripts they load can run. Injected inline or third-party scripts are blocked.
>   - Clerk's defaults already allow its frontend API, images and bot protection.
>   - Added: `connect-src` for the Convex HTTPS and WebSocket origin, `frame-ancestors 'none'`, `object-src 'none'` and `base-uri 'self'`.
> - `<ClerkProvider dynamic>` moved from a client component into the root layout. Pages now render per request, so Next.js and Clerk can stamp the nonce on their `<script>` tags.
> - `next.config.ts` adds `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, a restrictive `Permissions-Policy`, and HSTS in production. It also drops `X-Powered-By`.
> - **Verified** in a browser against the local backend, with a placeholder Clerk key:
>   - all headers are present and every script tag carries the request's nonce;
>   - the page hydrates and the Convex WebSocket connects with no CSP violations.
>   - The first version kept `ClerkProvider` in a client component, and the CSP blocked Clerk's script. That's why it moved to the layout. Clerk's script tag now carries the nonce.
> - **Not yet verified:** sign-in with real Clerk keys (the sign-in modal and Cloudflare bot protection). It is part of the signed-in UI walkthrough.
> - **Trade-offs:** `script-src` keeps `'unsafe-inline'` only as a fallback for browsers without nonce support; browsers that support nonces ignore it. `style-src 'unsafe-inline'` remains, because Clerk injects styles at runtime.

### LL-08: Some automation gaps are silent, contrary to the design goal

**Severity:** Low · **Location:** `convex/automation.ts:34`, `convex/automation.ts:22`, `convex/tools.ts` (`take(200)`)

- Overdue loans whose borrower has no stored email are skipped with `continue` and leave no record. No reminder is sent and nobody is told.
- The overdue query takes at most 500 loans and catalogue queries take at most 200 tools. Anything beyond that is silently dropped.

**Impact:** borrowers can stay overdue indefinitely without anyone
noticing, which undermines the "failed runs are visible" requirement.

**Recommendation:**

- Record a `failed` reminder event (`detail: "no email on file"`) so it appears in the admin failure panel.
- Paginate the overdue query in the workflow (cursor loop), and paginate catalogue queries in the UI.

> **Resolution: resolved.**
>
> - **No email on file:** `/n8n/overdue-loans` records these loans as failed reminders (label `overdue_reminder:none`, detail "No verified email on file…").
>   - They appear under **Admin → Automation failures** and on the loan card.
>   - They are retried on every run until the borrower has a verified email.
>   - Only loan ids reach this code path, so nothing about the borrower is sent to n8n.
> - **Overdue paging:** the endpoint returns 100 loans per page plus a `nextCursor`.
>   - A new **More pages?** node loops back with the cursor and the same `asOf` until the cursor is `null`.
>   - A 50-page guard fails the run, and so reaches the error workflow, rather than looping forever.
>   - Paging walks the index itself, so loans already reminded today never block the ones after them.
> - **Catalogue paging:** `tools.listPublic` and `tools.list` use Convex `paginate`, with the page size capped at 50 on the server. The public page, Browse and the admin listing have a **Load more** button.
> - **Verified** by four new tests and live:
>   - tests: no-email loans recorded and visible to admins; 106 overdue loans walked across pages with none missed or repeated; catalogue paging; the page-size cap;
>   - live, with the page size temporarily set to 2: the workflow walked 3 pages (2 + 2 + 1 loans) and recorded 5 reminders. A second run walked the same pages and sent nothing.
> - **Still capped:** the admin views (latest 200 loans, 500 users) and a user's own listings (bounded by the 50-listing limit). These are display windows, not automation inputs.

### LL-09: n8n duplicate suppression is not atomic

**Severity:** Low · **Location:** `n8n/workflows/lendloop-loan-event-notifications.json` (Verify signature / Remember delivered event nodes)

Delivered `eventId`s are tracked in workflow static data, which:

- is read at the start of an execution and written at the end, so two concurrent deliveries of the same event (e.g. a Convex retry overlapping a slow first attempt) can both pass the check;
- is persisted only for production executions;
- keeps just the last 1,000 ids.

**Impact:** an occasional duplicate notification. No data integrity
impact, because Convex-side state is idempotent.

**Recommendation:** use an atomic store for idempotency, such as a Redis
`SET NX` or a Postgres unique insert keyed on `eventId` before sending.

**Related (found while re-testing LL-05):** Convex deduplicates workflow
errors by n8n execution id (`workflow_error:<id>`). Execution ids restart at
1 when n8n's database is recreated (`docker compose down -v`). After a
reset, a new failure that reuses an old id would be treated as a duplicate
and not shown. Fix: include a per-instance id or the failure time in the key.

### LL-10: No account deletion or data retention

**Severity:** Low (privacy) · **Location:** `convex/users.ts`, `convex/schema.ts`

Deleting a user in Clerk doesn't affect Convex. The user's name, email,
listings and loan history stay indefinitely, as do `automationEvents`.
There's no self-service deletion or export.

**Impact:** personal data is kept longer than needed. This would matter
for GDPR/CCPA compliance (and similar regimes in healthcare contexts).

**Recommendation:**

- Handle Clerk's `user.deleted` webhook in a Svix-verified Convex HTTP action: anonymise the user and delete their listings.
- Add a scheduled job that prunes `automationEvents` after N days.
- Document the retention periods.

### LL-11: Dependency advisories (build- and dev-time only)

**Severity:** Low · **Location:** `package-lock.json`

`npm audit` reports 8 advisories (1 high, 7 moderate):

| Package | Advisories | Reachability in LendLoop |
| --- | --- | --- |
| `postcss` < 8.5.x, **bundled inside `next@15.5.29`** | GHSA-qx2v-qp2m-jg93 (XSS in stringify output), GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 (source-map file disclosure) | Runs at **build time** on the project's own CSS only, with no user-supplied CSS, so it is not exploitable in this app. |
| `minimatch` via `@typescript-eslint/*` | GHSA-g3hv-75wg-m249 (ReDoS) | ESLint only. Dev dependency, never shipped. |

`next@15.5.29` is the newest 15.x release. The PostCSS fix ships only in
Next 16 (`16.4.6`). React is already on the patched `19.1.10` line.

**Recommendation:** schedule an upgrade to Next 16 (also `eslint-config-next@16`)
and check the Clerk and Convex peer ranges. Until then, accept the risk:
build-time only, first-party input.

### LL-12: Demo seed functions ship to every deployment

**Severity:** Informational · **Location:** `convex/seed.ts`

`seed:demo` and `seed:overdueLoan` are internal, so clients can't call them.
They are still deployed everywhere, and an operator could run them against
production by mistake and create fake users and an overdue loan.

**Recommendation:** refuse to run unless an `ALLOW_SEED=true` environment
variable is set, or exclude the module from production deploys.

### LL-13: Secrets visible through `docker inspect`

**Severity:** Informational · **Location:** `n8n/docker-compose.yml`

Environment variables, including secrets, are visible to anyone with
access to the Docker daemon on the host. That is normal for Compose
setups, but worth noting alongside LL-01.

**Recommendation:** use Docker secrets (`*_FILE` variables) or a secrets
manager in production.

> **Partly mitigated** by the LL-01 fix: the encryption key is now a secret
> file. The two HMAC secrets are still environment variables.

---

## Controls verified as effective

| Control | Evidence |
| --- | --- |
| Server-side authorization on every public function | See the matrix below. The integration tests call each function as an unauthorized user and expect `UNAUTHENTICATED` or `FORBIDDEN`. |
| No privilege self-escalation | `ensureViewer` never writes `role` or `trustedLender`. `setRole` is an `internalMutation` that clients can't call (test: *ensureViewer never changes role*). |
| Public data minimisation | `listPublic` returns exactly `{id, name, category}` (test asserts the key set). |
| No email leakage between users | Loan views use first names only (test: *loan views never expose the other party's email*). Admin views omit emails too. |
| Minimal outbound payloads | The webhook body has the recipient's first name and email, the other party's first name and loan facts (test asserts the other party's email is absent). |
| Integrity of Convex → n8n | HMAC-SHA256 over the method, path and raw bytes, constant-time compare, ±5 min window, dedup. Live test: valid → 200, replay → *duplicate*, bad, stale, tampered or wrong-path signature → 401. |
| Integrity of n8n → Convex | Same scheme with a **separate** secret, verified against each endpoint's own path. Generic 401 for every verification failure, strict zod validation after verification (tests). |
| Idempotent write-backs | `reminderKey` and `executionId` keys. Live test: second reminder run → nothing to do. Tests: *created* then *duplicate*. A key can't be written against another loan (422). |
| Reliable delivery | Transactional outbox, retries with backoff (10 s → 30 min, 5 attempts), no retry on 4xx, failures shown to admins. Live outage test recovered on attempt 3. |
| Race safety | Convex mutations are serializable transactions, so two simultaneous approvals of overlapping loans can't both commit. |
| XSS | No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`. All output goes through React escaping. A strict nonce-based CSP blocks injected scripts as a second layer (LL-07). |
| Clickjacking | CSP `frame-ancestors 'none'` plus `X-Frame-Options: DENY` (LL-07). |
| CSRF | Convex calls carry a bearer JWT over WebSocket or `fetch`, not ambient cookies, so cross-site requests can't act as the user. |
| Secrets hygiene | `.env*` files are git-ignored except the templates. Exported workflows reference `$env` names only. Secret scan of tracked files: clean. |
| Input validation | Convex validators on every argument: enums, string length caps, strict calendar-date parsing, 30-day loans, 90-day booking horizon. |

### Access-control matrix

| Function | Who may call | Check |
| --- | --- | --- |
| `tools.listPublic` | anyone | Public by design; returns name + category only, at most 50 per page |
| `users.me` | anyone | Returns the caller's own record or `null` |
| `users.ensureViewer` | signed-in | Identity required; can't set role |
| `tools.list`, `tools.mine` | signed-in | `requireViewer` |
| `tools.create` | signed-in | `requireViewer` |
| `tools.update` | owner | `requireViewer` + `assertOwnsTool` |
| `tools.remove` | owner or admin | `requireViewer` + owner or `role === "admin"` |
| `loans.request` | signed-in, not the owner | `requireViewer` + `ownerId !== viewer` |
| `loans.approve` / `decline` / `markReturned` | lender of that loan | `loan.ownerId === viewer` |
| `loans.cancel` | borrower of that loan | `loan.borrowerId === viewer` |
| `loans.myRequests` / `incoming` | signed-in | Filtered by the caller's id through an index |
| `admin.*` (public) | admin | `requireAdmin` |
| `admin.setRole`, `automation.*`, `notifications.*`, `seed.*` | deployment credentials only | `internal*` functions |
| `POST /n8n/*` | n8n | HMAC signature bound to the endpoint's method and path (LL-05, resolved); 5-minute replay window (LL-06) |

---

## Remediation plan

| Priority | Findings | Status |
| --- | --- | --- |
| Before any public deployment | LL-01 (secret-file key, owner-only editors), LL-02 (gateway exposes only the webhook), LL-03 (abuse limits), LL-04 (fail-closed email, `setRole` by id) | **Done** |
| Next iteration | LL-05 (path-bound signatures, strict schemas), LL-07 (strict CSP and security headers), LL-08 (failed reminders recorded, overdue and catalogue paging) | **Done** |
| Next iteration | LL-06 (nonce cache for the Convex endpoints) | Open, about half a day |
| Planned | LL-09 (atomic dedupe store), LL-10 (deletion webhook, retention job), LL-11 (Next 16 upgrade), LL-12, LL-13 | Open, part of production hardening |
