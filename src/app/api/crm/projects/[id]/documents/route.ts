import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const KINDS = {
  proyecto: { column: 'dossier_proyecto_url', folder: 'proyecto' },
  equipos: { column: 'dossier_equipos_url', folder: 'equipos' },
} as const;
type Kind = keyof typeof KINDS;

/**
 * POST /api/crm/projects/[id]/documents
 * Sube el dossier del proyecto o de equipos instalados (etapa Documentación).
 *
 * Form-data multipart:
 *   - file: blob
 *   - kind: 'proyecto' | 'equipos'
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const kind = formData.get('kind') as Kind | null;
    if (!file) return NextResponse.json({ error: 'Archivo requerido en campo "file"' }, { status: 400 });
    if (!kind || !KINDS[kind]) return NextResponse.json({ error: 'kind debe ser "proyecto" o "equipos"' }, { status: 400 });

    const { data: project, error: pErr } = await supabaseAdmin.from('crm_projects').select('id').eq('id', id).single();
    if (pErr || !project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });

    const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 8);
    const storagePath = `${KINDS[kind].folder}/${id}/${ts}-${rnd}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: upErr } = await supabaseAdmin.storage
      .from('crm-documents')
      .upload(storagePath, arrayBuffer, { contentType: file.type || 'application/pdf' });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('crm_projects')
      .update({ [KINDS[kind].column]: storagePath })
      .eq('id', id)
      .select('id, dossier_proyecto_url, dossier_equipos_url')
      .single();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ project: updated }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** GET ?kind=proyecto|equipos — devuelve signed URL para ver/descargar el dossier */
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') as Kind | null;
  if (!kind || !KINDS[kind]) return NextResponse.json({ error: 'kind debe ser "proyecto" o "equipos"' }, { status: 400 });

  const { data: project, error } = await supabaseAdmin.from('crm_projects').select(KINDS[kind].column).eq('id', id).single();
  if (error || !project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
  const path = (project as unknown as Record<string, string | null>)[KINDS[kind].column];
  if (!path) return NextResponse.json({ url: null });

  const { data: signed, error: sErr } = await supabaseAdmin.storage.from('crm-documents').createSignedUrl(path, 3600);
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
  return NextResponse.json({ url: signed.signedUrl });
}
