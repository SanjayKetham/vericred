import type { ReactNode } from 'react';
import { NAV_BY_ROLE, ROLE_LABEL, type IconName, type ModuleKey, type Role } from '../nav';

/** App chrome: the fixed navigation rail and the top bar. */

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const PATHS: Record<IconName | 'logo' | 'sun' | 'moon' | 'logout' | 'magnifier', ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 19.5c.7-3.3 3.3-5.1 7-5.1s6.3 1.8 7 5.1" />
    </>
  ),
  courses: (
    <>
      <path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5z" />
      <path d="M20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5a1.5 1.5 0 001.5-1.5z" />
    </>
  ),
  progress: (
    <>
      <path d="M4 19V5M4 19h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </>
  ),
  certificate: (
    <>
      <rect x="3" y="4.5" width="18" height="11" rx="2" />
      <path d="M7 9h6M7 12h4" />
      <circle cx="17" cy="17.5" r="2.5" />
      <path d="M15.4 19.4L15 22l2-1 2 1-.4-2.6" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M8 11.5l4 3.5 4-3.5" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  verify: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.3-3 8-7.5 9.5-4.5-1.5-7.5-5.2-7.5-9.5V6z" />
      <path d="M9 12.2l2.2 2.2L15.5 10" />
    </>
  ),
  share: (
    <>
      <circle cx="17.5" cy="6" r="2.5" />
      <circle cx="6.5" cy="12" r="2.5" />
      <circle cx="17.5" cy="18" r="2.5" />
      <path d="M8.8 10.8l6.4-3.5M8.8 13.2l6.4 3.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 9.5a5.5 5.5 0 1111 0c0 3.2.8 4.7 1.5 5.5h-14c.7-.8 1.5-2.3 1.5-5.5z" />
      <path d="M10 18.5a2 2 0 004 0" />
    </>
  ),
  support: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M14.2 9.8L17 7M9.8 9.8L7 7M14.2 14.2L17 17M9.8 14.2L7 17" />
    </>
  ),
  learners: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6S14 16 14.6 19" />
      <path d="M16 6.2a3 3 0 010 5.6M17.5 14.6c2 .6 3.3 2.1 3.8 4.4" />
    </>
  ),
  attendance: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
      <path d="M9 14l1.8 1.8L15 12" />
    </>
  ),
  assessment: (
    <>
      <path d="M6 3.5h9L19 7v13.5H6z" />
      <path d="M15 3.5V7h4" />
      <path d="M9 12h7M9 16h4" />
    </>
  ),
  grade: (
    <>
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />
    </>
  ),
  records: (
    <>
      <path d="M5 4.5h14v15H5z" />
      <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" />
    </>
  ),
  eligibility: (
    <>
      <path d="M5 4.5h14v15H5z" />
      <path d="M8.2 9.5l1.6 1.6L13 7.8M8.2 15.2l1.6 1.6L13 13.5" />
      <path d="M15 10.5h2M15 16.2h2" />
    </>
  ),
  issue: (
    <>
      <rect x="3.5" y="5" width="17" height="11" rx="2" />
      <path d="M7 9.5h5M7 12.5h3" />
      <path d="M16 18.5l2 2 3.5-3.5" />
    </>
  ),
  registry: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <circle cx="8.5" cy="11" r="2.2" />
      <path d="M5 16.3c.7-1.5 2-2.3 3.5-2.3s2.8.8 3.5 2.3M15 10h4M15 13.5h2.5" />
    </>
  ),
  revoke: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M6.2 6.2l11.6 11.6" />
    </>
  ),
  issuer: (
    <>
      <path d="M4 20h16M6 20V9.5l6-4 6 4V20" />
      <path d="M10 20v-4.5h4V20" />
    </>
  ),
  history: (
    <>
      <path d="M3.8 12a8.2 8.2 0 103-6.3" />
      <path d="M3.5 4.5V9h4.5" />
      <path d="M12 8v4.4l3 1.8" />
    </>
  ),
  audit: (
    <>
      <path d="M5 4.5h14v15H5z" />
      <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" />
      <circle cx="17" cy="16.5" r="3" />
      <path d="M19.3 18.8L21 20.5" />
    </>
  ),
  report: (
    <>
      <path d="M6 3.5h9L19 7v13.5H6z" />
      <path d="M15 3.5V7h4" />
      <path d="M9.5 16.5v-3M12 16.5v-5M14.5 16.5v-2" />
    </>
  ),
  ticket: (
    <>
      <path d="M3.5 8.5V6.5h17v2a2.2 2.2 0 000 4.4v4.6h-17v-4.6a2.2 2.2 0 000-4.4z" />
      <path d="M12 7.5v9" strokeDasharray="2 2.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  magnifier: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  escalate: (
    <>
      <path d="M12 20V5M7 10l5-5 5 5" />
      <path d="M4.5 3.5h15" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6S14 16 14.6 19" />
      <path d="M16 6.2a3 3 0 010 5.6M17.5 14.6c2 .6 3.3 2.1 3.8 4.4" />
    </>
  ),
  roles: (
    <>
      <path d="M12 3l7 3v5c0 4.2-2.9 7.9-7 9.3C7.9 18.9 5 15.2 5 11V6z" />
      <circle cx="12" cy="10.5" r="2.2" />
      <path d="M8.6 16c.6-1.8 1.9-2.7 3.4-2.7s2.8.9 3.4 2.7" />
    </>
  ),
  institution: (
    <>
      <path d="M3.5 20h17M12 3.5l8 4.2H4z" />
      <path d="M6.5 10v7M10 10v7M14 10v7M17.5 10v7" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.3-3 8-7.5 9.5-4.5-1.5-7.5-5.2-7.5-9.5V6z" />
      <path d="M12 8.5v4M12 15.3v.2" />
    </>
  ),
  anomaly: (
    <>
      <path d="M3 16l4-5 3.5 3L15 7l6 9" />
      <circle cx="15" cy="7" r="1.8" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="12" r="3.5" />
      <path d="M11 12h9.5M17.5 12v3M20.5 12v2.2" />
    </>
  ),
  api: (
    <>
      <path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5" />
      <path d="M13.5 5l-3 14" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
      <path d="M4.5 6v12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8V6" />
      <path d="M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h11M19 7h1M4 12h3M11 12h9M4 17h7M15 17h5" />
      <circle cx="17" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="13" cy="17" r="2" />
    </>
  ),
  data: (
    <>
      <path d="M4 7.5h7v9H4zM13 4.5h7v15h-7z" />
      <path d="M6 10.5h3M15 7.5h3M15 11h3M15 14.5h3" />
    </>
  ),
  logo: (
    <>
      <path d="M12 2.6l8 3.2v6c0 4.7-3.3 8.8-8 10.2-4.7-1.4-8-5.5-8-10.2v-6z" />
      <path d="M8.6 12l2.5 2.5 4.6-5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2M12 19.2v2M21.2 12h-2M4.8 12h-2M18.4 5.6l-1.4 1.4M7 17l-1.4 1.4M18.4 18.4L17 17M7 7L5.6 5.6" />
    </>
  ),
  moon: <path d="M20 13.5A8 8 0 1110.5 4a6.5 6.5 0 009.5 9.5z" />,
  logout: (
    <>
      <path d="M14 4.5h4a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-4" />
      <path d="M10 15.5L13.5 12 10 8.5M13.5 12h-9" />
    </>
  ),
};

