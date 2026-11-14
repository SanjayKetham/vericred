/**
 * Role-scoped navigation.
 *
 * Each role sees only the modules its job needs; the API enforces the same boundaries, so hiding a
 * menu here is a convenience, never the security control. Every module listed reads live data — a
 * menu that cannot be backed by the dataset is not listed at all.
 */

export type Role = 'LEARNER' | 'INSTRUCTOR' | 'ADMIN' | 'SUPPORT' | 'PLATFORM_ADMIN';

export type ModuleKey =
  // learner
  | 'learner.dashboard'
  | 'learner.profile'
  | 'learner.courses'
  | 'learner.progress'
  | 'learner.credentials'
  | 'learner.download'
  | 'learner.verify'
  | 'learner.share'
  | 'learner.notifications'
  // instructor
  | 'instructor.dashboard'
  | 'instructor.courses'
  | 'instructor.learners'
  | 'instructor.attendance'
  | 'instructor.assessments'
  | 'instructor.completions'
  | 'instructor.eligibility'
  | 'instructor.notifications'
  // academic administrator
  | 'admin.dashboard'
  | 'admin.learners'
  | 'admin.courses'
  | 'admin.rules'
  | 'admin.completions'
  | 'admin.eligibility'
  | 'admin.issue'
  | 'admin.registry'
  | 'admin.revocations'
  | 'admin.issuers'
  | 'admin.verifications'
  | 'admin.audit'
  | 'admin.reports'
  // support
  | 'support.dashboard'
  | 'support.learnerLookup'
  | 'support.credentialLookup'
  | 'support.verificationIssues'
  | 'support.revocationQueries'
  | 'support.activity'
  // platform administrator
  | 'platform.dashboard'
  | 'platform.users'
  | 'platform.roles'
  | 'platform.institutions'
  | 'platform.issuers'
  | 'platform.security'
  | 'platform.anomalies'
  | 'platform.audit'
  | 'platform.keys'
  | 'platform.api'
  | 'platform.database'
  | 'platform.settings'
  | 'platform.data'
  // shared
  | 'shared.verify';

export type IconName =
  | 'dashboard'
  | 'profile'
  | 'courses'
  | 'progress'
  | 'certificate'
  | 'download'
  | 'verify'
  | 'share'
  | 'bell'
  | 'support'
  | 'learners'
  | 'attendance'
  | 'assessment'
  | 'grade'
  | 'records'
  | 'eligibility'
  | 'issue'
  | 'registry'
  | 'revoke'
  | 'issuer'
  | 'history'
  | 'audit'
  | 'report'
  | 'ticket'
  | 'search'
  | 'escalate'
  | 'users'
  | 'roles'
  | 'institution'
  | 'shield'
  | 'anomaly'
  | 'key'
  | 'api'
  | 'database'
  | 'settings'
  | 'data';

