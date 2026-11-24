import { useEffect, useMemo, useState } from 'react'
import { adminCall, today } from '../lib'
import { useApp } from '../App'
import { Icon, Sheet, Spinner, Header, Field } from '../ui'

const usd = (n) => `${(n || 0).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
const usd4 = (n) => `${(n || 0).toLocaleString('fr-CA', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} $`
const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2).replace('.', ',')} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n || 0))
const ACTIONS = { plan_week: 'Plans de semaine', shopping_list: "Listes d'épicerie", import_url: 'Import de liens', import_file: 'Import PDF/photos', import_text: 'Import de texte', suggest: 'Idées de Claude', tag_recipes: 'Étiquetage' }

export default function Admin() {
  const { go, toast, session } = useApp()
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [secret, setSecret] = useState(null)
  const [creating, setCreating] = useState(false)
  const [cfg, setCfg] = useState({})
  const [deleting, setDeleting] = useState(null)
  const [naming, setNaming] = useState(null) // { kind: 'household'|'community'|'rename', … }

  const load = async () => {
    try {
      const x = await adminCall('overview')
      setD(x); setCfg({ credits_usd: x.config?.credits_usd ?? 0, ai_daily_limit: x.config?.ai_daily_limit ?? 40, group_code: x.config?.group_code ?? '' })
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [])

  const hh = useMemo(() => Object.fromEntries((d?.households || []).map((h) => [h.id, h.name])), [d])
  const hhById = useMemo(() => Object.fromEntries((d?.households || []).map((h) => [h.id, h])), [d])
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
    const r = await act(() => adminCall('delete_user', { user_id: u.id }), 'Compte supprimé')
    setDeleting(null)
    if (r?.moved_recipes) toast(`${r.moved_recipes} recette(s) partagée(s) conservée(s) dans votre foyer`)
  }
  const move = (u, household_id) => {
    if (household_id === 'new') return setNaming({ kind: 'household', user: u })
    return act(() => adminCall('move_user', { user_id: u.id, household_id: household_id || null }), 'Foyer modifié')
  }
  const setCommunity = (household_id, community_id) => {
    if (community_id === 'new') return setNaming({ kind: 'community', household_id })
    return act(() => adminCall('set_household_community', { household_id, community_id: community_id || null }), 'Communauté modifiée')
  }
  const saveName = async (name) => {
    const n = naming
    setNaming(null)
    if (n.kind === 'household') {
      const r = await act(() => adminCall('create_household', { name, community_id: n.community_id }))
      if (r?.id && n.user) await act(() => adminCall('move_user', { user_id: n.user.id, household_id: r.id }), `Foyer « ${name} » créé`)
      else if (r?.id) toast(`Foyer « ${name} » créé`)
    } else if (n.kind === 'community') {
      const r = await act(() => adminCall('create_community', { name }))
      if (r?.id && n.household_id) await act(() => adminCall('set_household_community', { household_id: n.household_id, community_id: r.id }), `Communauté « ${name} » créée`)
      else if (r?.id) toast(`Communauté « ${name} » créée`)
    } else if (n.kind === 'rename') await act(() => adminCall('rename_community', { id: n.id, name }), 'Communauté renommée')
  }
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
        <h2>Réglages</h2>
        <div className="two">
          <Field label="Crédits achetés au total ($ US)" hint="Pour estimer le solde restant"><input inputMode="decimal" value={cfg.credits_usd} onChange={(e) => setCfg({ ...cfg, credits_usd: e.target.value.replace(',', '.') })} /></Field>
          <Field label="Limite IA par foyer / jour" hint="Protection contre les abus"><input inputMode="numeric" value={cfg.ai_daily_limit} onChange={(e) => setCfg({ ...cfg, ai_daily_limit: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <Field label="Code de la communauté" hint="Permet à un utilisateur sans foyer de créer le sien (placé dans la première communauté)"><input value={cfg.group_code} onChange={(e) => setCfg({ ...cfg, group_code: e.target.value })} /></Field>
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
                <div className="assign">
                  <label><small>Foyer</small>
                    <select className="mini wide" value={u.household_id || ''} onChange={(e) => move(u, e.target.value)}>
                      <option value="">— Sans foyer —</option>
                      {d.households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                      <option value="new">+ Nouveau foyer…</option>
                    </select>
                  </label>
                  <label><small>Communauté du foyer</small>
                    <select className="mini wide" disabled={!u.household_id} value={hhById[u.household_id]?.community_id || ''} onChange={(e) => setCommunity(u.household_id, e.target.value)}>
                      <option value="">— Aucune —</option>
                      {(d.communities || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      <option value="new">+ Nouvelle communauté…</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="user-actions">
                <button className="btn sm" onClick={() => resetPw(u)}>Mot de passe</button>
                {u.id !== session.user.id && <button className="btn sm danger" onClick={() => setDeleting(u)}>Supprimer</button>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="spread"><h2>Communautés</h2><button className="btn sm" onClick={() => setNaming({ kind: 'community' })}><Icon name="plus" size={16} /> Communauté</button></div>
        <p className="muted small">Les recettes partagées ne sont visibles qu'entre les foyers d'une même communauté. Changer un foyer de communauté s'applique à tous ses membres.</p>
        {[...(d.communities || []), { id: '', name: 'Sans communauté' }].map((c) => {
          const list = d.households.filter((h) => (h.community_id || '') === c.id)
          if (!c.id && !list.length) return null
          return (
            <div key={c.id || 'none'} className="community">
              <div className="spread"><h3>{c.name} <small className="muted">· {list.length} foyer{list.length > 1 ? 's' : ''}</small></h3>
                {c.id && <button className="link" onClick={() => setNaming({ kind: 'rename', id: c.id, initial: c.name })}>Renommer</button>}</div>
              <ul className="plain">
                {list.map((h) => (
                  <li key={h.id} className="spread"><span>{h.name} <small className="muted">· {d.users.filter((u) => u.household_id === h.id).map((u) => u.display_name).join(', ') || 'aucun membre'}</small></span>
                    <select className="mini" value={h.community_id || ''} onChange={(e) => setCommunity(h.id, e.target.value)} aria-label={`Communauté de ${h.name}`}>
                      <option value="">— Aucune —</option>
                      {(d.communities || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
              {c.id && <button className="link" onClick={() => setNaming({ kind: 'household', community_id: c.id })}>+ Foyer dans {c.name}</button>}
            </div>
          )
        })}
      </section>

      <section className="card">
        <h2>Sauvegarde</h2>
        <p className="muted small">Télécharge toutes les données (recettes, avis, inventaires, menus, coûts, comptes) dans un fichier JSON. En cas de panne, donnez ce fichier à Claude pour tout restaurer. Les PDF et photos restent dans Supabase (leur liste est incluse). Conservez ce fichier en lieu sûr : il contient les courriels des membres.</p>
        <button className="btn block" onClick={backup}><Icon name="download" size={18} /> Télécharger une sauvegarde</button>
      </section>

      {deleting && (
        <Sheet title="Supprimer le compte" onClose={() => setDeleting(null)}
          footer={<div className="two"><button className="btn" onClick={() => setDeleting(null)}>Annuler</button><button className="btn danger-fill" onClick={() => remove(deleting)}>Supprimer</button></div>}>
          <p>Supprimer définitivement le compte de <b>{deleting.display_name || deleting.email}</b> ({deleting.email})?</p>
          <p className="muted small">Ses avis et préférences sont supprimés. S'il était le dernier membre de son foyer, les recettes partagées du foyer sont conservées dans le vôtre et le reste du foyer est supprimé. Cette action est irréversible.</p>
        </Sheet>
      )}
      {naming && <NameSheet naming={naming} onClose={() => setNaming(null)} onSave={saveName} />}
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

function NameSheet({ naming, onClose, onSave }) {
  const [name, setName] = useState(naming.initial || '')
  const title = naming.kind === 'household' ? 'Nouveau foyer' : naming.kind === 'community' ? 'Nouvelle communauté' : 'Renommer la communauté'
  return (
    <Sheet title={title} onClose={onClose}
      footer={<button className="btn primary block" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Enregistrer</button>}>
      <Field label="Nom"><input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)}
        placeholder={naming.kind === 'household' ? 'ex. Famille Tremblay' : 'ex. Amis du chalet'} /></Field>
      {naming.user && <p className="muted small">{naming.user.display_name} sera placé(e) dans ce foyer.</p>}
    </Sheet>
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
