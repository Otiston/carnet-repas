// Edge Function « cadrer-balance » : reçoit la photo d'une pesée (JPEG en base64) et demande
// à Gemini où se trouve l'écran de la balance. Renvoie { box: [ymin, xmin, ymax, xmax] }
// (coordonnées entre 0 et 1000), ou { box: null } si aucun écran n'est reconnu.
// L'appli recadre ensuite la photo elle-même. Seul un utilisateur connecté peut l'appeler.

import { withSupabase } from "npm:@supabase/server@1";
import { askGemini, errorResponse, GeminiError, readImages } from "../_shared/gemini.ts";

const SCHEMA = {
  type: "object",
  properties: {
    trouve: { type: "boolean" },
    box_2d: { type: "array", items: { type: "integer" } },
  },
  required: ["trouve", "box_2d"],
};

const PROMPT = `Cette photo montre une balance de salle de bain, souvent vue du dessus avec des pieds dessus.
Repère l'écran de la balance : l'afficheur numérique ou le cadran à aiguille qui indique le poids.
Réponds trouve = true et box_2d = [ymin, xmin, ymax, xmax], normalisé entre 0 et 1000, qui entoure tout l'écran (chiffres et unité compris) et le moins possible de ce qui l'entoure : ni pieds, ni sol.
Si aucun écran de balance n'est visible, réponds trouve = false et box_2d = [].`;

function validBox(box: unknown): box is [number, number, number, number] {
  if (!Array.isArray(box) || box.length !== 4) return false;
  if (!box.every((v) => typeof v === "number" && v >= 0 && v <= 1000)) return false;
  const [ymin, xmin, ymax, xmax] = box;
  return ymax - ymin >= 10 && xmax - xmin >= 10;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req) => {
    try {
      const images = await readImages(req, 1);
      const result = (await askGemini(images, PROMPT, SCHEMA)) as { trouve?: boolean; box_2d?: unknown };
      const box = result?.trouve && validBox(result.box_2d) ? result.box_2d : null;
      return Response.json({ box });
    } catch (err) {
      if (err instanceof GeminiError) return errorResponse(err.status, err.message);
      throw err;
    }
  }),
};