export interface NavItem {
  key: ModuleKey;
  label: string;
  icon: IconName;
  /** What this module does, shown as the page subtitle. */
  purpose: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

const LEARNER_NAV: NavGroup[] = [
  {
    title: 'Learning',
    items: [
      { key: 'learner.dashboard', label: 'Dashboard', icon: 'dashboard', purpose: 'Your courses and credentials at a glance' },
      { key: 'learner.courses', label: 'My Courses', icon: 'courses', purpose: 'Every course you are enrolled in' },
      { key: 'learner.progress', label: 'Course Progress', icon: 'progress', purpose: 'Attendance, modules and assessment progress' },
    ],
  },
  {
    title: 'Credentials',
    items: [
      { key: 'learner.credentials', label: 'My Credentials', icon: 'certificate', purpose: 'Certificates issued to you' },
      { key: 'learner.download', label: 'Download Certificate', icon: 'download', purpose: 'Save a printable copy of a certificate' },
      { key: 'learner.verify', label: 'Verify Certificate', icon: 'verify', purpose: 'Check what a verifier would see' },
      { key: 'learner.share', label: 'Share Credential', icon: 'share', purpose: 'A public verification link and QR code' },
    ],
  },
  {
    title: 'Account',
    items: [
      { key: 'learner.profile', label: 'My Profile', icon: 'profile', purpose: 'Your personal details on record' },
      { key: 'learner.notifications', label: 'Notifications', icon: 'bell', purpose: 'Issuance and course updates for your record' },
    ],
  },
];

const INSTRUCTOR_NAV: NavGroup[] = [
  {
    title: 'Teaching',
    items: [
      { key: 'instructor.dashboard', label: 'Dashboard', icon: 'dashboard', purpose: 'Assigned courses and learner statistics' },
      { key: 'instructor.courses', label: 'My Courses', icon: 'courses', purpose: 'Courses assigned to you' },
      { key: 'instructor.learners', label: 'Learners', icon: 'learners', purpose: 'Learners enrolled in your courses' },
    ],
  },
  {
    title: 'Academic records',
    items: [
      { key: 'instructor.attendance', label: 'Attendance', icon: 'attendance', purpose: 'Attendance recorded against each enrolment' },
      { key: 'instructor.assessments', label: 'Assessments', icon: 'assessment', purpose: 'Assessments taken and passed per course' },
      { key: 'instructor.completions', label: 'Completion Records', icon: 'records', purpose: 'Completion submissions and their derived status' },
      { key: 'instructor.eligibility', label: 'Eligibility Preview', icon: 'eligibility', purpose: 'Which learners satisfy their credential rule' },
    ],
  },
  {
    title: 'Account',
    items: [
      { key: 'instructor.notifications', label: 'Notifications', icon: 'bell', purpose: 'Academic activity on your courses' },
    ],
  },
];

const ADMIN_NAV: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { key: 'admin.dashboard', label: 'Dashboard', icon: 'dashboard', purpose: 'Academic and credential analytics' },
    ],
  },
  {
    title: 'Academic records',
    items: [
      { key: 'admin.learners', label: 'Learner Management', icon: 'learners', purpose: 'Learner records and their credentials' },
      { key: 'admin.courses', label: 'Course Management', icon: 'courses', purpose: 'Courses, levels and effective dates' },
      { key: 'admin.rules', label: 'Credential Rules', icon: 'eligibility', purpose: 'Attendance and assessment requirements, by version' },
      { key: 'admin.completions', label: 'Completion Records', icon: 'records', purpose: 'Completion submissions awaiting evaluation' },
    ],
  },
  {
    title: 'Credential lifecycle',
    items: [
      { key: 'admin.eligibility', label: 'Eligibility Checker', icon: 'eligibility', purpose: 'Evaluate a completion against its rule without issuing' },
      { key: 'admin.issue', label: 'Issue Credentials', icon: 'issue', purpose: 'Generate and sign credentials that pass their rule' },
      { key: 'admin.registry', label: 'Credential Registry', icon: 'registry', purpose: 'Every issued credential' },
      { key: 'admin.revocations', label: 'Revocation Management', icon: 'revoke', purpose: 'Withdraw a credential and record why' },
      { key: 'admin.issuers', label: 'Issuer Management', icon: 'issuer', purpose: 'Issuing authorities and their signing identity' },
    ],
  },
  {
    title: 'Assurance',
    items: [
      { key: 'admin.verifications', label: 'Verification History', icon: 'history', purpose: 'Third-party verification requests' },
      { key: 'admin.audit', label: 'Audit Logs', icon: 'audit', purpose: 'Append-only record of every academic action' },
      { key: 'admin.reports', label: 'Reports', icon: 'report', purpose: 'Export credential and verification reports' },
    ],
  },
];

