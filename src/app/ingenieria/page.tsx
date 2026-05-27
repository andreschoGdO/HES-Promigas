'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Calculator } from 'lucide-react';
import { CrmModulePage } from '@/components/CrmModule';

/**
 * Calculadora rápida de dimensionamiento para Cali (4.5 kWh/kWp/día default).
 * Da una primera sugerencia al ingeniero — al ejecutar la transición a "aprobación"
 * los campos quedan persistidos en el proyecto.
 */
function QuickSizer() {
  const [kwhMes, setKwhMes] = useState<string>('');
  const [yieldKwhKwpDia, setYieldKwhKwpDia] = useState<string>('4.5');
  const [panelWp, setPanelWp] = useState<string>('550');
  const [autosuf, setAutosuf] = useState<string>('70'); // % de la demanda a cubrir

  const kwhMesN = Number(kwhMes) || 0;
  const yieldDia = Number(yieldKwhKwpDia) || 4.5;
  const panelKwp = (Number(panelWp) || 550) / 1000;
  const autosufN = Number(autosuf) || 70;

  const kwhDiaPromedio = kwhMesN / 30;
  const demandaCubrir = kwhDiaPromedio * (autosufN / 100);
  const kwpSugeridos = demandaCubrir / yieldDia;
  const paneles = Math.ceil(kwpSugeridos / panelKwp);
  const generacionMensual = kwpSugeridos * yieldDia * 30;
  const inversorRange = kwpSugeridos < 6 ? 'DEYE 6K' : kwpSugeridos < 12 ? 'Livoltek 10K' : 'DEYE 15K / Livoltek 15K';

  return (
    <div className="glass-panel" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Calculator size={18} style={{ color: '#8b5cf6' }} />
        <h3 style={{ margin: 0, fontSize: '0.98rem' }}>Calculadora rápida de dimensionamiento</h3>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
        Sugerencia inicial basada en yield Cali. Ajusta y luego registra los valores definitivos al avanzar el proyecto a "Pendiente aprobación".
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div>
          <label className="input-label" style={{ fontSize: '0.74rem' }}>Consumo mensual (kWh)</label>
          <input type="text" inputMode="decimal" value={kwhMes} onChange={(e) => setKwhMes(e.target.value)} placeholder="450" style={{ width: '100%' }} />
        </div>
        <div>
          <label className="input-label" style={{ fontSize: '0.74rem' }}>Yield (kWh/kWp/día)</label>
          <input type="text" inputMode="decimal" value={yieldKwhKwpDia} onChange={(e) => setYieldKwhKwpDia(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label className="input-label" style={{ fontSize: '0.74rem' }}>Wp por panel</label>
          <input type="text" inputMode="decimal" value={panelWp} onChange={(e) => setPanelWp(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label className="input-label" style={{ fontSize: '0.74rem' }}>Autosuficiencia objetivo (%)</label>
          <input type="text" inputMode="decimal" value={autosuf} onChange={(e) => setAutosuf(e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>
      {kwhMesN > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <ResultCard label="kWp sugeridos" value={kwpSugeridos.toFixed(2)} unit="kWp" color="#8b5cf6" />
          <ResultCard label="Paneles" value={paneles.toString()} unit={`× ${panelWp} Wp`} color="#3b82f6" />
          <ResultCard label="Generación esperada" value={generacionMensual.toFixed(0)} unit="kWh/mes" color="#10b981" />
          <ResultCard label="Inversor categoría" value={inversorRange} unit="" color="#f59e0b" />
        </div>
      )}
    </div>
  );
}

function ResultCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 8, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color, marginTop: 2 }}>{value}</div>
      {unit && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{unit}</div>}
    </div>
  );
}

export default function IngenieriaPage() {
  const [userEmail, setUserEmail] = useState<string>('');
  useEffect(() => {
    const supa = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    supa.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email); });
  }, []);
  return (
    <>
      <QuickSizer />
      <CrmModulePage
        module="engineering"
        title="Ingeniería"
        description="Solicita visita previa a Operaciones, dimensiona el sistema con inventario disponible, y aprueba el diseño antes de entregarlo a Operaciones para instalación."
        color="#8b5cf6"
        userEmail={userEmail}
      />
    </>
  );
}
