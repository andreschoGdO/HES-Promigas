'use client';

import { Receipt } from 'lucide-react';

export default function FacturacionEpcPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0 }}>Facturación EPC</h1>
        <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Facturación hacia el cliente EPC. Todavía sin definir.
        </p>
      </div>

      <div className="glass-panel" style={{ padding: 40, textAlign: 'center' }}>
        <Receipt size={32} style={{ color: 'var(--text-muted)', marginBottom: 10 }} />
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Este módulo todavía no tiene contenido.
        </p>
      </div>
    </div>
  );
}
