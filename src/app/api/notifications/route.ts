import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/notifications?email=&unread=true&limit=
 * Lista notificaciones de un usuario, más recientes primero.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  const unreadOnly = url.searchParams.get('unread') === 'true';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 30), 100);
  if (!email) return NextResponse.json({ error: 'email requerido' }, { status: 400 });

  let q = supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('user_email', email.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(limit);
  if (unreadOnly) q = q.eq('read', false);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_email', email.toLowerCase())
    .eq('read', false);

  return NextResponse.json({ notifications: data ?? [], unreadCount: count ?? 0 });
}

/** POST /api/notifications — crea una notificación (uso interno de otros endpoints). */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { user_email, type, title, body: notifBody, link, project_id } = body;
    if (!user_email || !title) return NextResponse.json({ error: 'user_email y title son requeridos' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('notifications')
      .insert({
        user_email: String(user_email).toLowerCase(),
        type: type || 'general',
        title,
        body: notifBody || null,
        link: link || null,
        project_id: project_id || null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ notification: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** PATCH /api/notifications — body { id } o { ids: [] } o { email, all: true } → marca como leída(s). */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    let q = supabaseAdmin.from('notifications').update({ read: true, read_at: new Date().toISOString() });
    if (body.id) {
      q = q.eq('id', body.id);
    } else if (Array.isArray(body.ids) && body.ids.length > 0) {
      q = q.in('id', body.ids);
    } else if (body.email && body.all) {
      q = q.eq('user_email', String(body.email).toLowerCase()).eq('read', false);
    } else {
      return NextResponse.json({ error: 'id, ids[] o {email, all:true} requerido' }, { status: 400 });
    }
    const { error } = await q;
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