export function Icon({ name, className = 'h-[18px] w-[18px]' }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...S}>
      {PATHS[name]}
    </svg>
  );
}

export function Sidebar({
  role,
  active,
  onSelect,
  footer,
}: {
  role: Role;
  active: ModuleKey;
  onSelect: (key: ModuleKey) => void;
  footer?: ReactNode;
}) {
  const groups = NAV_BY_ROLE[role];

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col gap-4 px-3 py-5" style={{ background: 'var(--sidebar)' }}>
      <div className="px-2">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          >
            <Icon name="logo" className="h-5 w-5" />
          </span>
          <span className="text-[17px] font-semibold tracking-tight" style={{ color: 'var(--sidebar-ink-strong)' }}>
            VeriCred
          </span>
        </div>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {ROLE_LABEL[role]}
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto scroll-thin pr-1" aria-label="Modules">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {group.title}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const selected = active === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => onSelect(item.key)}
                    aria-current={selected ? 'page' : undefined}
                    title={item.purpose}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors"
                    style={{
                      background: selected ? 'var(--accent)' : 'transparent',
                      color: selected ? 'var(--on-accent)' : 'var(--sidebar-ink)',
                    }}
                    onMouseEnter={(e) => {
                      if (!selected) e.currentTarget.style.background = 'var(--sidebar-hover)';
                    }}
                    onMouseLeave={(e) => {
                      if (!selected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <Icon name={item.icon} className="h-[17px] w-[17px] shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {footer}
    </aside>
  );
}

/** The sidebar footer card — dataset provenance, the platform equivalent of a plan/usage tile. */
export function IntegrityCard({ seed, source, checks }: { seed: number; source: string; checks: string }) {
  return (
    <div className="rounded-2xl p-3.5" style={{ background: 'var(--sidebar-hover)' }}>
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--sidebar-ink)' }}>
        Dataset integrity
      </p>
      <p className="mt-1.5 text-sm font-semibold" style={{ color: 'var(--sidebar-ink-strong)' }}>
        {checks}
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.14)' }}>
        <div className="h-full rounded-full" style={{ width: '100%', background: 'var(--status-good)' }} />
      </div>
      <p className="mt-2 text-[11px]" style={{ color: 'var(--sidebar-ink)' }}>
        seed {seed} · {source}
      </p>
    </div>
  );
}

export function TopBar({
  title,
  subtitle,
  search,
  onSearch,
  searchPlaceholder = 'Search credential, code, learner…',
  theme,
  onTheme,
  user,
  onSignOut,
  extra,
}: {
  title: string;
  subtitle: ReactNode;
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder?: string;
  theme: 'light' | 'dark';
  onTheme: () => void;
  user: { display_name: string; role: string } | null;
  onSignOut: () => void;
  extra?: ReactNode;
}) {
  const initial = user?.display_name.charAt(0).toUpperCase() ?? '?';

  return (
    <header className="flex flex-wrap items-center gap-4 px-6 py-5">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[22px] font-semibold tracking-tight">{title}</h1>
        <p className="ink-secondary mt-0.5 flex flex-wrap items-center gap-2 text-sm">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {extra}

        <label className="relative block">
          <span className="sr-only">Search</span>
          <span className="ink-muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
            <Icon name="magnifier" className="h-4 w-4" />
          </span>
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-[250px] py-2 pl-9 pr-3 text-sm"
          />
        </label>

        <button
          onClick={onTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          className="ink-secondary flex h-9 w-9 items-center justify-center rounded-full"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="h-4 w-4" />
        </button>

        {user && (
          <>
            <button
              onClick={onSignOut}
              aria-label="Sign out"
              className="ink-secondary flex h-9 w-9 items-center justify-center rounded-full"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
            >
              <Icon name="logout" className="h-4 w-4" />
            </button>
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
              title={`${user.display_name} · ${user.role.replace(/_/g, ' ').toLowerCase()}`}
            >
              {initial}
            </span>
          </>
        )}
      </div>
    </header>
  );
}
