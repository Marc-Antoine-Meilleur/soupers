// Mode démo : imite Supabase en mémoire (sauvegardé localement) pour essayer l'app sans compte.
const KEY = 'soupers-demo-db'
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))

function seed() {
  const hh = 'demo-foyer'
  const t = new Date()
  const iso = (n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
  const r = (title, min, tags, ing, extra = {}) => ({
    id: uid(), household_id: hh, title, prep_minutes: min, servings: 4, tags, shared: false,
    author_name: 'Moi', description: '', steps: ['Préparer les ingrédients.', 'Cuire.', 'Servir.'],
    ingredients: ing.map(([name, quantity, unit, category]) => ({ name, quantity, unit, category })),
    health_notes: '', created_at: new Date().toISOString(), ...extra,
  })
  return {
    session: null,
    users: [],
    households: [{ id: hh, name: 'Foyer démo', invite_code: 'DEMO42', settings: {
      stores: ['Maxi', 'IGA', 'Costco'], category_store: { 'Viandes et poissons': 'Costco', 'Fruits et légumes': 'Maxi' },
      plan_days: [0, 1, 2, 3, 4, 5, 6], servings: 4, max_minutes_weekday: 40, max_minutes_weekend: 90,
      health: ['Réduire les glucides', 'Réduire le sucre'], avoid: '', likes: 'Mexicain, asiatique',
    } }],
    profiles: [{ id: 'ami-1', display_name: 'Julie', household_id: 'autre' }],
    recipes: [
      r('Poulet au beurre allégé', 35, ['Plat principal', 'Riche en protéines', 'Faible en glucides', 'poulet'], [['poitrine de poulet', 800, 'g', 'Viandes et poissons'], ['yogourt grec', 1, 'tasse', 'Produits laitiers et oeufs'], ['tomates broyées', 1, 'boîte', 'Conserves et sauces']], { shared: true, rating: 5, health_notes: 'Riche en protéines, servir avec chou-fleur en riz.' }),
      r('Tacos de porc effiloché', 30, ['Plat principal', 'Rapide', 'porc'], [['porc haché', 500, 'g', 'Viandes et poissons'], ['tortillas', 8, null, 'Boulangerie'], ['avocat', 2, null, 'Fruits et légumes']]),
      r('Saumon teriyaki et brocoli', 25, ['Plat principal', 'Rapide', 'Sans lactose', 'Faible en glucides'], [['filet de saumon', 4, null, 'Viandes et poissons'], ['brocoli', 1, null, 'Fruits et légumes'], ['sauce soya', 3, 'c. à soupe', 'Conserves et sauces']], { rating: 4 }),
      r('Chili végé aux haricots noirs', 40, ['Plat principal', 'Végé', 'Se congèle', 'Mijoteuse'], [['haricots noirs', 2, 'boîtes', 'Conserves et sauces'], ['poivrons', 2, null, 'Fruits et légumes'], ['oignon', 1, null, 'Fruits et légumes']]),
      r('Crème de courge rôtie', 45, ['Soupe', 'Végé', 'Se congèle'], [['courge butternut', 1, null, 'Fruits et légumes'], ['bouillon de légumes', 1, 'l', 'Conserves et sauces'], ['oignon', 1, null, 'Fruits et légumes']], { description: 'Veloutée, parfumée au gingembre.' }),
      r('Salade de chou croquante', 15, ['Accompagnement', 'Salade', 'Rapide', 'Végé'], [['chou vert', 0.5, null, 'Fruits et légumes'], ['carottes', 2, null, 'Fruits et légumes'], ['vinaigre de cidre', 2, 'c. à soupe', 'Conserves et sauces']]),
      r('Soupe-repas thaï au poulet', 30, ['Soupe', 'Sans lactose', 'poulet'], [['cuisses de poulet', 600, 'g', 'Viandes et poissons'], ['lait de coco', 1, 'boîte', 'Conserves et sauces'], ['pâte de cari rouge', 2, 'c. à soupe', 'Épices et condiments']], { household_id: 'autre', author_name: 'Julie', shared: true }),
    ],
    inventory_items: [
      { id: uid(), household_id: hh, label_code: 'K7M2QX', name: 'Porc haché', quantity: 2, unit: 'paquets de 500 g', location: 'Congélateur', category: 'Viandes et poissons', added_on: iso(-70), best_before: iso(20) },
      { id: uid(), household_id: hh, name: 'Poitrines de poulet', quantity: 6, unit: 'unités', location: 'Congélateur', category: 'Viandes et poissons', added_on: iso(-20), best_before: iso(120) },
      { id: uid(), household_id: hh, name: 'Brocoli surgelé', quantity: 1, unit: 'sac', location: 'Congélateur', category: 'Surgelés', added_on: iso(-10), best_before: iso(5) },
      { id: uid(), household_id: hh, name: 'Riz basmati', quantity: 2, unit: 'kg', location: 'Garde-manger', category: 'Épicerie sèche', added_on: iso(-30) },
    ],
    meal_plans: [],
    shopping_items: [],
    feedback: [],
    ai_usage: [],
    recipe_reviews: [],
    recipe_prefs: [],
  }
}

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed() } catch { return seed() } }
let db = load()
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)) } catch { /* */ } }
const listeners = new Set()
const myHH = () => db.profiles.find((p) => p.id === db.session?.user.id)?.household_id

