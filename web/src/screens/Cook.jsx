import { useEffect, useState } from 'react'
import { supabase, fmtNum, fmtQty, fmtStars } from '../lib'
import { useApp } from '../App'
import { Icon, Sheet } from '../ui'

// Sélecteur de portions (pas de ½)
export function Servings({ value, onChange }) {
  const step = (d) => onChange(Math.max(0.5, Math.round((value + d) * 2) / 2))
  return (
    <div className="servings">
      <button className="icon-btn" onClick={() => step(-1)} aria-label="Moins de portions"><Icon name="minus" size={18} /></button>
      <span><b>{fmtNum(value)}</b> portion{value > 1 ? 's' : ''}</span>
      <button className="icon-btn" onClick={() => step(1)} aria-label="Plus de portions"><Icon name="plus" size={18} /></button>
    </div>
  )
}

// Ingrédients ajustés aux portions. Toucher une quantité permet de la changer : tout le reste suit.
export function ScaledIngredients({ ingredients, factor, onFactor, checkable }) {
  const [checked, setChecked] = useState({})
  const [editing, setEditing] = useState(null)
  const [val, setVal] = useState('')
  const apply = (i) => {
    const n = Number(String(val).replace(',', '.'))
    if (n > 0 && typeof i.quantity === 'number' && i.quantity > 0) onFactor(n / i.quantity)
    setEditing(null)
  }
  return (
    <ul className={`ingredients scaled ${checkable ? 'checkable' : ''}`}>
      {(ingredients || []).map((i, k) => (
        <li key={k} className={checked[k] ? 'done' : ''}>
          {checkable && (
            <button className="check" onClick={() => setChecked({ ...checked, [k]: !checked[k] })} aria-label="Cocher">
              {checked[k] && <Icon name="check" size={14} />}
            </button>
          )}
          {editing === k ? (
            <span className="qty-edit">
              <input autoFocus inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && apply(i)} onBlur={() => apply(i)} />
              <small>{i.unit}</small>
            </span>
          ) : (
            <button className="qty-btn" disabled={typeof i.quantity !== 'number'}
              onClick={() => { setEditing(k); setVal(fmtNum(i.quantity * factor).replace(/ .*/, '')) }}
              title="Changer cette quantité : la recette s'ajuste">
              {fmtQty(i, factor) || '—'}
            </button>
          )}
          <span className="ing-name">{i.name}</span>
        </li>
      ))}
    </ul>
  )
}

