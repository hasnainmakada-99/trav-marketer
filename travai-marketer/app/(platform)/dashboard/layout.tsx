'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { account, getCurrentUser } from '@/lib/appwrite-client';
import { canAccess, useRole, type StaffRole } from '@/lib/use-role';

const SIDEBAR_STORAGE_KEY = 'travai.dashboard.sidebar.collapsed';

const ALL_NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Command Center',
    shortLabel: 'Home',
    icon: 'CC',
    exact: true,
    feature: 'dashboard' as keyof ReturnType<typeof canAccess> | null,
  },
  {
    href: '/dashboard/gbp',
    label: 'Google Business',
    shortLabel: 'GBP',
    icon: 'GB',
    feature: 'gbp' as const,
  },
  {
    href: '/dashboard/whatsapp',
    label: 'WhatsApp CRM',
    shortLabel: 'WA',
    icon: 'WA',
    feature: 'whatsapp' as const,
  },
  {
    href: '/dashboard/campaigns',
    label: 'Campaigns',
    shortLabel: 'Camp',
    icon: 'CM',
    feature: 'campaigns' as const,
  },
  {
    href: '/dashboard/leads',
    label: 'Lead Pipeline',
    shortLabel: 'Leads',
    icon: 'LP',
    feature: 'leads' as const,
  },
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
      <div className={`border-b border-white/10 ${props.collapsed ? 'px-3 py-3.5' : 'px-4 py-4'}`}>
        <div className={`rounded-[28px] border border-white/10 bg-white/6 backdrop-blur ${props.collapsed ? 'p-3' : 'p-3.5'}`}>
          <div className={`flex items-center ${props.collapsed ? 'justify-center' : 'justify-between gap-3'}`}>
            <div className={`flex items-center ${props.collapsed ? 'justify-center' : 'gap-3'}`}>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-emerald-400 font-bold text-slate-950 shadow-lg">
                T
              </div>
              {!props.collapsed && (
                <div>
                  <p className="font-semibold tracking-tight text-white">TravAI Marketer</p>
                  <p className="text-xs text-slate-300">Travel CRM operating desk</p>
                </div>
              )}
            </div>

            {props.onToggleCollapse && (
              <button
                onClick={props.onToggleCollapse}
                className="hidden rounded-xl border border-white/10 bg-white/6 px-2.5 py-2 text-xs text-slate-200 transition hover:bg-white/12 lg:inline-flex"
                aria-label={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {props.collapsed ? '->' : '<-'}
              </button>
            )}
          </div>

          {!props.collapsed && (
            <div className="mt-3 rounded-2xl bg-emerald-400/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-200 ring-1 ring-emerald-300/15">
              GBP, WhatsApp, campaigns, and leads in one clean operating desk.
            </div>
          )}
        </div>
      </div>

      <nav className={`space-y-1.5 ${props.collapsed ? 'px-3 py-3.5' : 'px-3 py-4'}`}>
        {navItems.map((item) => {
          const isActive = item.exact ? props.pathname === item.href : props.pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={props.closeMobile}
              className={`group flex items-center rounded-2xl text-sm font-medium transition-all ${
                props.collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3.5 py-2.5'
              } ${
                isActive
                  ? 'bg-white text-slate-950 shadow-lg shadow-cyan-950/20'
                  : 'text-slate-200 hover:bg-white/8 hover:text-white'
              }`}
              title={props.collapsed ? item.label : undefined}
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl text-[11px] font-semibold tracking-wide ${
                  isActive ? 'bg-slate-100 text-slate-900' : 'bg-white/8 text-slate-100'
                }`}
              >
                {props.collapsed ? item.shortLabel : item.icon}
              </span>
              {!props.collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

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
              {item.shortLabel}
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

      <div className={`mt-auto border-t border-white/10 ${props.collapsed ? 'p-3' : 'p-3.5'}`}>
        {props.user && (
          <div
            className={`mb-3 rounded-[26px] border border-white/10 bg-white/5 ${props.collapsed ? 'p-3' : 'p-3.5'}`}
            title={props.collapsed ? `${props.user.name} - ${props.user.email}` : undefined}
          >
            <div className={`flex items-center ${props.collapsed ? 'justify-center' : 'gap-3'}`}>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 font-semibold">
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
                  <p className="truncate text-xs text-slate-300">{props.user.email}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <button
          onClick={props.onLogout}
          className={`w-full rounded-2xl border border-white/10 bg-white/5 text-sm font-medium text-slate-200 transition hover:bg-rose-500/10 hover:text-rose-200 ${
            props.collapsed ? 'px-0 py-3 text-center' : 'px-4 py-3 text-left'
          }`}
          title={props.collapsed ? 'Sign out' : undefined}
        >
          {props.collapsed ? 'Out' : 'Sign out'}
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

  const desktopSidebarWidth = useMemo(() => (sidebarCollapsed ? '5.25rem' : '16rem'), [sidebarCollapsed]);

  return (
    <div className="flex min-h-screen bg-transparent lg:h-screen lg:overflow-hidden">
      <aside className="hidden shrink-0 border-r border-slate-200/10 lg:flex lg:flex-col" style={{ width: desktopSidebarWidth }}>
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

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[min(20rem,calc(100vw-1rem))] max-w-full transform transition-transform duration-200 lg:hidden ${
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/70 bg-white/88 px-4 backdrop-blur lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm"
            aria-label="Open menu"
          >
            Menu
          </button>
          <div className="text-right">
            <p className="font-semibold text-slate-900">TravAI Marketer</p>
            <p className="text-xs text-slate-500">Travel CRM</p>
          </div>
        </div>

        <main className="min-h-0 flex-1 overflow-x-hidden lg:overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
