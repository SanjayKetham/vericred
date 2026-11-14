/** Row shapes returned by the API, mirroring docs/data-dictionary.md. */

export interface Learner {
  learner_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  date_of_birth: string;
  country: string;
  enrollment_date: string;
  status: string;
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
  status: string;
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
  status: string;
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
  status: string;
}

export interface VerificationRequest {
  verification_id: string;
  credential_id: string | null;
  requested_credential_ref: string;
  verifier_name: string;
  verifier_type: string;
  requested_at: string;
  presented_hash: string;
  identity_match_method: string;
  identity_match_score: number;
  result: string;
  latency_ms: number;
}

export interface Revocation {
  revocation_id: string;
  credential_id: string;
  sequence_no: number;
  reason_code: string;
  reason_text: string;
  revoked_at: string;
  revoked_by: string;
  status: string;
}

export interface Issuer {
  issuer_id: string;
  legal_name: string;
  accreditation_body: string;
  key_algorithm: string;
  public_key: string;
  effective_from: string;
  effective_to: string | null;
  supersedes_issuer_id: string | null;
  status: string;
}

export interface PlatformUser {
  user_id: string;
  email: string;
  role: string;
  display_name: string;
  learner_id: string | null;
  created_at?: string;
}

export interface Criterion {
  criterion: string;
  required: string | number;
  actual: string | number;
  passed: boolean;
}

export interface IssuanceDecision {
  decision: 'APPROVED' | 'DENIED';
  rule_id: string;
  rule_version: number;
  evaluated_at: string;
  criteria: Criterion[];
  failed_criteria: string[];
}

/** A learner's enrolment with the rule evaluation attached. */
export interface LearnerCourseRow {
  completion: CompletionRecord;
  course: Course;
  rule: CredentialRule | null;
  decision: IssuanceDecision | null;
}
