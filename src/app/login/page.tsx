'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { Sun, LogIn, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';

const ALLOWED_DOMAINS = ['@gdo.com.co', '@promigas.com'];
const isAllowedEmail = (email: string) => ALLOWED_DOMAINS.some((d) => email.toLowerCase().endsWith(d));
const ALLOWED_DOMAINS_LABEL = ALLOWED_DOMAINS.join(' o ');

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    const err = params.get('error');
    if (err === 'domain') setMsg({ kind: 'error', text: `Solo se permite acceso a correos ${ALLOWED_DOMAINS_LABEL}.` });
    else if (err === 'exchange-failed') setMsg({ kind: 'error', text: 'La sesión expiró. Vuelve a iniciar sesión.' });
  }, [params]);

  const supa = () => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!isAllowedEmail(trimmedEmail)) {
      setMsg({ kind: 'error', text: `El correo debe terminar en ${ALLOWED_DOMAINS_LABEL}` });
      return;
    }
    if (password.length < 6) {
      setMsg({ kind: 'error', text: 'La contraseña debe tener al menos 6 caracteres' });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supa().auth.signInWithPassword({ email: trimmedEmail, password });
    setSubmitting(false);
    if (error) {
      const friendlyMsg = error.message.toLowerCase().includes('invalid login')
        ? 'Correo o contraseña incorrectos. Si no tienes cuenta aún, pídele al administrador que te cree una.'
        : error.message.toLowerCase().includes('email not confirmed')
          ? 'Tu cuenta aún no está confirmada. Contacta al administrador.'
          : error.message;
      setMsg({ kind: 'error', text: friendlyMsg });
      return;
    }
    if (!isAllowedEmail(data.user?.email ?? '')) {
      await supa().auth.signOut();
      setMsg({ kind: 'error', text: `Solo se permite acceso a correos ${ALLOWED_DOMAINS_LABEL}.` });
      return;
    }
    setMsg({ kind: 'success', text: '✓ Acceso autorizado, redirigiendo...' });
    const next = params.get('next') ?? '/dashboard';
    router.push(next);
    router.refresh();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: '24px', background: 'var(--bg-base)' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 420, padding: '36px 32px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <div style={{ color: 'var(--accent)' }}>
            <Sun size={42} strokeWidth={2.5} fill="currentColor" />
          </div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>SUNNY APP</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
            HES Promigas · Monitoreo solar
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Correo corporativo</label>
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder={`tu.nombre${ALLOWED_DOMAINS[0]}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              style={{ minHeight: 44 }}
            />
          </div>

          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Contraseña</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                style={{ width: '100%', minHeight: 44, paddingRight: 42 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 6 }}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button className="primary-btn" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: '0.95rem', fontWeight: 600 }}>
            <LogIn size={16} /> {submitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        {msg && (
          <div className={msg.kind === 'success' ? 'alert-success' : msg.kind === 'error' ? 'alert-error' : 'alert-warning'} style={{ marginTop: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {msg.kind === 'success' ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
            <span style={{ fontSize: '0.85rem' }}>{msg.text}</span>
          </div>
        )}

        <p style={{ marginTop: 20, fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
          Acceso restringido a usuarios <strong>{ALLOWED_DOMAINS_LABEL}</strong>.<br />
          ¿No tienes cuenta? Pídele al administrador que la cree.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>Cargando...</div>}>
      <LoginInner />
    </Suspense>
  );
}
