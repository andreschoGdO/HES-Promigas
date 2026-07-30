import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const BUCKET = 'purchase-orders';

/**
 * GET /api/purchase-orders/[id]/pdf
 * Devuelve una signed URL de 1h para ver/descargar el PDF vigente
 * (mismo patrón/expiración que visit-photos).
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { data: oc, error } = await supabaseAdmin.from('purchase_orders').select('pdf_storage_path').eq('id', id).single();
  if (error || !oc) return NextResponse.json({ error: 'Orden de compra no encontrada' }, { status: 404 });
  if (!oc.pdf_storage_path) return NextResponse.json({ error: 'Esta OC todavía no tiene PDF cargado' }, { status: 404 });

  const { data: signed, error: signErr } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(oc.pdf_storage_path, 3600);
  if (signErr) return NextResponse.json({ error: signErr.message }, { status: 500 });

  return NextResponse.json({ url: signed.signedUrl });
}

/**
 * POST /api/purchase-orders/[id]/pdf
 * Sube (o reemplaza — "editar pdf" del pedido original es resubirlo) el
 * PDF de la OC. Form-data: file.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { data: oc, error: ocErr } = await supabaseAdmin.from('purchase_orders').select('pdf_storage_path').eq('id', id).single();
    if (ocErr || !oc) return NextResponse.json({ error: 'Orden de compra no encontrada' }, { status: 404 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Archivo requerido en campo "file"' }, { status: 400 });
    if (file.type !== 'application/pdf') return NextResponse.json({ error: 'Solo se aceptan archivos PDF' }, { status: 400 });

    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 8);
    const storagePath = `oc/${id}/${ts}-${rnd}.pdf`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, arrayBuffer, { contentType: 'application/pdf' });
    if (upErr) {
      const msg = upErr.message.toLowerCase().includes('bucket')
        ? `Bucket "${BUCKET}" no existe en Supabase Storage. Crear en Dashboard → Storage → New bucket (private).`
        : upErr.message;
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // Reemplazo: borrar el PDF anterior recién después de que el nuevo subió bien.
    if (oc.pdf_storage_path) {
      await supabaseAdmin.storage.from(BUCKET).remove([oc.pdf_storage_path]);
    }

    const { data: updated, error: dbErr } = await supabaseAdmin
      .from('purchase_orders')
      .update({ pdf_storage_path: storagePath })
      .eq('id', id)
      .select('*')
      .single();
    if (dbErr) throw dbErr;

    const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(storagePath, 3600);

    return NextResponse.json({ purchaseOrder: updated, url: signed?.signedUrl ?? null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
