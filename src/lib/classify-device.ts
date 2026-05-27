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

  if (type === 'meter' || type === 'red' || type === 'solar' || type === 'medidor') return 'meter';
  if (type === 'inverter' || type === 'inversor') return 'inverter';
  if (type === 'pulsar' || type === 'gateway' || type === 'modem') return 'gateway';

  if (/^IN\d+/i.test(name)) return 'gateway';
  if (/^HP/i.test(name)) return 'inverter';
  if (/^(24|25)\d{8}$/.test(name)) return 'inverter';

  if (marca || modelo) return 'inverter';

  return 'other';
};
