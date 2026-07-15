'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const DISPLAY = { fontFamily: 'var(--font-display)' }

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  // Password is the primary way in; the email magic-link is offered as a fallback.
  const [mode, setMode] = useState<'password' | 'link'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function sendLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null); setLoading(true)
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/risk` },
    })
    setLoading(false)
    if (otpError) { setError(otpError.message); return }
    setSent(true)
  }

  async function signInPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null); setLoading(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password,
    })
    setLoading(false)
    if (signInError) { setError(signInError.message); return }
    router.push('/risk'); router.refresh()
  }

  const inputCls =
    'w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-lt)]'

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-10"
      style={{
        background:
          'radial-gradient(1100px 500px at 50% -10%, var(--blue-lt), transparent 60%), var(--bg)',
      }}
    >
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div
            className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl shadow-[var(--shadow-md)]"
            style={{ background: 'linear-gradient(140deg, var(--blue-md), var(--blue))' }}
          >
            <span>🛡️</span>
          </div>
          <h1 className="text-2xl font-semibold text-[var(--text)]" style={DISPLAY}>
            RMCQ HASA Portal
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Risk Management, Compliance &amp; Quality
          </p>
          <p className="text-xs text-[var(--muted)]">Hospital Al-Sultan Abdullah UiTM</p>
        </div>

        {/* Card */}
        <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[var(--shadow-md)]">
          {sent ? (
            <div className="rounded-[12px] border border-[var(--green)] bg-[var(--green-lt)] p-4 text-sm text-[var(--green)]">
              <p className="font-semibold">Check your email</p>
              <p className="mt-1">
                We sent a sign-in link to <b>{email}</b>. Open it on this device to sign in.
                The link expires shortly.
              </p>
              <button
                type="button"
                onClick={() => { setSent(false); setError(null) }}
                className="mt-3 font-medium underline"
              >
                Use a different email
              </button>
            </div>
          ) : mode === 'password' ? (
            <form onSubmit={signInPassword} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[var(--text)]">Email</label>
                <input
                  id="email" type="email" autoComplete="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@moh.gov.my"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[var(--text)]">Password</label>
                <input
                  id="password" type="password" autoComplete="current-password" required value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputCls}
                />
              </div>
              {error && <p className="text-sm text-[var(--red)]" role="alert">{error}</p>}
              <button
                type="submit" disabled={loading}
                className="w-full rounded-[10px] bg-[var(--blue)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>

              <div className="flex items-center gap-3 pt-1">
                <span className="h-px flex-1 bg-[var(--border)]" />
                <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">or</span>
                <span className="h-px flex-1 bg-[var(--border)]" />
              </div>
              <button
                type="button" onClick={() => { setMode('link'); setError(null) }}
                className="w-full rounded-[10px] border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg)]"
              >
                Email me a sign-in link instead
              </button>
            </form>
          ) : (
            <form onSubmit={sendLink} className="space-y-4">
              <div>
                <label htmlFor="email2" className="mb-1.5 block text-sm font-medium text-[var(--text)]">Email</label>
                <input
                  id="email2" type="email" autoComplete="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@moh.gov.my"
                  className={inputCls}
                />
              </div>
              {error && <p className="text-sm text-[var(--red)]" role="alert">{error}</p>}
              <button
                type="submit" disabled={loading}
                className="w-full rounded-[10px] bg-[var(--blue)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Sending…' : 'Email me a sign-in link'}
              </button>
              <p className="text-center text-xs text-[var(--muted)]">
                No password needed — we&apos;ll email you a secure one-time link.
              </p>
              <button
                type="button" onClick={() => { setMode('password'); setError(null) }}
                className="w-full text-center text-xs text-[var(--muted)] underline"
              >
                Sign in with a password instead
              </button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] text-[var(--muted)]">
          Internal use only · Hospital Al-Sultan Abdullah UiTM
        </p>
      </div>
    </main>
  )
}
