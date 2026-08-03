'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronRight, Menu, Bell } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';

const TITLES: Record<string, string> = {
  '/': 'Head End System',
  '/dashboard': 'Head End System',
  '/dash': 'Dash Construcción',
  '/operaciones': 'CRM Construcción',
  '/reportes': 'Reportes',
  '/configuracion': 'Configuración',
  '/usuarios': 'Usuarios',
  '/funnel-topleads': 'Dash Comercial',
  '/planner': 'Planner',
  '/ordenes-compra': 'Órdenes de Compra',
  '/presupuesto': 'Presupuesto',
  '/visitas': 'Visitas en Campo',
  '/inventario': 'Inventario',
  '/facturacion': 'Facturación',
  '/cuenta': 'Mi cuenta',
};

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

function NotificationBell({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = async () => {
    if (!email) return;
    const r = await fetch(`/api/notifications?email=${encodeURIComponent(email)}&limit=20`);
    if (!r.ok) return;
    const j = await r.json();
    setItems(j.notifications ?? []);
    setUnreadCount(j.unreadCount ?? 0);
  };

  useEffect(() => {
    void load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const markAllRead = async () => {
    if (unreadCount === 0) return;
    setItems((its) => its.map((i) => ({ ...i, read: true })));
    setUnreadCount(0);
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, all: true }),
    });
  };

  const openBell = () => {
    setOpen((o) => !o);
    if (!open) void markAllRead();
  };

  if (!email) return null;

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={openBell}
        aria-label="Notificaciones"
        style={{ position: 'relative', background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, display: 'flex', color: 'var(--text-secondary)' }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2, minWidth: 15, height: 15, borderRadius: 8,
            background: '#ef4444', color: 'white', fontSize: '0.6rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
          }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 900 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', right: 0, top: '120%', width: 320, maxHeight: 400, overflowY: 'auto',
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 901,
          }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: '0.8rem', fontWeight: 700 }}>
              Notificaciones
            </div>
            {items.length === 0 ? (
              <div style={{ padding: 16, fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>Sin notificaciones</div>
            ) : items.map((n) => (
              <a
                key={n.id}
                href={n.link ?? '#'}
                style={{
                  display: 'block', padding: '10px 12px', borderBottom: '1px solid var(--border)',
                  fontSize: '0.78rem', color: 'var(--text-primary)', textDecoration: 'none',
                  background: n.read ? 'transparent' : 'rgba(59, 130, 246, 0.06)',
                }}
              >
                <div style={{ fontWeight: 600 }}>{n.title}</div>
                {n.body && <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{n.body}</div>}
                <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: 4 }}>
                  {new Date(n.created_at).toLocaleString('es-CO')}
                </div>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

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
      <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <NotificationBell email={email} />
        <span className="topbar-user">{email || '—'}</span>
      </div>
    </header>
  );
}
