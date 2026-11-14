import { useEffect, useMemo, useState } from 'react';
import { api, clearSession, getUser, type AuthUser } from './lib/api';
import { DEFAULT_MODULE, findItem, NAV_BY_ROLE, type ModuleKey, type Role } from './nav';
import { IntegrityCard, Sidebar, TopBar } from './components/shell';
import { Banner, Spinner } from './components/ui';

import { AuthPage } from './pages/Auth';
import { LandingPage } from './pages/Landing';
import { VerifyPage } from './pages/Verify';
import { AuditPage } from './pages/Audit';
import { CredentialsPage } from './pages/Credentials';
import { DashboardPage } from './pages/Dashboard';
import { IssuancePage } from './pages/Issuance';
import { LearnersPage } from './pages/Learners';
import { SettingsPage } from './pages/Settings';
import { LearnerCourses, LearnerCredentials, LearnerDashboard, LearnerNotifications, LearnerProfile } from './pages/learner';
import { CompletionsModule, InstructorDashboard, PlatformDashboard, SupportDashboard } from './pages/dashboards';
import {
  AnomalyModule,
  ApiModule,
  CoursesModule,
  DatabaseModule,
  IssuersModule,
  KeysModule,
  LearnerLookupModule,
  ReportsModule,
  RevocationsModule,
  RolesModule,
  RulesModule,
  SecurityModule,
  UsersModule,
  VerificationsModule,
} from './pages/modules';

interface Health {
  data_source: string;
  ai: string;
  seed: number;
  as_of: string;
  audit_tail: { event_id: string; event_hash: string } | null;
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(getUser);
  const [module, setModule] = useState<ModuleKey | null>(null);
  // Signed out, the app is a landing page, the auth page, or the standalone public verify page.
  const [publicView, setPublicView] = useState<'landing' | 'auth' | 'verify'>('landing');
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin');
  const [search, setSearch] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem('vericred.theme') as 'light' | 'dark' | null) ?? 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('vericred.theme', theme);
    } catch {
      /* blocked storage must not break the toggle */
    }
  }, [theme]);

  useEffect(() => {
    api<Health>('/api/health').then(setHealth).catch(() => setHealth(null));
  }, []);

  // A shared verification link still lands on the landing page: its verify panel reads the code from
  // the query string and sits above the fold, so the visitor sees the result and the context around it.

  const role = (user?.role ?? 'LEARNER') as Role;
  const allKeys = useMemo(() => NAV_BY_ROLE[role]?.flatMap((group) => group.items.map((item) => item.key)) ?? [], [role]);
  const active: ModuleKey = module && allKeys.includes(module) ? module : DEFAULT_MODULE[role] ?? 'learner.dashboard';
  const item = user ? findItem(role, active) : undefined;

  function signOut() {
    clearSession();
    setUser(null);
    setModule(null);
    setSearch('');
    setPublicView('landing');
  }

  function signedIn(next: AuthUser) {
    setUser(next);
    setModule(DEFAULT_MODULE[(next.role as Role) ?? 'LEARNER'] ?? null);
    setPublicView('landing');
  }

  /* ------------------------------------------------- signed out: verify or auth */

  if (!user) {
    if (publicView === 'landing') {
      return (
        <LandingPage
          onSignIn={() => {
            setAuthMode('signin');
            setPublicView('auth');
          }}
          onRegister={() => {
            setAuthMode('register');
            setPublicView('auth');
          }}
          theme={theme}
          onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
      );
    }

    if (publicView === 'verify') {
      return (
        <div className="min-h-screen">
          <header className="flex items-center justify-between px-6 py-5">
            <button onClick={() => setPublicView('landing')} className="flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold"
                style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
                aria-hidden="true"
              >
                V
              </span>
              <span className="text-[17px] font-semibold tracking-tight">VeriCred</span>
            </button>
            <button
              onClick={() => {
                setAuthMode('signin');
                setPublicView('auth');
              }}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            >
              Sign in
            </button>
          </header>
          <main className="mx-auto max-w-3xl">
            <VerifyPage />
          </main>
          <footer className="ink-muted mx-auto max-w-3xl px-6 pb-8 text-xs">
            Fully synthetic data · no real personal information.
          </footer>
        </div>
      );
    }
    return (
      <AuthPage
        mode={authMode}
        onMode={setAuthMode}
        onSignedIn={signedIn}
        onVerify={() => setPublicView('verify')}
        onBack={() => setPublicView('landing')}
      />
    );
  }

  /* -------------------------------------------------------------- signed in */

  const subtitle = (
    <>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: health ? 'var(--status-good)' : 'var(--status-critical)' }} aria-hidden="true" />
        {health ? `${health.data_source} store` : 'API unreachable'}
      </span>
      {item && <span className="ink-muted">· {item.purpose}</span>}
    </>
  );

  const title = active.endsWith('.dashboard') ? `Hi, ${user.display_name}` : item?.label ?? 'VeriCred';

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        role={role}
        active={active}
        onSelect={setModule}
        footer={health ? <IntegrityCard seed={health.seed} source={`${health.data_source} store`} checks="18/18 checks pass" /> : null}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto scroll-thin">
        <TopBar
          title={title}
          subtitle={subtitle}
          search={search}
          onSearch={setSearch}
          theme={theme}
          onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          user={user}
          onSignOut={signOut}
        />
        <main className="flex-1 px-6 pb-8">
          <ModuleView module={active} user={user} role={role} search={search} health={health} />
        </main>
      </div>
    </div>
  );
}

