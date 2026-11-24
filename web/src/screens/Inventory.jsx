import { lazy, Suspense, useEffect, useState } from 'react'
import { supabase, LOCATIONS, CATEGORIES, today, daysBetween, parseQuick, guessCategory, parseTable, parseDate, parseQtyUnit, normLocation } from '../lib'
import { FeedbackButton } from '../shared'
import { useApp } from '../App'
import { Icon, Sheet, Spinner, Empty, Header, Field, Segmented } from '../ui'
// Chargés seulement au besoin (bibliothèques QR)
const Scanner = lazy(() => import('./Labels').then((m) => ({ default: m.Scanner })))
const LabelAction = lazy(() => import('./Labels').then((m) => ({ default: m.LabelAction })))
const PrintLabels = lazy(() => import('./Labels').then((m) => ({ default: m.PrintLabels })))

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
  const { toast, pendingLabel, setPendingLabel } = useApp()
  const [items, setItems] = useState(null)
  const [scan, setScan] = useState(null) // null | 'scan' | 'print' | { code } | { series }
  const [loc, setLoc] = useState('Congélateur')
  const [editing, setEditing] = useState(null)
  const [quick, setQuick] = useState('')
  const [pasting, setPasting] = useState(false)

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
  // Étiquette ouverte par lien (?e=CODE)
  useEffect(() => { if (pendingLabel) { setScan({ code: pendingLabel }); setPendingLabel(null) } }, [pendingLabel]) // eslint-disable-line

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
        action={<div className="head-actions"><FeedbackButton screen="Inventaire" /><button className="icon-btn" onClick={() => setScan('scan')} aria-label="Scanner une étiquette QR"><Icon name="qr" /></button><button className="icon-btn" onClick={() => setPasting(true)} aria-label="Importer depuis Excel"><Icon name="table" /></button><button className="icon-btn" onClick={() => setEditing({ location: loc, quantity: 1, added_on: today() })} aria-label="Ajout détaillé"><Icon name="edit" /></button></div>} />
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
                <div className="meta">{it.label_code && <span className="code-badge sm">{it.label_code}</span>}{it.category && <span>{it.category}</span>}{ageBadge(it)}</div>
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
      {pasting && <PasteImport defaultLocation={loc} onClose={() => setPasting(false)} onDone={(n) => { setPasting(false); load(); toast(`${n} article(s) importé(s)`) }} />}
      {editing && <ItemEditor item={editing} onClose={() => setEditing(null)} onSaved={(again) => { setEditing(null); load(); if (again) setScan({ series: true }) }} />}
      <Suspense fallback={<Spinner />}>
      {(scan === 'scan' || scan?.series) && <Scanner title={scan?.series ? 'Étiquette suivante' : undefined} onClose={() => setScan(null)}
        onPrint={() => setScan('print')} onCode={(code) => setScan({ code, series: scan?.series })} />}
      {scan === 'print' && <PrintLabels onClose={() => setScan(null)} />}
      {scan?.code && <LabelAction code={scan.code} onClose={() => setScan(null)}
        onNew={(code) => { setScan(null); setEditing({ label_code: code, location: 'Congélateur', quantity: 1, added_on: today(), _series: true }) }}
        onEdit={(it) => { setScan(null); setEditing(it) }} onDone={() => { setScan(null); load() }} />}
      </Suspense>
    </>
  )
}

