/**
 * Configuración de visibilidad del menú lateral.
 *
 * Persiste en localStorage por navegador (no se sincroniza entre dispositivos
 * — es preferencia local del usuario, no del proyecto). Los cambios disparan
 * un CustomEvent `sidebar-visibility-change` para que el Sidebar reaccione
 * inmediatamente sin recargar.
 *
 * "Inicio" y "Configuración API" SIEMPRE están visibles para evitar que el
 * usuario se quede sin forma de regresar al panel de control.
 */

export interface SidebarVisibility {
  inicio?: boolean;
  dashboard?: boolean;
  ventas?: boolean;
  ingenieria?: boolean;
  operaciones?: boolean;
  funnel?: boolean;
  visitas?: boolean;
  inventario?: boolean;
  alertas?: boolean;
  configuracion?: boolean;
}

const STORAGE_KEY = 'sidebar-visibility-v1';

/** IDs que no se pueden ocultar (escape hatch para regresar a la configuración) */
export const ALWAYS_VISIBLE_IDS: ReadonlySet<string> = new Set(['inicio', 'configuracion']);

/** Catálogo completo de items que se pueden mostrar/ocultar */
export const MENU_ITEM_CATALOG: Array<{ id: keyof SidebarVisibility; label: string; group: 'general' | 'sistema' }> = [
  { id: 'inicio',        label: 'Inicio',                  group: 'general' },
  { id: 'dashboard',     label: 'HES Head End System',     group: 'general' },
  { id: 'ventas',        label: 'CRM Ventas',              group: 'general' },
  { id: 'ingenieria',    label: 'Ingeniería',              group: 'general' },
  { id: 'operaciones',   label: 'Operaciones',             group: 'general' },
  { id: 'funnel',        label: 'Funnel',                  group: 'general' },
  { id: 'visitas',       label: 'Visitas en Campo',        group: 'general' },
  { id: 'inventario',    label: 'Inventario',              group: 'general' },
  { id: 'alertas',       label: 'Configuración Alertas',   group: 'sistema' },
  { id: 'configuracion', label: 'Configuración API',       group: 'sistema' },
];

export function readVisibility(): SidebarVisibility {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function writeVisibility(v: SidebarVisibility): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    window.dispatchEvent(new CustomEvent('sidebar-visibility-change', { detail: v }));
  } catch {
    // ignorar errores de storage (quota, modo privado, etc.)
  }
}

export function setItemVisibility(id: keyof SidebarVisibility, visible: boolean): void {
  const cur = readVisibility();
  cur[id] = visible;
  writeVisibility(cur);
}

/** Default = visible. Solo retorna false si se guardó false explícitamente. */
export function isItemVisible(id: string, vis: SidebarVisibility): boolean {
  if (ALWAYS_VISIBLE_IDS.has(id)) return true;
  return vis[id as keyof SidebarVisibility] !== false;
}
