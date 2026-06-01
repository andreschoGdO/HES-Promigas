import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendTaskAssignedEmail } from '@/lib/planner-emails';

const appUrl = (req: Request): string => {
  // Vercel deployment URL prevalece; en local cae al origin del request.
  const v = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  if (v) return v.startsWith('http') ? v : `https://${v}`;
  return new URL(req.url).origin;
};

const ALLOWED_URGENCIES = ['low', 'medium', 'high', 'critical'];
const ALLOWED_STATUSES = ['todo', 'in_progress', 'done', 'blocked'];

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const dateStr = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  // Acepta YYYY-MM-DD o un Date ISO; normaliza a YYYY-MM-DD
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const arrTags = (v: unknown): string[] | undefined => {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
};

/**
 * GET /api/planner/tasks
 *   ?urgency=low|medium|high|critical
 *   ?status=todo|in_progress|done|blocked
 *   ?assignee=...
 *   ?from=YYYY-MM-DD  (due_date >=)
 *   ?to=YYYY-MM-DD    (due_date <=)
 *   ?q=texto libre
 *   ?limit=...        (default 1000, max 5000)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const urgency = url.searchParams.get('urgency');
  const status = url.searchParams.get('status');
  const assignee = url.searchParams.get('assignee');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const q = url.searchParams.get('q');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 1000), 5000);

  let query = supabaseAdmin
    .from('planner_tasks')
    .select('*')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(limit);

  if (urgency && ALLOWED_URGENCIES.includes(urgency)) query = query.eq('urgency', urgency);
  if (status && ALLOWED_STATUSES.includes(status)) query = query.eq('status', status);
  if (assignee) query = query.eq('assigned_to', assignee);
  if (from) query = query.gte('due_date', from);
  if (to) query = query.lte('due_date', to);
  if (q) {
    const safe = q.replace(/[,()*"\\]/g, ' ').trim();
    if (safe) query = query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%,assigned_to.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data });
}

/**
 * POST /api/planner/tasks
 * Body: { title (req), description, assigned_to, urgency, status, start_date, due_date, tags, project_id, created_by }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!str(body.title)) return NextResponse.json({ error: 'title requerido' }, { status: 400 });

    const urgency = str(body.urgency) ?? 'medium';
    if (!ALLOWED_URGENCIES.includes(urgency)) return NextResponse.json({ error: `urgency inválida (${ALLOWED_URGENCIES.join('|')})` }, { status: 400 });
    const status = str(body.status) ?? 'todo';
    if (!ALLOWED_STATUSES.includes(status)) return NextResponse.json({ error: `status inválido (${ALLOWED_STATUSES.join('|')})` }, { status: 400 });

    const payload: Record<string, unknown> = {
      title: String(body.title).trim(),
      description: str(body.description),
      assigned_to: str(body.assigned_to),
      urgency,
      status,
      start_date: dateStr(body.start_date),
      due_date: dateStr(body.due_date),
      tags: arrTags(body.tags) ?? [],
      project_id: str(body.project_id),
      created_by: str(body.created_by),
      completed_at: status === 'done' ? new Date().toISOString() : null,
    };
    for (const k of Object.keys(payload)) if (payload[k] === null || payload[k] === undefined) delete payload[k];

    const { data, error } = await supabaseAdmin
      .from('planner_tasks')
      .insert(payload)
      .select('*')
      .single();
    if (error) {
      console.error('planner_tasks insert error', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Notificar al responsable si tiene email. Fire-and-forget — el response
    // al cliente no espera al envío SMTP.
    if (data.assigned_to) {
      void sendTaskAssignedEmail({
        title: data.title,
        description: data.description,
        assignedTo: data.assigned_to,
        urgency: data.urgency,
        dueDate: data.due_date,
        startDate: data.start_date,
        createdBy: data.created_by,
        taskId: data.id,
      }, appUrl(request)).then((r) => {
        if (!r.ok) console.warn('Task email skipped/failed:', r.reason);
      });
    }

    return NextResponse.json({ task: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * PATCH /api/planner/tasks
 * Body: { id (req), ...campos editables }
 */
const PATCHABLE = new Set<string>([
  'title', 'description', 'assigned_to', 'urgency', 'status',
  'start_date', 'due_date', 'tags', 'project_id',
]);

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    const updates: Record<string, unknown> = {};
    for (const k of Object.keys(body)) {
      if (!PATCHABLE.has(k)) continue;
      const v = body[k];
      if (k === 'urgency') {
        if (v !== null && v !== undefined && !ALLOWED_URGENCIES.includes(String(v))) {
          return NextResponse.json({ error: 'urgency inválida' }, { status: 400 });
        }
        updates[k] = v;
      } else if (k === 'status') {
        if (v !== null && v !== undefined && !ALLOWED_STATUSES.includes(String(v))) {
          return NextResponse.json({ error: 'status inválido' }, { status: 400 });
        }
        updates[k] = v;
        if (v === 'done') updates.completed_at = new Date().toISOString();
        else if (v === 'todo' || v === 'in_progress' || v === 'blocked') updates.completed_at = null;
      } else if (k === 'start_date' || k === 'due_date') {
        updates[k] = dateStr(v);
      } else if (k === 'tags') {
        updates[k] = arrTags(v) ?? [];
      } else if (typeof v === 'string') {
        const s = v.trim();
        updates[k] = s === '' ? null : s;
      } else {
        updates[k] = v;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'sin campos válidos para actualizar' }, { status: 400 });
    }

    // Capturar assigned_to anterior para detectar si cambió (notificar solo cuando es nuevo responsable)
    const { data: prev } = await supabaseAdmin
      .from('planner_tasks')
      .select('assigned_to')
      .eq('id', body.id)
      .maybeSingle();

    const { data, error } = await supabaseAdmin
      .from('planner_tasks')
      .update(updates)
      .eq('id', body.id)
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Notificar al nuevo responsable si cambió
    const oldAssignee = (prev?.assigned_to ?? '').toLowerCase();
    const newAssignee = (data.assigned_to ?? '').toLowerCase();
    if (newAssignee && newAssignee !== oldAssignee) {
      void sendTaskAssignedEmail({
        title: data.title,
        description: data.description,
        assignedTo: data.assigned_to,
        urgency: data.urgency,
        dueDate: data.due_date,
        startDate: data.start_date,
        createdBy: data.created_by,
        taskId: data.id,
      }, appUrl(request)).then((r) => {
        if (!r.ok) console.warn('Task reassign email skipped/failed:', r.reason);
      });
    }

    return NextResponse.json({ task: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/planner/tasks?id=...
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  const { error } = await supabaseAdmin.from('planner_tasks').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
