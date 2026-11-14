/** Row shapes shared by the generator, the validator and the API. These mirror docs/data-dictionary.md. */

export type LearnerStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type CourseStatus = 'ACTIVE' | 'RETIRED';
export type IssuerStatus = 'ACTIVE' | 'SUPERSEDED';
export type RuleStatus = 'ACTIVE' | 'SUPERSEDED';
export type CompletionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'WITHDRAWN' | 'FAILED';
export type CredentialStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';
export type RevocationStatus = 'ACTIVE' | 'RESCINDED';

export type VerificationResult =
  | 'VALID'
  | 'INVALID_NOT_FOUND'
  | 'INVALID_REVOKED'
  | 'INVALID_EXPIRED'
  | 'INVALID_HASH_MISMATCH'
  | 'INVALID_IDENTITY_MISMATCH';

export type IdentityMatchMethod =
  | 'CREDENTIAL_ID'
  | 'VERIFICATION_CODE'
  | 'NATIONAL_ID_HASH'
  | 'EMAIL'
  | 'NAME_ONLY';

export type VerifierType = 'EMPLOYER' | 'UNIVERSITY' | 'GOVERNMENT' | 'PLATFORM' | 'INDIVIDUAL';

export type RevocationReason =
  | 'FRAUD'
  | 'ADMIN_ERROR'
  | 'COURSE_RETIRED'
  | 'ISSUER_CHANGE'
  | 'LEARNER_REQUEST'
  | 'DATA_CORRECTION';

export type ActorRole =
  | 'SYSTEM'
  | 'LEARNER'
  | 'INSTRUCTOR'
  | 'ADMIN'
  | 'SUPPORT'
  | 'PLATFORM_ADMIN'
  | 'VERIFIER';

export type AuditEntityType =
  | 'LEARNER'
  | 'COURSE'
  | 'RULE'
  | 'COMPLETION'
  | 'CREDENTIAL'
  | 'VERIFICATION'
  | 'REVOCATION'
  | 'ISSUER'
  | 'USER';

export type AuditEventType =
  | 'CREATED'
  | 'COMPLETION_EVALUATED'
  | 'ISSUANCE_APPROVED'
  | 'ISSUANCE_DENIED'
  | 'CREDENTIAL_ISSUED'
  | 'VERIFICATION_REQUESTED'
  | 'VERIFICATION_COMPLETED'
  | 'REVOKED'
  | 'REVOCATION_RESCINDED'
  | 'ISSUER_SUPERSEDED'
  | 'EXPIRED'
  | 'USER_REGISTERED'
  | 'USER_ROLE_CHANGED';

export type IssueType =
  | 'EC01_ISSUED_BEFORE_COMPLETION'
  | 'EC02_DUPLICATE_CREDENTIAL_ID'
  | 'EC03_REVOKED_VERIFIES_ACTIVE'
  | 'EC04_ALTERED_PAYLOAD_HASH_UNDETECTED';

export interface Learner {
  learner_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  date_of_birth: string;
  national_id_hash: string;
  country: string;
  enrollment_date: string;
  status: LearnerStatus;
  created_at: string;
}

export interface Course {
  course_id: string;
  course_code: string;
  title: string;
  subject_area: string;
  level: string;
  credit_hours: number;
  modules_total: number;
  assessment_count: number;
  passing_score: number;
  effective_from: string;
  effective_to: string | null;
  status: CourseStatus;
}

export interface Issuer {
  issuer_id: string;
  legal_name: string;
  accreditation_body: string;
  key_algorithm: 'Ed25519';
  public_key: string;
  effective_from: string;
  effective_to: string | null;
  supersedes_issuer_id: string | null;
  status: IssuerStatus;
}

export interface CredentialRule {
  rule_id: string;
  course_id: string;
  rule_version: number;
  min_overall_score: number;
  min_modules_completed_pct: number;
  required_assessments_passed: number;
  min_attendance_pct: number;
  max_days_to_complete: number;
  effective_from: string;
  effective_to: string | null;
  status: RuleStatus;
}

export interface CompletionRecord {
  completion_id: string;
  learner_id: string;
  course_id: string;
  enrolled_at: string;
  last_activity_at: string;
  completed_at: string | null;
  modules_total: number;
  modules_completed: number;
  modules_completed_pct: number;
  attendance_pct: number;
  assessments_taken: number;
  assessments_passed: number;
  overall_score: number;
  days_to_complete: number | null;
  status: CompletionStatus;
}

export interface CriterionResult {
  criterion: string;
  required: number | string;
  actual: number | string;
  passed: boolean;
}

export interface IssuanceDecision {
  decision: 'APPROVED' | 'DENIED';
  rule_id: string;
  rule_version: number;
  evaluated_at: string;
  criteria: CriterionResult[];
  failed_criteria: string[];
}

export interface Credential {
  credential_id: string;
  learner_id: string;
  course_id: string;
  completion_id: string;
  issuer_id: string;
  rule_id: string;
  rule_version: number;
  issued_at: string;
  expires_at: string | null;
  status: CredentialStatus;
  payload_json: string;
  payload_hash: string;
  hash_algorithm: 'SHA-256';
  signature: string;
  signature_algorithm: 'Ed25519';
  verification_code: string;
  issuance_decision: string;
}

export interface VerificationRequest {
  verification_id: string;
  credential_id: string | null;
  requested_credential_ref: string;
  verifier_name: string;
  verifier_type: VerifierType;
  requested_at: string;
  presented_hash: string;
  identity_match_method: IdentityMatchMethod;
  identity_match_score: number;
  result: VerificationResult;
  latency_ms: number;
}

export interface Revocation {
  revocation_id: string;
  credential_id: string;
  sequence_no: number;
  reason_code: RevocationReason;
  reason_text: string;
  revoked_at: string;
  revoked_by: string;
  status: RevocationStatus;
}

export interface AuditEvent {
  event_id: string;
  event_seq: number;
  entity_type: AuditEntityType;
  entity_id: string;
  event_type: AuditEventType;
  actor_id: string;
  actor_role: ActorRole;
  occurred_at: string;
  payload_json: string;
  prev_hash: string;
  event_hash: string;
}

export interface GroundTruthRow {
  record_type: string;
  record_id: string;
  issue_type: IssueType;
  expected_decision: string;
  detectable_by: string;
  description: string;
}

export interface Dataset {
  learners: Learner[];
  courses: Course[];
  issuers: Issuer[];
  credentialRules: CredentialRule[];
  completionRecords: CompletionRecord[];
  credentials: Credential[];
  verificationRequests: VerificationRequest[];
  revocations: Revocation[];
  auditEvents: AuditEvent[];
  groundTruth: GroundTruthRow[];
  /** Generation diagnostics for the CLI summary; not part of the persisted schema. */
  __stats?: { approvedTotal: number; deniedTotal: number; issuanceBacklog: number };
}
