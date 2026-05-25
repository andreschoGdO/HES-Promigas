import { redirect } from 'next/navigation';

export type Category = 'gateway' | 'meter' | 'inverter' | 'other';

export const classifyDevice = (d: {
  type?: string | null;
  name?: string | null;
  marca?: string | null;
  modelo?: string | null;
}): Category => {
  const type = (d.type ?? '').toLowerCase().trim();
  const name = (d.name ?? '').trim();
  const marca = (d.marca ?? '').trim();
  const modelo = (d.modelo ?? '').trim();

  // 1. Tipo explícito tiene prioridad (red/solar son MEDIDORES aunque tengan modelo)
  if (type === 'meter' || type === 'red' || type === 'solar' || type === 'medidor') return 'meter';
  if (type === 'inverter' || type === 'inversor') return 'inverter';
  if (type === 'pulsar' || type === 'gateway' || type === 'modem') return 'gateway';

  // 2. Fallback por patrón de nombre (devices con type='unknown')
  // Pulsar/Gateway: nombre IN seguido de dígitos, opcional sufijo: IN42420373(P)
  if (/^IN\d+/i.test(name)) return 'gateway';
  // Inversor Livoltek: nombre HP seguido de alfanumérico: HP310K2HWC290002
  if (/^HP/i.test(name)) return 'inverter';
  // Inversor DEYE: serial numérico que empieza con 24 o 25 (2412240050, 2504093125)
  // (Medidores Eastron también son numéricos pero empiezan con 2223)
  if (/^(24|25)\d{8}$/.test(name)) return 'inverter';

  // 3. Último recurso: marca o modelo presentes
  if (marca || modelo) return 'inverter';

  return 'other';
};

export default function Home() {
  redirect('/dashboard');
}
