// Tout ce qui parle à Supabase (connexion, base, photos, lecture de recette) passe par ici.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js?v=__VERSION__";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const BUCKET = "photos";

let userId = null;

// --- Connexion -------------------------------------------------------------

export async function currentUser() {
  const { data } = await supabase.auth.getSession();
  userId = data.session?.user.id ?? null;
  return data.session?.user ?? null;
}

export function onSignedOut(callback) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      userId = null;
      callback();
    }
  });
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  userId = data.user.id;
  return data.user;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// --- Journées --------------------------------------------------------------

/** Lignes de `days` entre deux dates incluses (YYYY-MM-DD), indexées par date. */
export async function loadDays(from, to) {
  const { data, error } = await supabase
    .from("days")
    .select("*")
    .gte("day", from)
    .lte("day", to);
  if (error) throw error;
  return new Map(data.map((row) => [row.day, row]));
}

/** Crée ou complète la journée avec `fields` ; renvoie la ligne à jour. */
export async function saveDay(day, fields) {
  const { data, error } = await supabase
    .from("days")
    .upsert(
      { user_id: userId, day, ...fields, updated_at: new Date().toISOString() },
      { onConflict: "user_id,day" },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteDay(day) {
  const { error } = await supabase.from("days").delete().eq("day", day);
  if (error) throw error;
}

// --- Photos ----------------------------------------------------------------

/** Envoie la photo et sa miniature ; renvoie leurs chemins dans le bucket. */
export async function uploadPhoto(day, kind, full, thumb) {
  const base = `${userId}/${day}/${kind}-${Date.now()}`;
  const path = `${base}.jpg`;
  const thumbPath = `${base}-mini.jpg`;
  // Chaque photo a un nom unique : le navigateur peut la garder en cache un an.
  const options = { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" };
  const results = await Promise.all([
    supabase.storage.from(BUCKET).upload(path, full, options),
    supabase.storage.from(BUCKET).upload(thumbPath, thumb, options),
  ]);
  const failed = results.find((r) => r.error);
  if (failed) {
    await removeFiles([path, thumbPath]);
    throw failed.error;
  }
  return { path, thumb: thumbPath };
}

export async function removeFiles(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  await supabase.storage.from(BUCKET).remove(list);
}

/** Adresses publiques des photos (le bucket est lisible par tous). */
export function photoUrls(paths) {
  const bucket = supabase.storage.from(BUCKET);
  return new Map(paths.filter(Boolean).map((p) => [p, bucket.getPublicUrl(p).data.publicUrl]));
}

// --- Lecture de recette ----------------------------------------------------

/** `images` : JPEG en base64 (sans préfixe data:). Renvoie { titre, portions, ingredients, etapes, note }. */
export async function readRecipe(images) {
  const { data, error } = await supabase.functions.invoke("lire-recette", {
    body: { images },
  });
  if (error) {
    let message = "La lecture de la recette a échoué.";
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch {
      // pas de corps JSON : on garde le message générique
    }
    throw new Error(message);
  }
  return data.recipe;
}
