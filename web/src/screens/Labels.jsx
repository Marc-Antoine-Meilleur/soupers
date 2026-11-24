// Étiquettes QR du congélateur : impression, lecture et mise à jour de l'inventaire
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { supabase, today, daysBetween, fmtLong, addDays, mondayOf } from '../lib'
import { useApp } from '../App'
import { Icon, Sheet, Spinner, Field } from '../ui'

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sans 0/O ni 1/I
export const newLabelCode = () => {
  const b = new Uint8Array(6); crypto.getRandomValues(b)
  return [...b].map((x) => ALPHA[x % ALPHA.length]).join('')
}
export const labelUrl = (code) => `${location.origin}${location.pathname}?e=${code}`
// Accepte une adresse d'étiquette ou le code tapé à la main
export function parseLabel(text) {
  const t = String(text || '').trim()
  let code = t
  try { const u = new URL(t); code = u.searchParams.get('e') || '' } catch { /* code tapé */ }
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^[A-Z0-9]{4,8}$/.test(code) ? code : null
}

// ---------- Impression : feuilles de 30 étiquettes (format Avery 5160 / 8160, 2-5/8 po × 1 po) ----------
export function PrintLabels({ onClose }) {
  const [sheets, setSheets] = useState(1)
  const [pages, setPages] = useState(null)
  useEffect(() => {
    let on = true
    const codes = Array.from({ length: sheets * 30 }, newLabelCode)
    Promise.all(codes.map((c) => QRCode.toString(labelUrl(c), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then((svg) => ({ c, svg }))))
      .then((list) => on && setPages(Array.from({ length: sheets }, (_, p) => list.slice(p * 30, p * 30 + 30))))
    return () => { on = false }
  }, [sheets])
  return (
    <>
      <Sheet title="Étiquettes QR" onClose={onClose}
        footer={<button className="btn primary block" disabled={!pages} onClick={() => window.print()}><Icon name="print" size={18} /> Imprimer</button>}>
        <p>Chaque étiquette a un code unique et vierge. Collez-la sur un sac ou un plat, puis <b>scannez-la dans l'app</b> pour dire ce qu'elle contient.</p>
        <Field label="Nombre de feuilles (30 étiquettes chacune)">
          <select value={sheets} onChange={(e) => setSheets(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} ({n * 30} étiquettes)</option>)}</select>
        </Field>
        <div className="note">
          <b>Papier :</b> étiquettes 2-5/8 po × 1 po, 30 par feuille (Avery 5160/8160 ou équivalent). Pour le congélateur, prenez des étiquettes
          <b> résistantes à l'eau pour jet d'encre</b> et collez-les à la température de la pièce, sur un sac sec, avant de congeler.
        </div>
        <p className="small muted">À l'impression : format Lettre, échelle 100 % (« taille réelle »), sans marges ajoutées. Imprimez d'abord une page sur du papier ordinaire et superposez-la pour vérifier l'alignement. Depuis un ordinateur, l'alignement est plus fiable.</p>
        {!pages && <Spinner />}
      </Sheet>
      {pages && createPortal(
        <div className="print-root" aria-hidden="true">
          {pages.map((page, p) => (
            <div key={p} className="label-page">
              {page.map(({ c, svg }) => (
                <div key={c} className="label">
                  <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
                  <div className="label-txt"><small>AU MENU</small><b>{c}</b><span>_____________</span></div>
                </div>
              ))}
            </div>
          ))}
        </div>, document.body,
      )}
    </>
  )
}

