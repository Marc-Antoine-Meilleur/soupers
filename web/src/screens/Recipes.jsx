import { useEffect, useMemo, useState } from 'react'
import { supabase, ai, CATEGORIES, safeUrl } from '../lib'
import { FeedbackButton } from '../shared'
import { useApp } from '../App'
import { Icon, Sheet, Spinner, Empty, Header, Field, Segmented } from '../ui'

export function useRecipes() {
  const [recipes, setRecipes] = useState(null)
  const load = async () => {
    const { data } = await supabase.from('recipes').select('*').order('created_at', { ascending: false })
    setRecipes(data || [])
  }
  useEffect(() => { load() }, [])
  return [recipes, load]
}

const fmtQty = (i) => [i.quantity, i.unit].filter((x) => x !== null && x !== undefined && x !== '').join(' ')

export default function Recipes() {
  const { household } = useApp()
  const [recipes, reload] = useRecipes()
  const [view, setView] = useState('mine')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(false)

  const list = useMemo(() => {
    if (!recipes) return []
    const term = q.trim().toLowerCase()
    return recipes
      .filter((r) => (view === 'mine' ? r.household_id === household.id : r.household_id !== household.id))
      .filter((r) => !term || r.title.toLowerCase().includes(term) || (r.tags || []).some((t) => t.toLowerCase().includes(term))
        || (r.ingredients || []).some((i) => i.name?.toLowerCase().includes(term)))
  }, [recipes, view, q, household.id])

  return (
    <>
      <Header title="Recettes" sub={recipes ? `${recipes.filter((r) => r.household_id === household.id).length} dans votre archive` : ''}
        action={<div className="head-actions"><FeedbackButton screen="Recettes" /><button className="btn primary sm" onClick={() => setAdding(true)}><Icon name="plus" size={18} /> Ajouter</button></div>} />
      <Segmented value={view} onChange={setView} options={[['mine', 'Mes recettes'], ['friends', 'Partagées par les amis']]} />
      <div className="search">
        <Icon name="search" size={18} />
        <input placeholder="Chercher un titre, un ingrédient, un mot-clé…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!recipes ? <Spinner /> : list.length === 0 ? (
        view === 'mine'
          ? <Empty icon="book" title="Votre archive est vide">
              <p>Ajoutez vos recettes préférées à partir d'un lien web, d'un PDF ou d'une photo. L'IA s'en servira pour planifier vos semaines.</p>
              <button className="btn primary" onClick={() => setAdding(true)}>Ajouter une recette</button>
            </Empty>
          : <Empty icon="users" title="Rien de partagé pour l'instant"><p>Quand vos amis partageront des recettes, elles apparaîtront ici.</p></Empty>
      ) : (
        <ul className="list">
          {list.map((r) => (
            <li key={r.id} className="card recipe-row" onClick={() => setOpen(r)}>
              <div className="grow">
                <h3>{r.title}</h3>
                <div className="meta">
                  {r.prep_minutes && <span><Icon name="clock" size={14} /> {r.prep_minutes} min</span>}
                  {r.rating && <span>{'★'.repeat(r.rating)}</span>}
                  {view === 'friends' && r.author_name && <span>par {r.author_name}</span>}
                  {view === 'mine' && r.shared && <span className="pill green">Partagée</span>}
                </div>
                {r.tags?.length > 0 && <div className="tags">{r.tags.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}</div>}
              </div>
              <Icon name="next" size={18} className="chev" />
            </li>
          ))}
        </ul>
      )}
      {open && <RecipeDetail recipe={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload() }} />}
      {adding && <AddRecipe onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload() }} />}
    </>
  )
}

