import { useEffect, useRef, useState } from 'react'
import { supabase, ai, mondayOf, addDays, fmtDay, fmtLong, fromISO, today, newKey, saveRecipe } from '../lib'
import { CriteriaForm, FeedbackButton } from '../shared'
import { useApp } from '../App'
import { Icon, Sheet, Spinner, Header } from '../ui'
import { RecipeDetail, RecipeEditor, useRecipeData } from './Recipes'
import Deck from './Deck'
import { QuickAdd, AskClaude } from './Add'

export default function Week() {
  const { household, go, toast } = useApp()
  const s = household.settings
  const [week, setWeek] = useState(() => (new Date().getDay() === 0 ? addDays(mondayOf(), 7) : mondayOf()))
  const [plan, setPlan] = useState(undefined)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [saving, setSaving] = useState(null)
  const [criteria, setCriteria] = useState(false)
  const [deck, setDeck] = useState(null)
  const [aiFill, setAiFill] = useState(false)
  const data = useRecipeData()
  const { recipes } = data
  const reloadRecipes = data.reload
  const [history, setHistory] = useState(false)
  const planRef = useRef(null)
  useEffect(() => { planRef.current = plan }, [plan])

  const load = async () => {
    setPlan(undefined)
    const { data } = await supabase.from('meal_plans').select('*').eq('week_start', week).maybeSingle()
    setPlan(data ? { ...data, days: withKeys(data.days) } : null)
  }
  useEffect(() => { load() }, [week]) // eslint-disable-line
  // Historique conservé 12 mois : les plans plus anciens sont supprimés
  useEffect(() => { supabase.from('meal_plans').delete().lt('week_start', addDays(mondayOf(), -365)).then(() => {}) }, [])

  const planDays = (s.plan_days || []).slice().sort().map((i) => addDays(week, i))
  const entries = plan?.days || []
  const shownDays = [...new Set([...planDays, ...entries.map((e) => e.date)])].sort()
  const persist = async (patch, w = week) => {
    const row = { week_start: w, household_id: household.id, ...patch }
    const { data, error } = await supabase.from('meal_plans').upsert(row, { onConflict: 'household_id,week_start' }).select().single()
    if (error) throw error
    const next = { ...data, days: withKeys(data.days) }
    if (w === week) { setPlan(next); planRef.current = next }
    return next
  }
  const setEntries = (list) => persist({ days: list.sort((a, b) => a.date.localeCompare(b.date)), status: 'brouillon' })

  // Ajoute une recette (ou un souper libre) à une date; renvoie la clé de l'entrée pour pouvoir annuler
  const addEntry = async (date, e) => {
    const entry = { key: newKey(), date, recipe_id: null, new_recipe: null, minutes: null, reason: '', uses_inventory: [], ...e }
    const w = mondayOf(fromISO(date))
    if (w !== week) {
      const { data: other } = await supabase.from('meal_plans').select('days').eq('week_start', w).maybeSingle()
      await persist({ days: [...withKeys(other?.days), entry], status: 'brouillon' }, w)
    } else await setEntries([...(planRef.current?.days || []), entry])
    return entry.key
  }
  const addRecipe = (r, date, uses = []) => addEntry(date, { title: r.title, recipe_id: r.id, minutes: r.prep_minutes, uses_inventory: uses })
  const removeEntry = async (key) => {
    const cur = planRef.current?.days || []
    if (cur.some((e) => e.key === key)) await setEntries(cur.filter((e) => e.key !== key))
  }

  // L'IA complète seulement les soirs encore vides
  const generate = async () => {
    const empty = planDays.filter((d) => !entries.some((e) => e.date === d))
    if (!empty.length) return toast('Tous les jours ont déjà quelque chose au menu')
    setBusy('all'); setErr(null); setAiFill(false)
    try {
      const { plan: p } = await ai('plan_week', { dates: empty, note, locked: entries.map((d) => ({ date: d.date, souper: d.title })) })
      const added = (p.days || []).filter((d) => empty.includes(d.date)).map((d) => ({ ...d, key: newKey() }))
      await persist({ days: [...entries, ...added].sort((a, b) => a.date.localeCompare(b.date)), summary: p.summary || plan?.summary, status: 'brouillon' })
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }

  const approve = async () => {
    setBusy('approve'); setErr(null)
    try {
      const saved = await persist({ status: 'approuvé' })
      await ai('shopping_list', { plan_id: saved.id })
      await load()
      toast("Liste d'épicerie prête!")
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }

  // Retire de l'inventaire la quantité utilisée (ou l'article au complet s'il n'en reste plus)
  const takeOut = async (k) => {
    const t = plan.thaw[k]
    if (t.inventory_id) {
      const { data: it } = await supabase.from('inventory_items').select('*').eq('id', t.inventory_id).maybeSingle()
      if (it) {
        const left = Math.max(0, Number(it.quantity) - (Number(t.take) || Number(it.quantity)))
        if (left <= 0) await supabase.from('inventory_items').delete().eq('id', it.id)
        else await supabase.from('inventory_items').update({ quantity: left }).eq('id', it.id)
      }
    }
    await persist({ thaw: plan.thaw.map((x, j) => (j === k ? { ...x, done: true } : x)) })
    toast(`${t.name} : inventaire mis à jour`)
  }

  const openDay = (d) => {
    if (d.recipe_id) {
      const r = recipes?.find((x) => x.id === d.recipe_id)
      if (r) setViewing({ ...r, _day: d })
      else toast('Cette recette n\'est plus disponible')
    } else if (d.new_recipe) setViewing({ ...d.new_recipe, household_id: household.id, _new: d, _day: d })
  }
  // Portions d'un souper planifié (servent à la liste d'épicerie)
  const setDayServings = async (key, servings) => {
    if (!plan) return
    await persist({ days: plan.days.map((x) => (x.key === key ? { ...x, servings } : x)) })
    if (plan.status === 'approuvé') toast('Portions changées : recréez la liste d\'épicerie si besoin')
  }
  const maxMinutesFor = (d) => ([0, 6].includes(fromISO(d).getDay()) ? s.max_minutes_weekend : s.max_minutes_weekday)

  const isPast = addDays(week, 6) < today()
  const emptyCount = planDays.filter((d) => !entries.some((e) => e.date === d)).length

  return (
    <>
      <Header title="Ma semaine" sub={`Du ${fmtLong(week)} au ${fmtLong(addDays(week, 6))}`}
        action={<div className="head-actions"><FeedbackButton screen="Semaine" /><button className="icon-btn" onClick={() => setHistory(true)} aria-label="Historique"><Icon name="history" /></button><button className="icon-btn" onClick={() => setCriteria(true)} aria-label="Critères"><Icon name="gear" /></button></div>} />

      <div className="hero-actions">
        <button className="hero" onClick={() => setDeck({ mode: 'plan' })} disabled={isPast}>
          <Icon name="cards" size={26} /><b>Composer ma semaine</b><small>Glissez les idées</small>
        </button>
        <button className="hero dark" onClick={() => setDeck({ mode: 'tonight' })}>
          <Icon name="chef" size={26} /><b>Ce soir, on mange quoi ?</b><small>Sans planifier</small>
        </button>
      </div>

      <div className="week-nav">
        <button className="icon-btn" onClick={() => setWeek(addDays(week, -7))} aria-label="Semaine précédente"><Icon name="back" /></button>
        <span>{week === mondayOf() ? 'Cette semaine' : week === addDays(mondayOf(), 7) ? 'Semaine prochaine' : `Semaine du ${fmtDay(week)}`}</span>
        <button className="icon-btn" onClick={() => setWeek(addDays(week, 7))} aria-label="Semaine suivante"><Icon name="next" /></button>
      </div>

      {plan === undefined ? <Spinner /> : busy === 'all' ? <Spinner label="Claude complète vos soupers… (environ 30 secondes)" /> : (
        <>
          {plan?.summary && <p className="summary">{plan.summary}</p>}
          {entries.length > 0 && (
            <div className={`status ${plan.status === 'approuvé' ? 'ok' : ''}`}>
              {plan.status === 'approuvé' ? <><Icon name="check" size={16} /> Plan approuvé</> : 'Brouillon : ajustez puis approuvez'}
            </div>
          )}
          <ul className="list days">
            {shownDays.map((date) => {
              const list = entries.filter((e) => e.date === date)
              return (
                <li key={date} className={`card day ${date === today() ? 'is-today' : ''}`}>
                  <div className="day-date"><b>{fmtDay(date).split(' ')[0]}</b><span>{fmtDay(date).split(' ').slice(1).join(' ')}</span></div>
                  <div className="grow">
                    {list.length === 0 && <button className="day-empty" onClick={() => setAdding(date)} disabled={isPast}>Ajouter au menu</button>}
                    {list.map((d) => (
                      <div key={d.key} className="entry">
                        <div className="grow" onClick={() => openDay(d)}>
                          <h3>{d.title || '—'}</h3>
                          <div className="meta">
                            {d.minutes && <span><Icon name="clock" size={14} /> {d.minutes} min</span>}
                            {(d.recipe_id || d.new_recipe) && <span>👥 {d.servings ?? s.servings}</span>}
                            {d.new_recipe && <span className="pill violet">Nouvelle idée</span>}
                            {d.uses_inventory?.length > 0 && <span className="ice-txt">❄ {d.uses_inventory.slice(0, 2).join(', ')}</span>}
                          </div>
                          {d.reason && <p className="reason">{d.reason}</p>}
                        </div>
                        <button className="icon-btn faint" onClick={() => removeEntry(d.key)} aria-label={`Retirer ${d.title}`}><Icon name="close" size={16} /></button>
                      </div>
                    ))}
                  </div>
                  {list.length > 0 && !isPast && <button className="icon-btn" onClick={() => setAdding(date)} aria-label="Ajouter à cette journée"><Icon name="plus" size={20} /></button>}
                </li>
              )
            })}
          </ul>

          {!isPast && emptyCount > 0 && (
            <button className="btn block ghost-ai" onClick={() => setAiFill(true)}><Icon name="spark" size={18} /> Compléter {emptyCount === planDays.length ? 'la semaine' : `les ${emptyCount} soir${emptyCount > 1 ? 's' : ''} vide${emptyCount > 1 ? 's' : ''}`} avec Claude</button>
          )}

          {plan?.status === 'approuvé' && plan.thaw?.length > 0 && (
            <div className="card">
              <h3>❄ À sortir de l'inventaire</h3>
              <p className="small muted">Touchez « Sorti » quand c'est fait (ou scannez l'étiquette) : l'inventaire se met à jour tout seul.</p>
              <ul className="plain thaw">{plan.thaw.map((t, k) => (
                <li key={k} className={t.done ? 'done' : ''}>
                  <span><b>{t.take ?? t.quantity} {t.unit || ''}</b> {t.name} <span className="muted">· {t.location}</span></span>
                  {t.done ? <Icon name="check" size={18} /> : <button className="btn sm" onClick={() => takeOut(k)}>Sorti</button>}
                </li>
              ))}</ul>
            </div>
          )}

          {err && <p className="note err">{err}</p>}
          {entries.some((e) => e.recipe_id || e.new_recipe) && (busy === 'approve' ? <Spinner label="Préparation de la liste d'épicerie…" /> : (
            <div className="stack">
              {plan.status !== 'approuvé'
                ? <button className="btn primary block" onClick={approve}><Icon name="check" size={18} /> Approuver et créer la liste d'épicerie</button>
                : <button className="btn primary block" onClick={() => go('shopping')}><Icon name="cart" size={18} /> Voir la liste d'épicerie</button>}
              {plan.status === 'approuvé' && <button className="btn block" onClick={approve}>Recréer la liste d'épicerie</button>}
            </div>
          ))}
        </>
      )}

      {aiFill && (
        <Sheet title="Compléter avec Claude" onClose={() => setAiFill(false)}
          footer={<button className="btn primary block" onClick={generate}><Icon name="spark" size={18} /> Proposer {emptyCount} souper{emptyCount > 1 ? 's' : ''}</button>}>
          <p className="muted">Claude choisit pour les soirs vides, dans vos recettes et celles de la communauté, en utilisant d'abord ce qui est au congélateur. Les soupers déjà choisis restent.</p>
          <p className="small muted">{s.servings} portions · max {s.max_minutes_weekday} min en semaine{(s.health || []).length > 0 && <> · {s.health.join(', ')}</>}
            {' '}<button className="link" onClick={() => { setAiFill(false); setCriteria(true) }}>Critères</button></p>
          <label className="field"><span>Quelque chose de spécial? (optionnel)</span>
            <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="ex. invités samedi, hockey mercredi" /></label>
        </Sheet>
      )}
      {criteria && <Sheet title="Critères des soupers" onClose={() => setCriteria(false)}
        footer={<button className="btn primary block" onClick={() => setCriteria(false)}>Terminé</button>}><CriteriaForm /></Sheet>}
      {adding && <AddToDay date={adding} recipes={recipes} data={data} onClose={() => setAdding(null)}
        onSwipe={() => { setDeck({ mode: 'plan', day: adding }); setAdding(null) }}
        onPick={async (e) => { await addEntry(adding, e); setAdding(null) }}
        onRecipe={async (r) => { await addRecipe(r, adding); setAdding(null); reloadRecipes() }} />}
      {deck && <Deck mode={deck.mode} data={data} days={planDays} entries={entries} startDay={deck.day} maxMinutesFor={maxMinutesFor}
        onAdd={addRecipe} onUndo={removeEntry} onClose={() => setDeck(null)} />}
      {history && <History onClose={() => setHistory(false)} onOpen={(d) => { setHistory(false); openDay(d) }} />}
      {viewing && !saving && (
        <RecipeDetail recipe={viewing} data={data} servings={viewing._day?.servings ?? s.servings}
          onServings={viewing._day?.key && plan?.days?.some((x) => x.key === viewing._day.key) ? (n) => setDayServings(viewing._day.key, n) : undefined}
          onClose={() => setViewing(null)} onChanged={() => { setViewing(null); reloadRecipes() }}
          unsaved={viewing._new ? <button className="btn primary block" onClick={() => setSaving(viewing)}>Enregistrer dans mes recettes</button> : null} />
      )}
      {saving && (
        <RecipeEditor initial={saving} onClose={() => setSaving(null)} onSaved={async (row) => {
          if (row?.id) await setEntries(plan.days.map((x) => (x.key === saving._new.key ? { ...x, recipe_id: row.id, new_recipe: null } : x)))
          setSaving(null); setViewing(null); reloadRecipes(); toast('Recette enregistrée')
        }} />
      )}
    </>
  )
}

const withKeys = (days) => (Array.isArray(days) ? days : []).map((d) => (d.key ? d : { ...d, key: newKey() }))

// « + » d'une journée : glisser des idées, choisir, coller un lien, demander à Claude
function AddToDay({ date, recipes, data, onClose, onSwipe, onPick, onRecipe }) {
  const [q, setQ] = useState('')
  const [custom, setCustom] = useState('')
  const [ideas, setIdeas] = useState(null)
  const [peek, setPeek] = useState(null)
  const { profile, toast } = useApp()
  const term = q.trim().toLowerCase()
  const list = (recipes || []).filter((r) => data.prefs[r.id] !== 'bloquee')
    .filter((r) => !term || r.title.toLowerCase().includes(term) || (r.tags || []).some((t) => t.toLowerCase().includes(term))).slice(0, 40)
  const free = (title) => onPick({ title })
  const keepIdea = async (r) => {
    try { const { _idea: _x, ...rest } = r; const saved = await saveRecipe(rest, profile.display_name); await onRecipe(saved) } catch (e) { toast('Erreur : ' + e.message) }
  }
  return (
    <Sheet title={`Menu du ${fmtDay(date)}`} onClose={onClose}>
      <button className="btn primary block" onClick={onSwipe}><Icon name="cards" size={18} /> Glisser des idées</button>
      <h3>Lien ou photo</h3>
      <QuickAdd compact onSaved={onRecipe} />
      <h3>Demander à Claude</h3>
      {ideas ? (
        <ul className="list ideas">
          {ideas.map((r, k) => (
            <li key={k} className="card recipe-row">
              <div className="grow" onClick={() => setPeek(r)}>
                <h3>{r.title}</h3>
                <div className="meta">{r.prep_minutes && <span><Icon name="clock" size={14} /> {r.prep_minutes} min</span>}<span>{r.source_url ? new URL(r.source_url).hostname.replace('www.', '') : 'Idée de Claude'}</span></div>
                {r.description && <p className="reason">{r.description}</p>}
              </div>
              <button className="btn sm primary" onClick={() => keepIdea(r)}>Ajouter</button>
            </li>
          ))}
          <li><button className="link" onClick={() => setIdeas(null)}>Autre demande</button></li>
        </ul>
      ) : <AskClaude onResults={setIdeas} />}
      <h3>Dans mes recettes</h3>
      <div className="search"><Icon name="search" size={18} /><input placeholder="Chercher une recette…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ul className="pick">
        {list.map((r) => (
          <li key={r.id} onClick={() => onRecipe(r)}><span>{r.title}</span>{r.prep_minutes && <small>{r.prep_minutes} min</small>}</li>
        ))}
      </ul>
      <h3>Autre chose</h3>
      <div className="quick">
        {['Restes', 'Resto / livraison', 'Rien de prévu'].map((t) => <button key={t} className="chip" onClick={() => free(t)}>{t}</button>)}
      </div>
      <div className="inline-add">
        <input placeholder="Texte libre…" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button className="btn sm" disabled={!custom.trim()} onClick={() => free(custom.trim())}>OK</button>
      </div>
      {peek && <RecipeDetail recipe={peek} data={data} onClose={() => setPeek(null)} onChanged={() => setPeek(null)}
        unsaved={<button className="btn primary block" onClick={() => { setPeek(null); keepIdea(peek) }}>Ajouter au {fmtDay(date)}</button>} />}
    </Sheet>
  )
}

// Historique des menus (12 derniers mois), avec recherche
function History({ onClose, onOpen }) {
  const [plans, setPlans] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    supabase.from('meal_plans').select('week_start,days,status').order('week_start', { ascending: false }).limit(60)
      .then(({ data }) => setPlans(data || []))
  }, [])
  const term = q.trim().toLowerCase()
  const list = (plans || []).map((p) => ({ ...p, days: (p.days || []).filter((d) => !term || d.title?.toLowerCase().includes(term)) }))
    .filter((p) => p.days.length)
  return (
    <Sheet title="Historique des menus" onClose={onClose}>
      <div className="search"><Icon name="search" size={18} /><input placeholder="Retrouver un repas…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!plans ? <Spinner /> : list.length === 0 ? <p className="muted">Aucun menu trouvé.</p> : list.map((p) => (
        <div key={p.week_start} className="hist-week">
          <h3>Semaine du {fmtLong(p.week_start)}</h3>
          <ul className="pick">
            {p.days.map((d) => (
              <li key={d.key || d.date + d.title} onClick={() => (d.recipe_id || d.new_recipe) && onOpen(d)}>
                <span><small className="muted">{fmtDay(d.date)}</small> · {d.title}</span>
                {(d.recipe_id || d.new_recipe) && <Icon name="next" size={16} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="muted small">Les menus sont conservés 12 mois.</p>
    </Sheet>
  )
}
