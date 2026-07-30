'use client';

import { useEffect } from 'react';
import { X, type LucideIcon } from 'lucide-react';

/**
 * Extraído de src/app/facturacion/page.tsx (donde vivía sin exportar).
 * Chrome genérico de modal: overlay + header con ícono/título + click
 * afuera/Escape cierran. Reusado por Órdenes de Compra, Presupuesto, etc.
 */
export function ModalShell({ title, onClose, accent, Icon, width = 520, children }: {
  title: string; onClose: () => void; accent: string; Icon: LucideIcon; width?: number; children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-panel"
        style={{ width: '100%', maxWidth: width, maxHeight: '92vh', overflow: 'auto', padding: 0, borderTop: `3px solid ${accent}` }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon size={18} style={{ color: accent }} />
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{title}</h3>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'inline-flex' }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