export function RecipeDetail({ recipe, onClose, onChanged, unsaved }) {
  const { household, profile, toast } = useApp()
  const [r, setR] = useState(recipe)
  const [editing, setEditing] = useState(false)
  const mine = r.household_id === household.id

  const update = async (patch) => {
    setR({ ...r, ...patch })
    const { error } = await supabase.from('recipes').update(patch).eq('id', r.id)
    if (error) toast('Erreur : ' + error.message)
  }
  const remove = async () => {
    if (!confirm(`Supprimer « ${r.title} »?`)) return
    await supabase.from('recipes').delete().eq('id', r.id)
    if (r.file_path) await supabase.storage.from('recipe-files').remove([r.file_path])
    toast('Recette supprimée'); onChanged()
  }
  const copy = async () => {
    const { id: _i, household_id: _h, created_by: _c, created_at: _d, shared: _s, file_path: _f, ...rest } = r
    const { error } = await supabase.from('recipes').insert({ ...rest, copied_from: r.id, author_name: profile.display_name, shared: false })
    if (error) return toast('Erreur : ' + error.message)
    toast('Ajoutée à vos recettes'); onChanged()
  }
  const openFile = async () => {
    const { data } = await supabase.storage.from('recipe-files').createSignedUrl(r.file_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (editing) return <RecipeEditor initial={r} onClose={() => setEditing(false)} onSaved={onChanged} />

  return (
    <Sheet title={r.title} onClose={onClose}>
      <div className="meta big">
        {r.prep_minutes && <span><Icon name="clock" size={16} /> {r.prep_minutes} min</span>}
        {r.servings && <span>{r.servings} portions</span>}
        {!mine && r.author_name && <span>par {r.author_name}</span>}
      </div>
      {r.description && <p>{r.description}</p>}
      {r.health_notes && <p className="note health">{r.health_notes}</p>}
      {mine && !unsaved && (
        <div className="row-actions">
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => update({ rating: n })} aria-label={`${n} étoiles`}>
                <Icon name="star" size={24} fill={n <= (r.rating || 0) ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
          <label className="switch">
            <input type="checkbox" checked={r.shared} onChange={(e) => update({ shared: e.target.checked })} />
            <span>Partager avec les amis</span>
          </label>
        </div>
      )}
      <h3>Ingrédients</h3>
      <ul className="ingredients">
        {(r.ingredients || []).map((i, k) => <li key={k}><b>{fmtQty(i)}</b> {i.name}</li>)}
      </ul>
      <h3>Préparation</h3>
      <ol className="steps">{(r.steps || []).map((s, k) => <li key={k}>{s}</li>)}</ol>
      {r.tags?.length > 0 && <div className="tags">{r.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
      <div className="detail-links">
        {safeUrl(r.source_url) && <a className="btn sm" href={safeUrl(r.source_url)} target="_blank" rel="noopener noreferrer"><Icon name="link" size={16} /> Recette originale</a>}
        {r.file_path && mine && <button className="btn sm" onClick={openFile}><Icon name="file" size={16} /> Voir le fichier</button>}
      </div>
      <div className="detail-actions">
        {unsaved ? unsaved : mine ? (
          <>
            <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={18} /> Modifier</button>
            <button className="btn danger" onClick={remove}><Icon name="trash" size={18} /> Supprimer</button>
          </>
        ) : <button className="btn primary block" onClick={copy}><Icon name="copy" size={18} /> Copier dans mes recettes</button>}
      </div>
    </Sheet>
  )
}

function AddRecipe({ onClose, onSaved }) {
  const { household, toast } = useApp()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [draft, setDraft] = useState(null)
  const [manual, setManual] = useState(false)
  const link = safeUrl(input.trim()) && !/\s/.test(input.trim()) ? input.trim() : null

  const run = async (fn) => {
    setBusy(true); setErr(null)
    try {
      const { recipe, extra = {} } = await fn()
      if (!recipe || recipe.error) throw new Error(recipe?.error || 'Aucune recette trouvée')
      setDraft({ ...recipe, ...extra })
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const fromInput = () => run(async () => link
    ? { ...(await ai('import_url', { url: link })), extra: { source_url: link } }
    : await ai('import_text', { text: input }))
  const fromFile = (file) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) return setErr('Fichier trop volumineux (10 Mo max).')
    run(async () => {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
      const path = `${household.id}/${crypto.randomUUID ? crypto.randomUUID() : Date.now()}.${ext}`
      const { error } = await supabase.storage.from('recipe-files').upload(path, file, { contentType: file.type })
      if (error) throw error
      return { ...(await ai('import_file', { path })), extra: { file_path: path } }
    })
  }
  const paste = async () => {
    try { setInput(await navigator.clipboard.readText()) } catch { toast('Collez avec un appui long dans le champ') }
  }

  if (draft || manual) {
    return <RecipeEditor initial={draft || { title: '', ingredients: [], steps: [], tags: [] }} onClose={onClose}
      onSaved={() => { toast('Recette ajoutée'); onSaved() }} />
  }

  return (
    <Sheet title="Ajouter une recette" onClose={onClose}>
      {busy ? <Spinner label="Lecture de la recette par l'IA…" /> : (
        <>
          <Field label="Lien web ou texte de la recette" hint="Ricardo, Trois fois par jour, un blogue… ou collez le texte complet.">
            <textarea rows={input.length > 80 ? 6 : 2} value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://… ou le texte de la recette" />
          </Field>
          <div className="two">
            <button className="btn" onClick={paste}><Icon name="paste" size={18} /> Coller</button>
            <button className="btn primary" disabled={!link && input.trim().length < 40} onClick={fromInput}><Icon name="spark" size={18} /> Importer</button>
          </div>
          <div className="or">ou</div>
          <label className="dropzone">
            <Icon name="file" /> PDF, capture d'écran ou photo
            <input type="file" accept="application/pdf,image/*" onChange={(e) => fromFile(e.target.files[0])} />
          </label>
          <button className="link center" onClick={() => setManual(true)}>Écrire la recette à la main</button>
          {err && <p className="note err">{err}</p>}
        </>
      )}
    </Sheet>
  )
}

export function RecipeEditor({ initial, onClose, onSaved }) {
  const { profile, toast } = useApp()
  const [r, setR] = useState({
    ...initial,
    ingredients: (initial.ingredients || []).map((i) => ({ ...i })),
    stepsText: (initial.steps || []).join('\n'),
    tagsText: (initial.tags || []).join(', '),
  })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setR((x) => ({ ...x, [k]: v }))
  const setIng = (k, field, v) => setR((x) => ({ ...x, ingredients: x.ingredients.map((i, j) => (j === k ? { ...i, [field]: v } : i)) }))

  const save = async () => {
    setBusy(true)
    const row = {
      title: r.title.trim(), description: r.description || null,
      servings: r.servings ? Number(r.servings) : null, prep_minutes: r.prep_minutes ? Number(r.prep_minutes) : null,
      ingredients: r.ingredients.filter((i) => i.name?.trim()).map((i) => ({
        name: i.name.trim(), quantity: i.quantity === '' || i.quantity == null ? null : (isNaN(+i.quantity) ? i.quantity : +i.quantity),
        unit: i.unit || null, category: i.category || 'Autre',
      })),
      steps: r.stepsText.split('\n').map((s) => s.trim()).filter(Boolean),
      tags: r.tagsText.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      health_notes: r.health_notes || null, source_url: safeUrl(r.source_url || '') || null, file_path: r.file_path || null,
    }
    const q = initial.id
      ? supabase.from('recipes').update(row).eq('id', initial.id)
      : supabase.from('recipes').insert({ ...row, author_name: profile.display_name })
    const { error } = await q
    setBusy(false)
    if (error) return toast('Erreur : ' + error.message)
    onSaved()
  }

  return (
    <Sheet title={initial.id ? 'Modifier la recette' : 'Vérifier et enregistrer'} onClose={onClose}
      footer={<button className="btn primary block" disabled={!r.title?.trim() || busy} onClick={save}>{busy ? '…' : 'Enregistrer'}</button>}>
      <Field label="Titre"><input value={r.title || ''} onChange={(e) => set('title', e.target.value)} /></Field>
      <Field label="Description"><input value={r.description || ''} onChange={(e) => set('description', e.target.value)} /></Field>
      <div className="two">
        <Field label="Portions"><input type="number" inputMode="numeric" value={r.servings || ''} onChange={(e) => set('servings', e.target.value)} /></Field>
        <Field label="Temps total (min)"><input type="number" inputMode="numeric" value={r.prep_minutes || ''} onChange={(e) => set('prep_minutes', e.target.value)} /></Field>
      </div>
      <h3>Ingrédients</h3>
      <div className="ing-edit">
        {r.ingredients.map((i, k) => (
          <div key={k} className="ing-row">
            <input className="q" placeholder="Qté" value={i.quantity ?? ''} onChange={(e) => setIng(k, 'quantity', e.target.value)} />
            <input className="u" placeholder="Unité" value={i.unit ?? ''} onChange={(e) => setIng(k, 'unit', e.target.value)} />
            <input className="n" placeholder="Ingrédient" value={i.name ?? ''} onChange={(e) => setIng(k, 'name', e.target.value)} />
            <select className="c" value={i.category || 'Autre'} onChange={(e) => setIng(k, 'category', e.target.value)} aria-label="Rayon">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <button className="icon-btn" onClick={() => set('ingredients', r.ingredients.filter((_, j) => j !== k))} aria-label="Retirer"><Icon name="close" size={18} /></button>
          </div>
        ))}
        <button className="btn sm" onClick={() => set('ingredients', [...r.ingredients, { name: '', quantity: '', unit: '', category: 'Autre' }])}><Icon name="plus" size={16} /> Ingrédient</button>
      </div>
      <Field label="Étapes (une par ligne)"><textarea rows={7} value={r.stepsText} onChange={(e) => set('stepsText', e.target.value)} /></Field>
      <Field label="Mots-clés (séparés par des virgules)"><input value={r.tagsText} onChange={(e) => set('tagsText', e.target.value)} placeholder="poulet, rapide, mijoteuse" /></Field>
      <Field label="Notes santé"><input value={r.health_notes || ''} onChange={(e) => set('health_notes', e.target.value)} /></Field>
      <Field label="Lien source"><input value={r.source_url || ''} onChange={(e) => set('source_url', e.target.value)} /></Field>
    </Sheet>
  )
}
