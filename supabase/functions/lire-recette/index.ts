// Edge Function « lire-recette » : reçoit 1 à 4 photos d'une fiche recette (JPEG en base64),
// demande à Gemini de la réécrire simplement, en français et traduite en anglais, et renvoie
// { recipe: { titre, portions, ingredients, etapes, en: { title, servings, ingredients, steps } } }.
// Seul un utilisateur connecté peut l'appeler.

import { withSupabase } from "npm:@supabase/server@1";
import { askGemini, errorResponse, GeminiError, readImages } from "../_shared/gemini.ts";

const MAX_IMAGES = 4;

const RECIPE_SCHEMA = {
  type: "object",
  properties: {
    titre: { type: "string" },
    portions: { type: "string" },
    ingredients: { type: "array", items: { type: "string" } },
    etapes: { type: "array", items: { type: "string" } },
    en: {
      type: "object",
      properties: {
        title: { type: "string" },
        servings: { type: "string" },
        ingredients: { type: "array", items: { type: "string" } },
        steps: { type: "array", items: { type: "string" } },
      },
      required: ["title", "servings", "ingredients", "steps"],
    },
  },
  required: ["titre", "portions", "ingredients", "etapes", "en"],
};

const PROMPT = `Ces photos montrent une fiche recette (souvent une fiche de box repas, parfois recto et verso).
Réécris la recette en français, de façon simple et claire :

- titre : le nom du plat s'il est visible, sinon un titre court qui décrit le plat.
- portions : le nombre de personnes s'il est indiqué, sinon une chaîne vide.
- ingredients : la liste complète, un ingrédient par élément, au format « quantité ingrédient » (ex. « 2 carottes », « 150 ml d'eau chaude par personne »). Inclus aussi les ingrédients qui n'apparaissent que dans les étapes (beurre, huile, sel, poivre, sucre, eau…). N'invente jamais de quantité : si elle n'est pas lisible, écris seulement l'ingrédient.
- etapes : les étapes dans l'ordre, chacune en une ou deux phrases courtes. Retire les titres décoratifs (« On s'y met ! », « À vos fourchettes ! »…) et l'astuce du chef, mais garde les durées, feux, tailles de découpe et mentions « par personne ».
- en : toute la recette traduite en anglais naturel (title, servings, ingredients, steps), avec les mêmes éléments dans le même ordre. Écris « tsp » pour « cc » et « tbsp » pour « cs ».

N'ajoute aucune note ni astuce. Si les photos ne montrent pas de recette, renvoie des titres vides et des listes vides.`;

export default {
  fetch: withSupabase({ auth: "user" }, async (req) => {
    try {
      const images = await readImages(req, MAX_IMAGES);
      const recipe = await askGemini(images, PROMPT, RECIPE_SCHEMA);
      return Response.json({ recipe });
    } catch (err) {
      if (err instanceof GeminiError) return errorResponse(err.status, err.message);
      throw err;
    }
  }),
};
