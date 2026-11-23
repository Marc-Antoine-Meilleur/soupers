import { useState } from 'react'
import { supabase, HEALTH_OPTIONS, WEEKDAYS, APP_VERSION } from './lib'
import { useApp } from './App'
import { Field, Icon, Sheet } from './ui'

// Critères de planification — utilisés dans « Semaine » et dans « Réglages »
export function CriteriaForm() {
  const { household, saveSettings } = useApp()
  const s = household.settings
  const [custom, setCustom] = useState('')
  const [avoid, setAvoid] = useState(s.avoid || '')
  const [likes, setLikes] = useState(s.likes || '')
  const toggleIn = (key, v) => saveSettings({ [key]: (s[key] || []).includes(v) ? s[key].filter((x) => x !== v) : [...(s[key] || []), v] })
  return (
    <>
      <div className="field"><span>Soirs à planifier</span>
        <div className="chips">{WEEKDAYS.map((w, i) => (
          <button key={w} className={`chip ${s.plan_days.includes(i) ? 'on' : ''}`} onClick={() => toggleIn('plan_days', i)}>{w}</button>
        ))}</div>
      </div>
      <div className="three">
        <Field label="Portions"><input type="number" inputMode="numeric" min="1" max="20" value={s.servings} onChange={(e) => saveSettings({ servings: +e.target.value })} /></Field>
        <Field label="Max semaine (min)"><input type="number" inputMode="numeric" min="5" value={s.max_minutes_weekday} onChange={(e) => saveSettings({ max_minutes_weekday: +e.target.value })} /></Field>
        <Field label="Max fin de sem."><input type="number" inputMode="numeric" min="5" value={s.max_minutes_weekend} onChange={(e) => saveSettings({ max_minutes_weekend: +e.target.value })} /></Field>
      </div>
      <div className="field"><span>Santé</span>
        <div className="chips">
          {[...new Set([...HEALTH_OPTIONS, ...(s.health || [])])].map((h) => (
            <button key={h} className={`chip ${(s.health || []).includes(h) ? 'on' : ''}`} onClick={() => toggleIn('health', h)}>{h}</button>
          ))}
        </div>
        <div className="inline-add">
          <input placeholder="Autre objectif santé…" maxLength={80} value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button className="btn sm" disabled={!custom.trim()} onClick={() => { saveSettings({ health: [...(s.health || []), custom.trim()] }); setCustom('') }}>Ajouter</button>
        </div>
      </div>
      <Field label="À éviter (allergies, aversions)"><input maxLength={300} value={avoid} onChange={(e) => setAvoid(e.target.value)} onBlur={() => saveSettings({ avoid })} placeholder="ex. fruits de mer, coriandre" /></Field>
      <Field label="On aime"><input maxLength={300} value={likes} onChange={(e) => setLikes(e.target.value)} onBlur={() => saveSettings({ likes })} placeholder="ex. mexicain, mijoteuse, BBQ l'été" /></Field>
    </>
  )
}

// Bouton « Commentaire » présent sur chaque écran : sert aux itérations
export function FeedbackButton({ screen }) {
  const { profile, toast } = useApp()
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const send = async () => {
    const { error } = await supabase.from('feedback').insert({ message: msg.trim(), screen, author_name: profile.display_name, app_version: APP_VERSION })
    if (error) return toast('Erreur : ' + error.message)
    setMsg(''); setOpen(false); toast('Merci! Commentaire enregistré')
  }
  return (
    <>
      <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Donner un commentaire"><Icon name="chat" /></button>
      {open && (
        <Sheet title="Un commentaire?" onClose={() => setOpen(false)}
          footer={<button className="btn primary block" disabled={!msg.trim()} onClick={send}>Envoyer</button>}>
          <p className="muted small">Ce qui irrite, ce qui manque, une idée… Tout est conservé dans Réglages → Commentaires pour la prochaine amélioration.</p>
          <textarea rows={5} maxLength={4000} autoFocus value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={`Écran : ${screen}`} />
        </Sheet>
      )}
    </>
  )
}
