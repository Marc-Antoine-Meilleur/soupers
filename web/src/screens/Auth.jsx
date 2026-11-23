import { useState } from 'react'
import { supabase, DEMO } from '../lib'

export default function Auth() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } })
        if (error) throw error
        if (!data.session) setMsg({ ok: true, text: 'Compte créé! Confirmez votre adresse en cliquant le lien reçu par courriel, puis connectez-vous.' })
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })
        if (error) throw error
        setMsg({ ok: true, text: 'Courriel de réinitialisation envoyé.' })
      }
    } catch (err) {
      const t = err.message?.includes('Invalid login') ? 'Courriel ou mot de passe invalide.' : err.message
      setMsg({ ok: false, text: t })
    } finally { setBusy(false) }
  }

  return (
    <div className="auth">
      <div className="auth-hero">
        <img className="brand-logo" src="./brand/logo.png" alt="Ateliers du Champ Libre" />
        <div className="logo">Soupers</div>
        <p>Planifiez vos soupers de la semaine, gérez le congélateur et partagez vos recettes entre amis.</p>
      </div>
      <form className="card auth-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Connexion' : mode === 'signup' ? 'Créer un compte' : 'Mot de passe oublié'}</h2>
        {mode === 'signup' && (
          <label className="field"><span>Prénom</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="given-name" /></label>
        )}
        <label className="field"><span>Courriel</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" /></label>
        {mode !== 'reset' && (
          <label className="field"><span>Mot de passe</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        )}
        {msg && <p className={msg.ok ? 'note ok' : 'note err'}>{msg.text}</p>}
        <button className="btn primary block" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'Se connecter' : mode === 'signup' ? 'Créer mon compte' : 'Envoyer'}
        </button>
        <div className="auth-links">
          {mode !== 'login' && <button type="button" className="link" onClick={() => setMode('login')}>J'ai déjà un compte</button>}
          {mode !== 'signup' && <button type="button" className="link" onClick={() => setMode('signup')}>Créer un compte</button>}
          {mode === 'login' && <button type="button" className="link" onClick={() => setMode('reset')}>Mot de passe oublié?</button>}
        </div>
        {DEMO && <p className="note">Mode démo : n'importe quel courriel et mot de passe fonctionnent.</p>}
      </form>
    </div>
  )
}

export function NewPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setMsg(error.message)
    else onDone()
  }
  return (
    <div className="auth">
      <div className="auth-hero"><img className="brand-logo" src="./brand/logo.png" alt="Ateliers du Champ Libre" /></div>
      <form className="card" onSubmit={submit}>
        <h2>Nouveau mot de passe</h2>
        <label className="field"><span>Mot de passe (8 caractères ou plus)</span>
          <input type="password" minLength={8} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {msg && <p className="note err">{msg}</p>}
        <button className="btn primary block" disabled={busy}>Enregistrer</button>
      </form>
    </div>
  )
}