export function ItemEditor({ item, onClose, onSaved }) {
  const { toast } = useApp()
  const [f, setF] = useState({ name: '', unit: '', category: '', best_before: '', notes: '', ...item })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = async (again) => {
    const row = {
      name: f.name.trim(), quantity: Number(f.quantity) || 0, unit: f.unit || null, location: f.location,
      category: f.category || null, added_on: f.added_on || today(), best_before: f.best_before || null, notes: f.notes || null,
      label_code: f.label_code || null,
    }
    const { error } = item.id
      ? await supabase.from('inventory_items').update(row).eq('id', item.id)
      : await supabase.from('inventory_items').insert(row)
    if (error) return toast(/inventory_label_unique|duplicate/.test(error.message) ? 'Cette étiquette est déjà utilisée' : 'Erreur : ' + error.message)
    toast(item.id ? 'Modifié' : 'Ajouté à l\'inventaire'); onSaved(again === true)
  }
  const remove = async () => {
    await supabase.from('inventory_items').delete().eq('id', item.id)
    toast('Retiré'); onSaved()
  }
  return (
    <Sheet title={item.id ? 'Modifier' : f.label_code ? 'Nouvelle étiquette' : 'Ajouter à l\'inventaire'} onClose={onClose}
      footer={<div className="two">
        {item.id && <button className="btn danger" onClick={remove}>Supprimer</button>}
        {item._series && <button className="btn" disabled={!f.name.trim()} onClick={() => save(true)}>Enregistrer + suivante</button>}
        <button className="btn primary" disabled={!f.name.trim()} onClick={() => save()}>Enregistrer</button>
      </div>}>
      {f.label_code && (
        <div className="label-line"><span className="code-badge">{f.label_code}</span>
          <span className="muted small">{item.id ? 'Étiquette QR liée' : 'Que contient ce sac ou ce plat?'}</span>
          {item.id && <button className="link" onClick={() => set('label_code', null)}>Détacher</button>}
        </div>
      )}
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

// ---------- Importer un tableau collé depuis Excel, Google Sheets ou les réponses d'un Google Form ----------
const FIELDS = [
  ['ignore', '— Ignorer —'], ['name', 'Aliment'], ['quantity', 'Quantité'], ['unit', 'Unité'], ['qty_unit', 'Quantité + unité (ex. 500 g)'],
  ['location', 'Emplacement'], ['category', 'Catégorie'], ['added_on', "Date d'entrée"], ['best_before', 'Meilleur avant'], ['notes', 'Notes'],
]
const TEMPLATE = "Aliment\tQuantité\tUnité\tEmplacement\tDate d'entrée\tMeilleur avant\tNotes"

function guessField(header, values) {
  const h = (header || '').toLowerCase()
  if (/horodat|timestamp|adresse e-mail|courriel|email/.test(h)) return 'ignore'
  if (/meilleur|expir|p[ée]remption|best|consommer/.test(h)) return 'best_before'
  if (/date|entr[ée]|congel[ée] le|achat/.test(h)) return 'added_on'
  if (/unit[ée]/.test(h)) return 'unit'
  if (/quantit|qt[ée]|qty|nombre|poids|gramme|kilo|\(g\)|\(kg\)/.test(h)) {
    return values.some((v) => /\d\s*[a-zA-Zé]/.test(v)) ? 'qty_unit' : 'quantity'
  }
  if (/emplacement|lieu|endroit|o[uù]|location|rangement/.test(h)) return 'location'
  if (/cat[ée]gor|type|rayon/.test(h)) return 'category'
  if (/note|comment|remarque/.test(h)) return 'notes'
  if (/aliment|item|produit|nom|article|description|quoi/.test(h)) return 'name'
  return null
}

function PasteImport({ defaultLocation, onClose, onDone }) {
  const { toast } = useApp()
  const [text, setText] = useState('')
  const [hasHeader, setHasHeader] = useState(true)
  const [map, setMap] = useState(null)
  const [location, setLocation] = useState(defaultLocation)
  const [busy, setBusy] = useState(false)
  const rows = parseTable(text)
  const width = Math.max(0, ...rows.map((r) => r.length))
  const header = hasHeader ? rows[0] || [] : []
  const body = hasHeader ? rows.slice(1) : rows

  // Correspondance automatique des colonnes, modifiable ensuite
  const auto = () => {
    const used = new Set()
    return Array.from({ length: width }, (_, c) => {
      const vals = body.slice(0, 20).map((r) => r[c] || '')
      let f = guessField(header[c], vals)
      if (!f) {
        if (vals.every((v) => !v || parseDate(v))) f = used.has('added_on') ? 'best_before' : 'added_on'
        else if (vals.every((v) => !v || /^\d+([.,]\d+)?$/.test(v))) f = 'quantity'
        else if (vals.some((v) => /^\d+([.,]\d+)?\s*[a-zA-Zé]/.test(v))) f = 'qty_unit'
        else f = used.has('name') ? 'notes' : 'name'
      }
      if (f !== 'ignore' && used.has(f)) f = 'ignore'
      used.add(f)
      return f
    })
  }
  const mapping = map && map.length === width ? map : auto()

  const items = body.map((r) => {
    const it = { location, added_on: today() }
    mapping.forEach((f, c) => {
      const v = (r[c] || '').trim()
      if (!v || f === 'ignore') return
      if (f === 'name') it.name = v.slice(0, 120)
      if (f === 'quantity') it.quantity = Number(v.replace(',', '.')) || it.quantity
      if (f === 'unit') it.unit = v.slice(0, 40)
      if (f === 'qty_unit') { const q = parseQtyUnit(v); it.quantity = q.quantity ?? it.quantity; it.unit = q.unit?.slice(0, 40) ?? it.unit }
      if (f === 'location') it.location = normLocation(v, location)
      if (f === 'category') it.category = CATEGORIES.find((c) => c.toLowerCase().startsWith(v.toLowerCase().slice(0, 5))) || null
      if (f === 'added_on') it.added_on = parseDate(v) || it.added_on
      if (f === 'best_before') it.best_before = parseDate(v)
      if (f === 'notes') it.notes = v.slice(0, 500)
    })
    if (it.quantity === undefined || it.quantity === null) it.quantity = 1
    if (!it.category && it.name) it.category = guessCategory(it.name)
    return it
  }).filter((it) => it.name)

  const doImport = async () => {
    setBusy(true)
    for (let i = 0; i < items.length; i += 200) {
      const { error } = await supabase.from('inventory_items').insert(items.slice(i, i + 200))
      if (error) { setBusy(false); return toast('Erreur : ' + error.message) }
    }
    onDone(items.length)
  }
  const copyTemplate = async () => { await navigator.clipboard.writeText(TEMPLATE); toast('En-tête copié : collez-le dans la 1re ligne de votre feuille') }

  return (
    <Sheet title="Importer depuis Excel ou Google" onClose={onClose}
      footer={items.length > 0 && <button className="btn primary block" disabled={busy} onClick={doImport}>{busy ? '…' : `Importer ${items.length} article${items.length > 1 ? 's' : ''}`}</button>}>
      <p className="muted small">Dans Excel, Google Sheets ou la feuille de réponses d'un Google Form : sélectionnez les lignes (avec la ligne de titres), copiez, puis collez ici.</p>
      <textarea className="paste" rows={5} value={text} onChange={(e) => { setText(e.target.value); setMap(null) }} placeholder={"Aliment\tQuantité\tDate\nPoulet\t2 kg\t2026-11-20"} />
      <div className="two">
        <label className="switch"><input type="checkbox" checked={hasHeader} onChange={(e) => { setHasHeader(e.target.checked); setMap(null) }} /><span>1re ligne = titres</span></label>
        <button className="btn sm" onClick={copyTemplate}><Icon name="copy" size={16} /> Copier un modèle</button>
      </div>
      {width > 0 && (
        <>
          <Field label="Emplacement si la colonne est absente">
            <select value={location} onChange={(e) => setLocation(e.target.value)}>{LOCATIONS.map((l) => <option key={l}>{l}</option>)}</select>
          </Field>
          <h3>Correspondance des colonnes</h3>
          <div className="map-list">
            {mapping.map((f, c) => (
              <label key={c}><span>{header[c] || `Colonne ${c + 1}`} <small className="muted">ex. {body[0]?.[c] || '—'}</small></span>
                <select value={f} onChange={(e) => { const m = [...mapping]; m[c] = e.target.value; setMap(m) }}>
                  {FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            ))}
          </div>
          <h3>Aperçu ({items.length})</h3>
          <div className="table-wrap">
            <table className="preview">
              <thead><tr><th>Aliment</th><th>Qté</th><th>Lieu</th><th>Entré</th><th>Avant</th></tr></thead>
              <tbody>{items.slice(0, 8).map((it, k) => (
                <tr key={k}><td>{it.name}</td><td>{it.quantity} {it.unit || ''}</td><td>{it.location.replace('Réfrigérateur', 'Frigo')}</td><td>{it.added_on}</td><td>{it.best_before || '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {items.length > 8 && <p className="muted small">… et {items.length - 8} autres</p>}
          {!mapping.includes('name') && <p className="note err">Choisissez la colonne « Aliment ».</p>}
        </>
      )}
    </Sheet>
  )
}
