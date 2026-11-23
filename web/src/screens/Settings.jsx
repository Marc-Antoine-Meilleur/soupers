import { useEffect, useState } from 'react'
import { supabase, CATEGORIES, DEMO, APP_VERSION, fmtDay } from '../lib'
import { resetDemo } from '../mock'
import { useApp } from '../App'
import { CriteriaForm, FeedbackButton } from '../shared'
import { Icon, Header, Field } from '../ui'

export default function Settings() {
  const { household, profile, saveSettings, toast, session, reload, go } = useApp()
  const [pw, setPw] = useState('')
  const s = household.settings
  const [members, setMembers] = useState([])
  const [feedback, setFeedback] = useState([])
  const [newStore, setNewStore] = useState('')
  const [name, setName] = useState(profile.display_name || '')
  const [code, setCode] = useState(household.invite_code)

  useEffect(() => {
    supabase.from('profiles').select('id,display_name').eq('household_id', household.id).then(({ data }) => setMembers(data || []))
    supabase.from('feedback').select('*').order('created_at', { ascending: false }).limit(100).then(({ data }) => setFeedback(data || []))
  }, [household.id])

  const invite = async () => {
    const text = `Rejoins notre foyer dans l'app AU MENU des Ateliers du Champ Libre! Ouvre ${location.origin}${location.pathname} dans Safari, crée ton compte, puis entre le code : ${code}`
    if (navigator.share) { try { await navigator.share({ text }) } catch { /* annulé */ } }
    else { await navigator.clipboard.writeText(text); toast('Invitation copiée') }
  }
  const rotate = async () => {
    if (!confirm('Créer un nouveau code? L\'ancien ne fonctionnera plus (les membres actuels restent).')) return
    const { data, error } = await supabase.rpc('rotate_invite_code')
    if (error) return toast('Erreur : ' + error.message)
    setCode(data); toast('Nouveau code créé')
  }
  const saveName = async () => {
    await supabase.from('profiles').update({ display_name: name.trim().slice(0, 60) }).eq('id', session.user.id)
    reload(); toast('Nom mis à jour')
  }
  const leave = async () => {
    if (!confirm('Quitter ce foyer? Vous pourrez en créer ou en rejoindre un autre.')) return
    await supabase.from('profiles').update({ household_id: null }).eq('id', session.user.id)
    reload()
  }
  const copyFeedback = async () => {
    const open = feedback.filter((f) => !f.done)
    const text = `Commentaires sur l'app AU MENU (v${APP_VERSION}) :\n\n` +
      open.map((f) => `- [${f.screen || '?'}] ${f.message} (${f.author_name || ''}, ${f.created_at.slice(0, 10)}, v${f.app_version || '?'})`).join('\n')
    await navigator.clipboard.writeText(text)
    toast(`${open.length} commentaire(s) copié(s) — collez-les dans Claude`)
  }
  const markDone = async () => {
    const ids = feedback.filter((f) => !f.done).map((f) => f.id)
    if (!ids.length) return
    await supabase.from('feedback').update({ done: true }).in('id', ids)
    setFeedback(feedback.map((f) => ({ ...f, done: true })))
  }
  const openFeedback = feedback.filter((f) => !f.done)

  return (
    <>
      <Header title="Réglages" action={<FeedbackButton screen="Réglages" />} />
      {profile.is_admin && (
        <button className="card admin-link" onClick={() => go('admin')}>
          <Icon name="shield" /><span><b>Administration</b><small>Utilisateurs, coûts de l'IA, sauvegarde</small></span><Icon name="next" size={18} />
        </button>
      )}

      <section className="card">
        <h2>Critères des soupers</h2>
        <CriteriaForm />
      </section>

      <section className="card">
        <h2>Épiceries</h2>
        <ul className="plain store-list">
          {s.stores.map((st) => (
            <li key={st}><span>{st}</span>
              <button className="icon-btn" onClick={() => saveSettings({ stores: s.stores.filter((x) => x !== st) })} aria-label={`Retirer ${st}`}><Icon name="close" size={18} /></button>
            </li>
          ))}
        </ul>
        <div className="inline-add">
          <input placeholder="Ajouter une épicerie (ex. Metro, Super C)" maxLength={40} value={newStore} onChange={(e) => setNewStore(e.target.value)} />
          <button className="btn sm" disabled={!newStore.trim() || s.stores.includes(newStore.trim())} onClick={() => { saveSettings({ stores: [...s.stores, newStore.trim()] }); setNewStore('') }}>Ajouter</button>
        </div>
        <h3>Où acheter chaque rayon</h3>
        <div className="map-list">
          {CATEGORIES.map((c) => (
            <label key={c}><span>{c}</span>
              <select value={s.category_store?.[c] || ''} onChange={(e) => saveSettings({ category_store: { ...s.category_store, [c]: e.target.value } })}>
                <option value="">{s.stores[0] || '—'} (par défaut)</option>
                {s.stores.map((st) => <option key={st}>{st}</option>)}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Commentaires ({openFeedback.length})</h2>
        <p className="muted small">Notez vos irritants avec le bouton <Icon name="chat" size={14} /> en haut de chaque écran. Pour la prochaine version, copiez-les et collez-les dans votre conversation avec Claude.</p>
        {openFeedback.length > 0 && (
          <>
            <ul className="plain feedback-list">{openFeedback.slice(0, 8).map((f) => (
              <li key={f.id}>{f.message}<small>{f.screen} · {f.author_name} · {fmtDay(f.created_at.slice(0, 10))}</small></li>
            ))}</ul>
            <div className="two">
              <button className="btn primary" onClick={copyFeedback}><Icon name="copy" size={18} /> Copier</button>
              <button className="btn" onClick={markDone}>Marquer traités</button>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Foyer : {household.name}</h2>
        <p className="muted">Les membres partagent le plan, l'inventaire et la liste d'épicerie.</p>
        <div className="invite"><span>Code d'invitation</span><b>{code}</b></div>
        <div className="two">
          <button className="btn" onClick={invite}><Icon name="share" size={18} /> Inviter</button>
          <button className="btn" onClick={rotate}><Icon name="refresh" size={18} /> Nouveau code</button>
        </div>
        <ul className="plain">{members.map((m) => <li key={m.id}><Icon name="users" size={16} /> {m.display_name}{m.id === session.user.id ? ' (vous)' : ''}</li>)}</ul>
      </section>

      <section className="card">
        <h2>Mon profil</h2>
        <Field label="Prénom affiché"><input maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <button className="btn sm" onClick={saveName} disabled={!name.trim()}>Enregistrer</button>
        <p className="small muted">{session.user.email}</p>
        <h3>Changer mon mot de passe</h3>
        <div className="inline-add">
          <input type="password" autoComplete="new-password" placeholder="Nouveau (8 caractères ou plus)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="btn sm" disabled={pw.length < 8} onClick={async () => { const { error } = await supabase.auth.updateUser({ password: pw }); if (error) toast('Erreur : ' + error.message); else { setPw(''); toast('Mot de passe changé') } }}>Changer</button>
        </div>
      </section>

      <section className="card">
        <h2>Installer sur iPhone</h2>
        <ol className="steps small">
          <li>Ouvrir l'app dans <b>Safari</b>.</li>
          <li>Toucher le bouton <b>Partager</b> (carré avec flèche).</li>
          <li>Choisir <b>Sur l'écran d'accueil</b>, puis <b>Ajouter</b>.</li>
        </ol>
      </section>

      <div className="stack">
        <button className="btn block" onClick={() => supabase.auth.signOut()}>Se déconnecter</button>
        <button className="btn danger block" onClick={leave}>Quitter ce foyer</button>
        {DEMO && <button className="btn block" onClick={() => { resetDemo(); location.reload() }}>Réinitialiser la démo</button>}
      </div>
      <p className="version">AU MENU · Ateliers du Champ Libre · v{APP_VERSION}</p>
    </>
  )
}
