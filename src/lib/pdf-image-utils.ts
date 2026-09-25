/**
 * Helpers de imagen compartidos entre visit-pdf.ts y construction-log-pdf.ts
 * — antes vivían duplicados/privados dentro de visit-pdf.ts.
 */

/** Descarga una foto (signed URL de Supabase Storage) y la convierte a
 *  data-URL base64 para poder insertarla con jsPDF's addImage. */
export const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
  try {
    const r = await fetch(url);
    if (!r.ok) {
      console.error(`[PDF] fetch foto fallo (${r.status})`, url);
      return null;
    }
    const blob = await r.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => { console.error('[PDF] FileReader fallo'); resolve(null); };
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('[PDF] fetchImageAsBase64 error:', e, url);
    return null;
  }
};

export const detectImageFormat = (dataUri: string): 'PNG' | 'JPEG' | 'WEBP' => {
  if (dataUri.startsWith('data:image/png')) return 'PNG';
  if (dataUri.startsWith('data:image/webp')) return 'WEBP';
  return 'JPEG';
};