// ---------- Lecture d'une étiquette : caméra en direct, photo ou code tapé ----------
export function Scanner({ onCode, onClose, onPrint, title = 'Scanner une étiquette' }) {
  const video = useRef(null)
  const [live, setLive] = useState('start')
  const [manual, setManual] = useState('')
  const [err, setErr] = useState(null)

  useEffect(() => {
    let stream, timer, done = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const tick = () => {
      const v = video.current
      if (done || !v) return
      if (v.readyState >= 2 && v.videoWidth) {
        const k = Math.min(1, 640 / v.videoWidth)
        canvas.width = v.videoWidth * k; canvas.height = v.videoHeight * k
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
        const code = hit && parseLabel(hit.data)
        if (code) { done = true; navigator.vibrate?.(40); onCode(code); return }
      }
      timer = setTimeout(tick, 180)
    }
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-camera')
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (done) return
        video.current.srcObject = stream
        await video.current.play()
        setLive('on'); tick()
      } catch { setLive('off') }
    })()
    return () => { done = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Solution de rechange : photo prise avec l'appareil
  const fromPhoto = async (file) => {
    if (!file) return
    setErr(null)
    try {
      const bmp = await createImageBitmap(file)
      for (const size of [1000, 1600, 700]) {
        const k = Math.min(1, size / Math.max(bmp.width, bmp.height))
        const c = document.createElement('canvas'); c.width = bmp.width * k; c.height = bmp.height * k
        const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0, c.width, c.height)
        const hit = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height)
        const code = hit && parseLabel(hit.data)
        if (code) return onCode(code)
      }
      setErr('Aucun code lu. Rapprochez-vous et évitez les reflets.')
    } catch { setErr('Photo illisible.') }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <div className={`scan-view ${live}`}>
        <video ref={video} playsInline muted />
        {live === 'on' && <div className="scan-frame" />}
        {live === 'start' && <Spinner label="Ouverture de la caméra…" />}
        {live === 'off' && <p className="muted center">Caméra indisponible ici. Prenez une photo de l'étiquette.</p>}
      </div>
      <label className="btn block"><Icon name="camera" size={18} /> Prendre une photo de l'étiquette
        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => fromPhoto(e.target.files[0])} />
      </label>
      {err && <p className="note err">{err}</p>}
      <div className="inline-add">
        <input placeholder="ou tapez le code (ex. K7M2QX)" value={manual} autoCapitalize="characters" onChange={(e) => setManual(e.target.value)} />
        <button className="btn sm" disabled={!parseLabel(manual)} onClick={() => onCode(parseLabel(manual))}>OK</button>
      </div>
      {onPrint && <button className="link center" onClick={onPrint}><Icon name="print" size={16} /> Imprimer des étiquettes vierges</button>}
    </Sheet>
  )
}

// ---------- Que faire avec l'étiquette lue ----------
export function LabelAction({ code, onClose, onNew, onEdit, onDone }) {
  const { toast } = useApp()
  const [item, setItem] = useState(undefined)
  const [left, setLeft] = useState('')
  useEffect(() => {
    supabase.from('inventory_items').select('*').eq('label_code', code).maybeSingle().then(({ data }) => {
      setItem(data || null)
      if (data) setLeft(String(Math.max(0, Number(data.quantity) - 1) || ''))
    })
  }, [code])
  useEffect(() => { if (item === null) onNew(code) }, [item]) // eslint-disable-line react-hooks/exhaustive-deps

  // Coche aussi « Sorti » dans le plan de la semaine si l'article y était
  const syncThaw = async (id) => {
    const { data: plans } = await supabase.from('meal_plans').select('id,week_start,thaw').gt('week_start', addDays(mondayOf(), -15))
    for (const p of plans || []) {
      if ((p.thaw || []).some((t) => t.inventory_id === id && !t.done)) {
        await supabase.from('meal_plans').update({ thaw: p.thaw.map((t) => (t.inventory_id === id ? { ...t, done: true } : t)) }).eq('id', p.id)
      }
    }
  }
  const allUsed = async () => {
    await supabase.from('inventory_items').delete().eq('id', item.id)
    await syncThaw(item.id)
    toast(`${item.name} retiré de l'inventaire — l'étiquette peut être réutilisée`); onDone()
  }
  const keep = async () => {
    const q = Number(String(left).replace(',', '.'))
    if (!(q > 0)) return allUsed()
    await supabase.from('inventory_items').update({ quantity: q }).eq('id', item.id)
    await syncThaw(item.id)
    toast(`${item.name} : il en reste ${q} ${item.unit || ''}`); onDone()
  }

  if (item === undefined || item === null) return <Sheet title={`Étiquette ${code}`} onClose={onClose}><Spinner /></Sheet>
  const weeks = item.added_on ? Math.floor(daysBetween(item.added_on, today()) / 7) : null
  return (
    <Sheet title={item.name} onClose={onClose}>
      <div className="label-card">
        <span className="code-badge">{code}</span>
        <p><b>{Number(item.quantity)} {item.unit || ''}</b> · {item.location}</p>
        <p className="muted small">{item.added_on && <>Entré le {fmtLong(item.added_on)}{weeks > 0 && ` (${weeks} sem.)`}</>}{item.best_before && <> · avant le {fmtLong(item.best_before)}</>}</p>
        {item.notes && <p className="reason">{item.notes}</p>}
      </div>
      <button className="btn primary block" onClick={allUsed}><Icon name="check" size={18} /> Tout utilisé</button>
      <div className="left-row">
        <input type="number" inputMode="decimal" step="any" value={left} onChange={(e) => setLeft(e.target.value)} aria-label="Quantité restante" />
        <button className="btn" onClick={keep}>Il en reste</button>
      </div>
      <button className="btn block" onClick={() => onEdit(item)}><Icon name="edit" size={18} /> Modifier</button>
    </Sheet>
  )
}
