// Edge Function « lire-recette » : reçoit 1 à 4 photos d'une fiche recette (JPEG en base64),
// demande à Gemini (offre gratuite de l'API Google) de la réécrire simplement et renvoie
// { recipe: { titre, portions, ingredients, etapes, note } }.
// Seul un utilisateur connecté peut l'appeler ; la clé reste côté serveur (secret GEMINI_API_KEY).

import { withSupabase } from "npm:@supabase/server@1";

// Modèle inclus dans l'offre gratuite. S'il est retiré un jour, remplace-le par un modèle
// « Flash » plus récent listé sur https://ai.google.dev/gemini-api/docs/pricing.
const MODEL = "gemini-3.8-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_IMAGES = 4;

const RECIPE_SCHEMA = {
  type: "object",
  properties: {
    titre: { type: "string" },
    portions: { type: "string" },
    ingredients: { type: "array", items: { type: "string" } },
    etapes: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
  required: ["titre", "portions", "ingredients", "etapes", "note"],
};

const PROMPT = `Ces photos montrent une fiche recette (souvent une fiche de box repas, parfois recto et verso).
Réécris la recette en français, de façon simple et claire :

- titre : le nom du plat s'il est visible, sinon un titre court qui décrit le plat.
- portions : le nombre de personnes s'il est indiqué, sinon une chaîne vide.
- ingredients : la liste complète, un ingrédient par élément, au format « quantité ingrédient » (ex. « 2 carottes », « 150 ml d'eau chaude par personne »). Inclus aussi les ingrédients qui n'apparaissent que dans les étapes (beurre, huile, sel, poivre, sucre, eau…). N'invente jamais de quantité : si elle n'est pas lisible, écris seulement l'ingrédient.
- etapes : les étapes dans l'ordre, chacune en une ou deux phrases courtes. Retire les titres décoratifs (« On s'y met ! », « À vos fourchettes ! »…) mais garde les durées, feux, tailles de découpe et astuces utiles.
- note : l'astuce du chef ou une remarque utile (par exemple que la liste d'ingrédients n'était pas visible et a été déduite des étapes), sinon une chaîne vide.

Si les photos ne montrent pas de recette, renvoie des listes vides et explique-le dans note.`;

function error(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req) => {
    if (req.method !== "POST") return error(405, "Méthode non autorisée.");

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return error(500, "Secret GEMINI_API_KEY manquant dans Supabase.");

    let images: unknown;
    try {
      ({ images } = await req.json());
    } catch {
      return error(400, "Requête illisible.");
    }
    if (!Array.isArray(images) || images.length === 0 || images.length > MAX_IMAGES) {
      return error(400, `Envoie entre 1 et ${MAX_IMAGES} photos.`);
    }
    if (!images.every((img) => typeof img === "string" && img.length > 0)) {
      return error(400, "Photo invalide.");
    }

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                ...images.map((data) => ({ inlineData: { mimeType: "image/jpeg", data } })),
                { text: PROMPT },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: RECIPE_SCHEMA,
          },
        }),
      });
    } catch {
      return error(502, "Gemini ne répond pas, réessaie plus tard.");
    }

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body?.error?.message ?? `HTTP ${res.status}`;
      console.error("Gemini", res.status, detail);
      if (res.status === 429) {
        return error(429, "Quota gratuit de Gemini atteint pour le moment, réessaie plus tard.");
      }
      if (res.status === 400 && /api key/i.test(detail)) {
        return error(500, "Clé Gemini invalide : vérifie le secret GEMINI_API_KEY.");
      }
      if (res.status === 404) {
        return error(500, `Modèle ${MODEL} introuvable : mets à jour MODEL dans la fonction.`);
      }
      return error(502, `Erreur Gemini : ${detail}`);
    }

    const candidate = body?.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought)
      .map((part: { text: string }) => part.text)
      .join("");
    if (!text) {
      const reason = body?.promptFeedback?.blockReason ?? candidate?.finishReason ?? "réponse vide";
      return error(422, `Gemini n'a pas pu lire cette photo (${reason}). Réessaie avec une autre photo.`);
    }

    try {
      return Response.json({ recipe: JSON.parse(text) });
    } catch {
      return error(502, "Réponse de Gemini illisible, réessaie.");
    }
  }),
};
