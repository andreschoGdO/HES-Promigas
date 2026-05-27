'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BarChart3, Settings, LogOut, Sun, Bell, ClipboardCheck, Home, Package, ShoppingCart, Ruler, HardHat, TrendingUp } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email: string; initial: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Escuchar el botón hamburguesa del topbar
  useEffect(() => {
    const handler = () => setMobileOpen((v) => !v);
    window.addEventListener('toggle-sidebar', handler);
    return () => window.removeEventListener('toggle-sidebar', handler);
  }, []);

  // Cerrar al navegar (cambio de ruta)
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Bloquear scroll del body cuando el drawer está abierto en móvil
  useEffect(() => {
    if (mobileOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) {
        const email = data.user.email;
        setUser({ email, initial: email[0].toUpperCase() });
      }
    });
  }, []);

  const handleLogout = async () => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  // No renderizar sidebar en rutas de auth
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) return null;

  const navItems = [
    { label: 'Inicio', path: '/inicio', icon: Home },
    { label: 'HES Head End System', path: '/dashboard', icon: BarChart3 },
    { label: 'CRM Ventas', path: '/ventas', icon: ShoppingCart },
    { label: 'Ingeniería', path: '/ingenieria', icon: Ruler },
    { label: 'Operaciones', path: '/operaciones', icon: HardHat },
    { label: 'Funnel', path: '/funnel', icon: TrendingUp },
    { label: 'Visitas en Campo', path: '/visitas', icon: ClipboardCheck },
    { label: 'Inventario', path: '/inventario', icon: Package },
  ];

  const adminItems = [
    { label: 'Configuración Alertas', path: '/alertas', icon: Bell },
    { label: 'Configuración API', path: '/configuracion', icon: Settings },
  ];

  return (
    <>
      {/* Backdrop visible solo cuando el menú está abierto en móvil */}
      <div
        className={`sidebar-backdrop ${mobileOpen ? 'open' : ''}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-logo">
        <div className="sidebar-logo-mark" style={{ background: 'transparent', color: 'var(--accent)' }}>
          <Sun size={26} strokeWidth={2.5} fill="currentColor" />
        </div>
        <span className="sidebar-logo-text">SUNNY</span>
      </div>

      <div className="sidebar-content">
        <div className="sidebar-section">General</div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`nav-item ${active ? 'active' : ''}`}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </Link>
          );
        })}

        <div className="sidebar-section">Sistema</div>
        {adminItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`nav-item ${active ? 'active' : ''}`}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>

      <Link
        href="/cuenta"
        className={`sidebar-footer ${pathname === '/cuenta' ? 'active' : ''}`}
        style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
        title="Mi cuenta"
      >
        <div className="sidebar-avatar">{user?.initial ?? '?'}</div>
        <div className="sidebar-user-info" style={{ minWidth: 0, overflow: 'hidden' }}>
          <div className="sidebar-user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email?.split('@')[0] ?? 'Mi cuenta'}
          </div>
          <div className="sidebar-user-role">Configurar</div>
        </div>
        <button
          className="icon-btn"
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleLogout(); }}
        >
          <LogOut size={14} />
        </button>
      </Link>
    </aside>
    </>
  );
}
