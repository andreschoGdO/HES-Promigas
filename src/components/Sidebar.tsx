'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BarChart3, Settings, LogOut, Sun, Bell } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email: string; initial: string } | null>(null);

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
    { label: 'Dashboard', path: '/dashboard', icon: BarChart3 },
  ];

  const adminItems = [
    { label: 'Configuración Alertas', path: '/alertas', icon: Bell },
    { label: 'Configuración API', path: '/configuracion', icon: Settings },
  ];

  return (
    <aside className="sidebar">
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

      <div className="sidebar-footer">
        <div className="sidebar-avatar">D</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">David Eraso</div>
          <div className="sidebar-user-role">Admin</div>
        </div>
        <button className="icon-btn" title="Salir" aria-label="Salir">
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  );
}
