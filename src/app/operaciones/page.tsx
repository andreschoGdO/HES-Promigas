'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { CrmModulePage } from '@/components/CrmModule';

export default function OperacionesPage() {
  const [userEmail, setUserEmail] = useState<string>('');
  useEffect(() => {
    const supa = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    supa.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email); });
  }, []);
  return (
    <CrmModulePage
      module="operations"
      title="Construcción"
      description="Visita previa, alistamiento de inventario, instalación con contratista, puesta en marcha y legalización."
      color="#f59e0b"
      userEmail={userEmail}
    />
  );
}
