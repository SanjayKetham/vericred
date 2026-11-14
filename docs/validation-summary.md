# Validation summary (Step 8)

Generated 2026-11-14T11:26:23.530Z from `C:\CandidateWorkspace\Hackathon\data`. Re-create with `npm run validate`.

**18/18 checks pass. 0 unexpected violations.**

A violation is "expected" when a row in `ground_truth.csv` explains it: the dataset is *supposed* to
contain those four edge cases, so the acceptance bar is zero *unexpected* violations, not zero violations.

## Checks

| ID | Category | Rows checked | Unexpected | Expected (labelled) | Status | Description |
|---|---|---:|---:|---:|---|---|
| PK-01 | primary-key uniqueness | 123,907 | 0 | 6 | PASS | Every primary key appears exactly once |
| FK-01 | foreign-key integrity | 146,618 | 0 | 0 | PASS | Every foreign key resolves to an existing parent row |
| FK-02 | join validity | 10,006 | 0 | 0 | PASS | Credential learner/course agree with the cited completion record |
| ID-01 | naming conventions | 123,907 | 0 | 0 | PASS | All identifiers match their documented zero-padded pattern |
| EN-01 | enum domains | 94,744 | 0 | 0 | PASS | Every enum column holds only documented values |
| DT-01 | date ordering | 60,313 | 0 | 16 | PASS | Event dates follow their documented ordering |
| AR-01 | arithmetic reconciliation | 44,798 | 0 | 0 | PASS | Derived numeric columns recompute from their sources |
| LC-01 | lifecycle transitions | 54,804 | 0 | 0 | PASS | Entity states agree with a replay of their event history |
| UQ-01 | natural-key uniqueness | 41,006 | 0 | 0 | PASS | Unique business keys (email, national_id_hash, course_code, public_key) do not collide |
| IS-01 | issuance rules enforced | 10,006 | 0 | 0 | PASS | Every issued credential still passes its pinned rule version |
| HS-01 | payload integrity | 10,006 | 0 | 11 | PASS | Stored payload hash recomputes from the stored payload |
| SG-01 | issuer signatures | 10,006 | 0 | 0 | PASS | Every credential signature verifies against its issuer public key |
| AU-01 | audit chain integrity | 40,895 | 0 | 0 | PASS | Hash chain replays from genesis without a break |
| AU-02 | audit sequence | 40,895 | 0 | 0 | PASS | event_seq is monotonic with no gaps |
| AU-03 | audit timing | 40,895 | 0 | 0 | PASS | No audit event is dated after the dataset as-of instant |
| VR-01 | verification reproducibility | 5,011 | 0 | 35 | PASS | Re-running verification reproduces the recorded result |
| ID-02 | identity matching | 5,011 | 0 | 0 | PASS | A VALID result never rests on name-only or sub-threshold identity matching |
| CN-01 | canonical form stability | 2,000 | 0 | 0 | PASS | Canonicalising a payload twice yields the same hash |

## Anomaly detection against ground truth

Detectors read only the feature files. `ground_truth.csv` is opened afterwards purely to score them.

| Issue type | Expected | Detected | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| EC01_ISSUED_BEFORE_COMPLETION | 14 | 14 | 14 | 0 | 0 | 1.000 | 1.000 | 1.000 |
| EC02_DUPLICATE_CREDENTIAL_ID | 8 | 8 | 8 | 0 | 0 | 1.000 | 1.000 | 1.000 |
| EC03_REVOKED_VERIFIES_ACTIVE | 18 | 18 | 18 | 0 | 0 | 1.000 | 1.000 | 1.000 |
| EC04_ALTERED_PAYLOAD_HASH_UNDETECTED | 26 | 26 | 26 | 0 | 0 | 1.000 | 1.000 | 1.000 |
| **OVERALL** | 66 | 66 | 66 | 0 | 0 | 1.000 | 1.000 | 1.000 |

## Row counts

| Table | Rows |
|---|---:|
| learners | 20,000 |
| courses | 1,000 |
| issuers | 6 |
| credential_rules | 1,481 |
| completion_records | 44,798 |
| credentials | 10,006 |
| verification_requests | 5,011 |
| revocations | 710 |
| audit_events | 40,895 |
| ground_truth | 66 |

## Distributions

```json
{
  "completion_status": {
    "COMPLETED": 19942,
    "WITHDRAWN": 11296,
    "IN_PROGRESS": 8498,
    "FAILED": 5062
  },
  "credential_status": {
    "ACTIVE": 9398,
    "REVOKED": 590,
    "EXPIRED": 18
  },
  "verification_result": {
    "VALID": 4302,
    "INVALID_HASH_MISMATCH": 236,
    "INVALID_NOT_FOUND": 212,
    "INVALID_IDENTITY_MISMATCH": 191,
    "INVALID_REVOKED": 70
  },
  "identity_match_method": {
    "CREDENTIAL_ID": 2315,
    "VERIFICATION_CODE": 1530,
    "NATIONAL_ID_HASH": 623,
    "EMAIL": 387,
    "NAME_ONLY": 156
  },
  "revocation_reason": {
    "ADMIN_ERROR": 185,
    "DATA_CORRECTION": 156,
    "FRAUD": 117,
    "COURSE_RETIRED": 98,
    "ISSUER_CHANGE": 88,
    "LEARNER_REQUEST": 66
  },
  "overall_score_distribution": {
    "p10": 57,
    "p25": 69,
    "median": 73,
    "p75": 77,
    "p90": 80
  },
  "identity_coverage": {
    "distinct_full_names": 1600,
    "names_shared_by_more_than_one_learner": 1600,
    "learners_sharing_a_name": 20000,
    "note": "Name collisions are deliberate: identity resolution must use learner_id, verification_code or national_id_hash."
  },
  "issuer_changes": 2,
  "incomplete_courses": 24856
}
```
