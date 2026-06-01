import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/users
 * Lista los usuarios de Supabase Auth (sólo email + nombre + id). Usa service_role.
 * Pensado para poblar dropdowns de "Responsable", "Asignado a", etc.
 */
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const users = (data?.users ?? []).map((u) => {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      const name = (meta.full_name as string) || (meta.name as string) || (meta.display_name as string) || null;
      return {
        id: u.id,
        email: u.email ?? null,
        name,
      };
    }).filter((u) => u.email)
      .sort((a, b) => (a.name ?? a.email!).localeCompare(b.name ?? b.email!));

    return NextResponse.json({ users });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
