import { useEffect, useMemo, useState } from 'react'
import { supabase, ai, CATEGORIES, safeUrl, reviewStats, fmtNum, TAGS, TAG_GROUPS, canonTag, resizeImage, uploadFile } from '../lib'
import { FeedbackButton } from '../shared'
import { useApp } from '../App'
import { Icon, Sheet, Spinner, Empty, Header, Field, Segmented } from '../ui'
import { CookMode, Reviews, ScaledIngredients, Servings, StatsLine } from './Cook'
import { usePhoto, toneOf } from './Deck'

// Recettes + avis + préférences (favori / bloquée) de l'utilisateur
export function useRecipeData() {
  const { session } = useApp()
  const [recipes, setRecipes] = useState(null)
  const [reviews, setReviews] = useState([])
  const [prefs, setPrefs] = useState({})
  const load = async () => {
    const [{ data: r }, { data: rv }, { data: p }] = await Promise.all([
      supabase.from('recipes').select('*').order('created_at', { ascending: false }),
      supabase.from('recipe_reviews').select('*').order('updated_at', { ascending: false }),
      supabase.from('recipe_prefs').select('recipe_id,kind,user_id').eq('user_id', session.user.id),
    ])
    setRecipes(r || [])
    setReviews(rv || [])
    setPrefs(Object.fromEntries((p || []).map((x) => [x.recipe_id, x.kind])))
  }
  useEffect(() => { load() }, []) // eslint-disable-line
  const stats = useMemo(() => reviewStats(reviews), [reviews])
  const setPref = async (recipeId, kind) => {
    const next = prefs[recipeId] === kind ? null : kind
    setPrefs({ ...prefs, [recipeId]: next })
    if (next) await supabase.from('recipe_prefs').upsert({ user_id: session.user.id, recipe_id: recipeId, kind: next }, { onConflict: 'user_id,recipe_id' })
    else await supabase.from('recipe_prefs').delete().eq('user_id', session.user.id).eq('recipe_id', recipeId)
  }
  return { recipes, reviews, stats, prefs, setPref, reload: load }
}
export const useRecipes = useRecipeData

const SORTS = [['recent', 'Plus récentes'], ['note', 'Mieux notées'], ['temps', 'Plus rapides'], ['az', 'A à Z']]

