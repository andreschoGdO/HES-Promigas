'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { Sun, Mail, AlertCircle, CheckCircle2, ArrowLeft, KeyRound } from 'lucide-react';

const ALLOWED_DOMAIN = '@gdo.com.co';

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (params.get('error') === 'domain') {
      setMsg({ kind: 'error', text: `Solo se permite acceso a correos ${ALLOWED_DOMAIN}.` });
    } else if (params.get('error') === 'exchange-failed') {
      setMsg({ kind: 'error', text: 'El enlace expiró o ya fue usado. Solicita un nuevo código.' });
    }
  }, [params]);

  const supabase = () => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.endsWith(ALLOWED_DOMAIN)) {
      setMsg({ kind: 'error', text: `El correo debe terminar en ${ALLOWED_DOMAIN}` });
      return;
    }
    setSending(true);
    const { error } = await supabase().auth.signInWithOtp({
      email: trimmed,
      options: { shouldCreateUser: true },
    });
    setSending(false);
    if (error) {
      setMsg({ kind: 'error', text: error.message });
      return;
    }
    setEmail(trimmed);
    setStep('code');
    setMsg({ kind: 'info', text: `Te enviamos un código a ${trimmed}. Revisa tu Outlook (incluida la carpeta Spam).` });
    setTimeout(() => codeInputRef.current?.focus(), 100);
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const cleanCode = code.trim().replace(/\s/g, '');
    if (!/^\d{6,8}$/.test(cleanCode)) {
      setMsg({ kind: 'error', text: 'El código debe tener entre 6 y 8 dígitos.' });
      return;
    }
    setVerifying(true);
    const { data, error } = await supabase().auth.verifyOtp({
      email,
      token: cleanCode,
      type: 'email',
    });
    setVerifying(false);
    if (error) {
      setMsg({ kind: 'error', text: 'Código inválido o expirado. Solicita uno nuevo.' });
      return;
    }
    if (!data.user?.email?.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
      await supabase().auth.signOut();
      setMsg({ kind: 'error', text: `Solo se permite acceso a correos ${ALLOWED_DOMAIN}.` });
      return;
    }
    setMsg({ kind: 'success', text: 'Acceso autorizado, redirigiendo...' });
    const next = params.get('next') ?? '/dashboard';
    router.push(next);
    router.refresh();
  };

  const handleBack = () => {
    setStep('email');
    setCode('');
    setMsg(null);
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

        {step === 'email' ? (
          <form onSubmit={handleSendCode} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Correo corporativo</label>
              <input
                type="email"
                required
                autoFocus
                placeholder={`tu.nombre${ALLOWED_DOMAIN}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sending}
              />
            </div>
            <button className="primary-btn" type="submit" disabled={sending} style={{ width: '100%', justifyContent: 'center', padding: '10px' }}>
              <Mail size={14} /> {sending ? 'Enviando código...' : 'Enviar código'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 4 }}>
              Código enviado a <strong>{email}</strong>
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Código de acceso</label>
              <input
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                required
                autoComplete="one-time-code"
                placeholder="00000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                disabled={verifying}
                style={{ textAlign: 'center', fontSize: '1.3rem', letterSpacing: '0.35em', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}
              />
            </div>
            <button className="primary-btn" type="submit" disabled={verifying || code.length < 6} style={{ width: '100%', justifyContent: 'center', padding: '10px' }}>
              <KeyRound size={14} /> {verifying ? 'Verificando...' : 'Verificar y entrar'}
            </button>
            <button
              type="button"
              onClick={handleBack}
              disabled={verifying}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center', padding: 6 }}
            >
              <ArrowLeft size={12} /> Cambiar correo
            </button>
          </form>
        )}

        {msg && (
          <div className={msg.kind === 'success' ? 'alert-success' : msg.kind === 'error' ? 'alert-error' : 'alert-warning'} style={{ marginTop: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {msg.kind === 'success' ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
            <span style={{ fontSize: '0.85rem' }}>{msg.text}</span>
          </div>
        )}

        <p style={{ marginTop: 20, fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
          Acceso restringido a usuarios <strong>{ALLOWED_DOMAIN}</strong>.<br />
          {step === 'email'
            ? 'Recibirás un código de un solo uso en tu Outlook.'
            : 'El código expira en 60 minutos. Si no llega, revisa Spam o vuelve a solicitarlo.'}
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
