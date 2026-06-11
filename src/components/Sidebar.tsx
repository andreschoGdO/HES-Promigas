'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BarChart3, Settings, LogOut, Sun, ClipboardCheck, Package, HardHat, PanelLeftClose, PanelLeftOpen, FileBarChart, CalendarRange, Receipt, Users } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import { readVisibility, fetchVisibility, isItemVisible, type SidebarVisibility } from '@/lib/sidebar-visibility';
import { getRoleFromEmail, type UserRole } from '@/lib/user-role';

const USER_CACHE_KEY = 'sidebar-user-v1';

interface CachedUser { email: string; initial: string; role: UserRole }

const readCachedUser = (): CachedUser | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedUser) : null;
  } catch { return null; }
};

const writeCachedUser = (u: CachedUser): void => {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u)); } catch {}
};

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  // Lee del cache local para evitar el flash inicial (de admin con todos los items
  // a user con solo Visitas) mientras supabase.auth.getUser() resuelve.
  const [user, setUser] = useState<CachedUser | null>(() => readCachedUser());
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

  // Visibility per-item (global, configurable desde /configuracion).
  // Render inicial usa cache local; en mount sincronizamos contra la API.
  const [visibility, setVisibility] = useState<SidebarVisibility>({});
  useEffect(() => {
    setVisibility(readVisibility());
    void fetchVisibility().then(setVisibility);
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
    const applyUser = (email: string | null | undefined) => {
      if (email) {
        const next: CachedUser = { email, initial: email[0].toUpperCase(), role: getRoleFromEmail(email) };
        setUser(next);
        writeCachedUser(next);
      } else {
        setUser(null);
        try { window.localStorage.removeItem(USER_CACHE_KEY); } catch {}
      }
    };
    // Lectura inicial
    supabase.auth.getUser().then(({ data }) => applyUser(data.user?.email));
    // Reaccionar a cambios de sesión sin reload (login/logout/cambio de cuenta)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      applyUser(session?.user?.email);
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  const handleLogout = async () => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await supabase.auth.signOut();
    // Limpiar cache del rol para que el siguiente login no muestre items del anterior
    try { window.localStorage.removeItem(USER_CACHE_KEY); } catch {}
    router.push('/login');
    router.refresh();
  };

  // No renderizar sidebar en rutas de auth
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) return null;

  const navItemsAll = [
    { id: 'dashboard',   label: 'Head End System', path: '/dashboard', icon: BarChart3 },
    { id: 'operaciones', label: 'Operaciones', path: '/operaciones', icon: HardHat },
    { id: 'visitas',     label: 'Visitas en Campo', path: '/visitas', icon: ClipboardCheck },
    { id: 'inventario',  label: 'Inventario', path: '/inventario', icon: Package },
    { id: 'facturacion', label: 'Facturación', path: '/facturacion', icon: Receipt },
    { id: 'reportes',    label: 'Reportes', path: '/reportes', icon: FileBarChart },
    { id: 'planner',     label: 'Planner', path: '/planner', icon: CalendarRange },
  ];
  const adminItemsAll = [
    { id: 'usuarios',      label: 'Usuarios',          path: '/usuarios',      icon: Users },
    { id: 'configuracion', label: 'Configuración API', path: '/configuracion', icon: Settings },
  ];
  // Si todavía no sabemos quién es el usuario (sin cache + getUser pendiente),
  // NO renderizamos items. Es preferible un sidebar vacío 500ms a hacer flash
  // de items que el contratista no debería ver.
  const userLoaded = user !== null;
  const isUser = user?.role === 'user';
  const navItems = !userLoaded
    ? []
    : isUser
      ? navItemsAll.filter((i) => i.id === 'visitas')
      : navItemsAll.filter((i) => isItemVisible(i.id, visibility));
  const adminItems = !userLoaded || isUser
    ? []
    : adminItemsAll.filter((i) => isItemVisible(i.id, visibility));

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
