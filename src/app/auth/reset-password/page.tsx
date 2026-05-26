'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { Sun, KeyRound, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';

function ResetInner() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const supa = () => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  // Cuando el usuario llega desde el correo, Supabase ya creó una sesión temporal
  useEffect(() => {
    supa().auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      if (!data.session) {
        setMsg({ kind: 'error', text: 'No hay sesión de recuperación activa. Abre el enlace desde el correo más reciente o solicita uno nuevo.' });
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (password.length < 6) { setMsg({ kind: 'error', text: 'Mínimo 6 caracteres' }); return; }
    if (password !== passwordConfirm) { setMsg({ kind: 'error', text: 'Las contraseñas no coinciden' }); return; }
    setSubmitting(true);
    const { error } = await supa().auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      setMsg({ kind: 'error', text: error.message });
      return;
    }
    setMsg({ kind: 'success', text: 'Contraseña actualizada. Redirigiendo al dashboard...' });
    setTimeout(() => { router.push('/dashboard'); router.refresh(); }, 1500);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: '24px', background: 'var(--bg-base)' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 420, padding: '32px 28px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 22 }}>
          <div style={{ color: 'var(--accent)' }}>
            <Sun size={40} strokeWidth={2.5} fill="currentColor" />
          </div>
          <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Crear nueva contraseña</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
            Define una contraseña nueva para tu cuenta.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Nueva contraseña</label>
            <div style={{ position: 'relative' }}>
              <input type={showPassword ? 'text' : 'password'} required autoComplete="new-password" minLength={6}
                placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)}
                disabled={submitting || !hasSession} style={{ width: '100%', minHeight: 44, paddingRight: 42 }} />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 6 }}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Confirma la contraseña</label>
            <input type={showPassword ? 'text' : 'password'} required autoComplete="new-password" minLength={6}
              placeholder="Repítela" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)}
              disabled={submitting || !hasSession} style={{ minHeight: 44 }} />
          </div>
          <button className="primary-btn" type="submit" disabled={submitting || !hasSession} style={{ width: '100%', justifyContent: 'center', padding: '12px', fontWeight: 600 }}>
            <KeyRound size={16} /> {submitting ? 'Guardando...' : 'Guardar contraseña'}
          </button>
        </form>

        {msg && (
          <div className={msg.kind === 'success' ? 'alert-success' : 'alert-error'} style={{ marginTop: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {msg.kind === 'success' ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
            <span style={{ fontSize: '0.83rem' }}>{msg.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>Cargando...</div>}>
      <ResetInner />
    </Suspense>
  );
}
