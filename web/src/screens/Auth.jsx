import { useState } from 'react'
import { supabase, DEMO } from '../lib'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [help, setHelp] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setMsg(error.message?.includes('Invalid login') ? 'Courriel ou mot de passe invalide.' : error.message)
  }

  return (
    <div className="auth">
      <div className="auth-hero">
        <img className="brand-logo" src="./brand/logo.png" alt="Ateliers du Champ Libre" />
        <div className="logo">AU MENU</div>
        <p>Planifiez vos soupers de la semaine, gérez le congélateur et partagez vos recettes entre amis.</p>
      </div>
      <form className="card auth-card" onSubmit={submit}>
        <h2>Connexion</h2>
        <label className="field"><span>Courriel</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" /></label>
        <label className="field"><span>Mot de passe</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
        {msg && <p className="note err">{msg}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? '…' : 'Se connecter'}</button>
        <button type="button" className="link center" onClick={() => setHelp(!help)}>Pas de compte ou mot de passe oublié?</button>
        {help && <p className="note">Les comptes sont créés par l'administrateur du groupe. Demandez-lui un compte ou un nouveau mot de passe temporaire.</p>}
        {DEMO && <p className="note">Mode démo : n'importe quel courriel et mot de passe fonctionnent.</p>}
      </form>
    </div>
  )
}

export function NewPassword({ onDone, first }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } })
    setBusy(false)
    if (error) setMsg(error.message)
    else onDone()
  }
  return (
    <div className="auth">
      <div className="auth-hero"><img className="brand-logo" src="./brand/logo.png" alt="Ateliers du Champ Libre" /></div>
      <form className="card" onSubmit={submit}>
        <h2>{first ? 'Choisissez votre mot de passe' : 'Nouveau mot de passe'}</h2>
        {first && <p className="muted small">Vous vous êtes connecté avec un mot de passe temporaire. Choisissez-en un personnel.</p>}
        <label className="field"><span>Mot de passe (8 caractères ou plus)</span>
          <input type="password" minLength={8} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {msg && <p className="note err">{msg}</p>}
        <button className="btn primary block" disabled={busy}>Enregistrer</button>
      </form>
    </div>
  )
}
