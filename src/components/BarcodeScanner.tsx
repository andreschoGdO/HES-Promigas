'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | Blob) => Promise<Array<{ rawValue: string; format: string }>>;
}

type BarcodeCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

/**
 * Componente de escaneo de código de barras / QR usando la cámara del dispositivo.
 * Usa la BarcodeDetector API nativa cuando está disponible (Chrome Android, Edge).
 * Si no, muestra un mensaje y deja al usuario teclear manualmente.
 */
export function BarcodeScanner({ open, onClose, onDetect }: {
  open: boolean;
  onClose: () => void;
  onDetect: (value: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);

    // Detección de soporte de BarcodeDetector API
    const win = window as unknown as { BarcodeDetector?: BarcodeCtor };
    const hasBD = typeof win.BarcodeDetector !== 'undefined';
    setSupported(hasBD);

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setScanning(true);

        if (hasBD) {
          const BarcodeDetectorCtor = win.BarcodeDetector!;
          const detector = new BarcodeDetectorCtor({
            formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix', 'pdf417'],
          });
          const tick = async () => {
            if (!videoRef.current || !streamRef.current) return;
            try {
              const results = await detector.detect(videoRef.current);
              if (results.length > 0) {
                onDetect(results[0].rawValue);
                stop();
                onClose();
                return;
              }
            } catch {
              // ignorar errores de frame individual
            }
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo abrir la cámara');
      }
    };

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setScanning(false);
    };

    start();
    return () => stop();
  }, [open, onClose, onDetect]);

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', color: 'white', border: 'none', borderRadius: '50%', width: 40, height: 40, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <X size={20} />
      </button>

      <h3 style={{ color: 'white', margin: 0, marginBottom: 12 }}>Escanea código QR / barras</h3>

      {error && (
        <div style={{ background: '#ef4444', color: 'white', padding: 12, borderRadius: 8, maxWidth: 400, textAlign: 'center', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {supported === false && (
        <div style={{ background: '#f59e0b', color: '#1a1a1a', padding: 12, borderRadius: 8, maxWidth: 400, textAlign: 'center', fontSize: '0.82rem', marginBottom: 12 }}>
          Tu navegador no soporta lectura automática. Ve la cámara, copia el código manualmente.
        </div>
      )}

      <div style={{ position: 'relative', width: '100%', maxWidth: 480, aspectRatio: '4/3', background: 'black', borderRadius: 12, overflow: 'hidden' }}>
        <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {/* Marco guía visual */}
        <div style={{
          position: 'absolute',
          top: '20%', left: '15%', right: '15%', bottom: '20%',
          border: '3px solid rgba(7, 197, 168, 0.8)',
          borderRadius: 12,
          boxShadow: '0 0 0 200vmax rgba(0,0,0,0.35)',
        }} />
      </div>

      <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.85rem', marginTop: 12, textAlign: 'center', maxWidth: 400 }}>
        Apunta al código de barras del equipo. Cuando se detecte, el valor se rellena automáticamente.
      </p>

      {scanning && supported && (
        <div style={{ color: 'rgba(7,197,168,1)', fontSize: '0.8rem', marginTop: 6 }}>● Escaneando...</div>
      )}
    </div>
  );
}