export default function Recipes() {
  const { household } = useApp()
  const data = useRecipeData()
  const { recipes, stats, prefs } = data
  const [source, setSource] = useState('all')
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState({})
  const [sort, setSort] = useState('recent')
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(false)
  const [tag, setTag] = useState(null)
  const [tagging, setTagging] = useState(false)
  const { toast } = useApp()
  const toggle = (k) => setFilters({ ...filters, [k]: !filters[k] })

  const list = useMemo(() => {
    if (!recipes) return []
    const term = q.trim().toLowerCase()
    const time = (r) => stats.get(r.id)?.minutes || r.prep_minutes || 999
    const out = recipes
      .filter((r) => source === 'all' || (source === 'mine' ? r.household_id === household.id : r.household_id !== household.id))
      .filter((r) => (filters.blocked ? prefs[r.id] === 'bloquee' : prefs[r.id] !== 'bloquee'))
      .filter((r) => !filters.fav || prefs[r.id] === 'favori')
      .filter((r) => !filters.top || (stats.get(r.id)?.taste ?? 0) >= 4)
      .filter((r) => !filters.quick || time(r) <= 30)
      .filter((r) => !filters.review || r.needs_review)
      .filter((r) => !tag || (r.tags || []).includes(tag))
      .filter((r) => !term || r.title.toLowerCase().includes(term) || (r.tags || []).some((t) => t.toLowerCase().includes(term))
        || (r.ingredients || []).some((i) => i.name?.toLowerCase().includes(term)))
    if (sort === 'note') out.sort((a, b) => (stats.get(b.id)?.taste ?? -1) - (stats.get(a.id)?.taste ?? -1))
    if (sort === 'temps') out.sort((a, b) => time(a) - time(b))
    if (sort === 'az') out.sort((a, b) => a.title.localeCompare(b.title, 'fr'))
    return out
  }, [recipes, source, q, filters, sort, stats, prefs, household.id, tag])

  const toReview = (recipes || []).filter((r) => r.needs_review && r.household_id === household.id).length
  const untagged = (recipes || []).filter((r) => r.household_id === household.id && !(r.tags || []).some((t) => TAGS.includes(t))).length
  const usedTags = TAGS.filter((t) => (recipes || []).some((r) => (r.tags || []).includes(t)))
  const autoTag = async () => {
    setTagging(true)
    try {
      let left = untagged, done = 0
      for (let i = 0; i < 8 && left > 0; i++) { const res = await ai('tag_recipes'); done += res.tagged; left = res.remaining; if (!res.tagged) break }
      toast(`${done} recette${done > 1 ? 's' : ''} étiquetée${done > 1 ? 's' : ''}`); data.reload()
    } catch (e) { toast(e.message) } finally { setTagging(false) }
  }

  return (
    <>
      <Header title="Recettes" sub={recipes ? `${recipes.filter((r) => r.household_id === household.id).length} dans votre archive · ${recipes.filter((r) => r.household_id !== household.id).length} de la communauté` : ''}
        action={<div className="head-actions"><FeedbackButton screen="Recettes" /><button className="btn primary sm" onClick={() => setAdding(true)}><Icon name="plus" size={18} /> Ajouter</button></div>} />
      <Segmented value={source} onChange={setSource} options={[['all', 'Toutes'], ['mine', 'Mon foyer'], ['friends', 'Communauté']]} />
      <div className="search">
        <Icon name="search" size={18} />
        <input placeholder="Titre, ingrédient, mot-clé…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="filter-row">
        <div className="chips scroll">
          <button className={`chip ${filters.fav ? 'on' : ''}`} onClick={() => toggle('fav')}>♥ Favoris</button>
          <button className={`chip ${filters.top ? 'on' : ''}`} onClick={() => toggle('top')}>★ 4 et +</button>
          <button className={`chip ${filters.quick ? 'on' : ''}`} onClick={() => toggle('quick')}>≤ 30 min</button>
          {toReview > 0 && <button className={`chip ${filters.review ? 'on' : ''}`} onClick={() => toggle('review')}>À vérifier ({toReview})</button>}
          <button className={`chip ${filters.blocked ? 'on' : ''}`} onClick={() => toggle('blocked')}>⊘ Bloquées</button>
        </div>
        <select className="mini sort" value={tag || ''} onChange={(e) => setTag(e.target.value || null)} aria-label="Étiquette">
          <option value="">Étiquette</option>{usedTags.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="mini sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Trier">
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {untagged > 0 && (
        <div className="note tagnote">{untagged} recette{untagged > 1 ? 's' : ''} sans étiquette (Soupe, Rapide, Végé…).
          <button className="btn sm" disabled={tagging} onClick={autoTag}>{tagging ? 'Étiquetage…' : 'Étiqueter avec Claude'}</button></div>
      )}
      {!recipes ? <Spinner /> : list.length === 0 ? (
        recipes.length === 0
          ? <Empty icon="book" title="Votre archive est vide">
              <p>Ajoutez vos recettes préférées : liens web, PDF ou photos (plusieurs à la fois). L'IA s'en servira pour planifier vos semaines.</p>
              <button className="btn primary" onClick={() => setAdding(true)}>Ajouter des recettes</button>
            </Empty>
          : <Empty icon="search" title="Aucune recette ne correspond"><p>Retirez un filtre ou changez la recherche.</p></Empty>
      ) : (
        <ul className="list">
          {list.map((r) => (
            <li key={r.id} className="card recipe-row" onClick={() => setOpen(r)}>
              <Thumb r={r} />
              <div className="grow">
                <h3>{prefs[r.id] === 'favori' && <span className="fav">♥ </span>}{r.title}</h3>
                <div className="meta">
                  <StatsLine s={stats.get(r.id)} prep={r.prep_minutes} />
                  {r.household_id !== household.id && r.author_name && <span>par {r.author_name}</span>}
                  {r.household_id === household.id && r.shared && <span className="pill green">Partagée</span>}
                  {r.needs_review && r.household_id === household.id && <span className="pill orange">À vérifier</span>}
                  {prefs[r.id] === 'bloquee' && <span className="pill red">Bloquée</span>}
                </div>
                {r.tags?.length > 0 && <div className="tags">{r.tags.slice(0, 4).map((t) => <span key={t} className={`tag ${t === tag ? 'on' : ''}`}>{t}</span>)}</div>}
              </div>
              <Icon name="next" size={18} className="chev" />
            </li>
          ))}
        </ul>
      )}
      {open && <RecipeDetail recipe={open} data={data} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); data.reload() }} />}
      {adding && <AddRecipe onClose={() => { setAdding(false); data.reload() }} onSaved={() => { setAdding(false); data.reload() }} />}
    </>
  )
}

