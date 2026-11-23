import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase, DEMO, DEFAULT_SETTINGS } from './lib'
import Auth, { NewPassword } from './screens/Auth'
import Onboarding from './screens/Onboarding'
import Week from './screens/Week'
import Recipes from './screens/Recipes'
import Inventory from './screens/Inventory'
import Shopping from './screens/Shopping'
import Settings from './screens/Settings'
import Admin from './screens/Admin'
import { Icon } from './ui'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

const TABS = [
  { id: 'week', label: 'Semaine', icon: 'calendar' },
  { id: 'recipes', label: 'Recettes', icon: 'book' },
  { id: 'inventory', label: 'Inventaire', icon: 'snow' },
  { id: 'shopping', label: 'Épicerie', icon: 'cart' },
  { id: 'settings', label: 'Réglages', icon: 'gear' },
]

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [household, setHousehold] = useState(null)
  const [tab, setTab] = useState(() => localStorage.getItem('soupers-tab') || 'week')
  const [toastMsg, setToastMsg] = useState(null)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((e, s) => { setSession(s); if (e === 'PASSWORD_RECOVERY') setRecovering(true) })
    return () => data.subscription.unsubscribe()
  }, [])

  const loadProfile = useCallback(async () => {
    if (!session) { setProfile(null); setHousehold(null); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
    setProfile(p || { id: session.user.id })
    if (p?.household_id) {
      const { data: h } = await supabase.from('households').select('*').eq('id', p.household_id).maybeSingle()
      setHousehold(h ? { ...h, settings: { ...DEFAULT_SETTINGS, ...(h.settings || {}) } } : null)
    } else setHousehold(null)
  }, [session])

  useEffect(() => { loadProfile() }, [loadProfile])

  const go = (t) => { setTab(t); localStorage.setItem('soupers-tab', t); window.scrollTo(0, 0) }
  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(null), 2600) }

  const saveSettings = async (patch) => {
    const settings = { ...household.settings, ...patch }
    setHousehold({ ...household, settings })
    const { error } = await supabase.from('households').update({ settings }).eq('id', household.id)
    if (error) toast('Erreur : ' + error.message)
  }

  if (session === undefined) return <div className="splash"><img className="brand-logo" src="./brand/logo.png" alt="Ateliers du Champ Libre" /></div>
  if (!session) return <Auth />
  if (recovering || session.user.user_metadata?.must_change_password) return <NewPassword first={!recovering} onDone={() => setRecovering(false)} />
  if (!profile) return <div className="splash"><img className="brand-logo" src="./brand/logo.png" alt="Ateliers du Champ Libre" /></div>

  const ctx = { session, profile, household, setProfile, reload: loadProfile, go, toast, saveSettings }

  return (
    <Ctx.Provider value={ctx}>
      {!household ? <Onboarding /> : (
        <div className="app">
          {DEMO && <div className="demo-band">Mode démo — les données restent sur cet appareil</div>}
          <main className="content">
            {tab === 'week' && <Week />}
            {tab === 'recipes' && <Recipes />}
            {tab === 'inventory' && <Inventory />}
            {tab === 'shopping' && <Shopping />}
            {tab === 'settings' && <Settings />}
            {tab === 'admin' && (profile.is_admin ? <Admin /> : <Settings />)}
          </main>
          <nav className="tabbar">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id || (tab === 'admin' && t.id === 'settings') ? 'on' : ''} onClick={() => go(t.id)}>
                <Icon name={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
      )}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </Ctx.Provider>
  )
}
