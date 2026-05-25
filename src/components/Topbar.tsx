'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';

const TITLES: Record<string, string> = {
  '/': 'Inicio',
  '/dashboard': 'Dashboard',
  '/configuracion': 'Configuración',
  '/alertas': 'Configuración Alertas',
};

export function Topbar() {
  const pathname = usePathname();
  const title = TITLES[pathname] ?? 'GdO';
  const [email, setEmail] = useState<string>('');

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setEmail(data.user.email);
    });
  }, []);

  // No mostrar topbar en /login y /auth/*
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) return null;

  return (
    <header className="topbar">
      <div className="topbar-breadcrumb">
        <span>HES SUNNY</span>
        <ChevronRight size={14} />
        <strong>{title}</strong>
      </div>
      <div className="topbar-actions">
        <span className="topbar-user">{email || '—'}</span>
      </div>
    </header>
  );
}
