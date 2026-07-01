/**
 * Configuración de visibilidad del menú lateral.
 *
 * Persiste en Supabase (`app_settings` con key='sidebar_visibility') y se
 * aplica a TODOS los usuarios de la cuenta. localStorage se usa solo como
 * cache para render instantáneo — la fuente de verdad es la API.
 *
 * - `readVisibility()` devuelve el cache local (sincrónico, render inicial).
 * - `fetchVisibility()` lee desde la API y sincroniza el cache; debe llamarse
 *   en el mount del Sidebar (y de la página /configuracion).
 * - `writeVisibility()` actualiza cache + API; dispara CustomEvent para que
 *   el Sidebar reaccione sin recargar.
 *
 * "Inicio" y "Configuración API" SIEMPRE están visibles para evitar que el
 * usuario se quede sin forma de regresar al panel de control.
 */

export interface SidebarVisibility {
  dashboard?: boolean;
  operaciones?: boolean;
  visitas?: boolean;
  inventario?: boolean;
  facturacion?: boolean;
  reportes?: boolean;
  planner?: boolean;
  configuracion?: boolean;
  usuarios?: boolean;
}

const STORAGE_KEY = 'sidebar-visibility-v1';

/** IDs que no se pueden ocultar. Vacío: cualquier ítem puede ocultarse globalmente.
 *  Si se oculta /configuracion, sigue siendo navegable escribiendo la URL en el
 *  navegador — la ocultación es solo del menú lateral. */
export const ALWAYS_VISIBLE_IDS: ReadonlySet<string> = new Set();

/** Catálogo completo de items que se pueden mostrar/ocultar */
export const MENU_ITEM_CATALOG: Array<{ id: keyof SidebarVisibility; label: string; group: 'general' | 'sistema' }> = [
  { id: 'dashboard',     label: 'Head End System',         group: 'general' },
  { id: 'operaciones',   label: 'Construcción',            group: 'general' },
  { id: 'visitas',       label: 'Visitas en Campo',        group: 'general' },
  { id: 'inventario',    label: 'Inventario',              group: 'general' },
  { id: 'facturacion',   label: 'Facturación',             group: 'general' },
  { id: 'reportes',      label: 'Reportes',                group: 'general' },
  { id: 'planner',       label: 'Planner',                 group: 'general' },
  { id: 'usuarios',      label: 'Usuarios',                group: 'sistema' },
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

/**
 * Carga la visibilidad global desde la API y actualiza el cache local.
 * Dispara `sidebar-visibility-change` para refrescar los componentes.
 * Llamar en el mount del Sidebar y de /configuracion.
 */
export async function fetchVisibility(): Promise<SidebarVisibility> {
  if (typeof window === 'undefined') return {};
  try {
    const r = await fetch('/api/settings/sidebar-visibility');
    if (!r.ok) return readVisibility();
    const j = await r.json();
    const v: SidebarVisibility = j.visibility ?? {};
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    window.dispatchEvent(new CustomEvent('sidebar-visibility-change', { detail: v }));
    return v;
  } catch {
    return readVisibility();
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
  // Persistir a la API (global para todos los usuarios). Fire-and-forget; si
  // falla, el cambio queda solo en este navegador hasta el próximo intento.
  void fetch('/api/settings/sidebar-visibility', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visibility: v }),
  }).catch(() => {});
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
