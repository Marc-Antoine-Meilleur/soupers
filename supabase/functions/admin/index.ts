// AU MENU · Ateliers du Champ Libre — fonction d'administration (Supabase Edge Function, Deno)
// Réservée aux comptes « is_admin ». Utilise la clé secrète du projet, jamais exposée au navigateur.
// Actions : overview, create_user, reset_password, move_user, delete_user, set_config,
//           create_household, set_household_community, create_community, rename_community
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const URL_ = Deno.env.get("SUPABASE_URL")!;

function keyFrom(legacyName: string, jsonName: string): string {
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get(jsonName) ?? "{}");
  const first = Object.values(keys)[0];
  if (typeof first !== "string") throw new Error(`Clé ${jsonName} introuvable`);
  return first;
}

class UserError extends Error {}
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function tempPassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const DEFAULT_SETTINGS = {
  stores: ["Maxi", "IGA", "Costco"], category_store: {}, plan_days: [0, 1, 2, 3, 4, 5, 6], servings: 4,
  max_minutes_weekday: 40, max_minutes_weekend: 90, health: ["Réduire les glucides", "Réduire le sucre"], avoid: "", likes: "",
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const cors = {
    "Access-Control-Allow-Origin": ALLOWED.length === 0 ? "*" : ALLOWED.includes(origin) ? origin : ALLOWED[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non permise" }, 405);

  try {
    // 1. Vérifier l'identité ET le rôle admin de l'appelant
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Non connecté" }, 401);
    const admin = createClient(URL_, keyFrom("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"), { auth: { persistSession: false } });
    const { data: { user } } = await admin.auth.getUser(authHeader.slice(7));
    if (!user) return json({ error: "Session expirée" }, 401);
    const { data: me } = await admin.from("profiles").select("is_admin,household_id").eq("id", user.id).single();
    if (!me?.is_admin) return json({ error: "Réservé à l'administrateur" }, 403);

    const body = await req.json();
    const action = body?.action;
    const firstCommunity = async () =>
      (await admin.from("communities").select("id").order("created_at").limit(1).maybeSingle()).data?.id ?? null;

    // ---------- Vue d'ensemble : utilisateurs, foyers, coûts ----------
    if (action === "overview") {
      const [{ data: list }, { data: profiles }, { data: households }, { data: calls }, { data: cfg }, { data: usage }, { data: communities }] = await Promise.all([
        admin.auth.admin.listUsers({ perPage: 1000 }),
        admin.from("profiles").select("id,display_name,household_id,is_admin"),
        admin.from("households").select("id,name,invite_code,created_at,community_id").order("name"),
        admin.from("ai_calls").select("created_at,user_id,user_name,household_id,action,model,input_tokens,output_tokens,cost_usd").order("created_at", { ascending: false }).limit(20000),
        admin.from("app_config").select("credits_usd,ai_daily_limit,group_code").single(),
        admin.from("ai_usage").select("household_id,calls").eq("day", new Date().toISOString().slice(0, 10)),
        admin.from("communities").select("id,name,created_at").order("created_at"),
      ]);
      const pmap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      const users = (list?.users ?? []).map((u: any) => ({
        id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
        display_name: pmap.get(u.id)?.display_name ?? null, household_id: pmap.get(u.id)?.household_id ?? null,
        is_admin: !!pmap.get(u.id)?.is_admin, must_change_password: !!u.user_metadata?.must_change_password,
      }));
      return json({ users, households, communities, calls, config: cfg, usage_today: usage });
    }

    // ---------- Créer un utilisateur (mot de passe temporaire) ----------
    if (action === "create_user") {
      const email = clean(body.email, 200).toLowerCase();
      const name = clean(body.display_name, 60);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError("Courriel invalide.");
      if (!name) throw new UserError("Prénom requis.");
      let householdId: string | null = isUuid(body.household_id) ? body.household_id : null;
      if (!householdId && clean(body.new_household, 80)) {
        const { data: h, error } = await admin.from("households").insert({
          name: clean(body.new_household, 80),
          community_id: isUuid(body.community_id) ? body.community_id : await firstCommunity(),
          settings: DEFAULT_SETTINGS,
        }).select().single();
        if (error) throw error;
        householdId = h.id;
      }
      const password = tempPassword();
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { display_name: name, must_change_password: true },
      });
      if (error) throw new UserError(error.message.includes("already") ? "Ce courriel a déjà un compte." : error.message);
      await admin.from("profiles").update({ display_name: name, household_id: householdId }).eq("id", data.user.id);
      return json({ user_id: data.user.id, password });
    }

    // ---------- Réinitialiser un mot de passe ----------
    if (action === "reset_password") {
      if (!isUuid(body.user_id)) throw new UserError("Utilisateur invalide.");
      const password = tempPassword();
      const { data: u } = await admin.auth.admin.getUserById(body.user_id);
      const { error } = await admin.auth.admin.updateUserById(body.user_id, {
        password, user_metadata: { ...(u?.user?.user_metadata ?? {}), must_change_password: true },
      });
      if (error) throw error;
      return json({ password });
    }

    // ---------- Changer un utilisateur de foyer ----------
    if (action === "move_user") {
      if (!isUuid(body.user_id)) throw new UserError("Utilisateur invalide.");
      const hid = isUuid(body.household_id) ? body.household_id : null;
      const { error } = await admin.from("profiles").update({ household_id: hid }).eq("id", body.user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    // ---------- Supprimer un utilisateur ----------
    if (action === "delete_user") {
      if (!isUuid(body.user_id)) throw new UserError("Utilisateur invalide.");
      if (body.user_id === user.id) throw new UserError("Vous ne pouvez pas supprimer votre propre compte.");
      const { data: target } = await admin.from("profiles").select("household_id").eq("id", body.user_id).single();
      const hid = target?.household_id;
      let movedRecipes = 0;
      if (hid) {
        const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("household_id", hid);
        if ((count ?? 0) <= 1) {
          // Dernier membre : ses recettes PARTAGÉES sont conservées dans le foyer de l'admin; le reste est supprimé.
          if (me.household_id && me.household_id !== hid) {
            const { data: moved } = await admin.from("recipes")
              .update({ household_id: me.household_id, file_path: null })
              .eq("household_id", hid).eq("shared", true).select("id");
            movedRecipes = moved?.length ?? 0;
          }
          const { data: files } = await admin.storage.from("recipe-files").list(hid, { limit: 1000 });
          if (files?.length) await admin.storage.from("recipe-files").remove(files.map((f: any) => `${hid}/${f.name}`));
          await admin.from("households").delete().eq("id", hid);
        }
      }
      const { error } = await admin.auth.admin.deleteUser(body.user_id);
      if (error) throw error;
      return json({ ok: true, moved_recipes: movedRecipes });
    }

    // ---------- Foyers et communautés ----------
    if (action === "create_household") {
      const name = clean(body.name, 80);
      if (!name) throw new UserError("Nom du foyer requis.");
      const { data, error } = await admin.from("households").insert({
        name, community_id: isUuid(body.community_id) ? body.community_id : await firstCommunity(), settings: DEFAULT_SETTINGS,
      }).select("id").single();
      if (error) throw error;
      return json({ id: data.id });
    }
    if (action === "set_household_community") {
      if (!isUuid(body.household_id)) throw new UserError("Foyer invalide.");
      const cid = isUuid(body.community_id) ? body.community_id : null;
      const { error } = await admin.from("households").update({ community_id: cid }).eq("id", body.household_id);
      if (error) throw error;
      return json({ ok: true });
    }
    if (action === "create_community") {
      const name = clean(body.name, 80);
      if (!name) throw new UserError("Nom de la communauté requis.");
      const { data, error } = await admin.from("communities").insert({ name }).select("id").single();
      if (error) throw error;
      return json({ id: data.id });
    }
    if (action === "rename_community") {
      const name = clean(body.name, 80);
      if (!isUuid(body.id) || !name) throw new UserError("Communauté invalide.");
      const { error } = await admin.from("communities").update({ name }).eq("id", body.id);
      if (error) throw error;
      return json({ ok: true });
    }

    // ---------- Sauvegarde complète (JSON) ----------
    if (action === "backup") {
      const tables = ["communities", "households", "profiles", "recipes", "recipe_reviews", "recipe_prefs", "inventory_items",
        "meal_plans", "shopping_items", "feedback", "ai_calls", "ai_usage", "app_config"];
      const out: Record<string, unknown> = {
        format: "au-menu-backup", version: 1, created_at: new Date().toISOString(), created_by: user.email,
      };
      for (const t of tables) {
        const rows: unknown[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await admin.from(t).select("*").range(from, from + 999);
          if (error) throw error;
          rows.push(...(data ?? []));
          if (!data || data.length < 1000) break;
        }
        out[t] = rows;
      }
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      out.users = (list?.users ?? []).map((u: any) => ({ id: u.id, email: u.email, created_at: u.created_at, display_name: u.user_metadata?.display_name }));
      // Liste des fichiers (PDF/photos) — les fichiers eux-mêmes restent dans le stockage Supabase
      const { data: folders } = await admin.storage.from("recipe-files").list("", { limit: 1000 });
      const files: string[] = [];
      for (const f of folders ?? []) {
        const { data: inner } = await admin.storage.from("recipe-files").list(f.name, { limit: 1000 });
        for (const x of inner ?? []) files.push(`${f.name}/${x.name}`);
      }
      out.storage_files = files;
      return json(out);
    }

    // ---------- Réglages : crédits prépayés, limite quotidienne, code du groupe ----------
    if (action === "set_config") {
      const patch: Record<string, unknown> = {};
      if (body.credits_usd != null && Number.isFinite(+body.credits_usd)) patch.credits_usd = Math.max(0, +body.credits_usd);
      if (body.ai_daily_limit != null && Number.isFinite(+body.ai_daily_limit)) patch.ai_daily_limit = Math.min(500, Math.max(1, Math.round(+body.ai_daily_limit)));
      if (clean(body.group_code, 40).length >= 6) patch.group_code = clean(body.group_code, 40);
      const { error } = await admin.from("app_config").update(patch).eq("id", true);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "Erreur inattendue." }, 500);
  }
});
