'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import { Sun, Mail, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react';

const ALLOWED_DOMAINS = ['@gdo.com.co', '@promigas.com'];
const isAllowedEmail = (email: string) => ALLOWED_DOMAINS.some((d) => email.toLowerCase().endsWith(d));

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const supa = () => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const trimmed = email.trim().toLowerCase();
    if (!isAllowedEmail(trimmed)) {
      setMsg({ kind: 'error', text: `El correo debe terminar en ${ALLOWED_DOMAINS.join(' o ')}` });
      return;
    }
    setSubmitting(true);
    const origin = window.location.origin;
    const { error } = await supa().auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${origin}/auth/reset-password`,
    });
    setSubmitting(false);
    if (error) {
      setMsg({ kind: 'error', text: error.message });
      return;
    }
    setMsg({ kind: 'success', text: `Si la cuenta existe, te enviamos un correo con instrucciones a ${trimmed}. Revisa también Spam.` });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: '24px', background: 'var(--bg-base)' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 420, padding: '32px 28px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 22 }}>
          <div style={{ color: 'var(--accent)' }}>
            <Sun size={40} strokeWidth={2.5} fill="currentColor" />
          </div>
          <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Recuperar contraseña</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
            Te enviamos un enlace a tu correo para crear una nueva contraseña.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Correo corporativo</label>
            <input type="email" required autoFocus autoComplete="email"
              placeholder={`tu.nombre${ALLOWED_DOMAINS[0]}`}
              value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting}
              style={{ minHeight: 44 }} />
          </div>
          <button className="primary-btn" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center', padding: '12px', fontWeight: 600 }}>
            <Mail size={16} /> {submitting ? 'Enviando...' : 'Enviar enlace de recuperación'}
          </button>
        </form>

        {msg && (
          <div className={msg.kind === 'success' ? 'alert-success' : 'alert-error'} style={{ marginTop: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {msg.kind === 'success' ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
            <span style={{ fontSize: '0.83rem' }}>{msg.text}</span>
          </div>
        )}

        <div style={{ marginTop: 18, textAlign: 'center' }}>
          <Link href="/login" style={{ fontSize: '0.82rem', color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ArrowLeft size={14} /> Volver al login
          </Link>
        </div>
      </div>
    </div>
  );
}
