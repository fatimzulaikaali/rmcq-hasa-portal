'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [mode, setMode] = useState<'link' | 'password'>('link')
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold text-gray-900">RMCQ Portal</h1>
        <p className="mb-6 text-sm text-gray-500">Risk Management, Compliance &amp; Quality</p>

        {sent ? (
          <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            <p className="font-medium">Check your email</p>
            <p className="mt-1">We sent a sign-in link to <b>{email}</b>. Open it on this device to sign in. The link expires shortly.</p>
            <button type="button" onClick={() => { setSent(false); setError(null) }}
              className="mt-3 text-green-700 underline">Use a different email</button>
          </div>
        ) : mode === 'link' ? (
          <form onSubmit={sendLink} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">Email</label>
              <input id="email" type="email" autoComplete="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            <p className="text-center text-xs text-gray-500">
              No password needed — we&apos;ll email you a secure one-time link.
            </p>
            <button type="button" onClick={() => { setMode('password'); setError(null) }}
              className="w-full text-center text-xs text-gray-500 underline">Sign in with a password instead</button>
          </form>
        ) : (
          <form onSubmit={signInPassword} className="space-y-4">
            <div>
              <label htmlFor="email2" className="mb-1 block text-sm font-medium text-gray-700">Email</label>
              <input id="email2" type="email" autoComplete="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">Password</label>
              <input id="password" type="password" autoComplete="current-password" required value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" onClick={() => { setMode('link'); setError(null) }}
              className="w-full text-center text-xs text-gray-500 underline">Use a sign-in link instead</button>
          </form>
        )}
      </div>
    </main>
  )
}
