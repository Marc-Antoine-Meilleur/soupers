import { useState } from 'react'
import { supabase } from '../lib'
import { useApp } from '../App'

export default function Onboarding() {
  const { reload, profile } = useApp()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [group, setGroup] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const run = async (fn, args) => {
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) setErr(error.message)
    else if (!data?.id) setErr(fn === 'create_household' ? 'Code du groupe invalide. Demandez-le à l\'administrateur.' : 'Ce code ne correspond à aucun foyer.')
    else reload()
  }

  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="logo">Bienvenue{profile?.display_name ? `, ${profile.display_name}` : ''}!</div>
        <p>Votre foyer regroupe les personnes qui partagent les soupers, l'inventaire et la liste d'épicerie.</p>
      </div>
      <div className="card">
        <h2>Créer mon foyer</h2>
        <label className="field"><span>Nom du foyer</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Famille Tremblay" /></label>
        <label className="field"><span>Code du groupe</span>
          <input value={group} onChange={(e) => setGroup(e.target.value)} autoCapitalize="characters" placeholder="Fourni par l'administrateur" /></label>
        <button className="btn primary block" disabled={!name.trim() || !group.trim() || busy} onClick={() => run('create_household', { p_name: name.trim(), p_group_code: group.trim() })}>Créer</button>
      </div>
      <div className="or">ou</div>
      <div className="card">
        <h2>Rejoindre un foyer</h2>
        <p className="muted">Demandez le code d'invitation à un membre (Réglages → Foyer).</p>
        <label className="field"><span>Code d'invitation</span>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" autoCapitalize="characters" /></label>
        <button className="btn block" disabled={code.trim().length < 4 || busy} onClick={() => run('join_household', { p_code: code })}>Rejoindre</button>
      </div>
      {err && <p className="note err">{err}</p>}
      <button className="link center" onClick={() => supabase.auth.signOut()}>Se déconnecter</button>
    </div>
  )
}
