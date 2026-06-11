/**
 * Determina el rol del usuario a partir de su email. La regla es por dominio:
 *
 *   - @gdo.com.co       → admin (operador)
 *   - @promigas.com     → admin (cliente)
 *   - @promigas.com.co  → admin (cliente, dominio colombiano)
 *   - cualquier otro    → user  (contratista — acceso limitado a /visitas)
 *
 * Compartido entre middleware (server), layouts (server) y sidebar (cliente).
 */

export type UserRole = 'admin' | 'user';

export const ADMIN_DOMAINS: ReadonlyArray<string> = [
  '@gdo.com.co',
  '@promigas.com',
  '@promigas.com.co',
];

export function getRoleFromEmail(email: string | null | undefined): UserRole {
  if (!email) return 'user';
  const lc = email.toLowerCase();
  return ADMIN_DOMAINS.some((d) => lc.endsWith(d)) ? 'admin' : 'user';
}

// Rutas que un user (contratista) puede visitar. Cualquier otra → redirect a /visitas.
// /cuenta queda accesible para que puedan cerrar sesión o cambiar su nombre.
// /auth/* y /login son públicas (manejadas por PUBLIC_PATHS).
export const USER_ALLOWED_PREFIXES: ReadonlyArray<string> = [
  '/visitas',
  '/cuenta',
];

export function isPathAllowedForUser(pathname: string): boolean {
  return USER_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
