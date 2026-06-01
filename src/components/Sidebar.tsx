'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BarChart3, Settings, LogOut, Sun, Bell, ClipboardCheck, Home, Package, ShoppingCart, Ruler, HardHat, TrendingUp, PanelLeftClose, PanelLeftOpen, FileBarChart, CalendarRange } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import { readVisibility, isItemVisible, type SidebarVisibility } from '@/lib/sidebar-visibility';

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email: string; initial: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Collapsed state (desktop only) — persiste en localStorage
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem('sidebar-collapsed') === '1'); } catch {}
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem('sidebar-collapsed', next ? '1' : '0'); } catch {}
      // Disparar evento para que el layout (margen del main) reaccione
      window.dispatchEvent(new CustomEvent('sidebar-collapsed-change', { detail: next }));
      return next;
    });
  };
  // Emitir el estado actual al cambiar (también al montar) + ajustar clase del <html>
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('sidebar-collapsed-change', { detail: collapsed }));
    document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
  }, [collapsed]);

  // Visibility per-item (configurable desde /configuracion)
  const [visibility, setVisibility] = useState<SidebarVisibility>({});
  useEffect(() => {
    setVisibility(readVisibility());
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SidebarVisibility>).detail;
      setVisibility(detail ?? readVisibility());
    };
    window.addEventListener('sidebar-visibility-change', handler);
    return () => window.removeEventListener('sidebar-visibility-change', handler);
  }, []);

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

  const navItemsAll = [
    { id: 'inicio',      label: 'Inicio', path: '/inicio', icon: Home },
    { id: 'dashboard',   label: 'HES Head End System', path: '/dashboard', icon: BarChart3 },
    { id: 'ventas',      label: 'CRM Ventas', path: '/ventas', icon: ShoppingCart },
    { id: 'ingenieria',  label: 'Ingeniería', path: '/ingenieria', icon: Ruler },
    { id: 'operaciones', label: 'Operaciones', path: '/operaciones', icon: HardHat },
    { id: 'funnel',      label: 'Funnel', path: '/funnel', icon: TrendingUp },
    { id: 'visitas',     label: 'Visitas en Campo', path: '/visitas', icon: ClipboardCheck },
    { id: 'inventario',  label: 'Inventario', path: '/inventario', icon: Package },
    { id: 'reportes',    label: 'Reportes', path: '/reportes', icon: FileBarChart },
    { id: 'planner',     label: 'Planner', path: '/planner', icon: CalendarRange },
  ];
  const adminItemsAll = [
    { id: 'alertas',       label: 'NAR', path: '/alertas', icon: Bell },
    { id: 'configuracion', label: 'Configuración API', path: '/configuracion', icon: Settings },
  ];
  const navItems = navItemsAll.filter((i) => isItemVisible(i.id, visibility));
  const adminItems = adminItemsAll.filter((i) => isItemVisible(i.id, visibility));

  return (
    <>
      {/* Backdrop visible solo cuando el menú está abierto en móvil */}
      <div
        className={`sidebar-backdrop ${mobileOpen ? 'open' : ''}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''} ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-logo" style={{ position: 'relative' }}>
        <div className="sidebar-logo-mark" style={{ background: 'transparent', color: 'var(--accent)' }}>
          <Sun size={26} strokeWidth={2.5} fill="currentColor" />
        </div>
        {!collapsed && <span className="sidebar-logo-text">SUNNY</span>}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          className="sidebar-collapse-btn"
          aria-label="Colapsar menú"
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      <div className="sidebar-content">
        {!collapsed && <div className="sidebar-section">General</div>}
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`nav-item ${active ? 'active' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={16} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}

        {!collapsed && <div className="sidebar-section">Sistema</div>}
        {adminItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`nav-item ${active ? 'active' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={16} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </div>

      <Link
        href="/cuenta"
        className={`sidebar-footer ${pathname === '/cuenta' ? 'active' : ''}`}
        style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
        title={collapsed ? (user?.email ?? 'Mi cuenta') : 'Mi cuenta'}
      >
        <div className="sidebar-avatar">{user?.initial ?? '?'}</div>
        {!collapsed && (
          <>
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
          </>
        )}
      </Link>
    </aside>
    </>
  );
}
