// Composer le menu en glissant des cartes : droite = ajouter, gauche = passer, haut = voir la recette
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, fmtDay, fromISO, today, rankRecipes, photoUrl, saveRecipe, isSide, TAG_GROUPS } from '../lib'
import { useApp } from '../App'
import { Icon, Sheet } from '../ui'
import { StatsLine } from './Cook'
import { RecipeDetail } from './Recipes'
import { QuickAdd, FindIdeas } from './Add'

const FILTERS = ['Soupe', 'Plat principal', 'Rapide', 'Faible en glucides', 'Végé', 'Sans lactose', 'Mijoteuse', 'Se congèle']
const TONES = { Soupe: 'ochre', Salade: 'sage', Accompagnement: 'sage', Sauce: 'red', Dessert: 'rose', Déjeuner: 'ochre' }
export const toneOf = (r) => TONES[(r.tags || []).find((t) => TONES[t])] || 'ink'

export function usePhoto(path) {
  const [url, setUrl] = useState(null)
  useEffect(() => { let on = true; setUrl(null); if (path) photoUrl(path).then((u) => on && setUrl(u)); return () => { on = false } }, [path])
  return url
}

// Carte visuelle : la photo du plat si elle existe, sinon une belle carte typographique
export function RecipeCard({ r, stats, fav, uses, style, className = '', ...rest }) {
  const url = usePhoto(r.photo_path)
  const type = (r.tags || []).find((t) => TAG_GROUPS[0][1].includes(t))
  return (
    <div className={`rcard ${url ? 'photo' : 'tone-' + toneOf(r)} ${className}`} style={style} {...rest}>
      {url && <img src={url} alt="" draggable="false" />}
      <div className="rcard-top">
        {type && <span className="rcard-type">{type}</span>}
        {r._idea && <span className="rcard-type idea">{r.source_url ? 'Trouvée en ligne' : 'Nouvelle idée'}</span>}
        {fav && <span className="rcard-fav">♥</span>}
      </div>
      <div className="rcard-body">
        {!url && <div className="rcard-rule" />}
        <h2>{r.title}</h2>
        {r.description && <p>{r.description}</p>}
        <div className="rcard-meta"><StatsLine s={stats} prep={r.prep_minutes} />{r.author_name && r._friend && <span>par {r.author_name}</span>}</div>
        {uses?.length > 0 && <div className="rcard-inv">❄ {uses.slice(0, 2).join(', ')}</div>}
        <div className="rcard-tags">{(r.tags || []).filter((t) => t !== type).slice(0, 4).map((t) => <span key={t}>{t}</span>)}</div>
      </div>
    </div>
  )
}