function Thumb({ r }) {
  const url = usePhoto(r.photo_path)
  return url ? <img className="thumb" src={url} alt="" /> : <div className={`thumb tone-${toneOf(r)}`}>{r.title.trim()[0]}</div>
}

function DetailPhoto({ r, mine, onPhoto }) {
  const url = usePhoto(r.photo_path)
  const [busy, setBusy] = useState(false)
  const pick = async (f) => { if (!f) return; setBusy(true); try { await onPhoto(f) } finally { setBusy(false) } }
  if (url) return (
    <div className="detail-photo"><img src={url} alt={r.title} />
      {mine && <label className="btn sm photo-change"><Icon name="camera" size={16} />{busy ? '…' : 'Changer'}<input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files[0])} /></label>}
    </div>
  )
  return mine && r.id ? (
    <label className="photo-add"><Icon name="camera" size={18} /> {busy ? 'Envoi…' : 'Ajouter une photo du plat'}<input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files[0])} /></label>
  ) : null
}

export function RecipeDetail({ recipe, data, onClose: close, onChanged, unsaved, servings: plannedServings, onServings }) {
  const { household, profile, toast } = useApp()
  const [r, setR] = useState(recipe)
  // Une modification (« C'est correct », photo, partage…) rafraîchit la liste à la fermeture
  const [dirty, setDirty] = useState(false)
  const onClose = () => { if (dirty) data?.reload?.(); close() }
  const [editing, setEditing] = useState(false)
  const [cooking, setCooking] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const base = r.servings || plannedServings || household.settings.servings || 4
  const [servings, setServingsState] = useState(plannedServings || base)
  const setServings = (s) => { setServingsState(s); onServings?.(s) }
  const mine = r.household_id === household.id
  const pref = data?.prefs?.[r.id]
  const reviews = (data?.reviews || []).filter((x) => x.recipe_id === r.id)
  const s = data?.stats?.get(r.id)

  const update = async (patch) => {
    setR({ ...r, ...patch })
    const { error } = await supabase.from('recipes').update(patch).eq('id', r.id)
    if (error) toast('Erreur : ' + error.message)
    else setDirty(true)
  }
  const remove = async () => {
    if (!confirm(`Supprimer « ${r.title} »?`)) return
    await supabase.from('recipes').delete().eq('id', r.id)
    const files = [r.file_path, r.photo_path].filter(Boolean)
    if (files.length) await supabase.storage.from('recipe-files').remove([...new Set(files)])
    toast('Recette supprimée'); onChanged()
  }
  const copy = async () => {
    const { id: _i, household_id: _h, created_by: _c, created_at: _d, shared: _s, file_path: _f, photo_path: _p, rating: _r, needs_review: _n, ...rest } = r
    const { error } = await supabase.from('recipes').insert({ ...rest, copied_from: r.id, author_name: profile.display_name, shared: false })
    if (error) return toast('Erreur : ' + error.message)
    toast('Ajoutée à vos recettes'); onChanged()
  }
  const setPhoto = async (file) => {
    try {
      const path = await uploadFile(await resizeImage(file, 1200, 0.8), household.id)
      const old = r.photo_path
      await update({ photo_path: path })
      if (old && old !== r.file_path) await supabase.storage.from('recipe-files').remove([old])
      toast('Photo ajoutée')
    } catch (e) { toast('Erreur : ' + e.message) }
  }
  const openFile = async () => {
    const { data: d } = await supabase.storage.from('recipe-files').createSignedUrl(r.file_path, 3600)
    if (d?.signedUrl) window.open(d.signedUrl, '_blank', 'noopener')
  }

  if (editing) return <RecipeEditor initial={r} onClose={() => setEditing(false)} onSaved={onChanged} />
  if (cooking) return <CookMode recipe={r} servings={servings} onServings={setServings} onClose={() => setCooking(false)}
    onReview={!unsaved && r.id ? () => { setCooking(false); setReviewing(true) } : null} />

  return (
    <Sheet title={r.title} onClose={onClose}>
      <DetailPhoto r={r} mine={mine && !unsaved} onPhoto={setPhoto} />
      <div className="meta big">
        <StatsLine s={s} prep={r.prep_minutes} />
        {r.servings && <span>Recette pour {fmtNum(r.servings)}</span>}
        {!mine && r.author_name && <span>par {r.author_name}</span>}
      </div>
      {r.needs_review && mine && (
        <div className="note warn">Importée automatiquement : vérifiez les quantités.
          <div className="two"><button className="btn sm" onClick={() => setEditing(true)}>Corriger</button><button className="btn sm" onClick={() => { update({ needs_review: false }); toast('Recette vérifiée') }}>C'est correct</button></div>
        </div>
      )}
      {r.description && <p>{r.description}</p>}
      {r.health_notes && <p className="note health">{r.health_notes}</p>}

      {!unsaved && r.id && (
        <div className="pref-row">
          <button className={`btn sm ${pref === 'favori' ? 'on-fav' : ''}`} onClick={() => data.setPref(r.id, 'favori')}><Icon name="heart" size={16} fill={pref === 'favori' ? 'currentColor' : 'none'} /> {pref === 'favori' ? 'Favori' : 'Ajouter aux favoris'}</button>
          <button className={`btn sm ${pref === 'bloquee' ? 'on-block' : ''}`} onClick={() => { data.setPref(r.id, 'bloquee'); if (pref !== 'bloquee') toast('Cette recette ne sera plus proposée dans votre menu') }}>⊘ {pref === 'bloquee' ? 'Bloquée' : 'Ne plus proposer'}</button>
          {mine && (
            <label className="switch"><input type="checkbox" checked={r.shared} onChange={(e) => update({ shared: e.target.checked })} /><span>Partagée avec la communauté</span></label>
          )}
        </div>
      )}

      <div className="ing-head">
        <h3>Ingrédients</h3>
        <Servings value={servings} onChange={setServings} />
      </div>
      <ScaledIngredients ingredients={r.ingredients} factor={servings / base} onFactor={(f) => setServings(Math.round(base * f * 2) / 2 || 0.5)} />
      <p className="muted small">Touchez une quantité pour la modifier : toute la recette s'ajuste.</p>
      <button className="btn primary block" onClick={() => setCooking(true)}><Icon name="chef" size={18} /> Cuisiner (mode pas à pas)</button>
      <h3>Préparation</h3>
      <ol className="steps">{(r.steps || []).map((st, k) => <li key={k}>{st}</li>)}</ol>
      {r.tags?.length > 0 && <div className="tags">{r.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
      <div className="detail-links">
        {safeUrl(r.source_url) && <a className="btn sm" href={safeUrl(r.source_url)} target="_blank" rel="noopener noreferrer"><Icon name="link" size={16} /> Recette originale</a>}
        {r.file_path && mine && <button className="btn sm" onClick={openFile}><Icon name="file" size={16} /> Voir le fichier</button>}
      </div>

      {!unsaved && r.id && data && <Reviews key={reviewing ? 'open' : 'closed'} recipe={r} reviews={reviews} startOpen={reviewing} onChanged={() => { setReviewing(false); data.reload() }} />}

      <div className="detail-actions">
        {unsaved ? unsaved : mine ? (
          <>
            <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={18} /> Modifier</button>
            <button className="btn danger" onClick={remove}><Icon name="trash" size={18} /> Supprimer</button>
          </>
        ) : <button className="btn block" onClick={copy}><Icon name="copy" size={18} /> Copier dans mes recettes</button>}
      </div>
    </Sheet>
  )
}

const MAX_BATCH = 20

function AddRecipe({ onClose, onSaved }) {
  const { household, profile, toast } = useApp()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [draft, setDraft] = useState(null)
  const [manual, setManual] = useState(false)
  const [queue, setQueue] = useState(null)
  const link = safeUrl(input.trim()) && !/\s/.test(input.trim()) ? input.trim() : null

  const fromInput = async () => {
    setBusy(true); setErr(null)
    try {
      const res = link ? await ai('import_url', { url: link }) : await ai('import_text', { text: input })
      if (!res.recipe || res.recipe.error) throw new Error(res.recipe?.error || 'Aucune recette trouvée')
      setDraft({ ...res.recipe, ...(link ? { source_url: link } : {}) })
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  // Import en lot : chaque fichier est lu par l'IA puis enregistré « à vérifier »
  const fromFiles = async (fileList) => {
    const files = [...fileList].slice(0, MAX_BATCH)
    if (!files.length) return
    if (fileList.length > MAX_BATCH) toast(`Maximum ${MAX_BATCH} fichiers à la fois : les ${MAX_BATCH} premiers seront importés`)
    const q = files.map((f) => ({ name: f.name, status: 'attente' }))
    setQueue([...q])
    for (let k = 0; k < files.length; k++) {
      const file = files[k]
      const setStatus = (status, msg) => { q[k] = { ...q[k], status, msg }; setQueue([...q]) }
      setStatus('lecture')
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error('Plus de 10 Mo')
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
        const path = `${household.id}/${crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + k}.${ext}`
        const { error: upErr } = await supabase.storage.from('recipe-files').upload(path, file, { contentType: file.type })
        if (upErr) throw upErr
        const { recipe } = await ai('import_file', { path })
        if (!recipe || recipe.error) throw new Error(recipe?.error || 'Aucune recette trouvée')
        const { error } = await supabase.from('recipes').insert({ ...recipe, file_path: path, needs_review: true, author_name: profile.display_name })
        if (error) throw error
        setStatus('ok', recipe.title)
      } catch (e) {
        setStatus('erreur', e.message)
        if (/Limite quotidienne/.test(e.message)) { for (let j = k + 1; j < files.length; j++) q[j] = { ...q[j], status: 'erreur', msg: 'Limite du jour atteinte' }; setQueue([...q]); break }
      }
    }
  }
  const paste = async () => {
    try { setInput(await navigator.clipboard.readText()) } catch { toast('Collez avec un appui long dans le champ') }
  }

  if (draft || manual) {
    return <RecipeEditor initial={draft || { title: '', ingredients: [], steps: [], tags: [] }} onClose={onClose}
      onSaved={() => { toast('Recette ajoutée'); onSaved() }} />
  }

  if (queue) {
    const doneN = queue.filter((x) => x.status === 'ok').length
    const finished = queue.every((x) => x.status === 'ok' || x.status === 'erreur')
    return (
      <Sheet title={finished ? 'Import terminé' : `Import en cours… ${queue.filter((x) => x.status === 'ok' || x.status === 'erreur').length}/${queue.length}`} onClose={finished ? onSaved : () => {}}
        footer={finished && <button className="btn primary block" onClick={onSaved}>Voir mes recettes</button>}>
        <div className="progress"><div style={{ width: `${(queue.filter((x) => x.status === 'ok' || x.status === 'erreur').length / queue.length) * 100}%` }} /></div>
        <ul className="plain batch">
          {queue.map((x, k) => (
            <li key={k} className={x.status}>
              <span className="st">{x.status === 'ok' ? '✓' : x.status === 'erreur' ? '!' : x.status === 'lecture' ? <span className="spinner sm" /> : '·'}</span>
              <span className="grow"><b>{x.status === 'ok' ? x.msg : x.name}</b>{x.status === 'erreur' && <small>{x.msg}</small>}</span>
            </li>
          ))}
        </ul>
        {finished && <p className="muted small">{doneN} recette{doneN > 1 ? 's' : ''} ajoutée{doneN > 1 ? 's' : ''} avec l'étiquette « À vérifier ». Jetez-y un œil quand vous aurez un moment.</p>}
        {!finished && <p className="muted small">Gardez l'app ouverte pendant l'import.</p>}
      </Sheet>
    )
  }

  return (
    <Sheet title="Ajouter des recettes" onClose={onClose}>
      {busy ? <Spinner label="Lecture de la recette par l'IA…" /> : (
        <>
          <label className="dropzone big">
            <Icon name="file" size={26} />
            <span><b>PDF, captures ou photos</b><small>Sélectionnez-en plusieurs à la fois (jusqu'à {MAX_BATCH})</small></span>
            <input type="file" multiple accept="application/pdf,image/*" onChange={(e) => fromFiles(e.target.files)} />
          </label>
          <div className="or">ou</div>
          <Field label="Lien web ou texte d'une recette" hint="Ricardo, Trois fois par jour, un blogue… ou collez le texte complet.">
            <textarea rows={input.length > 80 ? 6 : 2} value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://… ou le texte de la recette" />
          </Field>
          <div className="two">
            <button className="btn" onClick={paste}><Icon name="paste" size={18} /> Coller</button>
            <button className="btn primary" disabled={!link && input.trim().length < 40} onClick={fromInput}><Icon name="spark" size={18} /> Importer</button>
          </div>
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
    tagSet: (initial.tags || []).map(canonTag).filter((t) => TAGS.includes(t)),
    tagsText: (initial.tags || []).map(canonTag).filter((t) => !TAGS.includes(t)).join(', '),
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
        name: i.name.trim(), quantity: i.quantity === '' || i.quantity == null ? null : (isNaN(+String(i.quantity).replace(',', '.')) ? i.quantity : +String(i.quantity).replace(',', '.')),
        unit: i.unit || null, category: i.category || 'Autre',
      })),
      steps: r.stepsText.split('\n').map((s) => s.trim()).filter(Boolean),
      tags: [...new Set([...r.tagSet, ...r.tagsText.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)])].slice(0, 15),
      health_notes: r.health_notes || null, source_url: safeUrl(r.source_url || '') || null, file_path: r.file_path || null,
      needs_review: false,
      ...(initial.id ? {} : { shared: r.shared !== false }),
    }
    const q = initial.id
      ? supabase.from('recipes').update(row).eq('id', initial.id).select().single()
      : supabase.from('recipes').insert({ ...row, author_name: profile.display_name }).select().single()
    const { data: saved, error } = await q
    setBusy(false)
    if (error) return toast('Erreur : ' + error.message)
    onSaved(saved)
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
            <input className="q" placeholder="Qté" inputMode="decimal" value={i.quantity ?? ''} onChange={(e) => setIng(k, 'quantity', e.target.value)} />
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
      <h3>Étiquettes</h3>
      {TAG_GROUPS.map(([g, list]) => (
        <div key={g} className="tag-group"><small>{g}</small>
          <div className="chips wrap">{list.map((t) => (
            <button key={t} type="button" className={`chip ${r.tagSet.includes(t) ? 'on' : ''}`}
              onClick={() => set('tagSet', r.tagSet.includes(t) ? r.tagSet.filter((x) => x !== t) : [...r.tagSet, t])}>{t}</button>
          ))}</div>
        </div>
      ))}
      <Field label="Autres mots-clés (séparés par des virgules)"><input value={r.tagsText} onChange={(e) => set('tagsText', e.target.value)} placeholder="poulet, mexicain" /></Field>
      {!initial.id && <label className="switch"><input type="checkbox" checked={r.shared !== false} onChange={(e) => set('shared', e.target.checked)} /><span>Partagée avec la communauté</span></label>}
      <Field label="Notes santé"><input value={r.health_notes || ''} onChange={(e) => set('health_notes', e.target.value)} /></Field>
      <Field label="Lien source"><input value={r.source_url || ''} onChange={(e) => set('source_url', e.target.value)} /></Field>
    </Sheet>
  )
}
