# VeriCred — Data Dictionary (Step 1)

Fixed seed: **20261022**. All timestamps UTC ISO-8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`). Scores are unitless percentages (0–100) unless stated. Every table has an explicit primary key; every relationship is a declared foreign key. Enum columns list their complete allowed set.

## ID / Nomenclature Conventions

| Entity | Pattern | Example | Immutable |
|---|---|---|---|
| Learner | `LRN-` + 6-digit zero-padded | `LRN-000001` | yes |
| Course | `CRS-` + 6-digit zero-padded | `CRS-000001` | yes |
| Issuer | `ISS-` + 4-digit zero-padded | `ISS-0001` | yes |
| CredentialRule | `RUL-<course-number>-V<2-digit version>` | `RUL-000001-V01` | yes |
| CompletionRecord | `CMP-<learner-id>-<course-id>` | `CMP-LRN-000001-CRS-000042` | yes |
| Credential | `CRD-<issue-year>-` + 6-digit | `CRD-2026-000001` | yes |
| VerificationRequest | `VER-<year>-` + 6-digit | `VER-2026-000001` | yes |
| Revocation | `REV-<credential-id>-<2-digit seq>` | `REV-CRD-2026-000001-01` | yes |
| AuditEvent | `EVT-` + 9-digit monotonic sequence | `EVT-000000001` | yes |

---

## 1. Learner (master)

| Field | Type | Req | Allowed / Units | Unique | Validation |
|---|---|---|---|---|---|
| learner_id | string | Y | `LRN-\d{6}` | PK | immutable |
| first_name | string | Y | 1–40 chars | N | non-empty |
| last_name | string | Y | 1–40 chars | N | non-empty |
| full_name | string | Y | derived `first + ' ' + last` | N | **duplicates intentional** — identity must never match on name alone |
| email | string | Y | `a@b.c` | UK | lowercase, globally unique |
| date_of_birth | date | Y | 1960-01-01 … 2008-12-31 | N | age ≥ 16 at enrollment |
| national_id_hash | string | Y | SHA-256 hex (64) | UK | pseudonymous; no raw PII stored |
| country | enum | Y | IN, US, GB, DE, SG, AU, CA, BR, NG, JP | N | ISO-3166 alpha-2 subset |
| enrollment_date | datetime | Y | 2023-01-01 … 2026-06-30 | N | ≥ date_of_birth + 16y |
| status | enum | Y | ACTIVE, INACTIVE, SUSPENDED | N | lifecycle |
| created_at | datetime | Y | = enrollment_date | N | ≤ now |

## 2. Course (master)

| Field | Type | Req | Allowed / Units | Unique | Validation |
|---|---|---|---|---|---|
| course_id | string | Y | `CRS-\d{6}` | PK | immutable |
| course_code | string | Y | `<SUBJ>-<3 digits>` | UK | derived from subject_area |
| title | string | Y | 1–120 chars | N | non-empty |
| subject_area | enum | Y | DATA, CLOUD, SEC, FIN, HEALTH, DESIGN, PM, AI, NET, OPS | N | — |
| level | enum | Y | FOUNDATION, INTERMEDIATE, ADVANCED, EXPERT | N | — |
| credit_hours | int | Y | 10–120 (hours) | N | > 0 |
| modules_total | int | Y | 4–24 | N | > 0 |
| assessment_count | int | Y | 1–6 | N | ≤ modules_total |
| passing_score | int | Y | 50–75 (%) | N | 0 ≤ x ≤ 100 |
| effective_from | datetime | Y | 2022-01-01 … 2025-06-30 | N | < effective_to |
| effective_to | datetime | N | null = open-ended | N | > effective_from |
| status | enum | Y | ACTIVE, RETIRED | N | RETIRED ⇒ effective_to not null |

## 3. Issuer (master, effective-dated — models issuer changes)

| Field | Type | Req | Allowed / Units | Unique | Validation |
|---|---|---|---|---|---|
| issuer_id | string | Y | `ISS-\d{4}` | PK | immutable |
| legal_name | string | Y | 1–120 chars | N | — |
| accreditation_body | enum | Y | NAAC, ABET, EQAR, CHEA, TEQSA, NONE | N | — |
| key_algorithm | enum | Y | Ed25519 | N | — |
| public_key | string | Y | 64-hex raw Ed25519 public key | UK | deterministic from seed |
| effective_from | datetime | Y | — | N | < effective_to |
| effective_to | datetime | N | null = current | N | — |
| supersedes_issuer_id | string | N | FK → Issuer.issuer_id | N | null for originals; set on issuer change |
| status | enum | Y | ACTIVE, SUPERSEDED | N | SUPERSEDED ⇒ effective_to not null |

## 4. CredentialRule (master, versioned per course)

| Field | Type | Req | Allowed / Units | Unique | Validation |
|---|---|---|---|---|---|
| rule_id | string | Y | `RUL-\d{6}-V\d{2}` | PK | immutable |
| course_id | string | Y | FK → Course | N | must exist |
| rule_version | int | Y | 1…n | N | (course_id, rule_version) unique |
| min_overall_score | int | Y | 50–80 (%) | N | ≥ course.passing_score |
| min_modules_completed_pct | int | Y | 80–100 (%) | N | — |
| required_assessments_passed | int | Y | 1 … course.assessment_count | N | ≤ assessment_count |
| min_attendance_pct | int | Y | 0–85 (%) | N | — |
| max_days_to_complete | int | Y | 60–540 (days) | N | > 0 |
| effective_from | datetime | Y | ≥ course.effective_from | N | < effective_to |
| effective_to | datetime | N | null = current | N | — |
| status | enum | Y | ACTIVE, SUPERSEDED | N | exactly one ACTIVE rule per course |

## 5. CompletionRecord (bridge: Learner N:M Course — all values derived)

| Field | Type | Req | Allowed / Units | Unique | Validation |
|---|---|---|---|---|---|
| completion_id | string | Y | `CMP-LRN-\d{6}-CRS-\d{6}` | PK | encodes both parents |
| learner_id | string | Y | FK → Learner | N | must exist |
| course_id | string | Y | FK → Course | N | must exist |
| enrolled_at | datetime | Y | ≥ learner.enrollment_date | N | ≥ course.effective_from |
| last_activity_at | datetime | Y | ≥ enrolled_at | N | — |
| completed_at | datetime | N | null ⇒ not COMPLETED | N | ≥ enrolled_at |
| modules_total | int | Y | = course.modules_total | N | derived |
| modules_completed | int | Y | 0 … modules_total | N | derived |
| modules_completed_pct | int | Y | round(100·completed/total) | N | **reconciles** |
| attendance_pct | int | Y | 0–100 | N | — |
| assessments_taken | int | Y | 0 … course.assessment_count | N | — |
| assessments_passed | int | Y | 0 … assessments_taken | N | ≤ taken |
| overall_score | int | Y | 0–100 | N | mean of assessment scores, derived |
| days_to_complete | int | N | days(completed_at − enrolled_at) | N | **reconciles** |
| status | enum | Y | IN_PROGRESS, COMPLETED, WITHDRAWN, FAILED | N | **derived, never rolled** |

Status derivation (documented rule — Steps 5/6):
- `WITHDRAWN` if no activity for > 180 days and modules_completed_pct < 100
- `COMPLETED` if modules_completed == modules_total **and** assessments_passed ≥ 1
- `FAILED` if all assessments taken and assessments_passed == 0
- otherwise `IN_PROGRESS`

## 6. Credential (transaction — created only when rules pass)

| Field | Type | Req | Allowed / Units | Unique | Validation |
|---|---|---|---|---|---|
| credential_id | string | Y | `CRD-\d{4}-\d{6}` | PK | immutable (EC-02 injects a duplicate) |
| learner_id | string | Y | FK → Learner | N | = completion.learner_id |
| course_id | string | Y | FK → Course | N | = completion.course_id |
| completion_id | string | Y | FK → CompletionRecord | UK (1:1 baseline) | must be COMPLETED (EC-01 violates) |
| issuer_id | string | Y | FK → Issuer | N | issuer ACTIVE at issued_at |
| rule_id | string | Y | FK → CredentialRule | N | the version evaluated |
| rule_version | int | Y | = rule.rule_version | N | pinned at issuance |
| issued_at | datetime | Y | ≥ completion.completed_at | N | **EC-01: issued_at < completed_at** |
| expires_at | datetime | N | issued_at + 3y; null = perpetual | N | > issued_at |
| status | enum | Y | ACTIVE, REVOKED, EXPIRED | N | derived from Revocation + expires_at |
| payload_json | json | Y | canonical credential subject | N | sorted keys, no whitespace |
| payload_hash | string | Y | SHA-256 hex of canonical payload | N | **EC-04: payload mutated, hash stale** |
| hash_algorithm | enum | Y | SHA-256 | N | — |
| signature | string | Y | Ed25519 hex (128) | N | over payload_hash |
| signature_algorithm | enum | Y | Ed25519 | N | — |
| verification_code | string | Y | 10 upper-alnum | UK | public lookup handle |
| issuance_decision | json | Y | per-criterion pass/fail trace | N | **exposes the decision** |

## 7. VerificationRequest (event)

| Field | Type | Req | Allowed / Units | Unique | Validation |
|---|---|---|---|---|---|
| verification_id | string | Y | `VER-\d{4}-\d{6}` | PK | immutable |
| credential_id | string | N | FK → Credential | N | null ⇒ unknown-reference probe |
| requested_credential_ref | string | Y | raw string presented | N | — |
| verifier_name | string | Y | 1–120 chars | N | — |
| verifier_type | enum | Y | EMPLOYER, UNIVERSITY, GOVERNMENT, PLATFORM, INDIVIDUAL | N | — |
| requested_at | datetime | Y | ≥ credential.issued_at | N | — |
| presented_hash | string | Y | SHA-256 hex supplied by verifier | N | compared to stored |
| identity_match_method | enum | Y | CREDENTIAL_ID, VERIFICATION_CODE, NATIONAL_ID_HASH, EMAIL, NAME_ONLY | N | NAME_ONLY alone must never return VALID |
| identity_match_score | float | Y | 0.00–1.00 | N | < 0.90 ⇒ INVALID_IDENTITY_MISMATCH |
| result | enum | Y | VALID, INVALID_NOT_FOUND, INVALID_REVOKED, INVALID_EXPIRED, INVALID_HASH_MISMATCH, INVALID_IDENTITY_MISMATCH | N | **derived; EC-03/EC-04 inject contradictions** |
| latency_ms | int | Y | 5–400 (ms) | N | > 0 |

## 8. Revocation (event — Credential 1:N, sequence-numbered)

| Field | Type | Req | Allowed / Units | Unique | Validation |
|---|---|---|---|---|---|
| revocation_id | string | Y | `REV-CRD-\d{4}-\d{6}-\d{2}` | PK | immutable |
| credential_id | string | Y | FK → Credential | N | must exist |
| sequence_no | int | Y | 1…n | N | (credential_id, sequence_no) unique |
| reason_code | enum | Y | FRAUD, ADMIN_ERROR, COURSE_RETIRED, ISSUER_CHANGE, LEARNER_REQUEST, DATA_CORRECTION | N | — |
| reason_text | string | Y | 1–240 chars | N | — |
| revoked_at | datetime | Y | > credential.issued_at | N | date ordering |
| revoked_by | string | Y | actor id | N | role ∈ ADMIN, PLATFORM_ADMIN |
| status | enum | Y | ACTIVE, RESCINDED | N | RESCINDED ⇒ a later row supersedes it |

## 9. AuditEvent (append-only, hash-chained — history is never overwritten)

| Field | Type | Req | Allowed / Units | Unique | Validation |
|---|---|---|---|---|---|
| event_id | string | Y | `EVT-\d{9}` | PK | immutable |
| event_seq | int | Y | 1…n monotonic | UK | no gaps |
| entity_type | enum | Y | LEARNER, COURSE, RULE, COMPLETION, CREDENTIAL, VERIFICATION, REVOCATION, ISSUER | N | — |
| entity_id | string | Y | id of the subject row | N | must resolve |
| event_type | enum | Y | CREATED, COMPLETION_EVALUATED, ISSUANCE_APPROVED, ISSUANCE_DENIED, CREDENTIAL_ISSUED, VERIFICATION_REQUESTED, VERIFICATION_COMPLETED, REVOKED, REVOCATION_RESCINDED, ISSUER_SUPERSEDED, EXPIRED | N | — |
| actor_id | string | Y | `SYS`, `ADM-\d{3}`, `INS-\d{3}`, learner/verifier id | N | — |
| actor_role | enum | Y | SYSTEM, LEARNER, INSTRUCTOR, ADMIN, SUPPORT, PLATFORM_ADMIN, VERIFIER | N | — |
| occurred_at | datetime | Y | monotonic with event_seq | N | — |
| payload_json | json | Y | before/after state delta | N | — |
| prev_hash | string | Y | SHA-256 of previous event (genesis = 64×`0`) | N | chain link |
| event_hash | string | Y | SHA-256(prev_hash + canonical(event)) | N | **tamper-evident** |

---

## Relationship / cardinality map

```
Learner 1 ──N CompletionRecord N── 1 Course      CompletionRecord is the N:M bridge
Course  1 ──N CredentialRule                     versioned, effective-dated
CompletionRecord 1 ──0..1 Credential             optional: only if rules pass
Issuer  1 ──N Credential                         Issuer self-FK supersedes_issuer_id (0..1)
Credential 1 ──N VerificationRequest             optional: a ref may not resolve
Credential 1 ──N Revocation                      sequence-numbered, append-only
*       ──N AuditEvent                           polymorphic entity_type + entity_id
```

## Lifecycle states

- **CompletionRecord**: IN_PROGRESS → COMPLETED | FAILED | WITHDRAWN (terminal)
- **Credential**: ACTIVE → REVOKED (via Revocation) | EXPIRED (via expires_at). REVOKED → ACTIVE only through a RESCINDED revocation row; the original revocation row is never deleted.
- **Issuer**: ACTIVE → SUPERSEDED (successor row carries `supersedes_issuer_id`)
- **CredentialRule**: ACTIVE → SUPERSEDED (new version row)

## Ground truth (Step 7 — never joined into feature files)

`ground_truth.csv` / `.json` columns: `record_type, record_id, issue_type, expected_decision, detectable_by, description`.

`issue_type` ∈ `EC01_ISSUED_BEFORE_COMPLETION`, `EC02_DUPLICATE_CREDENTIAL_ID`, `EC03_REVOKED_VERIFIES_ACTIVE`, `EC04_ALTERED_PAYLOAD_HASH_UNDETECTED`.
