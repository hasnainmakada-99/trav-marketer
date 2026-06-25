'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { account, getCurrentUser } from '@/lib/appwrite-client';
import { canAccess, useRole, type StaffRole } from '@/lib/use-role';

const SIDEBAR_STORAGE_KEY = 'travai.dashboard.sidebar.collapsed';

const NAV_ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  gbp: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  ),
  whatsapp: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
    </svg>
  ),
  campaigns: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38a.482.482 0 01-.629-.122 17.938 17.938 0 01-2.286-4.472m0 0a16.472 16.472 0 00-1.088-4.398m5.138 4.398c.284.112.541.184.82.228m0-9.18a16.775 16.775 0 00-.82.228m5.138 4.398a16.832 16.832 0 00-1.088 4.398m0 0a17.938 17.938 0 01-2.286 4.472.482.482 0 01-.629.122l-.657-.38c-.523-.302-.71-.962-.463-1.511.401-.89.732-1.821.985-2.783m0-9.18A16.9 16.9 0 0012 4.5c-.704 0-1.402.03-2.09.09m5.139 4.398a16.832 16.832 0 011.088 4.398M12 4.5a16.87 16.87 0 01-2.09.09" />
    </svg>
  ),
  leads: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
};

const ALL_NAV_ITEMS = [
  { href: '/dashboard', label: 'Command Center', shortLabel: 'Home', key: 'dashboard', exact: true, feature: 'dashboard' as const },
  { href: '/dashboard/gbp', label: 'Google Business', shortLabel: 'GBP', key: 'gbp', feature: 'gbp' as const },
  { href: '/dashboard/whatsapp', label: 'WhatsApp CRM', shortLabel: 'WA', key: 'whatsapp', feature: 'whatsapp' as const },
  { href: '/dashboard/campaigns', label: 'Campaigns', shortLabel: 'Camp', key: 'campaigns', feature: 'campaigns' as const },
  { href: '/dashboard/leads', label: 'Lead Pipeline', shortLabel: 'Leads', key: 'leads', feature: 'leads' as const },
] as const;

const ROLE_BADGE: Record<StaffRole, string> = {
  owner: 'bg-fuchsia-100 text-fuchsia-700',
  admin: 'bg-cyan-100 text-cyan-700',
  manager: 'bg-emerald-100 text-emerald-700',
  staff: 'bg-slate-100 text-slate-600',
};

interface AppwriteUser {
  $id: string;
  name: string;
  email: string;
}

