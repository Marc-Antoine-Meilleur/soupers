import { useEffect, useState } from 'react'
import { supabase, ai, mondayOf, addDays, fmtDay, fmtLong, WEEKDAYS, today } from '../lib'
import { CriteriaForm, FeedbackButton } from '../shared'
import { useApp } from '../App'
import { Icon, Sheet, Spinner, Header } from '../ui'
import { RecipeDetail, RecipeEditor, useRecipes } from './Recipes'

export default function Week() {
  const { household, go, toast } = useApp()
  const s = household.settings
  const [week, setWeek] = useState(() => (new Date().getDay() === 0 ? addDays(mondayOf(), 7) : mondayOf()))
  const [plan, setPlan] = useState(undefined)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [note, setNote] = useState('')
  const [picking, setPicking] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [saving, setSaving] = useState(null)
  const [criteria, setCriteria] = useState(false)
  const [recipes, reloadRecipes] = useRecipes()

  const load = async () => {
    setPlan(undefined)
    const { data } = await supabase.from('meal_plans').select('*').eq('week_start', week).maybeSingle()
    setPlan(data || null)
  }
  useEffect(() => { load() }, [week]) // eslint-disable-line

  const days = (s.plan_days || []).slice().sort().map((i) => addDays(week, i))
  const persist = async (patch) => {
    const row = { week_start: week, household_id: household.id, ...patch }
    const { data, error } = await supabase.from('meal_plans').upsert(row, { onConflict: 'household_id,week_start' }).select().single()
    if (error) throw error
    setPlan(data)
    return data
  }

  const generate = async (dates = days, keep = []) => {
    setBusy(dates.length === 1 ? dates[0] : 'all'); setErr(null)
    try {
      const { plan: p } = await ai('plan_week', { dates, note, locked: keep.map((d) => ({ date: d.date, souper: d.title })) })
      if (dates.length === 1 && plan) {
        const nd = p.days[0]
        await persist({ days: plan.days.map((d) => (d.date === nd.date ? nd : d)), status: 'brouillon' })
      } else {
        await persist({ days: p.days, summary: p.summary, status: 'brouillon', thaw: [] })
      }
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }

  const setDay = async (date, d) => {
    await persist({ days: plan.days.map((x) => (x.date === date ? { ...x, ...d, date } : x)), status: 'brouillon' })
    setPicking(null)
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
      if (r) setViewing(r)
    } else if (d.new_recipe) setViewing({ ...d.new_recipe, household_id: household.id, _new: d })
  }

  const isPast = addDays(week, 6) < today()

  return (
    <>
      <Header title="Ma semaine" sub={`Du ${fmtLong(week)} au ${fmtLong(addDays(week, 6))}`}
        action={<div className="head-actions"><FeedbackButton screen="Semaine" /><button className="btn sm" onClick={() => setCriteria(true)}>Critères</button></div>} />
      <div className="week-nav">
        <button className="icon-btn" onClick={() => setWeek(addDays(week, -7))} aria-label="Semaine précédente"><Icon name="back" /></button>
        <span>{week === mondayOf() ? 'Cette semaine' : week === addDays(mondayOf(), 7) ? 'Semaine prochaine' : `Semaine du ${fmtDay(week)}`}</span>
        <button className="icon-btn" onClick={() => setWeek(addDays(week, 7))} aria-label="Semaine suivante"><Icon name="next" /></button>
      </div>

      {plan === undefined ? <Spinner /> : busy === 'all' ? <Spinner label="Claude prépare vos soupers… (environ 30 secondes)" /> : !plan || !plan.days?.length ? (
        <div className="card">
          <h2>Planifier les soupers</h2>
          <p className="muted">Claude choisit dans vos recettes et celles de vos amis, en utilisant d'abord ce qui est au congélateur.</p>
          <p className="small muted">
            {s.plan_days.length} soir{s.plan_days.length > 1 ? 's' : ''} ({s.plan_days.slice().sort().map((i) => WEEKDAYS[i]).join(', ')}) · {s.servings} portions · max {s.max_minutes_weekday} min en semaine
            {(s.health || []).length > 0 && <> · {s.health.join(', ')}</>}
            {' '}<button className="link" onClick={() => setCriteria(true)}>Modifier</button>
          </p>
          <label className="field"><span>Cette semaine, quelque chose de spécial? (optionnel)</span>
            <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="ex. invités samedi, hockey mercredi" /></label>
          {err && <p className="note err">{err}</p>}
          <button className="btn primary block" disabled={!days.length || isPast} onClick={() => generate()}><Icon name="spark" size={18} /> Proposer mes soupers</button>
        </div>
      ) : (
        <>
          {plan.summary && <p className="summary">{plan.summary}</p>}
          <div className={`status ${plan.status === 'approuvé' ? 'ok' : ''}`}>
            {plan.status === 'approuvé' ? <><Icon name="check" size={16} /> Plan approuvé</> : 'Brouillon : ajustez puis approuvez'}
          </div>
          <ul className="list">
            {plan.days.map((d) => (
              <li key={d.date} className="card day">
                <div className="day-date"><b>{fmtDay(d.date).split(' ')[0]}</b><span>{fmtDay(d.date).split(' ').slice(1).join(' ')}</span></div>
                <div className="grow" onClick={() => openDay(d)}>
                  {busy === d.date ? <Spinner /> : <>
                    <h3>{d.title || '—'}</h3>
                    <div className="meta">
                      {d.minutes && <span><Icon name="clock" size={14} /> {d.minutes} min</span>}
                      {d.new_recipe && <span className="pill violet">Nouvelle idée</span>}
                    </div>
                    {d.reason && <p className="reason">{d.reason}</p>}
                    {d.uses_inventory?.length > 0 && <div className="tags">{d.uses_inventory.map((x) => <span key={x} className="tag ice">❄ {x}</span>)}</div>}
                  </>}
                </div>
                <div className="day-actions">
                  <button className="icon-btn" onClick={() => setPicking(d)} aria-label="Changer"><Icon name="edit" size={18} /></button>
                  <button className="icon-btn" disabled={!!busy} onClick={() => generate([d.date], plan.days.filter((x) => x.date !== d.date))} aria-label="Autre suggestion"><Icon name="refresh" size={18} /></button>
                </div>
              </li>
            ))}
          </ul>

          {plan.status === 'approuvé' && plan.thaw?.length > 0 && (
            <div className="card">
              <h3>❄ À sortir de l'inventaire</h3>
              <p className="small muted">Touchez « Sorti » quand c'est fait : l'inventaire se met à jour tout seul.</p>
              <ul className="plain thaw">{plan.thaw.map((t, k) => (
                <li key={k} className={t.done ? 'done' : ''}>
                  <span><b>{t.take ?? t.quantity} {t.unit || ''}</b> {t.name} <span className="muted">· {t.location}</span></span>
                  {t.done ? <Icon name="check" size={18} /> : <button className="btn sm" onClick={() => takeOut(k)}>Sorti</button>}
                </li>
              ))}</ul>
            </div>
          )}

          {err && <p className="note err">{err}</p>}
          {busy === 'approve' ? <Spinner label="Préparation de la liste d'épicerie…" /> : (
            <div className="stack">
              {plan.status !== 'approuvé'
                ? <button className="btn primary block" onClick={approve}><Icon name="check" size={18} /> Approuver et créer la liste d'épicerie</button>
                : <button className="btn primary block" onClick={() => go('shopping')}><Icon name="cart" size={18} /> Voir la liste d'épicerie</button>}
              {plan.status === 'approuvé' && <button className="btn block" onClick={approve}>Recréer la liste d'épicerie</button>}
              <button className="btn block" onClick={() => { if (confirm('Remplacer tout le plan par de nouvelles suggestions?')) generate() }}><Icon name="refresh" size={18} /> Tout reproposer</button>
            </div>
          )}
        </>
      )}

      {criteria && <Sheet title="Critères des soupers" onClose={() => setCriteria(false)}
        footer={<button className="btn primary block" onClick={() => setCriteria(false)}>Terminé</button>}><CriteriaForm /></Sheet>}
      {picking && <PickRecipe day={picking} recipes={recipes} onClose={() => setPicking(null)} onPick={(d) => setDay(picking.date, d)} />}
      {viewing && !saving && (
        <RecipeDetail recipe={viewing} onClose={() => setViewing(null)} onChanged={() => { setViewing(null); reloadRecipes() }}
          unsaved={viewing._new ? <button className="btn primary block" onClick={() => setSaving(viewing)}>Enregistrer dans mes recettes</button> : null} />
      )}
      {saving && (
        <RecipeEditor initial={saving} onClose={() => setSaving(null)} onSaved={async () => {
          const { data } = await supabase.from('recipes').select('id,title').eq('title', saving.title).order('created_at', { ascending: false }).limit(1)
          if (data?.[0]) await setDay(saving._new.date, { recipe_id: data[0].id, new_recipe: null })
          setSaving(null); setViewing(null); reloadRecipes(); toast('Recette enregistrée')
        }} />
      )}
    </>
  )
}

function PickRecipe({ day, recipes, onClose, onPick }) {
  const [q, setQ] = useState('')
  const [custom, setCustom] = useState('')
  const list = (recipes || []).filter((r) => r.title.toLowerCase().includes(q.toLowerCase())).slice(0, 40)
  return (
    <Sheet title={`Souper du ${fmtDay(day.date)}`} onClose={onClose}>
      <div className="quick">
        {['Restes', 'Resto / livraison', 'Pas de souper'].map((t) => (
          <button key={t} className="chip" onClick={() => onPick({ title: t, recipe_id: null, new_recipe: null, reason: '', minutes: null, uses_inventory: [] })}>{t}</button>
        ))}
      </div>
      <div className="inline-add">
        <input placeholder="Autre (texte libre)…" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button className="btn sm" disabled={!custom.trim()} onClick={() => onPick({ title: custom.trim(), recipe_id: null, new_recipe: null, reason: '', minutes: null, uses_inventory: [] })}>OK</button>
      </div>
      <div className="search"><Icon name="search" size={18} /><input placeholder="Chercher une recette…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ul className="pick">
        {list.map((r) => (
          <li key={r.id} onClick={() => onPick({ title: r.title, recipe_id: r.id, new_recipe: null, minutes: r.prep_minutes, reason: 'Choisi par vous', uses_inventory: [] })}>
            <span>{r.title}</span>{r.prep_minutes && <small>{r.prep_minutes} min</small>}
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
