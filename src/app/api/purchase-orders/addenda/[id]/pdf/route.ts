import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const BUCKET = 'purchase-orders';

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { data: addendum, error } = await supabaseAdmin.from('purchase_order_addenda').select('pdf_storage_path').eq('id', id).single();
  if (error || !addendum) return NextResponse.json({ error: 'Adicional no encontrado' }, { status: 404 });
  if (!addendum.pdf_storage_path) return NextResponse.json({ error: 'Este adicional todavía no tiene PDF cargado' }, { status: 404 });

  const { data: signed, error: signErr } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(addendum.pdf_storage_path, 3600);
  if (signErr) return NextResponse.json({ error: signErr.message }, { status: 500 });
  return NextResponse.json({ url: signed.signedUrl });
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { data: addendum, error: aErr } = await supabaseAdmin.from('purchase_order_addenda').select('pdf_storage_path').eq('id', id).single();
    if (aErr || !addendum) return NextResponse.json({ error: 'Adicional no encontrado' }, { status: 404 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Archivo requerido en campo "file"' }, { status: 400 });
    if (file.type !== 'application/pdf') return NextResponse.json({ error: 'Solo se aceptan archivos PDF' }, { status: 400 });

    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 8);
    const storagePath = `oc-addenda/${id}/${ts}-${rnd}.pdf`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, arrayBuffer, { contentType: 'application/pdf' });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    if (addendum.pdf_storage_path) {
      await supabaseAdmin.storage.from(BUCKET).remove([addendum.pdf_storage_path]);
    }

    const { data: updated, error: dbErr } = await supabaseAdmin
      .from('purchase_order_addenda')
      .update({ pdf_storage_path: storagePath })
      .eq('id', id)
      .select('*')
      .single();
    if (dbErr) throw dbErr;

    const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
    return NextResponse.json({ addendum: updated, url: signed?.signedUrl ?? null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
