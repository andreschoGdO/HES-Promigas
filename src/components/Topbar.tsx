'use client';

import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

const TITLES: Record<string, string> = {
  '/': 'Inicio',
  '/dashboard': 'Dashboard',
  '/configuracion': 'Configuración',
  '/explorar-api': 'Explorar API',
};

export function Topbar() {
  const pathname = usePathname();
  const title = TITLES[pathname] ?? 'GdO';

  return (
    <header className="topbar">
      <div className="topbar-breadcrumb">
        <span>HES SUNNY</span>
        <ChevronRight size={14} />
        <strong>{title}</strong>
      </div>
      <div className="topbar-actions">
        <span className="topbar-user">davider@gdo.com.co</span>
      </div>
    </header>
  );
}
