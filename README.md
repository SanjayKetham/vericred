# VeriCred — credential issuance, verification and revocation

A working platform for the problem: *issue credentials once completion requirements are met, and support revocation and third-party verification.*

Two deliverables in one repository:

1. **A deterministic synthetic data generator** — 20,000 learners · 1,000 courses · 10,000 credentials · 5,000 verification requests, with labelled edge cases, a separate ground-truth file, an 18-check validator and a byte-level reproducibility proof.
2. **A working application** over that data — a public landing page with instant verification, rule-gated issuance, revocation, an append-only hash-chained audit trail, and five role-specific dashboards.

The same rule engine (`server/src/engine/rules.ts`) produces the dataset's outcome columns **and** serves live API requests. That is what makes a verification today reproduce a verification recorded at generation time.

---

## Contents

- [Quick start](#quick-start) — get it running in three commands
- [Using the application](#using-the-application) — the guided walkthrough
- [Role guide](#role-guide) — every menu, for every role
- [Try these scenarios](#try-these-scenarios) — see the edge cases for yourself
- [Troubleshooting](#troubleshooting)
- [How the business rules work](#how-the-business-rules-work)
- [Synthetic data generation](#synthetic-data-generation)
- [Validation and metrics](#validation-and-metrics)
- [API reference](#api-reference)

---

<img width="1847" height="905" alt="image" src="https://github.com/user-attachments/assets/432958d5-ea95-4341-b080-57ffe54252db" />


## Quick start

You need **Node.js 20+**. You do **not** need a database.

```bash
# 1. Install dependencies
cd server && npm install
cd ../web && npm install

# 2. Generate the dataset (deterministic, ~20 seconds)
cd ../server
npm run generate

# 3. Start the API (leave this terminal running)
npm run dev                     # http://localhost:4000

# 4. Start the UI in a second terminal
cd web && npm run dev           # http://localhost:5173
```

Open **http://localhost:5173**. You land on the public page — you can verify a credential immediately, without signing in.

### Other commands

| Command | Run from | What it does |
|---|---|---|
| `npm run generate` | `server` | Regenerates the whole dataset into `data/` |
| `npm run generate -- --scale 0.05` | `server` | A small starter dataset from the same generator and seed |
| `npm run validate` | `server` | Runs the 18 checks and scores anomaly detection |
| `npm run reproduce` | `server` | Generates twice and compares checksums |
| `npm run build` | `web` | Production build of the UI |

### PostgreSQL is optional

**Nothing above needs a database.** The API probes PostgreSQL once at startup and falls back to the generated files when it is not reachable, so `npm run dev` works on a machine with no database installed. `GET /api/health` reports which driver is live, and the UI shows it in the top bar. Set `DATA_SOURCE=file` to force the file driver even when a database is available.

The one thing the file driver does not do is persist: accounts created through the registration form live in memory and disappear when the API restarts. Everything else — issuance, revocation, verification, audit — behaves identically.

To use PostgreSQL instead:

```bash
cd server
cp .env.example .env                 # PowerShell: Copy-Item .env.example .env
# edit .env so DATABASE_URL points at your server, then:
npx prisma generate
npx prisma db push                   # create the tables
npm run db:seed                      # load the generated dataset
npm run dev
```

`db:seed` checks both of the ordinary failure modes before touching the database and explains them in plain terms: a missing `DATABASE_URL` (usually no `.env` file) and an unreachable server, with the password redacted from the connection string it echoes back.

Seeding deliberately inserts credentials one row at a time, so the duplicated `credential_id` from edge case EC-02 is **rejected by the primary-key constraint** rather than silently overwriting its twin. The seeder counts those rejections and prints them — that rejection is the evidence the constraint works.

---

## Using the application

### 1. The landing page

`http://localhost:5173` opens the public page. You do not need an account to use it.

- **Check a credential** — the panel on the right of the hero. Paste a credential ID (`CRD-2026-000001`) or a 10-character verification code and press **Verify**. The result shows every check that produced the answer, not just the verdict.
- **How it works / Security / Who uses it** — what the platform guarantees and how.
- **Sign in** / **Create account** — top right.

To get a real credential ID to try, open `data/csv/credentials.csv` and copy any value from the first column.

### 2. Signing in

Click **Sign in**. Five demo accounts are listed on the form itself — **click one to fill the form**, then press Sign in. The password for all of them is `vericred2026`.

| Account | Role | What you see |
|---|---|---|
| `learner@vericred.example` | Learner | Their own courses, progress and certificates |
| `instructor@vericred.example` | Instructor | Courses, attendance, assessments, eligibility |
| `registrar@vericred.example` | Academic administrator | Issue, revoke, registry, rules, reports |
| `support@vericred.example` | Support | Lookups and failed verifications |
| `admin@vericred.example` | Platform administrator | Users, keys, anomalies, system health |

### 3. Creating your own account

Click **Create account**. Fill in your name, email and a password of at least 8 characters.

The **Learner ID** field is optional. Leave it blank for an empty account, or enter an existing ID such as `LRN-003528` to link your account to that learner's real courses and certificates. The ID is validated before the account is created.

New accounts are always **learner** accounts. The role is decided by the server, never by the form — letting a visitor choose their own role would hand out issuance and revocation rights to anyone who can reach the page. Staff roles are granted by a platform administrator in User Management.

### 4. Finding your way around

Once signed in:

- The **left rail** lists the modules your role can use, grouped by job. Every module reads live data.
- The **top bar** has one search box that every module consumes — type a credential ID, learner ID or course and the current module filters itself.
- The **moon / sun button** switches between light and dark mode.
- The **arrow button** signs you out.
- The card at the bottom of the rail shows dataset integrity: the seed, the active store and the validation status.

---

## Role guide

### Learner — 9 modules

Sign in as `learner@vericred.example`.

| Module | What you can do |
|---|---|
| **Dashboard** | Enrolled / completed / pending counts, certificates earned, a timeline of your certificates and a list of recent courses |
| **My Courses** | Every enrolment with its status, level and score |
| **Course Progress** | Each course opened up: modules, attendance and score shown against what the rule requires, with a **Requirements** button that lists every criterion and whether you meet it |
| **My Credentials** | All certificates issued to you, with status, expiry and verification code |
| **Download Certificate** | Pick a certificate, see it laid out, then **Print / Save PDF** (your browser's print dialog) or copy the signed record |
| **Verify Certificate** | The public verification form, so you can see exactly what a verifier sees |
| **Share Credential** | A public link and a scannable **QR code** for any of your certificates, plus copy buttons |
| **My Profile** | Your details on record, and an explanation of why your name is not your identifier |
| **Notifications** | Events recorded against your certificates |

A learner can only ever see their own record. Requesting another learner's data returns `403` regardless of what the browser sends.

### Instructor — 8 modules

Sign in as `instructor@vericred.example`.

| Module | What you can do |
|---|---|
| **Dashboard** | Which rule criterion is blocking the queue, and the learners who are a single criterion away from a credential |
| **My Courses** | The course catalogue with levels, modules, assessments and pass marks |
| **Learners** | Learners grouped by ID, flagging shared display names |
| **Attendance** | Attendance against the minimum each rule requires, with a pass/fail marker |
| **Assessments** | Assessments taken and passed against the number the rule requires |
| **Completion Records** | Completion submissions and the decision each one produces |
| **Eligibility Preview** | The full rule trace per learner — filter by approved or blocked. Read-only: an instructor cannot issue |
| **Notifications** | Academic activity across courses |

### Academic administrator — 13 modules

Sign in as `registrar@vericred.example`. This is the role that runs the credential lifecycle.

| Module | What you can do |
|---|---|
| **Dashboard** | Issuance and verification trends, a six-week verification heatmap, per-issuer sparklines, failure and revocation breakdowns, live audit feed |
| **Learner Management** | Learners and their credentials |
| **Course Management** | The catalogue, with retired courses marked |
| **Credential Rules** | Every rule version with its thresholds and effective window |
| **Completion Records** | Submissions awaiting evaluation |
| **Eligibility Checker** | Evaluate a completion without issuing anything |
| **Issue Credentials** | The queue. Press **Rule trace** on any row to see all eight criteria. **Issue credential** appears only where the engine already approved; a denied row offers **Explain** instead |
| **Credential Registry** | Search every credential, open one for its decision trace, re-derived status and revocation history |
| **Revocation Management** | The full revocation register, including rescinded rows |
| **Issuer Management** | Issuing authorities, their keys and their succession |
| **Verification History** | Every third-party request with the identity method used |
| **Audit Logs** | The hash-chained log with `prev → hash` links visible |
| **Reports** | CSV export of the credential register, verification log and revocation register |

**To revoke a credential:** Credential Registry → find it → **Open** → choose a reason and explanation → **Revoke**. The credential's status flips immediately and the event is appended to the audit trail. The original row is never edited.

### Support — 6 modules

Sign in as `support@vericred.example`.

| Module | What you can do |
|---|---|
| **Dashboard** | Open investigations grouped by cause, and guidance on what support can and cannot change for each |
| **Learner Lookup** | Find a learner by an identifier they gave you — minimum three characters, no browsing the whole table |
| **Credential Lookup** | Find a credential by ID or code |
| **Verification Issues** | Requests that did not return valid, filterable by cause |
| **Revocation Queries** | Why a credential was withdrawn |
| **Activity History** | Actions taken on the platform |

Support can read and explain, but cannot issue, revoke, or alter assessment results. Those return `403`.

### Platform administrator — 13 modules

Sign in as `admin@vericred.example`.

| Module | What you can do |
|---|---|
| **System Dashboard** | Users, institutions, request volume, security incidents, validation status, detected anomalies |
| **User Management** | Every account that can sign in, and its role |
| **Role Management** | What each role is permitted to do |
| **Institution Management** / **Issuer Registry** | Issuing bodies, accreditation and succession |
| **Security Monitoring** | Name-only attempts, sub-threshold identity matches, hash mismatches, and the verifiers with the most failures |
| **Anomaly Detection** | Detector precision, recall and F1 per issue type, scored against ground truth |
| **Key Management** | Ed25519 signing keys, effective windows and rotation history |
| **Audit Logs** | The system-wide hash-chained log |
| **Database Monitoring** | Which store is live, table sizes and the audit chain head |
| **Data Management** | All 18 validation checks and the row counts behind them |
| **API Management** | Every endpoint with its required role and rate limit |
| **System Settings** | Seed, as-of instant, algorithms and provenance — read-only, because these define reproducibility |

---

## Try these scenarios

Each of these demonstrates one of the required edge cases or acceptance criteria. Run them from the landing page's verify panel unless stated otherwise.

**1. A valid credential.** Copy any `credential_id` from `data/csv/credentials.csv` whose `status` is `ACTIVE`, paste it in and verify. All seven checks pass.

**2. A revoked credential still reports as revoked.** Take a `credential_id` from `data/csv/revocations.csv` and verify it. The result is `INVALID_REVOKED` with the reason and date — revocation status is replayed from events, so it is always current.

**3. A tampered record is caught.** In `data/ground_truth.csv`, find a row whose `issue_type` is `EC04_ALTERED_PAYLOAD_HASH_UNDETECTED` and `record_type` is `Credential`. Verify that credential ID: the result is `INVALID_HASH_MISMATCH` and the `payload_integrity` check fails, because the stored payload no longer hashes to what the issuer signed.

**4. A duplicate ID is refused, not guessed.** Find a row whose `issue_type` is `EC02_DUPLICATE_CREDENTIAL_ID`. Verifying it returns **409 ambiguous reference** rather than picking one of the colliding rows.

**5. A name alone never verifies.** Sign in as a staff user and `POST /api/verify` with `"identity_match_method": "NAME_ONLY"` for a credential that is otherwise valid. The result is `INVALID_IDENTITY_MISMATCH`. The same credential verified by ID returns `VALID`.

**6. Issuance is genuinely gated.** Sign in as `registrar@` → Issue Credentials → filter to **denied** → press **Rule trace**. The failing criterion is named. The Issue button is not offered, and the API refuses the request if called directly.

**7. History is not rewritten.** Revoke a credential, then open it again: the revocation row is listed with its sequence number, and the audit trail has a new event. Nothing was edited in place.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `EADDRINUSE: address already in use :::4000` | An earlier API is still running. PowerShell: `Get-NetTCPConnection -LocalPort 4000 -State Listen \| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` |
| `Environment variable not found: DATABASE_URL` | No `server/.env`. Either create one (`cp .env.example .env`) or skip PostgreSQL entirely — the API runs without it |
| `Can't reach database server at localhost:5432` | PostgreSQL is not running. Start it, or run without it; `GET /api/health` will report `file` as the driver |
| UI loads but every panel is empty | The API is not running, or not on port 4000. The top bar shows "API unreachable" |
| `No validation report available` in Data Management | Run `npm run validate` from `server` |
| Dashboard charts are blank | Hard-refresh. Charts measure their container before drawing; a stale bundle can leave them at zero width |
| Registered account disappeared | Expected on the file driver — accounts live in memory. Use PostgreSQL for persistence |

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18 · TypeScript · Tailwind CSS · Recharts |
| Backend | Node.js · Express · REST |
| Database | PostgreSQL · Prisma ORM (optional — file driver fallback) |
| AI | OpenAI API with structured outputs (advisory only) |
| Security | JWT · role-based access control · SHA-256 · Ed25519 |

---

## How the business rules work

### Issuance is gated, and the gate is visible

`evaluateIssuance()` checks eight criteria and **does not short-circuit**, so every decision carries a full trace of what was required, what the learner had, and which criterion failed:

| Criterion | Source |
|---|---|
| `completion_status` | must be `COMPLETED` |
| `completed_at_present` | a completion date must exist |
| `min_overall_score` | `CredentialRule` |
| `course_passing_score` | `Course` |
| `min_modules_completed_pct` | `CredentialRule` |
| `required_assessments_passed` | `CredentialRule` |
| `min_attendance_pct` | `CredentialRule` |
| `max_days_to_complete` | `CredentialRule` |

A credential is minted only on `APPROVED`. A denial is still written to the audit log — refusing to issue is a decision worth recording. The trace is stored on the credential (`issuance_decision`) and shown in the UI under "Rule trace".

Rules are **versioned and effective-dated**. Issuance pins the version it evaluated (`rule_id`, `rule_version`), so re-checking an old credential uses the rule that was actually in force, not today's.

### Verification is deterministic and reproducible

`verifyCredential()` runs a fixed check order and returns one of six outcomes:

```
credential_exists → identity_match → issuer_signature → payload_integrity
                  → presented_hash_match → not_revoked → not_expired
```

- **`payload_integrity`** recomputes SHA-256 over the canonical form of the stored payload and compares it to the stored hash. This is what catches a payload altered after sealing.
- **`issuer_signature`** verifies an Ed25519 signature over that hash against the issuer's public key.
- **`identity_match`** is evaluated *before* the credential's own state, so a weak identity match can never be rescued by a valid hash. `NAME_ONLY` scores 0.42 against a 0.90 threshold and **can never return `VALID`** — the acceptance criterion "identity matching does not rely on name alone", enforced in code rather than asserted in a document.

Canonicalisation (sorted keys, no insignificant whitespace, UTC ISO timestamps) is why the same credential hashes identically on every run — without it, "reproducible verification" would be a coincidence.

### Revocation status is current, and history is never rewritten

Revocations are append-only, sequence-numbered rows. Current status is a **replay** of that sequence, not a mutable flag:

- Revoking adds row `REV-<credential-id>-01`.
- Rescinding does **not** delete it — it adds a further row marking the earlier one `RESCINDED`.
- `currentRevocation(revocations, asOf)` ignores revocations recorded *after* the instant being asked about, so a verification from last year is not retroactively invalidated by a revocation filed yesterday.

### The audit trail is tamper-evident

Every event carries `prev_hash` and `event_hash = SHA-256(prev_hash + canonical(event))`. Altering or removing any historical event breaks every link after it. `verifyAuditChain()` replays from genesis and names the first broken link; the validator runs it on every pass.

---

## Data model

Nine entities; full field-level dictionary in [docs/data-dictionary.md](docs/data-dictionary.md).

```
Learner 1 ──N CompletionRecord N── 1 Course      CompletionRecord is the N:M bridge
Course  1 ──N CredentialRule                     versioned, effective-dated
CompletionRecord 1 ──0..1 Credential             optional: only if the rules pass
Issuer  1 ──N Credential                         Issuer self-FK: supersedes_issuer_id (0..1)
Credential 1 ──N VerificationRequest             optional: a reference may not resolve
Credential 1 ──N Revocation                      sequence-numbered, append-only
*       ──N AuditEvent                           polymorphic entity_type + entity_id
```

### ID conventions

`LRN-000001` · `CRS-000001` · `ISS-0001` · `RUL-000001-V01` · `CMP-LRN-000001-CRS-000042` · `CRD-2026-000001` · `VER-2026-000001` · `REV-CRD-2026-000001-01` · `EVT-000000001`

Counters are zero-padded, IDs are immutable, and referenced IDs are identical across every file. The validator checks all nine patterns with regular expressions.

---

## Synthetic data generation

### Determinism

Fixed seed **20261022**. Every random draw comes from `sha256(seed | namespace | index | counter)` rather than one mutable global stream, so generation is **order-independent**: adding an entity type or reordering a loop cannot shift any other entity's values. Issuer Ed25519 keypairs are themselves seed-derived, so signatures reproduce too. The dataset's "now" is a fixed constant (`2026-10-22T00:00:00Z`), never `Date.now()`.

Scale is parameterised (`--scale`), so the starter and full datasets come from the same generator and the same seed.

### Derived, never rolled

Completion status, score, credential status and verification results are **computed from source records** (Step 6). There is no `random.choice(["ACTIVE","REVOKED"])` anywhere:

- `status` comes from `deriveCompletionStatus()` applied to raw facts (modules finished, assessments passed, last activity).
- `overall_score` is the mean of the generated assessment scores.
- `modules_completed_pct` and `days_to_complete` recompute from their sources — the validator re-derives all 44,798 rows.
- `Credential.status` is a replay of revocations plus expiry.
- `VerificationRequest.result` is `verifyCredential()` evaluated as of the request time.

### Coverage

| Requirement | How it appears |
|---|---|
| Revoked credentials | ~6% of credentials, with ~18% of those later rescinded and re-issued as a new sequence row |
| Duplicate names | 40 × 40 name pool over 20,000 learners — thousands of collisions, by design |
| Incomplete courses | ~34,000 completion records in `IN_PROGRESS`, `WITHDRAWN` or `FAILED` |
| Issuer changes | 6 issuers, 2 of which supersede an earlier issuer with effective dating and a self-FK |
| Retired courses | ~8% of courses, still carrying historical credentials |
| Issuance backlog | ~1,300 completions that pass their rule but have no credential yet — a real queue, not an error |

### Edge cases (Step 5) — injected and labelled

| Issue type | Count | Mechanism | Detected by |
|---|---:|---|---|
| `EC01_ISSUED_BEFORE_COMPLETION` | 14 | `issued_at` backdated before `completed_at`; payload re-sealed so the signature stays valid and the *only* defect is the date ordering | comparing `issued_at` to `completion.completed_at` |
| `EC02_DUPLICATE_CREDENTIAL_ID` | 8 | a second row reuses an existing `credential_id` | primary-key uniqueness; the database rejects it outright |
| `EC03_REVOKED_VERIFIES_ACTIVE` | 18 | a request recorded `VALID` while a revocation was in force at that moment | replaying revocations as of `requested_at` |
| `EC04_ALTERED_PAYLOAD_HASH_UNDETECTED` | 26 | payload mutated after sealing, `payload_hash` and signature left stale | recomputing the hash from the stored payload |

Counts scale with `--scale` and never drop below one of each.

Two of these have **documented knock-on effects**, labelled rather than hidden: a duplicate ID makes any verification citing it ambiguous (`AMBIGUOUS_REFERENCE`), and a baseline request that already pointed at a now-altered credential is itself an instance of the undetected tamper.

### Ground truth (Step 7)

`data/ground_truth.csv` / `.json` carry `record_type, record_id, issue_type, expected_decision, detectable_by, description`. The label **never appears in any feature file**, and the Prisma seed deliberately does not load it into the operational database. Detectors read only the feature files; ground truth is opened afterwards purely to score them.

---

## Validation and metrics

`npm run validate` → [docs/validation-summary.md](docs/validation-summary.md) and `data/validation-summary.json`.

**18/18 checks pass with 0 unexpected violations**, across ~600,000 field-level assertions:

| | Checks |
|---|---|
| Structure | PK uniqueness · FK integrity · join validity · ID patterns · enum domains · natural-key uniqueness |
| Logic | date ordering · arithmetic reconciliation · lifecycle replay · issuance rules re-enforced |
| Cryptography | payload hash recomputation · Ed25519 signatures · audit chain · canonical-form stability |
| Behaviour | verification reproducibility · identity-matching rule · audit sequence and timing |

A violation is **"expected"** when a ground-truth row explains it. The dataset is *supposed* to contain its four edge cases, so the acceptance bar is zero *unexpected* violations — a run reporting zero violations outright would mean the edge cases had gone missing.

### Detection metrics

| Issue type | Expected | Detected | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|
| `EC01_ISSUED_BEFORE_COMPLETION` | 14 | 14 | 1.000 | 1.000 | 1.000 |
| `EC02_DUPLICATE_CREDENTIAL_ID` | 8 | 8 | 1.000 | 1.000 | 1.000 |
| `EC03_REVOKED_VERIFIES_ACTIVE` | 18 | 18 | 1.000 | 1.000 | 1.000 |
| `EC04_ALTERED_PAYLOAD_HASH_UNDETECTED` | 26 | 26 | 1.000 | 1.000 | 1.000 |
| **Overall** | **66** | **66** | **1.000** | **1.000** | **1.000** |

These scores are high because the anomalies are *deterministically* detectable from documented rules — which is the point. The detectors are rule-based, not statistical; the metric demonstrates that each injected defect is reachable from the feature files alone.

### Reproducibility (Step 10)

`npm run reproduce` generates the dataset twice into `data/run-a` and `data/run-b` and compares row counts and SHA-256 checksums of every file on disk: **29/29 files byte-identical**. Report at `data/reproducibility-report.json`.

---

## Exports

`npm run generate` writes, per table, into `data/`:

- `csv/<table>.csv` — stable column order
- `json/<table>.jsonl` — newline-delimited JSON
- `sql/<table>.sql` — batched `INSERT` statements for PostgreSQL
- `ground_truth.csv` / `.json` — kept separate from every feature file
- `manifest.json` — seed, scale, as-of date, generator command, provenance, and a SHA-256 per file

---

## API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | — | JWT, rate-limited, no account enumeration |
| `POST` | `/api/auth/register` | — | Creates a LEARNER account; role is never taken from the request |
| `GET` | `/api/auth/me` | any | Current user and capabilities |
| `GET` | `/api/health` | — | Driver, seed, as-of date, audit tail |
| `GET` | `/api/public/stats` | **public** | Coarse totals for the landing page |
| `POST` | `/api/verify` | **public** | Third-party verification |
| `GET` | `/api/credentials` | staff / own | Paged search |
| `GET` | `/api/credentials/:id` | staff / own | Detail, decision trace, re-derived status |
| `GET` | `/api/learners/:id` | staff / own | Learner profile, without the identity hash |
| `GET` | `/api/learners/:id/courses` | staff / own | Enrolments with rule evaluations |
| `GET` | `/api/learners` | staff | Lookup by identifier (3-char minimum for support) |
| `GET` | `/api/courses`, `/api/rules`, `/api/issuers` | staff | Reference data |
| `GET` | `/api/verifications`, `/api/revocations` | admin, support | Event history |
| `GET` | `/api/issuance/eligible` | admin, instructor | Queue with full rule traces |
| `POST` | `/api/issuance/evaluate` | staff | Dry-run evaluation |
| `POST` | `/api/issuance/issue` | admin | Issue — refuses on a denied decision |
| `POST` | `/api/revocations` | admin | Revoke |
| `POST` | `/api/revocations/:id/rescind` | platform admin | Rescind without deleting history |
| `GET` | `/api/audit` | staff | Hash-chained event log |
| `GET` | `/api/metrics` | staff | Dashboard aggregates |
| `GET` | `/api/users` | platform admin | Accounts |
| `GET` | `/api/platform/validation` | admin | The validator's own report |
| `POST` | `/api/ai/explain-denial` | staff | Plain-English explanation of a decision |
| `POST` | `/api/ai/review-case` | admin, support | Case summary for a reviewer |

### Security

- **JWT** with issuer claim and 8-hour expiry; the server refuses to sign with a default secret in production.
- **RBAC** across six roles, enforced server-side. A `LEARNER` can only ever list their own credentials regardless of query parameters.
- **Self-registration cannot grant privilege.** The role is set by the server; a request asking for `PLATFORM_ADMIN` still produces a learner.
- **Verification is deliberately public** — a third party must not need an account — but it is rate-limited and returns only what a verifier needs. The learner's email and identity hash are never in the response.
- **Passwords** are bcrypt-hashed; a wrong password and an unknown account return the same error.
- **SHA-256** for payload hashing and the audit chain; **Ed25519** for issuer signatures.

### AI — scope

The model never participates in an issuance, verification or revocation decision. Those must be identical every time and show their working, so they are pure rule-engine code. The AI endpoints only put an *already-made* decision into plain language and suggest where a reviewer should look. Both use OpenAI **structured outputs** validated against a Zod schema, and both fall back to a deterministic template when `OPENAI_API_KEY` is absent — the responses say which path produced them.

---

## Project layout

```
server/src/
  engine/rules.ts        issuance, verification, revocation replay — the single source of truth
  lib/deterministic.ts   seeded RNG, ID formatters, canonical JSON, SHA-256, Ed25519
  lib/audit.ts           append-only hash-chained audit log
  generator/             synthetic data generation + CSV/JSON/SQL export
  validator/             18 structural checks + anomaly detection + metrics
  api/                   Express routes, Prisma and file drivers
  tools/                 reproducibility proof, database seed
web/src/
  nav.ts                 role-scoped menus
  components/shell.tsx   navigation rail, top bar, icon set
  components/charts.tsx  donut, area, sparkline, heatmap, ranked bars — all theme-token driven
  components/table.tsx   KPI cards, record tables, CSV export
  pages/Landing.tsx      public landing page with inline verification
  pages/Auth.tsx         sign-in and registration
  pages/learner.tsx      learner modules, printable certificate, QR share
  pages/dashboards.tsx   instructor, support and platform dashboards
  pages/modules.tsx      courses, rules, verifications, revocations, issuers, users, reports
docs/                    data dictionary, validation summary
data/                    generated output
```

---

## Lawful provenance

**No external data was used.** Every name, institution, course title and identifier is invented (`server/src/generator/reference.ts`); no dataset was downloaded, scraped or redistributed; no access control was bypassed; and no real personal information appears anywhere. Learner national identifiers are synthetic SHA-256 digests, never raw values. `manifest.json` records this with every run.

---

## Design decisions worth flagging

- **One rule engine, two consumers.** The generator and the API call the same functions. Any other arrangement makes "the verification result is reproducible" an aspiration rather than a property.
- **Per-entity random streams** instead of one global stream, so the generator can evolve without invalidating the reproducibility proof.
- **Expected vs unexpected violations.** The validator cross-references ground truth so injected edge cases do not masquerade as data-quality failures, and genuine regressions are not lost among them.
- **The duplicate ID is not swallowed.** The database rejects it, the seeder counts the rejection and prints it, and the API answers `409 ambiguous_reference` rather than picking one of the colliding rows.
- **A fixed as-of date.** Validation of the same bytes must not depend on the day it runs.
- **Only modules that work are listed.** Support ticketing and grade-writing were cut from the navigation rather than shipped as empty screens — a menu that cannot be backed by the dataset is not a feature.
- **Distributions are shaped by the domain, not by convenience.** Two cases were reworked after the charts exposed them:
  - **Issuance backlog.** More candidates pass their rule than the 10,000 target, so some wait. Taking the oldest N would have put the entire backlog in the most recent months and left a cliff at the end of every series; the backlog is now sampled across the whole period by a seed-derived score.
  - **Verification timing.** Requests cluster shortly after issuance, with a long tail. The delay is drawn first and the credential is then chosen from those old enough to accommodate it — so a credential issued last week is simply not verified yet, rather than being forced onto the final day.
- **A hand-rolled QR encoder that rendered but did not decode.** The share page originally built its QR matrix from scratch. It looked entirely correct on screen; decoding the rendered pixels with an independent reader returned nothing. It was replaced with the `qrcode` package, and the replacement was re-checked the same way. A picture of a QR code is not evidence that it scans.
- **Eight bugs found by the tooling.** The validator caught a time-blind revocation lookup, rule versions dated into the future, completion dates piling onto a single day, an as-of overflow from time-of-day arithmetic, and two date-clamping piles in verification sampling. The rendered dashboard caught two more: every chart container collapsing to zero width, and bar labels stranded outside their rows. All are fixed, and the checks that caught them remain in the suite.