function visible(table) {
  const rows = db[table] || []
  const hh = myHH()
  if (table === 'recipes') return rows.filter((r) => r.household_id === hh || r.shared)
  if (table === 'profiles') return rows
  if (table === 'recipe_reviews') { const ids = new Set(visible('recipes').map((r) => r.id)); return rows.filter((r) => ids.has(r.recipe_id)) }
  if (table === 'recipe_prefs') return rows.filter((r) => r.user_id === db.session?.user.id)
  if (table === 'households') return rows.filter((r) => r.id === hh)
  return rows.filter((r) => r.household_id === hh)
}

class Query {
  constructor(table) { Object.assign(this, { table, filters: [], op: 'select', _single: false, _order: null, _limit: null }) }
  select() { if (this.op === 'select') this.op = 'select'; this._ret = true; return this }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this }
  neq(c, v) { this.filters.push((r) => r[c] !== v); return this }
  in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this }
  lt(c, v) { this.filters.push((r) => r[c] < v); return this }
  gt(c, v) { this.filters.push((r) => r[c] > v); return this }
  order(c, o = {}) { this._order = [c, o.ascending !== false]; return this }
  limit(n) { this._limit = n; return this }
  single() { this._single = true; return this }
  maybeSingle() { this._single = 'maybe'; return this }
  insert(rows) { this.op = 'insert'; this.rows = [].concat(rows); return this }
  upsert(row, o = {}) { this.op = 'upsert'; this.rows = [].concat(row); this.conflict = (o.onConflict || 'id').split(','); return this }
  update(vals) { this.op = 'update'; this.vals = vals; return this }
  delete() { this.op = 'delete'; return this }
  run() {
    const t = this.table
    db[t] = db[t] || []
    const match = (r) => this.filters.every((f) => f(r))
    let out = []
    const hh = myHH()
    const defaults = () => ({ ...(t === 'recipes' ? { shared: true } : {}), id: uid(), household_id: hh, user_id: db.session?.user.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    if (this.op === 'select') out = visible(t).filter(match)
    if (this.op === 'insert') { out = this.rows.map((r) => ({ ...defaults(), ...r })); db[t].push(...out) }
    if (this.op === 'upsert') {
      out = this.rows.map((r) => {
        const full = { ...defaults(), ...r }
        const ex = db[t].find((x) => this.conflict.every((c) => x[c] === full[c]))
        if (ex) { Object.assign(ex, r); return ex }
        db[t].push(full); return full
      })
    }
    if (this.op === 'update') { out = visible(t).filter(match); out.forEach((r) => Object.assign(r, this.vals)) }
    if (this.op === 'delete') { const del = new Set(visible(t).filter(match)); db[t] = db[t].filter((r) => !del.has(r)); out = [...del] }
    if (this.op !== 'select') { save(); listeners.forEach((l) => l(t)) }
    out = out.map((r) => ({ ...r }))
    if (this._order) { const [c, asc] = this._order; out.sort((a, b) => (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1)) }
    if (this._limit) out = out.slice(0, this._limit)
    if (this._single) {
      if (!out.length) return this._single === 'maybe' ? { data: null, error: null } : { data: null, error: { message: 'Introuvable' } }
      return { data: out[0], error: null }
    }
    return { data: out, error: null }
  }
  then(res, rej) { return new Promise((r) => setTimeout(() => r(this.run()), 120)).then(res, rej) }
}

const blobs = new Map()
const authSubs = new Set()
const emit = (ev) => authSubs.forEach((cb) => cb(ev, db.session))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function fakePlan(dates) {
  const recs = visible('recipes')
  return {
    summary: 'Démo : semaine équilibrée qui utilise le porc haché du congélateur en priorité et reste faible en glucides.',
    days: dates.map((date, i) => {
      const r = recs[i % recs.length]
      return i === dates.length - 1
        ? { date, recipe_id: null, title: 'Bols poke au thon (nouvelle idée)', minutes: 20, reason: 'Nouvelle recette pour varier', uses_inventory: [],
          new_recipe: { title: 'Bols poke au thon', servings: 4, prep_minutes: 20, tags: ['poisson', 'rapide'], description: 'Bols frais.', health_notes: 'Servir sur riz de chou-fleur pour réduire les glucides.',
            ingredients: [{ name: 'thon frais', quantity: 500, unit: 'g', category: 'Viandes et poissons' }, { name: 'concombre', quantity: 1, unit: null, category: 'Fruits et légumes' }],
            steps: ['Couper le thon en dés.', 'Assembler les bols.'] } }
        : { date, recipe_id: r.id, title: r.title, minutes: r.prep_minutes, reason: i === 1 ? 'Utilise le porc haché congelé depuis 10 semaines' : 'Favori du foyer', uses_inventory: i === 1 ? ['Porc haché'] : [], new_recipe: null }
    }),
  }
}

export function createMock() {
  return {
    from: (t) => new Query(t),
    async rpc(fn, args) {
      await wait(150)
      if (fn === 'create_household') {
        const h = { id: uid(), name: args.p_name, invite_code: Math.random().toString(36).slice(2, 8).toUpperCase(), settings: {} }
        db.households.push(h)
        db.profiles.find((p) => p.id === db.session.user.id).household_id = h.id
        save(); return { data: h, error: null }
      }
      if (fn === 'join_household') {
        const h = db.households.find((x) => x.invite_code === args.p_code.trim().toUpperCase())
        if (!h) return { data: null, error: null }
        db.profiles.find((p) => p.id === db.session.user.id).household_id = h.id
        save(); return { data: h, error: null }
      }
      if (fn === 'rotate_invite_code') {
        const h = db.households.find((x) => x.id === myHH()); h.invite_code = Math.random().toString(36).slice(2, 10).toUpperCase(); save()
        return { data: h.invite_code, error: null }
      }
      return { data: null, error: { message: 'rpc inconnu' } }
    },
    auth: {
      async getSession() { return { data: { session: db.session } } },
      onAuthStateChange(cb) { authSubs.add(cb); return { data: { subscription: { unsubscribe: () => authSubs.delete(cb) } } } },
      async signInWithPassword({ email }) {
        await wait(200)
        const id = 'demo-user'
        db.session = { user: { id, email } }
        if (!db.profiles.find((p) => p.id === id)) db.profiles.push({ id, display_name: email.split('@')[0], household_id: 'demo-foyer', is_admin: true })
        db.session.user.user_metadata = {}
        save(); emit('SIGNED_IN'); return { data: { session: db.session }, error: null }
      },
      async signUp({ email, options }) {
        const res = await this.signInWithPassword({ email })
        const p = db.profiles.find((x) => x.id === 'demo-user'); if (options?.data?.display_name) p.display_name = options.data.display_name
        save(); return res
      },
      async signOut() { db.session = null; save(); emit('SIGNED_OUT'); return { error: null } },
      async resetPasswordForEmail() { return { error: null } },
      async updateUser({ data }) { if (data) db.session.user.user_metadata = { ...db.session.user.user_metadata, ...data }; save(); emit('USER_UPDATED'); return { data: { user: db.session.user }, error: null } },
    },
    storage: {
      from: () => ({
        async upload(path, file) { await wait(200); try { blobs.set(path, URL.createObjectURL(file)) } catch { /* */ } return { data: { path }, error: null } },
        async createSignedUrl(path) { return { data: { signedUrl: blobs.get(path) || '#' }, error: null } },
        async remove() { return { error: null } },
      }),
    },
    functions: {
      async invoke(name, { body }) {
        await wait(name === 'admin' ? 300 : 900)
        if (name === 'admin') {
          if (body.action === 'overview') {
            const now = Date.now()
            const calls = Array.from({ length: 40 }, (_, i) => {
              const a = ['plan_week', 'shopping_list', 'import_file', 'import_url'][i % 4]
              const big = a === 'plan_week'
              const inT = big ? 22000 : 4000, outT = big ? 3000 : 1200
              return { created_at: new Date(now - i * 4 * 86400000).toISOString(), user_id: i % 3 ? 'demo-user' : 'ami-1', user_name: i % 3 ? 'Moi' : 'Julie',
                household_id: i % 3 ? 'demo-foyer' : 'autre', action: a, model: big ? 'claude-sonnet-5-5' : 'claude-haiku-5-5', input_tokens: inT, output_tokens: outT,
                cost_usd: big ? (inT * 2 + outT * 10) / 1e6 : (inT * 0.1 + outT * 0.5) / 1e6 }
            })
            return { data: { users: [
              { id: 'demo-user', email: 'vous@exemple.com', display_name: 'Moi', household_id: 'demo-foyer', is_admin: true, last_sign_in_at: new Date().toISOString() },
              { id: 'ami-1', email: 'julie@exemple.com', display_name: 'Julie', household_id: 'autre', is_admin: false, must_change_password: true },
            ], households: [{ id: 'demo-foyer', name: 'Foyer démo', community_id: 'c1' }, { id: 'autre', name: 'Famille de Julie', community_id: 'c1' }],
            communities: [{ id: 'c1', name: 'Ateliers du Champ Libre' }, { id: 'c2', name: 'Amis du chalet' }], calls,
            config: { credits_usd: 5, ai_daily_limit: 40, group_code: 'CHAMP-DEMO' }, usage_today: [{ household_id: 'demo-foyer', calls: 3 }] }, error: null }
          }
          if (body.action === 'create_user' || body.action === 'reset_password') return { data: { password: 'Demo7kQp2mXa', user_id: 'x' }, error: null }
          if (body.action === 'backup') return { data: { format: 'au-menu-backup', demo: true, ...db }, error: null }
          return { data: { ok: true }, error: null }
        }
        if (body.action === 'suggest') {
          await wait(800)
          const q = body.query || 'souper'
          const mk = (title, min, tags, url, desc) => ({ title, prep_minutes: min, servings: 4, tags, source_url: url, description: desc, health_notes: '',
            ingredients: [{ name: 'lentilles corail', quantity: 1, unit: 'tasse', category: 'Épicerie sèche' }, { name: 'carottes', quantity: 3, unit: null, category: 'Fruits et légumes' }],
            steps: ['Faire revenir les légumes.', 'Ajouter le reste et mijoter 20 minutes.', 'Rectifier l\'assaisonnement.'] })
          return { data: { recipes: [
            mk(`Soupe de lentilles corail (${q})`, 30, ['Soupe', 'Végé', 'Sans lactose', 'Se congèle'], body.mode === 'invent' ? null : 'https://www.ricardocuisine.com/recettes/exemple', 'Douce et épicée, prête en 30 minutes.'),
            mk('Bol de poulet au cari vert', 25, ['Plat principal', 'Rapide', 'Sans lactose'], body.mode === 'invent' ? null : 'https://www.troisfoisparjour.com/exemple', 'Un bol coloré du soir de semaine.'),
            mk('Galettes de saumon et salade', 20, ['Plat principal', 'Rapide', 'Faible en glucides', 'Riche en protéines'], null, 'Nouvelle idée, faible en glucides.'),
          ] }, error: null }
        }
        if (body.action === 'tag_recipes') {
          let n = 0
          db.recipes.filter((r) => r.household_id === myHH() && !(r.tags || []).some((t) => /^[A-ZÉ]/.test(t))).forEach((r) => { r.tags = ['Plat principal', ...(r.tags || [])]; n++ })
          save(); return { data: { tagged: n, remaining: 0 }, error: null }
        }
        if (body.action === 'plan_week') return { data: { plan: fakePlan(body.dates) }, error: null }
        if (body.action === 'group_pages') {
          const n = body.paths.length, groups = []
          for (let i = 1; i <= n; i += 3) groups.push({ title: `Recette démo ${groups.length + 1}`, pages: Array.from({ length: Math.min(3, n - i + 1) }, (_, k) => i + k) })
          return { data: { groups, ignore: [] }, error: null }
        }
        if (body.action === 'import_file' && /\.pdf$/.test(body.path)) {
          const mk = (title) => ({ title, servings: 4, prep_minutes: 30, tags: ['Plat principal'], ingredients: [{ name: 'oignon', quantity: 1, unit: null, category: 'Fruits et légumes' }], steps: ['Cuire.'], description: 'Extraite d\'un PDF (démo).' })
          const recipes = [mk('Ragoût de boulettes'), mk('Pâté au saumon')]
          return { data: { recipe: recipes[0], recipes }, error: null }
        }
        if (body.action === 'import_pages') return { data: { recipe: {
          title: `Recette de ${body.paths.length} page(s)`, description: 'Pages lues ensemble (démo).', servings: 4, prep_minutes: 40, tags: ['Plat principal'],
          ingredients: [{ name: 'poulet', quantity: 1, unit: 'kg', category: 'Viandes et poissons' }], steps: body.paths.map((_, k) => `Étape de la page ${k + 1}.`), health_notes: '' } }, error: null }
        if (body.action.startsWith('import_')) return { data: { recipe: {
          title: 'Pâté chinois revisité', description: 'Version démo extraite automatiquement.', servings: 6, prep_minutes: 50,
          ingredients: [{ name: 'boeuf haché', quantity: 1, unit: 'lb', category: 'Viandes et poissons' }, { name: 'maïs en crème', quantity: 1, unit: 'boîte', category: 'Conserves et sauces' }, { name: 'chou-fleur', quantity: 1, unit: null, category: 'Fruits et légumes' }],
          steps: ['Cuire le boeuf.', 'Étager avec le maïs.', 'Couvrir de purée de chou-fleur et gratiner.'], tags: ['Plat principal', 'Se congèle', 'Faible en glucides'], health_notes: 'Purée de chou-fleur au lieu de pommes de terre : moins de glucides.' } }, error: null }
        if (body.action === 'shopping_list') {
          const plan = db.meal_plans.find((p) => p.id === body.plan_id)
          db.shopping_items = db.shopping_items.filter((i) => i.plan_id !== plan.id)
          const items = [['Avocats', '2', 'Fruits et légumes', 'Maxi'], ['Tortillas', '1 paquet', 'Boulangerie', 'IGA'], ['Filets de saumon', '4', 'Viandes et poissons', 'Costco'], ['Yogourt grec', '500 g', 'Produits laitiers et oeufs', 'IGA'], ['Poivrons', '2', 'Fruits et légumes', 'Maxi']]
          items.forEach(([name, quantity, category, store]) => db.shopping_items.push({ id: uid(), household_id: myHH(), plan_id: plan.id, name, quantity, category, store, checked: false }))
          const inv = (n) => db.inventory_items.find((i) => i.name === n && i.household_id === myHH())
          plan.thaw = [{ inventory_id: inv('Porc haché')?.id, name: 'Porc haché', take: 1, unit: 'paquet', location: 'Congélateur', done: false },
            { inventory_id: inv('Poitrines de poulet')?.id, name: 'Poitrines de poulet', take: 4, unit: 'unités', location: 'Congélateur', done: false }]
          save(); listeners.forEach((l) => l('shopping_items'))
          return { data: { count: items.length }, error: null }
        }
        return { data: { error: 'action démo inconnue' }, error: null }
      },
    },
    channel() {
      const ch = { _cb: null, on(_e, _f, cb) { ch._cb = cb; return ch }, subscribe() { ch._l = (t) => t === 'shopping_items' && ch._cb?.({}); listeners.add(ch._l); return ch } }
      return ch
    },
    removeChannel(ch) { listeners.delete(ch._l) },
  }
}

export function resetDemo() { localStorage.removeItem(KEY); db = seed(); save() }
