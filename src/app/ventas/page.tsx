'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { CrmModulePage } from '@/components/CrmModule';

export default function VentasPage() {
  const [userEmail, setUserEmail] = useState<string>('');
  useEffect(() => {
    const supa = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    supa.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email); });
  }, []);
  return (
    <CrmModulePage
      module="sales"
      title="CRM Ventas"
      description="Pipeline comercial de 5 etapas: del prospecto al contrato firmado. Al firmar, el proyecto pasa automáticamente a Ingeniería."
      color="#3b82f6"
      userEmail={userEmail}
    />
  );
}
