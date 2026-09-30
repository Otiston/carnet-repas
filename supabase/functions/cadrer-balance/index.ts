// Edge Function « cadrer-balance » : reçoit une photo de pesée (JPEG en base64) et demande
// à Gemini où se trouve l'écran de la balance. Renvoie
// { box: [ymin, xmin, ymax, xmax] (0 à 1000), shape: "rond" | "rectangle" },
// ou { box: null } si aucun écran n'est reconnu. L'appli recadre ensuite la photo elle-même
// (et l'appelle une seconde fois sur un zoom pour un cadrage plus serré).
// Seul un utilisateur connecté peut l'appeler.

import { withSupabase } from "npm:@supabase/server@1";
import { askGemini, errorResponse, GeminiError, readImages } from "../_shared/gemini.ts";

const SCHEMA = {
  type: "object",
  properties: {
    trouve: { type: "boolean" },
    forme: { type: "string", enum: ["rond", "rectangle"] },
    box_2d: { type: "array", items: { type: "integer" } },
  },
  required: ["trouve", "forme", "box_2d"],
};

const PROMPT = `Cette photo montre une balance de salle de bain, souvent vue du dessus avec des pieds dessus.
Repère uniquement l'écran qui indique le poids :
- balance à aiguille : le cadran rond (la vitre circulaire avec les graduations et l'aiguille) → forme = "rond" ;
- balance électronique : l'afficheur à chiffres → forme = "rectangle".

Réponds trouve = true et box_2d = [ymin, xmin, ymax, xmax], normalisé entre 0 et 1000.
La boîte doit être la plus serrée possible : ses bords touchent le bord extérieur du cadran ou de l'afficheur.
Elle ne contient ni le reste de la balance, ni les pieds, ni les orteils, ni le sol.
Si aucun écran de balance n'est visible, réponds trouve = false, forme = "rectangle" et box_2d = [].`;

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
      const result = (await askGemini(images, PROMPT, SCHEMA)) as {
        trouve?: boolean;
        forme?: string;
        box_2d?: unknown;
      };
      if (!result?.trouve || !validBox(result.box_2d)) return Response.json({ box: null });
      return Response.json({ box: result.box_2d, shape: result.forme === "rond" ? "rond" : "rectangle" });
    } catch (err) {
      if (err instanceof GeminiError) return errorResponse(err.status, err.message);
      throw err;
    }
  }),
};