function NavItem({
  href,
  label,
  shortLabel,
  navKey,
  exact,
  collapsed,
  isActive,
  closeMobile,
}: {
  href: string;
  label: string;
  shortLabel: string;
  navKey: string;
  exact?: boolean;
  collapsed: boolean;
  isActive: boolean;
  closeMobile?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={closeMobile}
      className={`group flex items-center rounded-2xl text-sm font-medium transition-all ${
        collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3.5 py-2.5'
      } ${
        isActive
          ? 'bg-white text-slate-950 shadow-lg shadow-cyan-950/20'
          : 'text-slate-200 hover:bg-white/8 hover:text-white'
      }`}
      title={collapsed ? label : undefined}
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-xl ${
          isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-100'
        }`}
      >
        {NAV_ICONS[navKey]}
      </span>
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}

function SidebarInner(props: {
  pathname: string;
  user: AppwriteUser | null;
  role: StaffRole;
  roleLoading: boolean;
  collapsed: boolean;
  onLogout: () => Promise<void>;
  onToggleCollapse?: () => void;
  closeMobile?: () => void;
}) {
  const navItems = ALL_NAV_ITEMS.filter(
    (item) => !item.feature || canAccess(props.role, item.feature as Parameters<typeof canAccess>[1])
  );
  const quickLinks = navItems.filter((item) => item.href !== '/dashboard').slice(0, 2);

  return (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,#091221_0%,#101828_45%,#162032_100%)] text-white">
      {/* Header */}
      <div className={`border-b border-white/10 ${props.collapsed ? 'px-3 py-3.5' : 'px-4 py-4'}`}>
        <div className="flex items-center justify-between">
          <div className={`flex items-center ${props.collapsed ? 'justify-center' : 'gap-3'}`}>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-emerald-400 font-bold text-slate-950 shadow-lg shadow-cyan-500/20">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            </div>
            {!props.collapsed && (
              <div>
                <p className="font-semibold tracking-tight text-white">TravAI</p>
                <p className="text-[11px] text-slate-400">Marketing Platform</p>
              </div>
            )}
          </div>
          {props.onToggleCollapse && (
            <button
              onClick={props.onToggleCollapse}
              className="hidden rounded-xl border border-white/10 bg-white/6 p-2 text-slate-400 transition hover:bg-white/12 hover:text-white lg:inline-flex"
              aria-label={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg
                className={`h-4 w-4 transition ${props.collapsed ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className={`flex-1 space-y-1 overflow-y-auto ${props.collapsed ? 'px-3 py-3.5' : 'px-3 py-4'}`}>
        {navItems.map((item) => {
          const i = item as typeof item & { exact?: boolean };
          return (
            <NavItem
              key={i.href}
              href={i.href}
              label={i.label}
              shortLabel={i.shortLabel}
              navKey={i.key}
              exact={i.exact}
              collapsed={props.collapsed}
              isActive={i.exact ? props.pathname === i.href : props.pathname.startsWith(i.href)}
              closeMobile={props.closeMobile}
            />
          );
        })}
      </nav>

      {/* Quick access */}
      <div className={`border-t border-white/10 ${props.collapsed ? 'px-3 py-3' : 'px-3 pb-3'}`}>
        {props.collapsed ? (
          quickLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={props.closeMobile}
              className="mt-2 flex h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/6 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-400/15"
              title={item.label}
            >
              {NAV_ICONS[item.key]}
            </Link>
          ))
        ) : (
          <div className="rounded-[24px] border border-white/10 bg-white/6 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Quick access</p>
            <div className="mt-3 space-y-2">
              {quickLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={props.closeMobile}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/30 px-3 py-2.5 text-sm font-medium text-white transition hover:border-emerald-300/30 hover:bg-emerald-400/10"
                >
                  <span>{item.label}</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                    Open
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* User profile */}
      <div className={`border-t border-white/10 ${props.collapsed ? 'p-3' : 'p-3.5'}`}>
        {props.user && (
          <div
            className={`mb-3 rounded-[26px] border border-white/10 bg-white/5 ${props.collapsed ? 'p-3' : 'p-3.5'}`}
            title={props.collapsed ? `${props.user.name} - ${props.user.email}` : undefined}
          >
            <div className={`flex items-center ${props.collapsed ? 'justify-center' : 'gap-3'}`}>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 font-bold text-white shadow-lg">
                {props.user.name?.[0]?.toUpperCase() || 'U'}
              </div>
              {!props.collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-white">{props.user.name}</p>
                    {!props.roleLoading && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${ROLE_BADGE[props.role]}`}>
                        {props.role}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-slate-400">{props.user.email}</p>
                </div>
              )}
            </div>
          </div>
        )}
        <button
          onClick={props.onLogout}
          className={`flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 text-sm font-medium text-slate-300 transition hover:bg-rose-500/10 hover:text-rose-200 ${
            props.collapsed ? 'px-0 py-3' : 'px-4 py-3'
          }`}
          title={props.collapsed ? 'Sign out' : undefined}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
          {!props.collapsed && 'Sign out'}
        </button>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AppwriteUser | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { role, loading: roleLoading } = useRole();

  useEffect(() => {
    getCurrentUser().then((currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }
      setUser(currentUser as AppwriteUser);
    });
  }, [router]);

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (storedValue === 'true') {
        setSidebarCollapsed(true);
      }
    } catch {
      // ignore storage read errors
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? 'true' : 'false');
    } catch {
      // ignore storage write errors
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    try {
      await account.deleteSession('current');
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const desktopSidebarWidth = useMemo(() => (sidebarCollapsed ? '5rem' : '16rem'), [sidebarCollapsed]);

  return (
    <div className="flex min-h-screen bg-slate-50 lg:h-screen lg:overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className="hidden shrink-0 border-r border-slate-200/20 lg:flex lg:flex-col"
        style={{ width: desktopSidebarWidth, transition: 'width 0.2s ease' }}
      >
        <SidebarInner
          pathname={pathname}
          user={user}
          role={role}
          roleLoading={roleLoading}
          collapsed={sidebarCollapsed}
          onLogout={handleLogout}
          onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
        />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Mobile sidebar drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[min(20rem,calc(100vw-1rem))] max-w-full transform transition-transform duration-300 ease-in-out lg:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarInner
          pathname={pathname}
          user={user}
          role={role}
          roleLoading={roleLoading}
          collapsed={false}
          onLogout={handleLogout}
          closeMobile={() => setMobileOpen(false)}
        />
      </aside>

      {/* Main content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <div className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            Menu
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-emerald-400 text-xs font-bold text-slate-950">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-slate-900">TravAI</p>
              <p className="text-xs text-slate-500">Marketing Platform</p>
            </div>
          </div>
        </div>

        <main className="min-h-0 flex-1 overflow-x-hidden lg:overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
