'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { User, KeyRound, LogOut, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';

interface UserInfo {
  email: string;
  full_name?: string;
  created_at?: string;
}

export default function CuentaPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const supa = () => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  useEffect(() => {
    supa().auth.getUser().then(({ data }) => {
      if (data.user?.email) {
        setUser({
          email: data.user.email,
          full_name: (data.user.user_metadata as { full_name?: string })?.full_name,
          created_at: data.user.created_at,
        });
      }
    });
  }, []);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (password.length < 6) { setMsg({ kind: 'error', text: 'Mínimo 6 caracteres' }); return; }
    if (password !== passwordConfirm) { setMsg({ kind: 'error', text: 'Las contraseñas no coinciden' }); return; }
    setSubmitting(true);
    const { error } = await supa().auth.updateUser({ password });
    setSubmitting(false);
    if (error) { setMsg({ kind: 'error', text: error.message }); return; }
    setPassword(''); setPasswordConfirm('');
    setMsg({ kind: 'success', text: 'Contraseña actualizada correctamente.' });
  };

  const logout = async () => {
    await supa().auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <User size={24} style={{ color: 'var(--accent)' }} />
        <h1 style={{ margin: 0 }}>Mi cuenta</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginTop: 4, marginBottom: 16 }}>
        Datos del usuario y cambio de contraseña.
      </p>

      <div className="glass-panel">
        <h2 className="card-title" style={{ marginBottom: 12 }}>Información</h2>
        <table style={{ width: '100%', fontSize: '0.85rem' }}>
          <tbody>
            <tr>
              <td style={{ padding: '6px 0', color: 'var(--text-muted)', width: 140 }}>Correo</td>
              <td style={{ padding: '6px 0', fontWeight: 600 }}>{user?.email ?? '—'}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 0', color: 'var(--text-muted)' }}>Nombre</td>
              <td style={{ padding: '6px 0' }}>{user?.full_name ?? '—'}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 0', color: 'var(--text-muted)' }}>Cuenta creada</td>
              <td style={{ padding: '6px 0' }}>{user?.created_at ? new Date(user.created_at).toLocaleString('es-CO') : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="glass-panel">
        <h2 className="card-title" style={{ marginBottom: 12 }}>Cambiar contraseña</h2>
        <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Nueva contraseña (mín. 6 caracteres)</label>
            <div style={{ position: 'relative' }}>
              <input type={showPassword ? 'text' : 'password'} required minLength={6} autoComplete="new-password"
                value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting}
                style={{ width: '100%', minHeight: 44, paddingRight: 42 }} />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 6 }}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Confirma la contraseña</label>
            <input type={showPassword ? 'text' : 'password'} required minLength={6} autoComplete="new-password"
              value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} disabled={submitting}
              style={{ minHeight: 44 }} />
          </div>
          <button className="primary-btn" type="submit" disabled={submitting} style={{ width: 'auto', alignSelf: 'flex-start' }}>
            <KeyRound size={14} /> {submitting ? 'Guardando...' : 'Actualizar contraseña'}
          </button>
        </form>

        {msg && (
          <div className={msg.kind === 'success' ? 'alert-success' : 'alert-error'} style={{ marginTop: 14, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {msg.kind === 'success' ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
            <span style={{ fontSize: '0.85rem' }}>{msg.text}</span>
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
        <h2 className="card-title" style={{ marginBottom: 8, color: '#ef4444' }}>Cerrar sesión</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Cierra la sesión actual. Tendrás que volver a entrar con tu contraseña.
        </p>
        <button onClick={logout} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 600 }}>
          <LogOut size={14} /> Cerrar sesión
        </button>
      </div>
    </div>
  );
}
