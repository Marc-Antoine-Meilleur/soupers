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

// ----- Fonction d'administration -----
export async function adminCall(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('admin', { body: { action, ...payload } })
  if (error) {
    let msg = error.message
    try { const b = await error.context.json(); msg = b.error || msg } catch { /* */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

// ----- Quantités et portions -----
const FRACTIONS = [[0, ''], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾'], [1, '']]
export function fmtNum(n) {
  if (n === null || n === undefined || n === '') return ''
  if (typeof n !== 'number' || !isFinite(n)) return String(n)
  if (n >= 20) return String(Math.round(n))
  if (n >= 10) return String(Math.round(n * 2) / 2).replace('.', ',')
  const whole = Math.floor(n)
  const frac = n - whole
  let best = FRACTIONS[0], diff = 1
  for (const f of FRACTIONS) { const d = Math.abs(frac - f[0]); if (d < diff) { diff = d; best = f } }
  if (diff <= 0.04) {
    const w = best[0] === 1 ? whole + 1 : whole
    return best[1] ? (w ? `${w} ${best[1]}` : best[1]) : String(w)
  }
  return (Math.round(n * 10) / 10).toString().replace('.', ',')
}
export const scaled = (q, factor) => (typeof q === 'number' ? q * factor : q)
export const fmtQty = (i, factor = 1) => [fmtNum(scaled(i.quantity, factor)), i.unit].filter((x) => x !== null && x !== undefined && x !== '').join(' ')

// ----- Statistiques d'avis -----
export function reviewStats(reviews) {
  const map = new Map()
  for (const r of reviews || []) {
    const s = map.get(r.recipe_id) || { taste: [], minutes: [], n: 0 }
    s.n++
    if (r.taste !== null && r.taste !== undefined) s.taste.push(r.taste)
    if (r.minutes) s.minutes.push(r.minutes)
    map.set(r.recipe_id, s)
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
  for (const [k, s] of map) map.set(k, { n: s.n, taste: avg(s.taste), tasteN: s.taste.length, minutes: avg(s.minutes) })
  return map
}
export const fmtStars = (v) => (v === null || v === undefined ? '' : (Math.round(v * 10) / 10).toString().replace('.', ','))

// ----- Collage depuis Excel / Google Sheets -----
export function parseTable(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim())
  if (!lines.length) return []
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  return lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, '')))
}
export function parseDate(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
  if (m) {
    let [a, b, y] = [+m[1], +m[2], +m[3]]
    if (y < 100) y += 2000
    let d = a, mo = b
    if (b > 12 && a <= 12) { d = b; mo = a } // format américain
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  if (/^\d{5}$/.test(s) && +s > 30000 && +s < 70000) { // numéro de série Excel
    const dt = new Date(Date.UTC(1899, 11, 30) + +s * 86400000)
    return dt.toISOString().slice(0, 10)
  }
  return null
}
export function parseQtyUnit(v) {
  const s = String(v ?? '').trim().replace(',', '.')
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([^\d].*)?$/)
  if (!m) return { quantity: null, unit: s || null }
  return { quantity: Number(m[1]), unit: m[2]?.trim() || null }
}
export function normLocation(v, fallback) {
  const s = String(v || '').toLowerCase()
  if (/cong|freez/.test(s)) return 'Congélateur'
  if (/frig|réfri|refri|fridge/.test(s)) return 'Réfrigérateur'
  if (/garde|pantry|armoire|épicerie|sec/.test(s)) return 'Garde-manger'
  return fallback
}

// ----- Étiquettes (même liste que la fonction IA) -----
export const TAG_GROUPS = [
  ['Type', ['Soupe', 'Plat principal', 'Accompagnement', 'Sauce', 'Salade', 'Déjeuner', 'Dessert']],
  ['Alimentation', ['Sans lactose', 'Sans gluten', 'Végé', 'Faible en glucides', 'Faible en sucre', 'Riche en protéines']],
  ['Pratique', ['Rapide', 'Mijoteuse', 'Une casserole', 'Se congèle', 'BBQ']],
]
export const TAGS = TAG_GROUPS.flatMap(([, t]) => t)
// Une recette « d'accompagnement » se combine avec un plat le même soir
export const SIDE_TAGS = ['Soupe', 'Accompagnement', 'Sauce', 'Salade']
export const isSide = (r) => (r?.tags || []).some((t) => SIDE_TAGS.includes(t)) && !(r?.tags || []).includes('Plat principal')
const lowerTags = new Map(TAGS.map((t) => [t.toLowerCase(), t]))
export const canonTag = (t) => lowerTags.get(String(t).trim().toLowerCase()) || String(t).trim()

// Identifiant court pour une entrée du menu
export const newKey = () => Math.random().toString(36).slice(2, 10)

// Réduit une photo (JPEG ~1200 px) avant l'envoi : plus rapide et moins d'espace
export async function resizeImage(file, max = 1200, quality = 0.82) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality))
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
  } catch { return file }
}