export default function Deck({ mode, data, days = [], entries = [], startDay, maxMinutesFor, onAdd, onUndo, onClose }) {
  const { household, profile, toast } = useApp()
  const tonight = mode === 'tonight'
  const [day, setDay] = useState(startDay || days.find((d) => !entries.some((e) => e.date === d)) || days[0] || today())
  const [filters, setFilters] = useState([])
  const [inventory, setInventory] = useState([])
  const [recent, setRecent] = useState(new Set())
  const [seen, setSeen] = useState(new Set())
  const [ideas, setIdeas] = useState([])
  const [hist, setHist] = useState([])
  const [drag, setDrag] = useState(null)
  const [fly, setFly] = useState(null)
  const [detail, setDetail] = useState(null)
  const [more, setMore] = useState(null)
  const start = useRef(null)

  useEffect(() => {
    supabase.from('inventory_items').select('name,location,best_before').then(({ data: d }) => setInventory(d || []))
    supabase.from('meal_plans').select('days').order('week_start', { ascending: false }).limit(4)
      .then(({ data: d }) => setRecent(new Set((d || []).flatMap((p) => (p.days || []).map((x) => x.recipe_id)).filter(Boolean))))
  }, [])

  const { recipes, stats, prefs } = data
  const ranked = useMemo(() => rankRecipes(recipes || [], {
    stats, prefs, inventory, recentIds: new Set([...recent, ...entries.map((e) => e.recipe_id)]), maxMinutes: maxMinutesFor?.(day),
  }), [recipes, stats, prefs, inventory, recent]) // eslint-disable-line react-hooks/exhaustive-deps
  const pass = (x) => filters.every((f) => (f === '♥' ? prefs[x.r.id] === 'favori' : f === '❄' ? x.uses.length > 0 : (x.r.tags || []).includes(f)))
  const stack = [...ideas.map((r) => ({ r, uses: [] })), ...ranked.filter(pass)].filter((x) => !seen.has(x.r.id || x.r.title))
  const top = stack[0], next = stack[1]
  const toggle = (f) => setFilters(filters.includes(f) ? filters.filter((x) => x !== f) : [...filters, f])

  const decide = async (dir) => {
    if (!top || fly) return
    const r = top.r
    setFly(dir); setDrag(null)
    setTimeout(async () => {
      setFly(null)
      setSeen((s) => new Set(s).add(r.id || r.title))
      if (dir === 'right') {
        let rec = r
        try {
          if (!rec.id) { rec = await saveRecipe({ ...r, _idea: undefined, needs_review: false }, profile.display_name); data.reload() }
          const key = await onAdd(rec, tonight ? today() : day, top.uses)
          setHist((h) => [...h, { id: r.id || r.title, key }])
          if (tonight) { setDetail(rec); return }
          toast(`${rec.title} → ${fmtDay(day)}`)
          // Une soupe ou un accompagnement : on reste sur la même journée pour ajouter le plat
          if (!isSide(rec)) {
            const i = days.indexOf(day)
            const nxt = days.slice(i + 1).find((d) => !entries.some((e) => e.date === d))
            if (nxt) setDay(nxt)
          }
        } catch (e) { toast('Erreur : ' + e.message) }
      } else setHist((h) => [...h, { id: r.id || r.title }])
    }, 220)
  }
  const undo = async () => {
    const last = hist[hist.length - 1]
    if (!last) return
    setHist(hist.slice(0, -1))
    setSeen((s) => { const n = new Set(s); n.delete(last.id); return n })
    if (last.key) { await onUndo(last.key); toast('Retiré du menu') }
  }

  // Geste de glissement
  const down = (e) => { if (fly) return; start.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture?.(e.pointerId) }
  const move = (e) => { if (start.current) setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y }) }
  const up = () => {
    if (!start.current) return
    start.current = null
    const d = drag || { x: 0, y: 0 }
    if (d.x > 90) decide('right')
    else if (d.x < -90) decide('left')
    else if (d.y < -110 && Math.abs(d.x) < 60) { setDrag(null); setDetail(top.r) }
    else if (Math.abs(d.x) < 6 && Math.abs(d.y) < 6) { setDrag(null); setDetail(top.r) }
    else setDrag(null)
  }
  const tf = fly ? `translate(${fly === 'right' ? 140 : -140}%, 0) rotate(${fly === 'right' ? 18 : -18}deg)`
    : drag ? `translate(${drag.x}px, ${Math.min(drag.y, 40)}px) rotate(${drag.x / 18}deg)` : 'none'
  const hint = fly || (drag?.x > 40 ? 'right' : drag?.x < -40 ? 'left' : null)

  const addIdeas = (list) => { setIdeas((prev) => [...list, ...prev]); setMore(null) }
  const reset = () => { setSeen(new Set()); setHist([]) }

  return (
    <div className="deck-screen" role="dialog" aria-label={tonight ? 'Ce soir' : 'Composer ma semaine'}>
      <div className="deck-head">
        <button className="icon-btn" onClick={onClose} aria-label="Fermer"><Icon name="close" /></button>
        <h2>{tonight ? 'Ce soir, on mange quoi ?' : 'Composer ma semaine'}</h2>
        <button className="icon-btn" onClick={() => setMore('add')} aria-label="Ajouter une recette"><Icon name="plus" /></button>
      </div>

      {!tonight && (
        <div className="day-pills">
          {days.map((d) => {
            const n = entries.filter((e) => e.date === d).length
            return (
              <button key={d} className={`${d === day ? 'on' : ''} ${n ? 'has' : ''}`} onClick={() => setDay(d)}>
                <span>{fromISO(d).toLocaleDateString('fr-CA', { weekday: 'short' }).replace('.', '')}</span>
                <b>{fromISO(d).getDate()}</b>
                <i>{n ? '●'.repeat(Math.min(n, 3)) : ''}</i>
              </button>
            )
          })}
        </div>
      )}

      <div className="chips scroll deck-filters">
        <button className={`chip ${filters.includes('♥') ? 'on' : ''}`} onClick={() => toggle('♥')}>♥ Favoris</button>
        <button className={`chip ${filters.includes('❄') ? 'on' : ''}`} onClick={() => toggle('❄')}>❄ Inventaire</button>
        {FILTERS.map((f) => <button key={f} className={`chip ${filters.includes(f) ? 'on' : ''}`} onClick={() => toggle(f)}>{f}</button>)}
      </div>

      <div className="deck-stage">
        {top ? (
          <>
            {next && <RecipeCard key={'n' + (next.r.id || next.r.title)} r={next.r} stats={stats.get(next.r.id)} fav={prefs[next.r.id] === 'favori'} uses={next.uses} className="under" />}
            <RecipeCard key={top.r.id || top.r.title} r={{ ...top.r, _friend: top.r.household_id && top.r.household_id !== household.id }} stats={stats.get(top.r.id)}
              fav={prefs[top.r.id] === 'favori'} uses={top.uses}
              className={`top ${drag ? 'dragging' : ''} ${fly ? 'flying' : ''}`} style={{ transform: tf }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; setDrag(null) }} />
            {hint && <div className={`stamp ${hint}`}>{hint === 'right' ? (tonight ? 'Ce soir!' : 'Au menu') : 'Passer'}</div>}
          </>
        ) : (
          <div className="rcard end">
            <h2>Pas trouvé ?</h2>
            <p className="muted">Ajoutez une recette ou demandez des idées.</p>
            <button className="btn primary block" onClick={() => setMore('ask')}><Icon name="search" size={18} /> Trouver des idées</button>
            <button className="btn block" onClick={() => setMore('add')}><Icon name="link" size={18} /> Lien ou photo</button>
            {filters.length > 0 && <button className="btn block" onClick={() => setFilters([])}>Retirer les filtres</button>}
            {seen.size > 0 && <button className="link center" onClick={reset}>Revoir toutes les cartes</button>}
          </div>
        )}
      </div>

      <div className="deck-actions">
        <button className="round sm" onClick={undo} disabled={!hist.length} aria-label="Annuler"><Icon name="undo" size={20} /></button>
        <button className="round no" onClick={() => decide('left')} disabled={!top} aria-label="Passer"><Icon name="close" size={28} /></button>
        <button className="round yes" onClick={() => decide('right')} disabled={!top} aria-label={tonight ? 'Cuisiner ce soir' : 'Ajouter au menu'}>
          {tonight ? <Icon name="chef" size={28} /> : <Icon name="check" size={28} />}</button>
        <button className="round sm" onClick={() => top && setDetail(top.r)} disabled={!top} aria-label="Voir la recette"><Icon name="info" size={20} /></button>
      </div>
      <p className="deck-help">{tonight ? 'Glissez à droite pour cuisiner, à gauche pour passer.' : `Glissez à droite pour ajouter au ${fmtDay(day)}, à gauche pour passer.`}</p>

      {more === 'add' && (
        <Sheet title="Ajouter une recette" onClose={() => setMore(null)}>
          <p className="muted small">Lien web, photo d'un livre ou PDF : la recette est rangée dans vos recettes {tonight ? 'et ouverte' : `et ajoutée au ${fmtDay(day)}`}.</p>
          <QuickAdd onSaved={async (r) => {
            data.reload(); setMore(null)
            const key = await onAdd(r, tonight ? today() : day, [])
            setHist((h) => [...h, { id: r.id, key }]); setSeen((s) => new Set(s).add(r.id))
            if (tonight) setDetail(r)
          }} />
          <div className="or">ou</div>
          <FindIdeas tags={filters} onResults={addIdeas} />
        </Sheet>
      )}
      {more === 'ask' && (
        <Sheet title="Trouver des idées" onClose={() => setMore(null)}>
          <p className="muted small">Les idées apparaissent comme des cartes. Glissez à droite pour les garder : elles s'ajoutent à vos recettes.</p>
          <FindIdeas tags={filters} onResults={addIdeas} />
        </Sheet>
      )}
      {detail && (
        <RecipeDetail recipe={detail} data={data} onClose={() => setDetail(null)} onChanged={() => { setDetail(null); data.reload() }}
          unsaved={!detail.id ? <button className="btn primary block" onClick={() => { setDetail(null); decide('right') }}>Garder cette recette</button> : null} />
      )}
    </div>
  )
}
