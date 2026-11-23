import { useEffect, useState } from 'react'
import { supabase, LOCATIONS, CATEGORIES, today, daysBetween, parseQuick, guessCategory } from '../lib'
import { FeedbackButton } from '../shared'
import { useApp } from '../App'
import { Icon, Sheet, Spinner, Empty, Header, Field, Segmented } from '../ui'

function ageBadge(item) {
  const t = today()
  if (item.best_before) {
    const left = daysBetween(t, item.best_before)
    if (left < 0) return <span className="pill red">Date dépassée</span>
    if (left <= 14) return <span className="pill orange">À utiliser d'ici {left} j</span>
  }
  if (item.location === 'Congélateur' && item.added_on) {
    const weeks = Math.floor(daysBetween(item.added_on, t) / 7)
    if (weeks >= 1) return <span className={`pill ${weeks >= 12 ? 'orange' : 'ice'}`}>Congelé depuis {weeks} sem.</span>
  }
  return null
}

export default function Inventory() {
  const { toast } = useApp()
  const [items, setItems] = useState(null)
  const [loc, setLoc] = useState('Congélateur')
  const [editing, setEditing] = useState(null)
  const [quick, setQuick] = useState('')

  // Ajout rapide : « 2 paquets porc haché » — plusieurs articles séparés par des retours de ligne ou des « ; »
  const quickAdd = async (e) => {
    e.preventDefault()
    const rows = quick.split(/\n|;/).map(parseQuick).filter(Boolean)
      .map((r) => ({ ...r, location: loc, category: guessCategory(r.name), added_on: today() }))
    if (!rows.length) return
    const { error } = await supabase.from('inventory_items').insert(rows)
    if (error) return toast('Erreur : ' + error.message)
    setQuick(''); load()
    toast(rows.length === 1 ? `${rows[0].name} ajouté` : `${rows.length} articles ajoutés`)
  }

  const load = async () => {
    const { data } = await supabase.from('inventory_items').select('*').order('name')
    setItems(data || [])
  }
  useEffect(() => { load() }, [])

  const adjust = async (it, delta) => {
    const quantity = Math.max(0, Math.round((Number(it.quantity) + delta) * 100) / 100)
    if (quantity === 0) {
      if (!confirm(`Plus de « ${it.name} »? L'article sera retiré.`)) return
      setItems(items.filter((x) => x.id !== it.id))
      await supabase.from('inventory_items').delete().eq('id', it.id)
      return toast(`${it.name} retiré`)
    }
    setItems(items.map((x) => (x.id === it.id ? { ...x, quantity } : x)))
    await supabase.from('inventory_items').update({ quantity }).eq('id', it.id)
  }

  const shown = (items || []).filter((i) => i.location === loc)
  const counts = Object.fromEntries(LOCATIONS.map((l) => [l, (items || []).filter((i) => i.location === l).length]))

  return (
    <>
      <Header title="Inventaire" sub="Ce que vous avez déjà à la maison"
        action={<div className="head-actions"><FeedbackButton screen="Inventaire" /><button className="btn sm" onClick={() => setEditing({ location: loc, quantity: 1, added_on: today() })}>Détaillé</button></div>} />
      <Segmented value={loc} onChange={setLoc} options={LOCATIONS.map((l) => [l, `${l.replace('Réfrigérateur', 'Frigo')}${counts[l] ? ` (${counts[l]})` : ''}`])} />
      <form className="quickbar" onSubmit={quickAdd}>
        <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder={`Ajout rapide : 2 paquets porc haché`} aria-label={`Ajouter au ${loc.toLowerCase()}`} enterKeyHint="done" />
        <button className="btn primary sm" disabled={!quick.trim()} aria-label="Ajouter"><Icon name="plus" size={18} /></button>
      </form>
      {!items ? <Spinner /> : shown.length === 0 ? (
        <Empty icon="snow" title={`Rien au ${loc.toLowerCase()}`}>
          <p>Tapez par exemple « 3 poitrines de poulet » dans la barre ci-dessus. Les plans de la semaine utiliseront ces aliments en priorité.</p>
        </Empty>
      ) : (
        <ul className="list">
          {shown.map((it) => (
            <li key={it.id} className="card inv-row">
              <div className="grow" onClick={() => setEditing(it)}>
                <h3>{it.name}</h3>
                <div className="meta">{it.category && <span>{it.category}</span>}{ageBadge(it)}</div>
                {it.notes && <p className="reason">{it.notes}</p>}
              </div>
              <div className="qty">
                <button className="icon-btn" onClick={() => adjust(it, -1)} aria-label="Moins"><Icon name="minus" size={18} /></button>
                <div><b>{Number(it.quantity)}</b><small>{it.unit}</small></div>
                <button className="icon-btn" onClick={() => adjust(it, 1)} aria-label="Plus"><Icon name="plus" size={18} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <ItemEditor item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </>
  )
}

function ItemEditor({ item, onClose, onSaved }) {
  const { toast } = useApp()
  const [f, setF] = useState({ name: '', unit: '', category: '', best_before: '', notes: '', ...item })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    const row = {
      name: f.name.trim(), quantity: Number(f.quantity) || 0, unit: f.unit || null, location: f.location,
      category: f.category || null, added_on: f.added_on || today(), best_before: f.best_before || null, notes: f.notes || null,
    }
    const { error } = item.id
      ? await supabase.from('inventory_items').update(row).eq('id', item.id)
      : await supabase.from('inventory_items').insert(row)
    if (error) return toast('Erreur : ' + error.message)
    toast(item.id ? 'Modifié' : 'Ajouté à l\'inventaire'); onSaved()
  }
  const remove = async () => {
    await supabase.from('inventory_items').delete().eq('id', item.id)
    toast('Retiré'); onSaved()
  }
  return (
    <Sheet title={item.id ? 'Modifier' : 'Ajouter à l\'inventaire'} onClose={onClose}
      footer={<div className="two">
        {item.id && <button className="btn danger" onClick={remove}>Supprimer</button>}
        <button className="btn primary" disabled={!f.name.trim()} onClick={save}>Enregistrer</button>
      </div>}>
      <Field label="Aliment"><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="ex. Cuisses de poulet" autoFocus={!item.id} /></Field>
      <div className="two">
        <Field label="Quantité"><input type="number" inputMode="decimal" step="any" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} /></Field>
        <Field label="Unité"><input value={f.unit || ''} onChange={(e) => set('unit', e.target.value)} placeholder="paquets, kg, sacs…" list="units" /></Field>
      </div>
      <datalist id="units">{['unités', 'paquets', 'sacs', 'kg', 'g', 'lb', 'contenants', 'portions'].map((u) => <option key={u} value={u} />)}</datalist>
      <Field label="Emplacement">
        <select value={f.location} onChange={(e) => set('location', e.target.value)}>{LOCATIONS.map((l) => <option key={l}>{l}</option>)}</select>
      </Field>
      <Field label="Catégorie">
        <select value={f.category || ''} onChange={(e) => set('category', e.target.value)}>
          <option value="">—</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Field>
      <div className="two">
        <Field label="Entré le"><input type="date" value={f.added_on || ''} onChange={(e) => set('added_on', e.target.value)} /></Field>
        <Field label="Meilleur avant"><input type="date" value={f.best_before || ''} onChange={(e) => set('best_before', e.target.value)} /></Field>
      </div>
      <Field label="Notes"><input value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} placeholder="ex. déjà mariné" /></Field>
    </Sheet>
  )
}
