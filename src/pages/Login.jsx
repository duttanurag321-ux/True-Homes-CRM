import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Login() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } }
        })
        if (error) throw error
        if (data.user && !data.session) {
          setInfo('Account created. Check your email to confirm, then sign in.')
          setMode('signin')
        }
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 bg-base">
      <div className="max-w-sm mx-auto w-full">
        <div className="text-center mb-10">
          <img src="/true-homes-crm/icon-192.png" alt="True Homes" className="h-20 w-20 rounded-2xl mx-auto mb-4 shadow-pop" />
          <h1 className="text-[28px] font-bold tracking-tight">True Homes</h1>
          <p className="text-muted text-sm mt-1">Your dream home comes true.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
              required
              className="w-full rounded-xl border border-line px-4 py-3 text-[15px] bg-white"
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            className="w-full rounded-xl border border-line px-4 py-3 text-[15px] bg-white"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            minLength={6}
            className="w-full rounded-xl border border-line px-4 py-3 text-[15px] bg-white"
          />

          {error && <p className="text-sm text-danger font-medium">{error}</p>}
          {info && <p className="text-sm text-success font-medium">{info}</p>}

          <button
            type="submit"
            disabled={loading}
            className="press w-full py-3.5 rounded-xl bg-accent text-white font-semibold disabled:opacity-50"
          >
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError('')
            setInfo('')
          }}
          className="press w-full text-center mt-5 text-sm text-accent font-medium"
        >
          {mode === 'signin' ? "New agent? Create an account" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