function ModuleView({
  module,
  user,
  role,
  search,
  health,
}: {
  module: ModuleKey;
  user: AuthUser;
  role: Role;
  search: string;
  health: Health | null;
}) {
  const canIssue = role === 'ADMIN' || role === 'PLATFORM_ADMIN';
  const canRevoke = canIssue;

  switch (module) {
    /* ------------------------------------------------------------ learner */
    case 'learner.dashboard':
      return <LearnerDashboard user={user} />;
    case 'learner.profile':
      return <LearnerProfile user={user} />;
    case 'learner.courses':
      return <LearnerCourses user={user} search={search} detailed={false} />;
    case 'learner.progress':
      return <LearnerCourses user={user} search={search} detailed />;
    case 'learner.credentials':
      return <LearnerCredentials user={user} mode="list" search={search} />;
    case 'learner.download':
      return <LearnerCredentials user={user} mode="download" search={search} />;
    case 'learner.share':
      return <LearnerCredentials user={user} mode="share" search={search} />;
    case 'learner.verify':
    case 'shared.verify':
      return <VerifyPage />;
    case 'learner.notifications':
      return <LearnerNotifications user={user} />;

    /* --------------------------------------------------------- instructor */
    case 'instructor.dashboard':
      return <InstructorDashboard />;
    case 'instructor.courses':
      return <CoursesModule search={search} />;
    case 'instructor.learners':
      return <LearnersPage search={search} />;
    case 'instructor.attendance':
      return <CompletionsModule search={search} focus="attendance" />;
    case 'instructor.assessments':
      return <CompletionsModule search={search} focus="assessments" />;
    case 'instructor.completions':
      return <CompletionsModule search={search} focus="records" />;
    case 'instructor.eligibility':
      return <IssuancePage canIssue={false} search={search} />;
    case 'instructor.notifications':
      return <AuditPage search={search} />;

    /* -------------------------------------------------------------- admin */
    case 'admin.dashboard':
      return <DashboardPage range="Monthly" search={search} />;
    case 'admin.learners':
      return <LearnersPage search={search} />;
    case 'admin.courses':
      return <CoursesModule search={search} />;
    case 'admin.rules':
      return <RulesModule search={search} />;
    case 'admin.completions':
      return <CompletionsModule search={search} focus="records" />;
    case 'admin.eligibility':
      return <IssuancePage canIssue={false} search={search} />;
    case 'admin.issue':
      return <IssuancePage canIssue={canIssue} search={search} />;
    case 'admin.registry':
      return <CredentialsPage canRevoke={canRevoke} search={search} />;
    case 'admin.revocations':
      return <RevocationsModule search={search} />;
    case 'admin.issuers':
      return <IssuersModule />;
    case 'admin.verifications':
      return <VerificationsModule search={search} failedOnly={false} />;
    case 'admin.audit':
      return <AuditPage search={search} />;
    case 'admin.reports':
      return <ReportsModule />;

    /* ------------------------------------------------------------ support */
    case 'support.dashboard':
      return <SupportDashboard />;
    case 'support.learnerLookup':
      return <LearnerLookupModule search={search} />;
    case 'support.credentialLookup':
      return <CredentialsPage canRevoke={false} search={search} />;
    case 'support.verificationIssues':
      return <VerificationsModule search={search} failedOnly />;
    case 'support.revocationQueries':
      return <RevocationsModule search={search} />;
    case 'support.activity':
      return <AuditPage search={search} />;

    /* ----------------------------------------------------------- platform */
    case 'platform.dashboard':
      return <PlatformDashboard health={health} />;
    case 'platform.users':
      return <UsersModule user={user} />;
    case 'platform.roles':
      return <RolesModule />;
    case 'platform.institutions':
      return <IssuersModule asInstitutions />;
    case 'platform.issuers':
      return <IssuersModule />;
    case 'platform.security':
      return <SecurityModule />;
    case 'platform.anomalies':
      return <AnomalyModule mode="anomalies" />;
    case 'platform.audit':
      return <AuditPage search={search} />;
    case 'platform.keys':
      return <KeysModule />;
    case 'platform.api':
      return <ApiModule />;
    case 'platform.database':
      return <DatabaseModule health={health} />;
    case 'platform.data':
      return <AnomalyModule mode="data" />;
    case 'platform.settings':
      return <SettingsPage health={health} />;

    default:
      return <Banner kind="warning">That module does not exist for this role.</Banner>;
  }
}

export { Spinner };
