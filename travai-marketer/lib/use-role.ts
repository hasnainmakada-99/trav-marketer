'use client';

import { useState, useEffect } from 'react';
import { getCurrentUser } from '@/lib/appwrite-client';

export type StaffRole = 'owner' | 'admin' | 'manager' | 'staff';

export const ROLE_PERMISSIONS: Record<StaffRole, {
  dashboard: boolean; whatsapp: boolean; gbp: boolean;
  campaigns: boolean; leads: boolean; settings: boolean;
}> = {
  owner:   { dashboard: true,  whatsapp: true,  gbp: true,  campaigns: true,  leads: true,  settings: true },
  admin:   { dashboard: true,  whatsapp: true,  gbp: true,  campaigns: true,  leads: true,  settings: false },
  manager: { dashboard: true,  whatsapp: true,  gbp: true,  campaigns: true,  leads: true,  settings: false },
  staff:   { dashboard: true,  whatsapp: true,  gbp: false, campaigns: false, leads: false, settings: false },
};

export function canAccess(role: StaffRole, feature: keyof typeof ROLE_PERMISSIONS['owner']): boolean {
  return ROLE_PERMISSIONS[role]?.[feature] ?? false;
}

interface UseRoleReturn {
  role: StaffRole;
  loading: boolean;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
}

export function useRole(): UseRoleReturn {
  const [role, setRole] = useState<StaffRole>('staff');
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) { setLoading(false); return; }
        const u = user as { $id?: string; name?: string; email?: string };
        setUserId(u.$id || null);
        setUserName(u.name || null);
        setUserEmail(u.email || null);

        const params = new URLSearchParams();
        if (u.$id) params.set('userId', u.$id);
        else if (u.email) params.set('email', u.email);

        const res = await fetch(`/api/staff/me?${params}`);
        if (res.ok) {
          const data = await res.json() as { role?: StaffRole };
          if (data.role) setRole(data.role);
        }
      } catch { /* default to staff */ } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return { role, loading, userId, userName, userEmail };
}