const SUPPORT_NAV: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { key: 'support.dashboard', label: 'Dashboard', icon: 'dashboard', purpose: 'Support activity overview' },
    ],
  },
  {
    title: 'Investigate',
    items: [
      { key: 'support.learnerLookup', label: 'Learner Lookup', icon: 'search', purpose: 'Find a learner by an authorised identifier' },
      { key: 'support.credentialLookup', label: 'Credential Lookup', icon: 'registry', purpose: 'Find a credential by ID or code' },
      { key: 'support.verificationIssues', label: 'Verification Issues', icon: 'history', purpose: 'Requests that did not return valid' },
      { key: 'support.revocationQueries', label: 'Revocation Queries', icon: 'revoke', purpose: 'Why a credential was withdrawn' },
    ],
  },
  {
    title: 'Records',
    items: [
      { key: 'support.activity', label: 'Activity History', icon: 'audit', purpose: 'Actions taken on this platform' },
    ],
  },
];

const PLATFORM_NAV: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { key: 'platform.dashboard', label: 'System Dashboard', icon: 'dashboard', purpose: 'Platform-wide analytics' },
    ],
  },
  {
    title: 'Access',
    items: [
      { key: 'platform.users', label: 'User Management', icon: 'users', purpose: 'Accounts that can sign in' },
      { key: 'platform.roles', label: 'Role Management', icon: 'roles', purpose: 'What each role is permitted to do' },
      { key: 'platform.institutions', label: 'Institution Management', icon: 'institution', purpose: 'Registered institutions and accreditation' },
      { key: 'platform.issuers', label: 'Issuer Registry', icon: 'issuer', purpose: 'Trusted issuer identities and succession' },
    ],
  },
  {
    title: 'Security',
    items: [
      { key: 'platform.security', label: 'Security Monitoring', icon: 'shield', purpose: 'Weak identity matching and failed verification patterns' },
      { key: 'platform.anomalies', label: 'Anomaly Detection', icon: 'anomaly', purpose: 'Detector findings scored against ground truth' },
      { key: 'platform.keys', label: 'Key Management', icon: 'key', purpose: 'Signing keys and their rotation history' },
      { key: 'platform.audit', label: 'Audit Logs', icon: 'audit', purpose: 'The hash-chained system log' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { key: 'platform.database', label: 'Database Monitoring', icon: 'database', purpose: 'Store health and row counts' },
      { key: 'platform.data', label: 'Data Management', icon: 'data', purpose: 'Generation, validation and reproducibility' },
      { key: 'platform.api', label: 'API Management', icon: 'api', purpose: 'Endpoints, roles and rate limits' },
      { key: 'platform.settings', label: 'System Settings', icon: 'settings', purpose: 'Platform configuration' },
    ],
  },
];

export const NAV_BY_ROLE: Record<Role, NavGroup[]> = {
  LEARNER: LEARNER_NAV,
  INSTRUCTOR: INSTRUCTOR_NAV,
  ADMIN: ADMIN_NAV,
  SUPPORT: SUPPORT_NAV,
  PLATFORM_ADMIN: PLATFORM_NAV,
};

export const ROLE_LABEL: Record<Role, string> = {
  LEARNER: 'Learner',
  INSTRUCTOR: 'Instructor',
  ADMIN: 'Academic administrator',
  SUPPORT: 'Support',
  PLATFORM_ADMIN: 'Platform administrator',
};

export const DEFAULT_MODULE: Record<Role, ModuleKey> = {
  LEARNER: 'learner.dashboard',
  INSTRUCTOR: 'instructor.dashboard',
  ADMIN: 'admin.dashboard',
  SUPPORT: 'support.dashboard',
  PLATFORM_ADMIN: 'platform.dashboard',
};

/** Flat lookup so a page can ask for its own label and purpose. */
export function findItem(role: Role, key: ModuleKey): NavItem | undefined {
  for (const group of NAV_BY_ROLE[role]) {
    const found = group.items.find((item) => item.key === key);
    if (found) return found;
  }
  return undefined;
}
