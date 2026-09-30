// Edge Function « lire-recette » : reçoit 1 à 4 photos d'une fiche recette (JPEG en base64),
// demande à Gemini (offre gratuite de l'API Google) de la réécrire simplement et renvoie
// { recipe: { titre, portions, ingredients, etapes, note } }.
// Seul un utilisateur connecté peut l'appeler ; la clé reste côté serveur (secret GEMINI_API_KEY).

import { withSupabase } from "npm:@supabase/server@1";

// Modèles de l'offre gratuite, essayés dans l'ordre : si l'un est surchargé, épuisé
// ou retiré, on passe au suivant. Liste à jour sur https://ai.google.dev/gemini-api/docs/pricing.
const MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
const MAX_IMAGES = 4;
// Temps maximum par modèle : l'ensemble reste sous la limite de 150 s des Edge Functions.
const ATTEMPT_TIMEOUT_MS = 40_000;
// Erreurs pour lesquelles un autre modèle a des chances de répondre.
const TRY_NEXT = new Set([404, 408, 429, 500, 502, 503, 504]);

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

    const request = JSON.stringify({
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
    });

    // deno-lint-ignore no-explicit-any
    let body: any = null;
    let lastStatus = 0;
    for (const model of MODELS) {
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: request,
          signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        });
      } catch (err) {
        console.error("Gemini", model, "sans réponse :", String(err));
        lastStatus = 504;
        continue;
      }
      const json = await res.json().catch(() => null);
      if (res.ok) {
        body = json;
        break;
      }
      const detail = json?.error?.message ?? `HTTP ${res.status}`;
      console.error("Gemini", model, res.status, detail);
      lastStatus = res.status;
      if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(detail))) {
        return error(500, "Clé Gemini invalide : vérifie le secret GEMINI_API_KEY.");
      }
      if (!TRY_NEXT.has(res.status)) return error(502, `Erreur Gemini : ${detail}`);
    }
    if (!body) {
      return lastStatus === 429
        ? error(429, "Quota gratuit de Gemini atteint pour le moment, réessaie plus tard.")
        : error(503, "Gemini est surchargé en ce moment, réessaie dans quelques minutes.");
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
