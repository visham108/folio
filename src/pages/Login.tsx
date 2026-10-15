import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, BookOpen, Mail, Smartphone } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Cover } from '../components/Cover'
import { cloudConfigured, sendEmailCode, signInWithGoogle, verifyEmailCode } from '../lib/supabaseBackend'
import { useStore } from '../state/store'
import { useToast } from '../state/toast'

const SHOWCASE = [
  ['The Left Hand of Darkness', 'Ursula K. Le Guin'], ['Piranesi', 'Susanna Clarke'], ['Middlemarch', 'George Eliot'],
  ['Kindred', 'Octavia E. Butler'], ['The Waves', 'Virginia Woolf'], ['Pachinko', 'Min Jin Lee'],
  ['Beloved', 'Toni Morrison'], ['Invisible Cities', 'Italo Calvino'], ['The Dispossessed', 'Ursula K. Le Guin'],
]

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

const RESEND_AFTER = 60

/** Email sign-in: address → 6-digit code. New addresses get an account automatically. */
function EmailSignIn({ onCancel }: { onCancel: () => void }) {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [wait, setWait] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!wait) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])
  useEffect(() => { if (sentTo) codeRef.current?.focus() }, [sentTo])

  const send = async (to: string) => {
    setBusy(true); setError('')
    try {
      await sendEmailCode(to)
      setSentTo(to); setCode(''); setWait(RESEND_AFTER)
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  const verify = async (token: string) => {
    if (!sentTo) return
    setBusy(true); setError('')
    try {
      await verifyEmailCode(sentTo, token)
      toast('Signed in')
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }

  if (!sentTo) {
    return (
      <form className="email-form" onSubmit={(e) => { e.preventDefault(); const v = email.trim().toLowerCase(); if (v) send(v) }}>
        <label className="field-label" htmlFor="login-email">Email address</label>
        <input id="login-email" className="input" type="email" inputMode="email" autoComplete="email" autoFocus required
          placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setError('') }} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Email me a sign-in code'}</button>
        <button type="button" className="link-btn" onClick={onCancel}><ArrowLeft size={14} /> Other ways to sign in</button>
      </form>
    )
  }
  return (
    <form className="email-form" onSubmit={(e) => { e.preventDefault(); if (code.length >= 6) verify(code) }}>
      <p className="email-sent">We sent a code to <b>{sentTo}</b>. It may take a minute, and can land in spam.</p>
      <label className="field-label" htmlFor="login-code">Code</label>
      <input id="login-code" ref={codeRef} className="input code-input" inputMode="numeric" autoComplete="one-time-code"
        pattern="[0-9]*" maxLength={10} placeholder="123456" value={code}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 10)
          setCode(v); setError('')
          // Pasted or autofilled whole codes sign in straight away.
          if (v.length >= 6 && v.length - code.length > 1) verify(v)
        }} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={busy || code.length < 6}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <div className="email-links">
        <button type="button" className="link-btn" onClick={() => { setSentTo(null); setError('') }}><ArrowLeft size={14} /> Different email</button>
        <button type="button" className="link-btn" disabled={busy || wait > 0} onClick={() => send(sentTo)}>
          {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
        </button>
      </div>
    </form>
  )
}

export function Login() {
  const { continueOnDevice } = useStore()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [withEmail, setWithEmail] = useState(false)
  return (
    <div className="login">
      <div className="login-art" aria-hidden>
        {SHOWCASE.map(([t, a], i) => (
          <motion.div
            key={t}
            className="login-cover"
            initial={{ opacity: 0, y: 40, rotate: (i % 3) * 3 - 3 }}
            animate={{ opacity: 1, y: 0, rotate: (i % 3) * 3 - 3 }}
            transition={{ delay: 0.08 * i, type: 'spring', stiffness: 90, damping: 16 }}
          >
            <Cover work={{ title: t, authors: [a] }} size="lg" />
          </motion.div>
        ))}
      </div>
      <motion.div className="login-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <div className="brand big"><BookOpen size={26} /> Folio</div>
        <h1 className="display">Every book.<br /><em>Every format.</em><br />Every reread.</h1>
        <p className="lede">Keep track of what you read and listen to: print, ebook and audio, with stats you'll actually want to look at.</p>
        <AnimatePresence mode="wait" initial={false}>
          {withEmail ? (
            <motion.div key="email" className="login-actions" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <EmailSignIn onCancel={() => setWithEmail(false)} />
            </motion.div>
          ) : (
            <motion.div key="choices" className="login-actions" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              {cloudConfigured && (
                <>
                  <button
                    className="btn btn-google"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try { await signInWithGoogle() } catch (e) { toast((e as Error).message, { tone: 'error' }); setBusy(false) }
                    }}
                  >
                    <GoogleMark /> Continue with Google
                  </button>
                  <button className="btn btn-google" onClick={() => setWithEmail(true)}>
                    <Mail size={18} /> Continue with email
                  </button>
                  <span className="or" aria-hidden>or</span>
                </>
              )}
              <button className={`btn ${cloudConfigured ? 'btn-ghost' : 'btn-primary'}`} onClick={continueOnDevice}>
                <Smartphone size={18} /> {cloudConfigured ? 'Try it without an account' : 'Start on this device'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <p className="fine">
          {cloudConfigured
            ? 'Signing in syncs your library across devices and keeps you signed in. Without an account, everything stays in this browser.'
            : 'Your library is saved in this browser. Connect a Supabase project to enable Google sign-in and sync.'}
          {' '}<a className="link" href="./privacy.html">Privacy</a>
        </p>
      </motion.div>
    </div>
  )
}