// Avis du groupe : goût (0 à 5), temps réel, commentaire
export function Reviews({ recipe, reviews, onChanged, startOpen }) {
  const { session, profile, toast } = useApp()
  const mine = reviews.find((r) => r.user_id === session.user.id)
  const others = reviews.filter((r) => r.user_id !== session.user.id)
  const [open, setOpen] = useState(!!startOpen)
  const [taste, setTaste] = useState(mine?.taste ?? null)
  const [minutes, setMinutes] = useState(mine?.minutes ?? '')
  const [comment, setComment] = useState(mine?.comment ?? '')
  useEffect(() => { setTaste(mine?.taste ?? null); setMinutes(mine?.minutes ?? ''); setComment(mine?.comment ?? '') }, [mine?.id]) // eslint-disable-line

  const save = async () => {
    const row = {
      recipe_id: recipe.id, user_id: session.user.id, author_name: profile.display_name,
      taste, minutes: minutes ? Number(minutes) : null, comment: comment.trim() || null, updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('recipe_reviews').upsert(row, { onConflict: 'recipe_id,user_id' })
    if (error) return toast('Erreur : ' + error.message)
    setOpen(false); toast('Merci pour votre avis!'); onChanged()
  }
  const remove = async () => {
    await supabase.from('recipe_reviews').delete().eq('id', mine.id)
    setOpen(false); onChanged()
  }

  return (
    <div className="reviews">
      <h3>Avis du groupe {reviews.length > 0 && <small>({reviews.length})</small>}</h3>
      {!open ? (
        <button className="btn sm" onClick={() => setOpen(true)}><Icon name="star" size={16} /> {mine ? 'Modifier mon avis' : 'Donner mon avis'}</button>
      ) : (
        <div className="review-form">
          <div className="field"><span>Goût</span>
            <div className="stars big">
              <button className={`zero ${taste === 0 ? 'on' : ''}`} onClick={() => setTaste(0)}>0</button>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setTaste(n)} aria-label={`${n} sur 5`}>
                  <Icon name="star" size={28} fill={taste !== null && n <= taste ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
          </div>
          <div className="field"><span>Temps réel pour la faire</span>
            <div className="chips">
              {[15, 30, 45, 60, 90, 120].map((m) => (
                <button key={m} className={`chip ${+minutes === m ? 'on' : ''}`} onClick={() => setMinutes(m)}>{m === 120 ? '2 h+' : `${m} min`}</button>
              ))}
              <input className="mini-num" inputMode="numeric" placeholder="autre" value={[15, 30, 45, 60, 90, 120].includes(+minutes) ? '' : minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} />
            </div>
          </div>
          <label className="field"><span>Commentaire, conseil (visible par le groupe)</span>
            <textarea rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="ex. Doubler l'ail, cuire 5 min de plus" /></label>
          <div className="two">
            {mine ? <button className="btn danger" onClick={remove}>Retirer</button> : <button className="btn" onClick={() => setOpen(false)}>Annuler</button>}
            <button className="btn primary" disabled={taste === null && !minutes && !comment.trim()} onClick={save}>Publier</button>
          </div>
        </div>
      )}
      {[...(mine && !open ? [mine] : []), ...others].map((r) => (
        <div key={r.id} className="review">
          <div className="review-head">
            <b>{r.author_name || 'Quelqu’un'}</b>
            {r.taste !== null && r.taste !== undefined && <span className="stars-txt">{'★'.repeat(r.taste)}{'☆'.repeat(5 - r.taste)}</span>}
            {r.minutes && <span className="muted"><Icon name="clock" size={13} /> {r.minutes} min</span>}
          </div>
          {r.comment && <p>{r.comment}</p>}
        </div>
      ))}
    </div>
  )
}

// Résumé des avis sur une ligne
export function StatsLine({ s, prep }) {
  if (!s && !prep) return null
  return (
    <>
      {s?.taste !== null && s?.taste !== undefined && <span className="stars-txt">★ {fmtStars(s.taste)} <small>({s.tasteN})</small></span>}
      {(s?.minutes || prep) && <span><Icon name="clock" size={14} /> {Math.round(s?.minutes || prep)} min{s?.minutes ? ' (réel)' : ''}</span>}
    </>
  )
}

// Mode cuisine : grand texte, cases à cocher, écran qui reste allumé
export function CookMode({ recipe, servings: initial, onServings, onClose, onReview }) {
  const base = recipe.servings || initial || 4
  const [servings, setServings] = useState(initial || base)
  const [done, setDone] = useState({})
  const factor = servings / base
  const set = (s) => { setServings(s); onServings?.(s) }

  useEffect(() => {
    let lock = null
    const req = async () => { try { lock = await navigator.wakeLock?.request('screen') } catch { /* non supporté */ } }
    req()
    const vis = () => document.visibilityState === 'visible' && req()
    document.addEventListener('visibilitychange', vis)
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release?.() }
  }, [])

  return (
    <Sheet title={recipe.title} onClose={onClose} full>
      <div className="cook">
        <div className="cook-top">
          <Servings value={servings} onChange={set} />
          <span className="muted small">Touchez une quantité pour la changer : tout s'ajuste.</span>
        </div>
        <h3>Ingrédients</h3>
        <ScaledIngredients ingredients={recipe.ingredients} factor={factor} onFactor={(f) => set(Math.round(base * f * 2) / 2 || 0.5)} checkable />
        <h3>Étapes</h3>
        <ol className="cook-steps">
          {(recipe.steps || []).map((s, k) => (
            <li key={k} className={done[k] ? 'done' : ''} onClick={() => setDone({ ...done, [k]: !done[k] })}>
              <span className="n">{done[k] ? <Icon name="check" size={16} /> : k + 1}</span><span>{s}</span>
            </li>
          ))}
        </ol>
        {recipe.health_notes && <p className="note health">{recipe.health_notes}</p>}
        {onReview && <button className="btn primary block" onClick={onReview}><Icon name="star" size={18} /> C'est prêt! Donner mon avis</button>}
      </div>
    </Sheet>
  )
}
