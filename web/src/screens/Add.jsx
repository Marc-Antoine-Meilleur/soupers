// Ajout rapide d'une recette (lien, texte, photo, PDF) et idées de Claude
import { useState } from 'react'
import { ai, safeUrl, importAndSave, TAGS } from '../lib'
import { useApp } from '../App'
import { Icon, Spinner, Segmented } from '../ui'

// Coller un lien ou prendre une photo : la recette est lue par l'IA puis rangée dans l'archive
export function QuickAdd({ onSaved, compact }) {
  const { household, profile, toast } = useApp()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const link = safeUrl(input.trim()) && !/\s/.test(input.trim()) ? input.trim() : null

  const run = async (src) => {
    setBusy(true); setErr(null)
    try {
      const r = await importAndSave(src, { householdId: household.id, author: profile.display_name })
      setInput(''); toast(`« ${r.title} » ajoutée à vos recettes`)
      await onSaved(r)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const paste = async () => {
    try { const t = await navigator.clipboard.readText(); setInput(t); if (safeUrl(t.trim())) run({ link: t.trim() }) } catch { toast('Collez avec un appui long dans le champ') }
  }

  if (busy) return <Spinner label="Lecture de la recette…" />
  return (
    <div className={`quickadd ${compact ? 'compact' : ''}`}>
      <div className="qa-row">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Coller un lien de recette" inputMode="url" enterKeyHint="go"
          onKeyDown={(e) => { if (e.key === 'Enter' && (link || input.trim().length > 40)) run(link ? { link } : { text: input }) }} />
        {input.trim()
          ? <button className="btn primary sm" disabled={!link && input.trim().length < 40} onClick={() => run(link ? { link } : { text: input })}>Ajouter</button>
          : <button className="btn sm" onClick={paste} aria-label="Coller"><Icon name="paste" size={18} /></button>}
        <label className="btn sm" aria-label="Photo ou PDF"><Icon name="camera" size={18} />
          <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => e.target.files[0] && run({ file: e.target.files[0] })} />
        </label>
      </div>
      {err && <p className="note err">{err}</p>}
    </div>
  )
}

// Idées de recettes : nouvelles ou trouvées sur le web
export function FindIdeas({ onResults, initial = '', tags = [] }) {
  const [q, setQ] = useState(initial)
  const [mode, setMode] = useState('both')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const query = [q.trim(), ...tags.filter((t) => TAGS.includes(t))].filter(Boolean).join(', ')

  const ask = async () => {
    setBusy(true); setErr(null)
    try {
      const { recipes } = await ai('suggest', { query, mode: mode === 'invent' ? 'invent' : 'web' })
      if (!recipes?.length) throw new Error('Aucune idée trouvée, essayez autrement.')
      onResults(recipes.map((r) => ({ ...r, _idea: true })))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const google = () => window.open(`https://www.google.com/search?q=${encodeURIComponent('recette ' + (query || 'souper'))}`, '_blank', 'noopener')

  if (busy) return <Spinner label={mode === 'invent' ? 'Préparation de 3 idées…' : 'Recherche en ligne… (jusqu’à 1 minute)'} />
  return (
    <div className="ask">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Une envie? ex. soupe réconfortante aux lentilles" enterKeyHint="search"
        onKeyDown={(e) => e.key === 'Enter' && query && ask()} />
      <Segmented value={mode} onChange={setMode} options={[['both', 'Recettes du web'], ['invent', 'Nouvelles idées']]} />
      <div className="two">
        <button className="btn primary" disabled={!query} onClick={ask}><Icon name="search" size={18} /> 3 idées</button>
        <button className="btn" onClick={google}><Icon name="globe" size={18} /> Google</button>
      </div>
      <p className="muted small">Google ouvre une recherche : copiez le lien d'une recette, puis collez-le ici.</p>
      {err && <p className="note err">{err}</p>}
    </div>
  )
}
