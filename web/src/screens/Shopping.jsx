import { useEffect, useState } from 'react'
import { supabase } from '../lib'
import { useApp } from '../App'
import { Icon, Spinner, Empty, Header } from '../ui'
import { FeedbackButton } from '../shared'

export default function Shopping() {
  const { household, toast, go } = useApp()
  const stores = household.settings.stores || []
  const [items, setItems] = useState(null)
  const [name, setName] = useState('')
  const [store, setStore] = useState(stores[0] || '')
  const [hideDone, setHideDone] = useState(false)

  const load = async () => {
    const { data } = await supabase.from('shopping_items').select('*').order('created_at')
    setItems(data || [])
  }
  useEffect(() => {
    load()
    const ch = supabase.channel('epicerie')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  const toggle = async (it) => {
    setItems(items.map((x) => (x.id === it.id ? { ...x, checked: !x.checked } : x)))
    await supabase.from('shopping_items').update({ checked: !it.checked }).eq('id', it.id)
  }
  const add = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    const m = name.trim().match(/^([\d.,/]+\s*\S*)\s+(.+)$/)
    await supabase.from('shopping_items').insert({ name: m ? m[2] : name.trim(), quantity: m ? m[1] : null, store: store || null, category: 'Autre' })
    setName(''); load()
  }
  const clearChecked = async () => {
    const ids = items.filter((i) => i.checked).map((i) => i.id)
    if (!ids.length) return
    await supabase.from('shopping_items').delete().in('id', ids)
    load(); toast(`${ids.length} article(s) retiré(s)`)
  }
  const clearAll = async () => {
    if (!confirm('Vider toute la liste?')) return
    await supabase.from('shopping_items').delete().in('id', items.map((i) => i.id))
    load()
  }
  const moveStore = async (it, s) => {
    setItems(items.map((x) => (x.id === it.id ? { ...x, store: s } : x)))
    await supabase.from('shopping_items').update({ store: s }).eq('id', it.id)
  }
  const share = async () => {
    const text = groups.map(([s, list]) => `${s}\n${list.filter((i) => !i.checked).map((i) => `☐ ${i.quantity ? i.quantity + ' ' : ''}${i.name}`).join('\n')}`).join('\n\n')
    if (navigator.share) { try { await navigator.share({ title: 'Liste d\'épicerie', text }) } catch { /* annulé */ } }
    else { await navigator.clipboard.writeText(text); toast('Liste copiée') }
  }

  const visibleItems = (items || []).filter((i) => !hideDone || !i.checked)
  const storeNames = [...new Set([...stores, ...visibleItems.map((i) => i.store || 'Sans épicerie')])]
  const groups = storeNames
    .map((s) => [s, visibleItems.filter((i) => (i.store || 'Sans épicerie') === s)
      .sort((a, b) => (a.checked - b.checked) || (a.category || '').localeCompare(b.category || ''))])
    .filter(([, l]) => l.length)
  const left = (items || []).filter((i) => !i.checked).length

  return (
    <>
      <Header title="Épicerie" sub={items ? `${left} article${left > 1 ? 's' : ''} à acheter` : ''}
        action={<div className="head-actions"><FeedbackButton screen="Épicerie" />{items?.length > 0 && <button className="btn sm" onClick={share}><Icon name="share" size={18} /> Partager</button>}</div>} />
      <form className="inline-add card" onSubmit={add}>
        <input placeholder="Ajouter (ex. 2 l lait)" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="Épicerie">
          {stores.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn primary sm" aria-label="Ajouter"><Icon name="plus" size={18} /></button>
      </form>
      {!items ? <Spinner /> : items.length === 0 ? (
        <Empty icon="cart" title="Liste vide">
          <p>Approuvez le plan de la semaine pour générer automatiquement la liste, classée par épicerie.</p>
          <button className="btn primary" onClick={() => go('week')}>Aller à ma semaine</button>
        </Empty>
      ) : (
        <>
          {groups.map(([s, list]) => (
            <section key={s} className="store">
              <h2>{s} <small>{list.filter((i) => !i.checked).length}</small></h2>
              <ul className="card checklist">
                {list.map((it) => (
                  <li key={it.id} className={it.checked ? 'done' : ''}>
                    <button className="check" onClick={() => toggle(it)} aria-label={it.checked ? 'Décocher' : 'Cocher'}>
                      {it.checked && <Icon name="check" size={16} />}
                    </button>
                    <div className="grow" onClick={() => toggle(it)}>
                      <span>{it.name}</span>
                      {it.quantity && <small>{it.quantity}</small>}
                    </div>
                    <select className="mini" value={it.store || ''} onChange={(e) => moveStore(it, e.target.value)} aria-label="Changer d'épicerie">
                      {[...new Set([...stores, it.store].filter(Boolean))].map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="stack">
            <label className="switch"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /><span>Masquer les articles cochés</span></label>
            <button className="btn block" onClick={clearChecked}>Retirer les articles cochés</button>
            <button className="btn danger block" onClick={clearAll}>Vider la liste</button>
          </div>
        </>
      )}
    </>
  )
}
