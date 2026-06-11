'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { Sun, LogIn, UserPlus, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { getRoleFromEmail } from '@/lib/user-role';

type Mode = 'signin' | 'signup';

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    const err = params.get('error');
    if (err === 'exchange-failed') setMsg({ kind: 'error', text: 'La sesión expiró. Vuelve a iniciar sesión.' });
    else if (params.get('signup_ok') === '1') setMsg({ kind: 'success', text: 'Cuenta creada. Si Supabase está configurado para confirmar email, revisa tu correo. Si no, ya puedes entrar.' });
  }, [params]);

  const supa = () => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (password.length < 6) {
      setMsg({ kind: 'error', text: 'La contraseña debe tener al menos 6 caracteres' });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supa().auth.signInWithPassword({ email: trimmedEmail, password });
    setSubmitting(false);
    if (error) {
      const friendly = error.message.toLowerCase().includes('invalid login')
        ? 'Correo o contraseña incorrectos.'
        : error.message.toLowerCase().includes('email not confirmed')
          ? 'Tu cuenta no está confirmada. Revisa el correo o pídele al administrador que la confirme.'
          : error.message;
      setMsg({ kind: 'error', text: friendly });
      return;
    }
    setMsg({ kind: 'success', text: 'Acceso autorizado, redirigiendo...' });
    // Admins (gdo/promigas) → /dashboard. Contratistas → /visitas.
    const role = getRoleFromEmail(data.user?.email ?? trimmedEmail);
    const fallback = role === 'admin' ? '/dashboard' : '/visitas';
    const next = params.get('next') ?? fallback;
    router.push(next);
    router.refresh();
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (password.length < 6) { setMsg({ kind: 'error', text: 'La contraseña debe tener al menos 6 caracteres' }); return; }
    if (password !== passwordConfirm) { setMsg({ kind: 'error', text: 'Las contraseñas no coinciden' }); return; }
    if (!fullName.trim()) { setMsg({ kind: 'error', text: 'Por favor escribe tu nombre completo' }); return; }
    setSubmitting(true);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const { error } = await supa().auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
        data: { full_name: fullName.trim() },
      },
    });
    setSubmitting(false);
    if (error) {
      setMsg({ kind: 'error', text: error.message.toLowerCase().includes('already registered') ? 'Ya existe una cuenta con ese correo. Intenta iniciar sesión.' : error.message });
      return;
    }
    setMsg({ kind: 'success', text: 'Cuenta creada. Si Supabase tiene confirmación por email habilitada, revisa tu correo (revisa Spam). Si no, ya puedes entrar abajo.' });
    setMode('signin');
    setPassword(''); setPasswordConfirm('');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: '24px', background: 'var(--bg-base)', overflowY: 'auto' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 440, padding: '32px 28px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 22 }}>
          <div style={{ color: 'var(--accent)' }}>
            <Sun size={40} strokeWidth={2.5} fill="currentColor" />
          </div>
          <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, letterSpacing: '-0.5px' }}>SUNNY APP</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>HES Promigas · Monitoreo solar</p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 10, padding: 4, marginBottom: 20 }}>
          <button type="button" onClick={() => { setMode('signin'); setMsg(null); }}
            style={{ flex: 1, padding: '8px 12px', border: 'none', borderRadius: 8, cursor: 'pointer', background: mode === 'signin' ? 'var(--bg-surface)' : 'transparent', fontWeight: mode === 'signin' ? 600 : 400, fontSize: '0.85rem', boxShadow: mode === 'signin' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
            Iniciar sesión
          </button>
          <button type="button" onClick={() => { setMode('signup'); setMsg(null); }}
            style={{ flex: 1, padding: '8px 12px', border: 'none', borderRadius: 8, cursor: 'pointer', background: mode === 'signup' ? 'var(--bg-surface)' : 'transparent', fontWeight: mode === 'signup' ? 600 : 400, fontSize: '0.85rem', boxShadow: mode === 'signup' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
            Crear cuenta
          </button>
        </div>

        {mode === 'signin' ? (
          <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Correo corporativo</label>
              <input type="email" required autoFocus autoComplete="email"
                placeholder="tu.correo@empresa.com"
                value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} style={{ minHeight: 44 }} />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Contraseña</label>
              <div style={{ position: 'relative' }}>
                <input type={showPassword ? 'text' : 'password'} required autoComplete="current-password" placeholder="••••••••"
                  value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting}
                  style={{ width: '100%', minHeight: 44, paddingRight: 42 }} />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 6 }}
                  aria-label={showPassword ? 'Ocultar' : 'Mostrar'}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button className="primary-btn" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center', padding: '12px', fontWeight: 600 }}>
              <LogIn size={16} /> {submitting ? 'Entrando...' : 'Entrar'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 4 }}>
              <Link href="/auth/forgot-password" style={{ fontSize: '0.78rem', color: 'var(--accent)', textDecoration: 'none' }}>
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Nombre completo</label>
              <input type="text" required autoFocus autoComplete="name"
                placeholder="Tu nombre y apellido"
                value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={submitting} style={{ minHeight: 44 }} />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Correo corporativo</label>
              <input type="email" required autoComplete="email"
                placeholder="tu.correo@empresa.com"
                value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} style={{ minHeight: 44 }} />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Contraseña (mín. 6 caracteres)</label>
              <div style={{ position: 'relative' }}>
                <input type={showPassword ? 'text' : 'password'} required autoComplete="new-password" placeholder="••••••••"
                  value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting}
                  style={{ width: '100%', minHeight: 44, paddingRight: 42 }} minLength={6} />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 6 }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Confirma la contraseña</label>
              <input type={showPassword ? 'text' : 'password'} required autoComplete="new-password" placeholder="Repite la contraseña"
                value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} disabled={submitting} style={{ minHeight: 44 }} />
            </div>
            <button className="primary-btn" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center', padding: '12px', fontWeight: 600 }}>
              <UserPlus size={16} /> {submitting ? 'Creando...' : 'Crear cuenta'}
            </button>
          </form>
        )}

        {msg && (
          <div className={msg.kind === 'success' ? 'alert-success' : msg.kind === 'error' ? 'alert-error' : 'alert-warning'} style={{ marginTop: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {msg.kind === 'success' ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
            <span style={{ fontSize: '0.83rem' }}>{msg.text}</span>
          </div>
        )}

        <p style={{ marginTop: 18, fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
          Acceso administrativo para <strong>@gdo.com.co</strong> y <strong>@promigas.com</strong>. Contratistas con otros dominios solo verán <strong>Visitas en Campo</strong>.
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
