import { createClient } from '@supabase/supabase-js'
import { createMock } from './mock'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_KEY

export const DEMO = !url || new URLSearchParams(location.search).has('demo')
export const supabase = DEMO
  ? createMock()
  : createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })

export async function ai(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('ai', { body: { action, ...payload } })
  if (error) {
    let msg = error.message
    try { const b = await error.context.json(); msg = b.error || msg } catch { /* */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export const CATEGORIES = [
  'Fruits et légumes', 'Viandes et poissons', 'Produits laitiers et oeufs', 'Boulangerie',
  'Épicerie sèche', 'Conserves et sauces', 'Épices et condiments', 'Surgelés', 'Autre',
]
export const LOCATIONS = ['Congélateur', 'Réfrigérateur', 'Garde-manger']
export const HEALTH_OPTIONS = [
  'Réduire les glucides', 'Réduire le sucre', 'Plus de protéines', 'Plus de légumes',
  'Moins de gras', 'Un souper végé par semaine', 'Poisson une fois par semaine',
]
export const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

// ----- Dates (toujours en heure locale) -----
export const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export function mondayOf(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return toISO(x)
}
export const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d) }
export const fmtDay = (iso) => fromISO(iso).toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' })
export const fmtLong = (iso) => fromISO(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' })
export const daysBetween = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000)
export const today = () => toISO(new Date())

export const DEFAULT_SETTINGS = {
  stores: ['Maxi', 'IGA', 'Costco'],
  category_store: {},
  plan_days: [0, 1, 2, 3, 4, 5, 6],
  servings: 4,
  max_minutes_weekday: 40,
  max_minutes_weekend: 90,
  health: ['Réduire les glucides', 'Réduire le sucre'],
  avoid: '',
  likes: '',
}

// eslint-disable-next-line no-undef
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

// N'accepte que des liens http(s) (bloque javascript:, data:, etc.)
export function safeUrl(u) {
  try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) ? x.href : null } catch { return null }
}

const UNITS = ['g', 'kg', 'lb', 'lbs', 'oz', 'ml', 'l', 'tasse', 'tasses', 'paquet', 'paquets', 'sac', 'sacs', 'boîte', 'boîtes',
  'contenant', 'contenants', 'portion', 'portions', 'unité', 'unités', 'pot', 'pots', 'filet', 'filets', 'morceau', 'morceaux', 'douzaine']

// « 2 paquets porc haché » → { quantity: 2, unit: 'paquets', name: 'Porc haché' }
export function parseQuick(line) {
  const t = line.trim().replace(/\s+/g, ' ')
  if (!t) return null
  const m = t.match(/^(\d+(?:[.,]\d+)?|\d+\/\d+)\s*(.*)$/)
  let quantity = 1, rest = t
  if (m) {
    quantity = m[1].includes('/') ? (([a, b]) => a / b)(m[1].split('/').map(Number)) : Number(m[1].replace(',', '.'))
    rest = m[2]
  }
  let unit = null
  const words = rest.split(' ')
  if (words.length > 1 && UNITS.includes(words[0].toLowerCase())) { unit = words.shift().toLowerCase() }
  if (words[0]?.toLowerCase() === 'de' || words[0]?.toLowerCase() === "d'") words.shift()
  const name = words.join(' ').replace(/^d'/i, '')
  if (!name) return null
  return { quantity, unit, name: name.charAt(0).toUpperCase() + name.slice(1) }
}

export function guessCategory(name) {
  const n = name.toLowerCase()
  if (/poulet|boeuf|bœuf|porc|veau|agneau|dinde|saumon|poisson|crevette|thon|morue|tilapia|saucisse|bacon|jambon|viande|steak|côtelette|filet/.test(n)) return 'Viandes et poissons'
  if (/surgel|congel|frite|pizza/.test(n)) return 'Surgelés'
  if (/lait|fromage|yogourt|yaourt|beurre|crème|oeuf|œuf/.test(n)) return 'Produits laitiers et oeufs'
  if (/pain|tortilla|pita|bagel|baguette/.test(n)) return 'Boulangerie'
  if (/riz|pâte|farine|quinoa|lentille|sucre|avoine|céréale/.test(n)) return 'Épicerie sèche'
  if (/sauce|conserve|boîte|bouillon|tomates broyées|haricot/.test(n)) return 'Conserves et sauces'
  if (/brocoli|carotte|oignon|poivron|légume|pomme|banane|laitue|épinard|chou|tomate|courge|ail|champignon|fruit|baie|petits pois|maïs/.test(n)) return 'Fruits et légumes'
  return null
}
