'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronRight, Menu } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';

const TITLES: Record<string, string> = {
  '/': 'Head End System',
  '/dashboard': 'Head End System',
  '/dash': 'Dash Construcción',
  '/operaciones': 'Construcción',
  '/reportes': 'Reportes',
  '/configuracion': 'Configuración',
  '/usuarios': 'Usuarios',
  '/funnel-topleads': 'Funnel Comercial (TopLeads)',
  '/planner': 'Planner',
  '/ordenes-compra': 'Órdenes de Compra',
  '/presupuesto': 'Presupuesto',
  '/visitas': 'Visitas en Campo',
  '/inventario': 'Inventario',
  '/gestion-equipos': 'Gestión de Equipos',
  '/facturacion': 'Facturación',
  '/cuenta': 'Mi cuenta',
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
    // Lectura inicial
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? '');
    });
    // Reaccionar a cambios de sesión (login/logout/cambio de cuenta sin reload)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? '');
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  // No mostrar topbar en /login y /auth/*
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) return null;

  return (
    <header className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="topbar-hamburger"
          aria-label="Abrir menú"
          onClick={() => window.dispatchEvent(new Event('toggle-sidebar'))}
        >
          <Menu size={20} />
        </button>
        <div className="topbar-breadcrumb">
          <span>HES SUNNY</span>
          <ChevronRight size={14} />
          <strong>{title}</strong>
        </div>
      </div>
      <div className="topbar-actions">
        <span className="topbar-user">{email || '—'}</span>
      </div>
    </header>
  );
}
