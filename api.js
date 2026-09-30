// Tout ce qui parle à Supabase (connexion, base, photos, lecture de recette) passe par ici.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js?v=__VERSION__";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
// Photos des repas : lisibles par tous. Photos de la balance : propriétaire seulement.
const PUBLIC_BUCKET = "photos";
const PRIVATE_BUCKET = "pesees";
const bucketFor = (kind) => (kind === "pesee" ? PRIVATE_BUCKET : PUBLIC_BUCKET);
const SIGNED_URL_SECONDS = 60 * 60;

let userId = null;
const signedCache = new Map(); // chemin -> { url, expires }

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

/** Envoie la photo et sa miniature ; renvoie leurs chemins. `kind` : "repas" ou "pesee". */
export async function uploadPhoto(day, kind, full, thumb) {
  const bucket = supabase.storage.from(bucketFor(kind));
  const base = `${userId}/${day}/${kind}-${Date.now()}`;
  const path = `${base}.jpg`;
  const thumbPath = `${base}-mini.jpg`;
  // Chaque photo a un nom unique : le navigateur peut la garder en cache un an.
  const options = { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" };
  const results = await Promise.all([bucket.upload(path, full, options), bucket.upload(thumbPath, thumb, options)]);
  const failed = results.find((r) => r.error);
  if (failed) {
    await removeFiles(kind, [path, thumbPath]);
    throw failed.error;
  }
  return { path, thumb: thumbPath };
}

export async function removeFiles(kind, paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  for (const p of list) signedCache.delete(p);
  await supabase.storage.from(bucketFor(kind)).remove(list);
  // Les photos de balance d'avant le stockage privé étaient dans le bucket public.
  if (kind === "pesee") await supabase.storage.from(PUBLIC_BUCKET).remove(list);
}

/** Adresses publiques des photos de repas. */
export function photoUrls(paths) {
  const bucket = supabase.storage.from(PUBLIC_BUCKET);
  return new Map(paths.filter(Boolean).map((p) => [p, bucket.getPublicUrl(p).data.publicUrl]));
}

/** Adresses temporaires (1 h) des photos de balance, pour le propriétaire connecté seulement. */
export async function privatePhotoUrls(paths) {
  const now = Date.now();
  const wanted = [...new Set(paths.filter(Boolean))];
  const missing = wanted.filter((p) => !(signedCache.get(p)?.expires > now));
  if (missing.length) {
    const { data, error } = await supabase.storage
      .from(PRIVATE_BUCKET)
      .createSignedUrls(missing, SIGNED_URL_SECONDS);
    if (error) throw error;
    for (const item of data) {
      if (item.signedUrl) {
        signedCache.set(item.path, { url: item.signedUrl, expires: now + (SIGNED_URL_SECONDS - 120) * 1000 });
      }
    }
  }
  return new Map(wanted.filter((p) => signedCache.has(p)).map((p) => [p, signedCache.get(p).url]));
}

// --- Fonctions Gemini (lecture de recette, recadrage de la balance) ---------

/** Appelle une Edge Function ; en cas d'échec, lève son message d'erreur en français. */
async function invoke(name, body, fallbackMessage) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = fallbackMessage;
    try {
      const json = await error.context.json();
      if (json?.error) message = json.error;
    } catch {
      // pas de corps JSON : on garde le message générique
    }
    throw new Error(message);
  }
  return data;
}

/** `images` : JPEG en base64 (sans préfixe data:). Renvoie { titre, portions, ingredients, etapes, note }. */
export async function readRecipe(images) {
  return (await invoke("lire-recette", { images }, "La lecture de la recette a échoué.")).recipe;
}

/** Où est l'écran de la balance sur la photo ? Renvoie [ymin, xmin, ymax, xmax] (0 à 1000) ou null. */
export async function frameScale(image) {
  return (await invoke("cadrer-balance", { images: [image] }, "Le recadrage de la photo a échoué.")).box;
}
