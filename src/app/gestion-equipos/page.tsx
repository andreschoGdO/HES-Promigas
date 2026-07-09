'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Sliders } from 'lucide-react';
import { InverterControlPanel } from '@/components/InverterControlPanel';
import type { DeviceOption } from '@/lib/device-option';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export default function GestionEquiposPage() {
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('devices')
        .select('id, metrum_id, name, type, client, casa, cliente_id, location, city, marca, modelo, potencia_kw, is_active, last_seen_at')
        .order('client', { ascending: true })
        .order('name', { ascending: true });
      if (error) console.error('Error fetching devices', error);
      setDevices((data ?? []) as DeviceOption[]);
      setLoading(false);
    })();
  }, []);

  return (
    <>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sliders size={24} style={{ color: 'var(--accent)' }} />
          <h1 style={{ margin: 0 }}>Gestión de Equipos</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>
          Control manual de inversores del portafolio: cos φ, Q reactiva, límite de P activa y modo de trabajo.
          {' '}El envío real depende del adapter del fabricante (Deye Cloud, Livoltek). Si no hay credenciales, el comando queda en auditoría con status <code>mocked</code>.
        </p>
      </div>

      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          Cargando equipos…
        </div>
      ) : (
        <InverterControlPanel devices={devices} />
      )}
    </>
  );
}
