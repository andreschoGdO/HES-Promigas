import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface RouteContext {
  params: Promise<{ id: string; entryId: string }>;
}

/**
 * DELETE /api/construction-logs/[id]/entries/[entryId]
 * Borra una entrada (y sus fotos, por cascade). Útil para corregir un
 * registro digitado por error.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id, entryId } = await context.params;
    const { data: photos } = await supabaseAdmin
      .from('construction_log_entry_photos')
      .select('storage_path')
      .eq('entry_id', entryId);
    if (photos && photos.length > 0) {
      await supabaseAdmin.storage.from('visit-photos').remove(photos.map((p) => p.storage_path));
    }
    const { error } = await supabaseAdmin
      .from('construction_log_entries')
      .delete()
      .eq('id', entryId)
      .eq('log_id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
