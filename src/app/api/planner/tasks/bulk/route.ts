import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendTaskAssignedEmail } from '@/lib/planner-emails';

const appUrl = (req: Request): string => {
  const v = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  if (v) return v.startsWith('http') ? v : `https://${v}`;
  return new URL(req.url).origin;
};

const ALLOWED_URGENCIES = new Set(['low', 'medium', 'high', 'critical']);
const ALLOWED_STATUSES = new Set(['todo', 'in_progress', 'done', 'blocked']);

const URGENCY_ALIASES: Record<string, string> = {
  'baja': 'low', 'low': 'low',
  'media': 'medium', 'medium': 'medium', 'normal': 'medium',
  'alta': 'high', 'high': 'high',
  'critica': 'critical', 'crítica': 'critical', 'critical': 'critical', 'urgente': 'critical',
};
const STATUS_ALIASES: Record<string, string> = {
  'por hacer': 'todo', 'pendiente': 'todo', 'todo': 'todo',
  'en progreso': 'in_progress', 'in progress': 'in_progress', 'in_progress': 'in_progress', 'haciendo': 'in_progress',
  'hecho': 'done', 'done': 'done', 'completado': 'done', 'completada': 'done',
  'bloqueado': 'blocked', 'bloqueada': 'blocked', 'blocked': 'blocked',
};

const normalizeUrgency = (s: string): string => URGENCY_ALIASES[s.trim().toLowerCase()] ?? s.trim().toLowerCase();
const normalizeStatus = (s: string): string => STATUS_ALIASES[s.trim().toLowerCase()] ?? s.trim().toLowerCase();

const normalizeDate = (s: string): string | null => {
  const t = s.trim();
  if (!t) return null;
  // Acepta YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY (asumimos DD/MM/YYYY que es default es-CO)
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m1 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) {
    const [, dd, mm, yyyy] = m1;
    const d = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
    if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const d = new Date(t);
  if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
};

// Parser CSV mínimo, soporta comillas y comas dentro de campos
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',' || c === ';') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((x) => x.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((x) => x.trim() !== '')) rows.push(row);
  }
  return rows;
}

/**
 * POST /api/planner/tasks/bulk
 *
 * Acepta dos formas:
 *   1) { tasks: Array<{ title, urgency?, ... }> }
 *   2) { csv: string }  con header en primera fila
 *
 * Columnas reconocidas en CSV (case-insensitive, español o inglés):
 *   title|titulo  description|descripcion  assigned_to|responsable|asignado
 *   urgency|urgencia  status|estado  start_date|inicio  due_date|vencimiento|fin
 *   tags|etiquetas (separadas por ;)
 *
 * Devuelve: { inserted: N, errors: [...] }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    let raw: Array<Record<string, unknown>> = [];
    if (Array.isArray(body.tasks)) {
      raw = body.tasks as Array<Record<string, unknown>>;
    } else if (typeof body.csv === 'string') {
      const rows = parseCsv(body.csv);
      if (rows.length < 2) return NextResponse.json({ error: 'CSV vacío o sin filas de datos' }, { status: 400 });
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const mapHeader = (h: string): string => {
        const aliases: Record<string, string> = {
          'titulo': 'title', 'título': 'title', 'title': 'title', 'tarea': 'title',
          'description': 'description', 'descripcion': 'description', 'descripción': 'description', 'detalle': 'description',
          'assigned_to': 'assigned_to', 'responsable': 'assigned_to', 'asignado': 'assigned_to', 'persona': 'assigned_to',
          'urgency': 'urgency', 'urgencia': 'urgency', 'prioridad': 'urgency',
          'status': 'status', 'estado': 'status',
          'start_date': 'start_date', 'inicio': 'start_date', 'fecha_inicio': 'start_date',
          'due_date': 'due_date', 'vencimiento': 'due_date', 'fin': 'due_date', 'fecha_fin': 'due_date', 'deadline': 'due_date',
          'tags': 'tags', 'etiquetas': 'tags',
          'project_id': 'project_id',
        };
        return aliases[h] ?? h;
      };
      const cols = header.map(mapHeader);
      for (let r = 1; r < rows.length; r++) {
        const obj: Record<string, string> = {};
        for (let c = 0; c < cols.length; c++) {
          obj[cols[c]] = rows[r][c] ?? '';
        }
        raw.push(obj);
      }
    } else {
      return NextResponse.json({ error: 'Body debe tener tasks (array) o csv (string)' }, { status: 400 });
    }

    const payload: Array<Record<string, unknown>> = [];
    const errors: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      const title = String(r.title ?? '').trim();
      if (!title) { errors.push({ row: i + 2, error: 'title vacío' }); continue; }

      const urgency = r.urgency ? normalizeUrgency(String(r.urgency)) : 'medium';
      if (!ALLOWED_URGENCIES.has(urgency)) { errors.push({ row: i + 2, error: `urgency inválida "${r.urgency}"` }); continue; }

      const status = r.status ? normalizeStatus(String(r.status)) : 'todo';
      if (!ALLOWED_STATUSES.has(status)) { errors.push({ row: i + 2, error: `status inválido "${r.status}"` }); continue; }

      const tagsRaw = r.tags;
      const tags = Array.isArray(tagsRaw)
        ? tagsRaw.map((x) => String(x).trim()).filter(Boolean)
        : typeof tagsRaw === 'string'
          ? tagsRaw.split(/[;,]/).map((s) => s.trim()).filter(Boolean)
          : [];

      const task: Record<string, unknown> = {
        title,
        description: r.description ? String(r.description).trim() || null : null,
        assigned_to: r.assigned_to ? String(r.assigned_to).trim() || null : null,
        urgency,
        status,
        start_date: r.start_date ? normalizeDate(String(r.start_date)) : null,
        due_date: r.due_date ? normalizeDate(String(r.due_date)) : null,
        tags,
        project_id: r.project_id ? String(r.project_id).trim() || null : null,
        created_by: r.created_by ? String(r.created_by).trim() || null : null,
        completed_at: status === 'done' ? new Date().toISOString() : null,
      };
      for (const k of Object.keys(task)) if (task[k] === null || task[k] === undefined) delete task[k];
      payload.push(task);
    }

    if (payload.length === 0) {
      return NextResponse.json({ inserted: 0, errors, message: 'No se generaron tareas válidas' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('planner_tasks')
      .insert(payload)
      .select('*');
    if (error) return NextResponse.json({ error: error.message, errors }, { status: 500 });

    // Notificar a cada responsable con email válido. Fire-and-forget.
    const base = appUrl(request);
    for (const t of data ?? []) {
      if (!t.assigned_to) continue;
      void sendTaskAssignedEmail({
        title: t.title,
        description: t.description,
        assignedTo: t.assigned_to,
        urgency: t.urgency,
        dueDate: t.due_date,
        startDate: t.start_date,
        createdBy: t.created_by,
        taskId: t.id,
      }, base).then((r) => {
        if (!r.ok) console.warn('Bulk task email skipped/failed:', r.reason);
      });
    }

    return NextResponse.json({ inserted: data?.length ?? 0, errors });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
