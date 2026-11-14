/**
 * Reference pools for synthetic generation.
 *
 * Provenance: these name, institution and subject strings are invented for this exercise. No external
 * dataset was downloaded, scraped or redistributed, and no real person's data appears here. See the
 * "Lawful provenance" section of the README.
 */

export const FIRST_NAMES = [
  'Aarav', 'Ananya', 'Rohan', 'Priya', 'Vikram', 'Meera', 'Arjun', 'Divya', 'Karthik', 'Sneha',
  'Liam', 'Olivia', 'Noah', 'Emma', 'James', 'Sophia', 'Ethan', 'Isabella', 'Lucas', 'Mia',
  'Mateo', 'Camila', 'Hiroshi', 'Yuki', 'Chen', 'Lin', 'Amara', 'Kwame', 'Fatima', 'Omar',
  'Lukas', 'Hannah', 'Pieter', 'Ingrid', 'Sofia', 'Marco', 'Elena', 'Tomas', 'Nadia', 'Samir',
];

export const LAST_NAMES = [
  'Sharma', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Gupta', 'Mehta', 'Rao', 'Desai', 'Kulkarni',
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Taylor',
  'Tanaka', 'Suzuki', 'Wang', 'Li', 'Okafor', 'Mensah', 'Haddad', 'Khan', 'Mueller', 'Schmidt',
  'Rossi', 'Ferrari', 'Novak', 'Petrov', 'Silva', 'Santos', 'Dubois', 'Laurent', 'Olsen', 'Berg',
];

/**
 * A small pool is deliberate: 40 x 40 names across 20,000 learners guarantees heavy full_name
 * collisions. Identity resolution therefore cannot rely on name alone, which is an explicit
 * acceptance criterion.
 */

export const COUNTRIES = ['IN', 'US', 'GB', 'DE', 'SG', 'AU', 'CA', 'BR', 'NG', 'JP'] as const;

export const COUNTRY_WEIGHTS: readonly (readonly [string, number])[] = [
  ['IN', 28], ['US', 20], ['GB', 10], ['DE', 8], ['SG', 6],
  ['AU', 6], ['CA', 7], ['BR', 6], ['NG', 5], ['JP', 4],
];

export const SUBJECT_AREAS = [
  'DATA', 'CLOUD', 'SEC', 'FIN', 'HEALTH', 'DESIGN', 'PM', 'AI', 'NET', 'OPS',
] as const;

export const SUBJECT_TOPICS: Record<string, string[]> = {
  DATA: ['Data Modelling', 'SQL Analytics', 'Data Warehousing', 'Streaming Pipelines', 'Data Quality'],
  CLOUD: ['Cloud Architecture', 'Container Orchestration', 'Serverless Design', 'Cloud Cost Management', 'Infrastructure as Code'],
  SEC: ['Applied Cryptography', 'Threat Modelling', 'Identity and Access Management', 'Incident Response', 'Secure Code Review'],
  FIN: ['Financial Reporting', 'Risk Analytics', 'Payments Infrastructure', 'Treasury Operations', 'Regulatory Reporting'],
  HEALTH: ['Clinical Informatics', 'Health Data Privacy', 'Care Pathway Design', 'Medical Coding', 'Patient Safety Systems'],
  DESIGN: ['Interaction Design', 'Design Systems', 'Accessibility Engineering', 'Service Design', 'Design Research'],
  PM: ['Product Discovery', 'Delivery Management', 'Stakeholder Alignment', 'Roadmap Planning', 'Outcome Metrics'],
  AI: ['Applied Machine Learning', 'Model Evaluation', 'Retrieval Systems', 'Responsible AI', 'LLM Application Design'],
  NET: ['Network Fundamentals', 'Routing and Switching', 'Network Security', 'Edge Delivery', 'Observability for Networks'],
  OPS: ['Site Reliability Practice', 'Release Engineering', 'Capacity Planning', 'On-call Operations', 'Change Management'],
};

export const LEVELS = ['FOUNDATION', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const;

export const LEVEL_WEIGHTS: readonly (readonly [string, number])[] = [
  ['FOUNDATION', 35], ['INTERMEDIATE', 34], ['ADVANCED', 23], ['EXPERT', 8],
];

export const ACCREDITATION_BODIES = ['NAAC', 'ABET', 'EQAR', 'CHEA', 'TEQSA', 'NONE'] as const;

export const ISSUER_NAMES = [
  'Meridian Institute of Technology',
  'Northgate Professional Academy',
  'Cascadia Open Learning Trust',
  'Vantage Skills Council',
  'Hanover Technical University',
  'Lumen Credentialing Authority',
];

export const VERIFIER_ORGS = [
  'Arclight Systems', 'Beacon Health Group', 'Cobalt Financial', 'Delta Logistics',
  'Everline Consulting', 'Foundry Labs', 'Greenfield Energy', 'Harborview Hospital',
  'Ironwood Manufacturing', 'Juniper Retail', 'Keystone Insurance', 'Lantern Media',
  'Ministry of Skills Development', 'National Registry Office', 'Orbit Telecom',
  'Pinecrest University Admissions', 'Quarry Analytics', 'Redwood Staffing',
  'Summit Aerospace', 'Trailhead Software',
];

export const VERIFIER_TYPE_WEIGHTS: readonly (readonly [string, number])[] = [
  ['EMPLOYER', 52], ['UNIVERSITY', 18], ['GOVERNMENT', 12], ['PLATFORM', 13], ['INDIVIDUAL', 5],
];

export const IDENTITY_METHOD_WEIGHTS: readonly (readonly [string, number])[] = [
  ['CREDENTIAL_ID', 46], ['VERIFICATION_CODE', 31], ['NATIONAL_ID_HASH', 12], ['EMAIL', 8], ['NAME_ONLY', 3],
];

export const REVOCATION_REASON_WEIGHTS: readonly (readonly [string, number])[] = [
  ['ADMIN_ERROR', 26], ['FRAUD', 18], ['DATA_CORRECTION', 20],
  ['COURSE_RETIRED', 14], ['ISSUER_CHANGE', 12], ['LEARNER_REQUEST', 10],
];

export const REVOCATION_REASON_TEXT: Record<string, string> = {
  FRAUD: 'Assessment integrity review concluded the submitted work was not the learner\'s own.',
  ADMIN_ERROR: 'Credential issued against the wrong course version by administrative error.',
  COURSE_RETIRED: 'Course retired and its credential withdrawn under the retirement policy.',
  ISSUER_CHANGE: 'Issuing authority superseded; credential reissued under the successor issuer.',
  LEARNER_REQUEST: 'Learner requested withdrawal of the published credential.',
  DATA_CORRECTION: 'Completion record corrected after audit; issuance criteria no longer met.',
};

export const ADMIN_ACTORS = ['ADM-001', 'ADM-002', 'ADM-003', 'ADM-004'];
export const INSTRUCTOR_ACTORS = ['INS-001', 'INS-002', 'INS-003', 'INS-004', 'INS-005', 'INS-006'];
