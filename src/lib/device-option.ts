/**
 * Row de `devices` proyectado para selectores / listados operativos.
 * Compartido entre el HES (dashboard) y Gestión de Equipos.
 */
export interface DeviceOption {
  id: string;
  metrum_id: string;
  name: string;
  type: string | null;
  client: string | null;
  casa: string | null;
  cliente_id: string | null;
  location: string | null;
  city: string | null;
  marca: string | null;
  modelo: string | null;
  potencia_kw: number | null;
  is_active: boolean | null;
  last_seen_at: string | null;
}
