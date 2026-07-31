'use client';

import { useState } from 'react';

/**
 * Extraído de src/app/dash/page.tsx (SimpleTable + PaginatedTable, antes
 * duplicadas ahí y en planner/page.tsx sin import compartido). Mismo
 * comportamiento, sin cambios de fondo.
 */
export function SimpleTable({ head, rows }: { head: React.ReactNode[]; rows: React.ReactNode[][] }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ background: '#1f2937', color: '#fff' }}>
            {head.map((h, i) => (
              <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, fontSize: '0.78rem' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 ? 'var(--bg-elevated)' : 'var(--bg-card)', borderTop: '1px solid var(--border)' }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Tabla con paginación. Muestra `pageSize` filas por página (default: 6) y
 * ofrece controles Prev/Next + indicador "Página X de Y". Si `rows.length <= pageSize`
 * se renderiza como una SimpleTable normal sin controles.
 */
export function PaginatedTable({ head, rows, pageSize = 6 }: { head: React.ReactNode[]; rows: React.ReactNode[][]; pageSize?: number }) {
  const [page, setPage] = useState(0);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  if (total <= pageSize) return <SimpleTable head={head} rows={rows} />;

  return (
    <div>
      <SimpleTable head={head} rows={pageRows} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 8, fontSize: '0.78rem' }}>
        <span style={{ color: 'var(--text-muted)' }}>
          {start + 1}–{Math.min(start + pageSize, total)} de {total}
        </span>
        <button
          onClick={() => setPage(Math.max(0, currentPage - 1))}
          disabled={currentPage === 0}
          className="secondary-btn"
          style={{ padding: '4px 10px', fontSize: '0.78rem', opacity: currentPage === 0 ? 0.4 : 1 }}
        >
          ← Anterior
        </button>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          {currentPage + 1} / {totalPages}
        </span>
        <button
          onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))}
          disabled={currentPage >= totalPages - 1}
          className="secondary-btn"
          style={{ padding: '4px 10px', fontSize: '0.78rem', opacity: currentPage >= totalPages - 1 ? 0.4 : 1 }}
        >
          Siguiente →
        </button>
      </div>
    </div>
  );
}
