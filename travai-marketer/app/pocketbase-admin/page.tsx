import { redirect } from 'next/navigation';
import { getPocketBaseAdminUrl } from '@/lib/dashboard-auth';

export default function PocketBaseAdminPage() {
  redirect(getPocketBaseAdminUrl());
}