// Envoie un fichier dans le dossier privé du foyer
export async function uploadFile(file, householdId) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
  const path = `${householdId}/${crypto.randomUUID ? crypto.randomUUID() : Date.now()}.${ext}`
  const { error } = await supabase.storage.from('recipe-files').upload(path, file, { contentType: file.type })
  if (error) throw error
  return path
}

// Liens signés des photos (gardés en mémoire 50 min)
const photoCache = new Map()
export async function photoUrl(path) {
  if (!path) return null
  const c = photoCache.get(path)
  if (c && c.until > Date.now()) return c.url
  const { data } = await supabase.storage.from('recipe-files').createSignedUrl(path, 3600)
  const url = data?.signedUrl && data.signedUrl !== '#' ? data.signedUrl : null
  photoCache.set(path, { url, until: Date.now() + 50 * 60000 })
  return url
}

// Importe une recette depuis un lien, un texte ou un fichier (photo, PDF) et l'enregistre dans l'archive
export async function importAndSave({ link, text, file }, { householdId, author }) {
  let recipe, extra = {}
  if (file) {
    const small = await resizeImage(file, 2000, 0.85)
    const path = await uploadFile(small, householdId)
    recipe = (await ai('import_file', { path })).recipe
    extra = { file_path: path }
  } else if (link) {
    recipe = (await ai('import_url', { url: link })).recipe
    extra = { source_url: link }
  } else recipe = (await ai('import_text', { text })).recipe
  if (!recipe || recipe.error) throw new Error(recipe?.error || 'Aucune recette trouvée')
  return saveRecipe({ ...recipe, ...extra, needs_review: true }, author)
}
export async function saveRecipe(recipe, author) {
  const { id: _i, _new, _day, ...row } = recipe
  const { data, error } = await supabase.from('recipes').insert({ ...row, author_name: author }).select().single()
  if (error) throw error
  return data
}

// Score pour l'ordre des cartes : inventaire, notes, favoris, variété, temps
export function rankRecipes(recipes, { stats, prefs, inventory = [], recentIds = new Set(), maxMinutes }) {
  const inv = inventory.map((i) => i.name.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3)).filter((w) => w.length)
  return recipes
    .filter((r) => prefs[r.id] !== 'bloquee')
    .map((r) => {
      const st = stats.get(r.id)
      const min = st?.minutes || r.prep_minutes
      const ingNames = (r.ingredients || []).map((i) => (i.name || '').toLowerCase())
      const uses = inventory.filter((_, k) => inv[k] && ingNames.some((n) => inv[k].some((w) => n.includes(w)))).map((i) => i.name)
      let score = Math.random() * 1.5
      score += uses.length * 2
      if (st?.taste != null) score += (st.taste - 3) * 1.2
      if (prefs[r.id] === 'favori') score += 2.5
      if (recentIds.has(r.id)) score -= 4
      if (maxMinutes && min && min > maxMinutes) score -= 2
      return { r, score, uses }
    })
    .sort((a, b) => b.score - a.score)
}
