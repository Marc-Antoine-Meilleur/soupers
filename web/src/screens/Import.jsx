// Import de recettes depuis des photos (une recette peut avoir plusieurs pages) et des PDF
import { useEffect, useRef, useState } from 'react'
import { supabase, ai, resizeImage, uploadFile } from '../lib'
import { useApp } from '../App'
import { Icon, Sheet, Spinner } from '../ui'

const MAX_PAGES = 20
const MAX_PER_RECIPE = 10
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
let seq = 0
const mkPage = (file) => ({ key: `p${++seq}`, file, url: URL.createObjectURL(file), path: null })

// Regroupe les pages selon les débuts de recette
export function toGroups(pages, starts) {
  const groups = []
  pages.forEach((p, i) => {
    if (i === 0 || starts.has(p.key)) groups.push({ pages: [] })
    groups[groups.length - 1].pages.push(p)
  })
  return groups
}

export default function ImportPages({ initialFiles, camera, onClose, onDone }) {
  const { household, profile, toast } = useApp()
  const [pages, setPages] = useState([])
  const [pdfs, setPdfs] = useState([])
  const [starts, setStarts] = useState(new Set())
  const [titles, setTitles] = useState({})
  const [grouping, setGrouping] = useState('idle') // idle | upload | running | done | error
  const [progress, setProgress] = useState(null)
  const [zoom, setZoom] = useState(null)
  const [newNext, setNewNext] = useState(false)
  const [queue, setQueue] = useState(null)
  const camRef = useRef(null)
  const pagesRef = useRef(pages)
  useEffect(() => { pagesRef.current = pages }, [pages])

  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), [])

  // Ajout de fichiers (sélection multiple) : photos triées par date de prise de vue
  const addFiles = (fileList, { auto = true } = {}) => {
    const files = [...fileList]
    const imgs = files.filter((f) => f.type.startsWith('image/')).sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name, 'fr', { numeric: true }))
    const docs = files.filter(isPdf)
    const room = MAX_PAGES - pages.length
    if (imgs.length > room) toast(`Maximum ${MAX_PAGES} pages à la fois : les ${room} premières sont gardées`)
    const added = imgs.slice(0, Math.max(0, room)).map(mkPage)
    const next = [...pages, ...added]
    setPages(next)
    if (docs.length) setPdfs([...pdfs, ...docs.slice(0, 10)])
    if (auto && added.length && next.length >= 2) autoGroup(next)
  }
  useEffect(() => { if (initialFiles?.length) addFiles(initialFiles) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (camera) setTimeout(() => camRef.current?.click(), 150) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Photo prise avec l'appareil : ajoutée à la recette en cours, ou commence la suivante
  const addPhoto = (file) => {
    if (!file) return
    if (pages.length >= MAX_PAGES) return toast(`Maximum ${MAX_PAGES} pages à la fois`)
    const p = mkPage(file)
    if (newNext && pages.length) setStarts(new Set(starts).add(p.key))
    setNewNext(false)
    setPages([...pages, p])
  }

  // Envoie les pages pas encore envoyées (réduites à ~2000 px)
  const uploadAll = async (list) => {
    const out = []
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      if (!p.path) {
        setProgress({ label: 'Envoi des pages', n: i + 1, total: list.length })
        p.path = await uploadFile(await resizeImage(p.file, 2000, 0.85), household.id)
      }
      out.push(p)
    }
    setProgress(null)
    return out
  }

  const autoGroup = async (list = pages) => {
    setGrouping('upload')
    try {
      const up = await uploadAll(list)
      setGrouping('running')
      const { groups } = await ai('group_pages', { paths: up.map((p) => p.path) })
      const s = new Set(), t = {}
      for (const g of groups || []) {
        const first = up[g.pages[0] - 1]
        if (!first) continue
        if (g.pages[0] > 1) s.add(first.key)
        if (g.title) t[first.key] = g.title
      }
      // Les pages « ignorées » restent seules dans leur groupe : l'utilisateur peut les retirer
      setStarts(s); setTitles(t); setGrouping('done')
    } catch (e) { setGrouping('error'); toast(e.message) }
  }

  const toggleSplit = (key) => { const s = new Set(starts); s.has(key) ? s.delete(key) : s.add(key); setStarts(s) }
  const removePage = (key) => {
    const i = pages.findIndex((p) => p.key === key)
    const p = pages[i]; URL.revokeObjectURL(p.url)
    if (p.path) supabase.storage.from('recipe-files').remove([p.path])
    const s = new Set(starts)
    if (s.has(key)) { s.delete(key); if (pages[i + 1] && i > 0) s.add(pages[i + 1].key) }
    setStarts(s); setPages(pages.filter((x) => x.key !== key)); setZoom(null)
  }
  const movePage = (key, dir) => {
    const i = pages.findIndex((p) => p.key === key), j = i + dir
    if (j < 0 || j >= pages.length) return
    const next = [...pages]; [next[i], next[j]] = [next[j], next[i]]
    const s = new Set(starts), a = s.has(pages[i].key), b = s.has(pages[j].key)
    s.delete(pages[i].key); s.delete(pages[j].key)
    if (a) s.add(next[i].key)
    if (b) s.add(next[j].key)
    setStarts(s); setPages(next)
  }

  const groups = toGroups(pages, starts)
  const tooLong = groups.some((g) => g.pages.length > MAX_PER_RECIPE)
  const busy = grouping === 'upload' || grouping === 'running'

  // Lecture des recettes, une à la fois
  const run = async () => {
    const tasks = [
      ...groups.map((g, k) => ({ kind: 'pages', g, name: titles[g.pages[0].key] || `Recette ${k + 1} (${g.pages.length} page${g.pages.length > 1 ? 's' : ''})` })),
      ...pdfs.map((f) => ({ kind: 'pdf', f, name: f.name })),
    ]
    const q = tasks.map((t) => ({ name: t.name, status: 'attente' }))
    setQueue([...q])
    const set = (k, status, msg) => { q[k] = { ...q[k], status, msg }; setQueue([...q]) }
    let up = null
    for (let k = 0; k < tasks.length; k++) {
      const t = tasks[k]
      set(k, 'lecture')
      try {
        if (t.kind === 'pages') {
          if (!up) up = await uploadAll(pages)
          const paths = t.g.pages.map((p) => p.path)
          const { recipe } = await ai('import_pages', { paths })
          if (!recipe || recipe.error) throw new Error(recipe?.error || 'Aucune recette trouvée')
          const { error } = await supabase.from('recipes').insert({ ...recipe, file_path: paths[0], file_paths: paths, needs_review: true, author_name: profile.display_name })
          if (error) throw error
          set(k, 'ok', recipe.title)
        } else {
          if (t.f.size > 10 * 1024 * 1024) throw new Error('Plus de 10 Mo')
          const path = await uploadFile(t.f, household.id)
          const { recipes } = await ai('import_file', { path })
          if (!recipes?.length) throw new Error('Aucune recette trouvée')
          for (const r of recipes) {
            const { error } = await supabase.from('recipes').insert({ ...r, file_path: path, file_paths: [path], needs_review: true, author_name: profile.display_name })
            if (error) throw error
          }
          set(k, 'ok', recipes.length > 1 ? `${recipes.length} recettes : ${recipes.map((r) => r.title).join(', ')}` : recipes[0].title)
        }
      } catch (e) {
        set(k, 'erreur', e.message)
        if (/Limite quotidienne/.test(e.message)) { for (let j = k + 1; j < tasks.length; j++) q[j] = { ...q[j], status: 'erreur', msg: 'Limite du jour atteinte' }; setQueue([...q]); break }
      }
    }
  }

  if (queue) {
    const finished = queue.every((x) => x.status === 'ok' || x.status === 'erreur')
    const doneN = queue.filter((x) => x.status === 'ok').length
    const n = queue.filter((x) => x.status === 'ok' || x.status === 'erreur').length
    return (
      <Sheet title={finished ? 'Import terminé' : `Lecture en cours… ${n}/${queue.length}`} onClose={finished ? onDone : () => {}}
        footer={finished && <button className="btn primary block" onClick={onDone}>Voir mes recettes</button>}>
        <div className="progress"><div style={{ width: `${(n / queue.length) * 100}%` }} /></div>
        <ul className="plain batch">
          {queue.map((x, k) => (
            <li key={k} className={x.status}>
              <span className="st">{x.status === 'ok' ? '✓' : x.status === 'erreur' ? '!' : x.status === 'lecture' ? <span className="spinner sm" /> : '·'}</span>
              <span className="grow"><b>{x.status === 'ok' ? x.msg : x.name}</b>{x.status === 'erreur' && <small>{x.msg}</small>}</span>
            </li>
          ))}
        </ul>
        {finished && <p className="muted small">{doneN} élément{doneN > 1 ? 's' : ''} importé{doneN > 1 ? 's' : ''} avec l'étiquette « À vérifier ».</p>}
        {!finished && <p className="muted small">Gardez l'app ouverte pendant la lecture.</p>}
      </Sheet>
    )
  }

  const total = groups.length + pdfs.length
  return (
    <Sheet title="Importer des recettes" onClose={onClose} full
      footer={<button className="btn primary block" disabled={!total || busy || tooLong} onClick={run}>
        {busy ? 'Regroupement…' : `Importer ${groups.length ? `${groups.length} recette${groups.length > 1 ? 's' : ''}` : ''}${groups.length && pdfs.length ? ' + ' : ''}${pdfs.length ? `${pdfs.length} PDF` : ''}`}</button>}>
      <div className="imp-actions">
        <label className="btn"><Icon name="camera" size={18} /> Photographier
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addPhoto(e.target.files[0]); e.target.value = '' }} />
        </label>
        <label className="btn"><Icon name="file" size={18} /> Choisir des fichiers
          <input type="file" multiple accept="image/*,application/pdf" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        </label>
      </div>
      {pages.length > 0 && (
        <div className="imp-next">
          <span className="muted small">Prochaine photo :</span>
          <button className={`chip ${!newNext ? 'on' : ''}`} onClick={() => setNewNext(false)}>Page suivante</button>
          <button className={`chip ${newNext ? 'on' : ''}`} onClick={() => setNewNext(true)}>Nouvelle recette</button>
        </div>
      )}

      {progress && <p className="muted small">{progress.label} {progress.n}/{progress.total}…</p>}
      {grouping === 'running' && <Spinner label="Regroupement des pages en recettes…" />}

      {pages.length === 0 && pdfs.length === 0 && (
        <div className="imp-help">
          <p><b>Une recette sur plusieurs pages?</b> Choisissez toutes les photos d'un coup (jusqu'à {MAX_PAGES}) : l'app les regroupe en recettes, puis vous vérifiez.</p>
          <p className="muted small">Avec l'appareil photo : prenez les pages une à une, et touchez « Nouvelle recette » avant la première page de la recette suivante.</p>
        </div>
      )}

      {pages.length > 0 && grouping !== 'running' && (
        <>
          <div className="spread imp-head">
            <h3>{groups.length} recette{groups.length > 1 ? 's' : ''} · {pages.length} page{pages.length > 1 ? 's' : ''}</h3>
            {pages.length >= 2 && <button className="link" disabled={busy} onClick={() => autoGroup()}>Regrouper automatiquement</button>}
          </div>
          <p className="muted small">Touchez ✂ entre deux pages pour séparer deux recettes, ou « Joindre » pour les réunir. Touchez une page pour l'agrandir, la déplacer ou la retirer.</p>
          {groups.map((g, k) => (
            <div key={g.pages[0].key} className="imp-group">
              <div className="spread">
                <b>{titles[g.pages[0].key] || `Recette ${k + 1}`}</b>
                {k > 0 && <button className="link" onClick={() => toggleSplit(g.pages[0].key)}>Joindre à la précédente</button>}
              </div>
              <div className="imp-pages">
                {g.pages.map((p, i) => (
                  <div key={p.key} className="imp-cell">
                    {i > 0 && <button className="imp-cut" onClick={() => toggleSplit(p.key)} aria-label="Séparer ici">✂</button>}
                    <button className="imp-thumb" onClick={() => setZoom(p.key)}><img src={p.url} alt={`Page ${pages.indexOf(p) + 1}`} /><span>{pages.indexOf(p) + 1}</span></button>
                  </div>
                ))}
              </div>
              {g.pages.length > MAX_PER_RECIPE && <p className="note err">Maximum {MAX_PER_RECIPE} pages par recette : séparez-la.</p>}
            </div>
          ))}
        </>
      )}

      {pdfs.length > 0 && (
        <div className="imp-group">
          <b>PDF</b>
          <ul className="plain">{pdfs.map((f, k) => (
            <li key={k} className="spread"><span><Icon name="file" size={16} /> {f.name}</span>
              <button className="icon-btn" onClick={() => setPdfs(pdfs.filter((_, j) => j !== k))} aria-label="Retirer"><Icon name="close" size={16} /></button></li>
          ))}</ul>
          <p className="muted small">Toutes les recettes de chaque PDF seront importées, même si elles s'étendent sur plusieurs pages.</p>
        </div>
      )}

      {zoom && (() => {
        const p = pages.find((x) => x.key === zoom)
        const i = pages.indexOf(p)
        return (
          <Sheet title={`Page ${i + 1}`} onClose={() => setZoom(null)}
            footer={<div className="imp-zoom-actions">
              <button className="btn" disabled={i === 0} onClick={() => movePage(zoom, -1)}><Icon name="back" size={18} /> Avant</button>
              <button className="btn danger" onClick={() => removePage(zoom)}><Icon name="trash" size={18} /> Retirer</button>
              <button className="btn" disabled={i === pages.length - 1} onClick={() => movePage(zoom, 1)}>Après <Icon name="next" size={18} /></button>
            </div>}>
            <img className="imp-big" src={p.url} alt="" />
          </Sheet>
        )
      })()}
    </Sheet>
  )
}

// Pages originales d'une recette (photos), dans l'ordre
export function OriginalPages({ paths, onClose }) {
  const [urls, setUrls] = useState(null)
  useEffect(() => {
    supabase.storage.from('recipe-files').createSignedUrls
      ? supabase.storage.from('recipe-files').createSignedUrls(paths, 3600).then(({ data }) => setUrls((data || []).map((d) => d.signedUrl)))
      : Promise.all(paths.map((p) => supabase.storage.from('recipe-files').createSignedUrl(p, 3600))).then((r) => setUrls(r.map((x) => x.data?.signedUrl)))
  }, [paths])
  return (
    <Sheet title="Recette originale" onClose={onClose} full>
      {!urls ? <Spinner /> : urls.map((u, k) => (
        <figure key={k} className="orig-page"><figcaption className="muted small">Page {k + 1} / {urls.length}</figcaption>
          {u && u !== '#' ? (/\.pdf(\?|$)/i.test(paths[k]) ? <a className="btn" href={u} target="_blank" rel="noopener noreferrer"><Icon name="file" size={16} /> Ouvrir le PDF</a> : <img src={u} alt={`Page ${k + 1}`} />) : <p className="muted">Fichier introuvable</p>}
        </figure>
      ))}
    </Sheet>
  )
}
