import { useEffect, useMemo, useState } from 'react'
import { adminCall, today } from '../lib'
import { useApp } from '../App'
import { Icon, Sheet, Spinner, Header, Field } from '../ui'

const usd = (n) => `${(n || 0).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
const usd4 = (n) => `${(n || 0).toLocaleString('fr-CA', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} $`
const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2).replace('.', ',')} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n || 0))
const ACTIONS = { plan_week: 'Plans de semaine', shopping_list: "Listes d'épicerie", import_url: 'Import de liens', import_file: 'Import PDF/photos', import_text: 'Import de texte' }

export default function Admin() {
  const { go, toast, session } = useApp()
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [secret, setSecret] = useState(null)
  const [creating, setCreating] = useState(false)
  const [cfg, setCfg] = useState({})

  const load = async () => {
    try {
      const x = await adminCall('overview')
      setD(x); setCfg({ credits_usd: x.config?.credits_usd ?? 0, ai_daily_limit: x.config?.ai_daily_limit ?? 40, group_code: x.config?.group_code ?? '' })
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [])

  const hh = useMemo(() => Object.fromEntries((d?.households || []).map((h) => [h.id, h.name])), [d])
  const fin = useMemo(() => {
    if (!d) return null
    const calls = d.calls || []
    const month = today().slice(0, 7)
    const total = calls.reduce((s, c) => s + Number(c.cost_usd), 0)
    const thisMonth = calls.filter((c) => c.created_at.slice(0, 7) === month).reduce((s, c) => s + Number(c.cost_usd), 0)
    const byUser = new Map()
    for (const c of calls) {
      const k = c.user_id || c.user_name || '?'
      const u = byUser.get(k) || { name: c.user_name || 'Utilisateur supprimé', household: hh[c.household_id] || '—', calls: 0, inTok: 0, outTok: 0, cost: 0, month: 0 }
      u.calls++; u.inTok += c.input_tokens; u.outTok += c.output_tokens; u.cost += Number(c.cost_usd)
      if (c.created_at.slice(0, 7) === month) u.month += Number(c.cost_usd)
      byUser.set(k, u)
    }
    const byAction = new Map()
    for (const c of calls) { const a = byAction.get(c.action) || { calls: 0, cost: 0 }; a.calls++; a.cost += Number(c.cost_usd); byAction.set(c.action, a) }
    const months = []
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - i)
      const key = dt.toISOString().slice(0, 7)
      months.push({ key, label: dt.toLocaleDateString('fr-CA', { month: 'short' }), cost: calls.filter((c) => c.created_at.slice(0, 7) === key).reduce((s, c) => s + Number(c.cost_usd), 0) })
    }
    return {
      total, thisMonth, remaining: Number(d.config?.credits_usd || 0) - total,
      inTok: calls.reduce((s, c) => s + c.input_tokens, 0), outTok: calls.reduce((s, c) => s + c.output_tokens, 0),
      users: [...byUser.values()].sort((a, b) => b.cost - a.cost), actions: [...byAction.entries()].sort((a, b) => b[1].cost - a[1].cost), months,
    }
  }, [d, hh])

  const act = async (fn, okMsg) => {
    try { const r = await fn(); if (okMsg) toast(okMsg); await load(); return r } catch (e) { toast('Erreur : ' + e.message) }
  }
  const resetPw = async (u) => {
    if (!confirm(`Créer un mot de passe temporaire pour ${u.display_name || u.email}?`)) return
    const r = await act(() => adminCall('reset_password', { user_id: u.id }))
    if (r?.password) setSecret({ title: 'Mot de passe temporaire', email: u.email, password: r.password })
  }
  const remove = async (u) => {
    const ans = prompt(`Supprimer définitivement le compte de ${u.display_name || u.email}?\nSes recettes partagées seront conservées. Tapez SUPPRIMER pour confirmer.`)
    if (ans !== 'SUPPRIMER') return
    const r = await act(() => adminCall('delete_user', { user_id: u.id }), 'Compte supprimé')
    if (r?.moved_recipes) toast(`${r.moved_recipes} recette(s) partagée(s) conservée(s) dans votre foyer`)
  }
  const move = (u, household_id) => act(() => adminCall('move_user', { user_id: u.id, household_id: household_id || null }), 'Foyer modifié')
  const saveCfg = () => act(() => adminCall('set_config', cfg), 'Réglages enregistrés')
  const backup = async () => {
    try {
      const data = await adminCall('backup')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = `au-menu-sauvegarde-${today()}.json`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      toast('Sauvegarde téléchargée')
    } catch (e) { toast('Erreur : ' + e.message) }
  }

  if (err) return <><Header title="Administration" /><p className="note err">{err}</p></>
  if (!d) return <><Header title="Administration" /><Spinner /></>
  const max = Math.max(0.01, ...fin.months.map((m) => m.cost))

  return (
    <>
      <button className="link back" onClick={() => go('settings')}><Icon name="back" size={16} /> Réglages</button>
      <Header title="Administration" sub={`${d.users.length} utilisateurs · ${d.households.length} foyers`} />

      <section className="card">
        <h2>Coûts de l'IA</h2>
        <div className="kpis">
          <div><small>Ce mois-ci</small><b>{usd(fin.thisMonth)}</b></div>
          <div><small>Depuis le début</small><b>{usd(fin.total)}</b></div>
          <div className={fin.remaining < 1 ? 'warn' : ''}><small>Crédits restants (estimé)</small><b>{usd(fin.remaining)}</b></div>
        </div>
        <div className="bars">
          {fin.months.map((m) => (
            <div key={m.key} className="bar"><span style={{ height: `${(m.cost / max) * 100}%` }} title={usd4(m.cost)} /><small>{m.label}</small></div>
          ))}
        </div>
        <p className="muted small">{tok(fin.inTok)} tokens envoyés · {tok(fin.outTok)} tokens reçus. Estimation selon les tarifs publics ; la console Anthropic fait foi.</p>
        <h3>Par personne</h3>
        <div className="table-wrap">
          <table className="preview">
            <thead><tr><th>Nom</th><th>Foyer</th><th>Appels</th><th>Tokens</th><th>Ce mois</th><th>Total</th></tr></thead>
            <tbody>{fin.users.length === 0 ? <tr><td colSpan={6} className="muted">Aucun appel pour l'instant</td></tr> : fin.users.map((u, k) => (
              <tr key={k}><td>{u.name}</td><td>{u.household}</td><td>{u.calls}</td><td>{tok(u.inTok + u.outTok)}</td><td>{usd4(u.month)}</td><td><b>{usd4(u.cost)}</b></td></tr>
            ))}</tbody>
          </table>
        </div>
        {fin.actions.length > 0 && <>
          <h3>Par fonction</h3>
          <ul className="plain">{fin.actions.map(([a, v]) => <li key={a} className="spread"><span>{ACTIONS[a] || a}</span><span className="muted">{v.calls} appel{v.calls > 1 ? 's' : ''} · {usd4(v.cost)}</span></li>)}</ul>
        </>}
      </section>

      <section className="card">
        <h2>Réglages du groupe</h2>
        <div className="two">
          <Field label="Crédits achetés au total ($ US)" hint="Pour estimer le solde restant"><input inputMode="decimal" value={cfg.credits_usd} onChange={(e) => setCfg({ ...cfg, credits_usd: e.target.value.replace(',', '.') })} /></Field>
          <Field label="Limite IA par foyer / jour" hint="Protection contre les abus"><input inputMode="numeric" value={cfg.ai_daily_limit} onChange={(e) => setCfg({ ...cfg, ai_daily_limit: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <Field label="Code du groupe" hint="Permet à un utilisateur sans foyer d'en créer un"><input value={cfg.group_code} onChange={(e) => setCfg({ ...cfg, group_code: e.target.value })} /></Field>
        <button className="btn primary sm" onClick={saveCfg}>Enregistrer</button>
        {d.usage_today?.length > 0 && <p className="muted small">Aujourd'hui : {d.usage_today.map((u) => `${hh[u.household_id] || '?'} ${u.calls}`).join(' · ')}</p>}
      </section>

      <section className="card">
        <div className="spread"><h2>Utilisateurs</h2><button className="btn primary sm" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Nouveau</button></div>
        <ul className="plain users">
          {d.users.map((u) => (
            <li key={u.id}>
              <div className="grow">
                <b>{u.display_name || '—'}</b> {u.is_admin && <span className="pill violet">Admin</span>} {u.must_change_password && <span className="pill orange">Mot de passe temporaire</span>}
                <small>{u.email} · dernière connexion : {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString('fr-CA') : 'jamais'}</small>
                <select className="mini wide" value={u.household_id || ''} onChange={(e) => move(u, e.target.value)}>
                  <option value="">— Sans foyer —</option>
                  {d.households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div className="user-actions">
                <button className="btn sm" onClick={() => resetPw(u)}>Mot de passe</button>
                {u.id !== session.user.id && <button className="btn sm danger" onClick={() => remove(u)}>Supprimer</button>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Sauvegarde</h2>
        <p className="muted small">Télécharge toutes les données (recettes, avis, inventaires, menus, coûts, comptes) dans un fichier JSON. En cas de panne, donnez ce fichier à Claude pour tout restaurer. Les PDF et photos restent dans Supabase (leur liste est incluse). Conservez ce fichier en lieu sûr : il contient les courriels des membres.</p>
        <button className="btn block" onClick={backup}><Icon name="download" size={18} /> Télécharger une sauvegarde</button>
      </section>

      {creating && <CreateUser households={d.households} onClose={() => setCreating(false)}
        onCreated={(r) => { setCreating(false); setSecret({ title: 'Compte créé', ...r }); load() }} />}
      {secret && (
        <Sheet title={secret.title} onClose={() => setSecret(null)}>
          <p>Transmettez ces informations à la personne (en personne ou par texto). À sa première connexion, elle devra choisir son propre mot de passe.</p>
          <div className="secret"><small>Adresse de l'app</small><b>{location.origin + location.pathname}</b><small>Courriel</small><b>{secret.email}</b><small>Mot de passe temporaire</small><b className="mono">{secret.password}</b></div>
          <button className="btn primary block" onClick={async () => {
            const text = `Ton compte AU MENU (Ateliers du Champ Libre)\n${location.origin + location.pathname}\nCourriel : ${secret.email}\nMot de passe temporaire : ${secret.password}`
            if (navigator.share) { try { await navigator.share({ text }) } catch { /* */ } } else { await navigator.clipboard.writeText(text); toast('Copié') }
          }}><Icon name="share" size={18} /> Envoyer / copier</button>
        </Sheet>
      )}
    </>
  )
}

function CreateUser({ households, onClose, onCreated }) {
  const { toast } = useApp()
  const [f, setF] = useState({ email: '', display_name: '', household_id: households[0]?.id || '', new_household: '' })
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      const r = await adminCall('create_user', { ...f, household_id: f.household_id === 'new' ? null : f.household_id })
      onCreated({ email: f.email.trim().toLowerCase(), password: r.password })
    } catch (e) { toast('Erreur : ' + e.message) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Nouvel utilisateur" onClose={onClose}
      footer={<button className="btn primary block" disabled={busy || !f.email || !f.display_name || (f.household_id === 'new' && !f.new_household.trim())} onClick={submit}>{busy ? '…' : 'Créer le compte'}</button>}>
      <Field label="Prénom"><input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
      <Field label="Courriel"><input type="email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Foyer">
        <select value={f.household_id} onChange={(e) => setF({ ...f, household_id: e.target.value })}>
          {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          <option value="new">+ Nouveau foyer…</option>
        </select>
      </Field>
      {f.household_id === 'new' && <Field label="Nom du nouveau foyer"><input value={f.new_household} onChange={(e) => setF({ ...f, new_household: e.target.value })} placeholder="ex. Famille Tremblay" /></Field>}
      <p className="muted small">Un mot de passe temporaire sera généré. La personne le changera à sa première connexion.</p>
    </Sheet>
  )
}
