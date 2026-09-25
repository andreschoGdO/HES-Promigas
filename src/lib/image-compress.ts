/**
 * Comprime una imagen en el navegador antes de subirla (redimensiona a
 * maxDim y reencodea como JPEG con la calidad dada). Si no es imagen, ya es
 * chica, o algo falla, devuelve el archivo original tal cual.
 *
 * Extraído de src/app/visitas/page.tsx para reusarlo también en
 * ConstructionLog.tsx — antes vivía duplicado/local en ese archivo.
 */
export async function compressImageIfNeeded(file: File, maxDim = 1920, quality = 0.85): Promise<{ blob: Blob; filename: string }> {
  if (!file.type.startsWith('image/') || file.size < 500_000) {
    return { blob: file, filename: file.name };
  }
  try {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error ?? new Error('FileReader fail'));
      r.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image decode fail'));
      i.src = dataUrl;
    });
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob: file, filename: file.name };
    ctx.drawImage(img, 0, 0, width, height);
    const blob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
    });
    if (!blob || blob.size >= file.size) return { blob: file, filename: file.name };
    const filename = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return { blob, filename };
  } catch {
    return { blob: file, filename: file.name };
  }
}
