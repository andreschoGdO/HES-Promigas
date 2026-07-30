'use client';

/**
 * Extraído de src/app/dash/page.tsx (donde vivía duplicado junto con
 * planner/page.tsx, sin import compartido). Mismo comportamiento, sin
 * cambios — solo dejó de estar copiado 2-3 veces.
 */
export function StatCard({ label, value, hint, tag, detalle, detalleSecundario }: {
  label: string; value: string; hint: string;
  tag?: string;
  /** Lista de casas que componen esta métrica; se muestra al hover. */
  detalle?: string[];
  /** Lista secundaria (ej: para mostrar 'programadas' al lado de 'instaladas'). */
  detalleSecundario?: { label: string; items: string[] };
}) {
  const parts: string[] = [];
  if (detalle && detalle.length > 0) {
    parts.push(`${label}:\n${detalle.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}`);
  }
  if (detalleSecundario && detalleSecundario.items.length > 0) {
    parts.push(`${detalleSecundario.label}:\n${detalleSecundario.items.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}`);
  }
  const nativeTitle = parts.length > 0 ? parts.join('\n\n') : undefined;
  const showHint = parts.length > 0;
  return (
    <div className="stat-card" title={nativeTitle} style={{ position: 'relative' }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600 }}>{hint}</div>
      {tag && (
        <div style={{
          marginTop: 4,
          display: 'inline-flex',
          alignSelf: 'flex-start',
          padding: '2px 8px',
          background: 'var(--bg-elevated)',
          color: 'var(--text-secondary)',
          borderRadius: 999,
          fontSize: '0.68rem',
          fontWeight: 600,
          border: '1px solid var(--border)',
        }}>
          {tag}
        </div>
      )}
      {showHint && (
        <div style={{
          marginTop: 6,
          fontSize: '0.68rem',
          color: 'var(--text-muted)',
          fontStyle: 'italic',
        }}>
          Ver casas ↗
        </div>
      )}
    </div>
  );
}
