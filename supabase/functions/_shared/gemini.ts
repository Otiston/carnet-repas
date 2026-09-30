// Outils communs aux Edge Functions qui interrogent Gemini (offre gratuite de l'API Google) :
// lecture des photos envoyées par l'appli, appel avec repli sur plusieurs modèles, réponse JSON.
// La clé reste côté serveur (secret GEMINI_API_KEY).

// Modèles de l'offre gratuite, essayés dans l'ordre : si l'un est surchargé, épuisé
// ou retiré, on passe au suivant. Liste à jour sur https://ai.google.dev/gemini-api/docs/pricing.
const MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
// Temps maximum par modèle : l'ensemble reste sous la limite de 150 s des Edge Functions.
const ATTEMPT_TIMEOUT_MS = 40_000;
// Erreurs pour lesquelles un autre modèle a des chances de répondre.
const TRY_NEXT = new Set([404, 408, 429, 500, 502, 503, 504]);

/** Erreur à renvoyer telle quelle à l'appli (message en français pour l'utilisateur). */
export class GeminiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function errorResponse(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

/** Lit `{ images: [base64 JPEG, …] }` dans la requête de l'appli. */
export async function readImages(req: Request, max: number): Promise<string[]> {
  if (req.method !== "POST") throw new GeminiError(405, "Méthode non autorisée.");
  let images: unknown;
  try {
    ({ images } = await req.json());
  } catch {
    throw new GeminiError(400, "Requête illisible.");
  }
  if (!Array.isArray(images) || images.length === 0 || images.length > max) {
    throw new GeminiError(400, max === 1 ? "Envoie une photo." : `Envoie entre 1 et ${max} photos.`);
  }
  if (!images.every((img) => typeof img === "string" && img.length > 0)) {
    throw new GeminiError(400, "Photo invalide.");
  }
  return images;
}

/** Envoie les photos et la consigne à Gemini ; renvoie la réponse JSON conforme à `schema`. */
export async function askGemini(images: string[], prompt: string, schema: object): Promise<unknown> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new GeminiError(500, "Secret GEMINI_API_KEY manquant dans Supabase.");

  const request = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [...images.map((data) => ({ inlineData: { mimeType: "image/jpeg", data } })), { text: prompt }],
      },
    ],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema },
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
      throw new GeminiError(500, "Clé Gemini invalide : vérifie le secret GEMINI_API_KEY.");
    }
    if (!TRY_NEXT.has(res.status)) throw new GeminiError(502, `Erreur Gemini : ${detail}`);
  }
  if (!body) {
    throw lastStatus === 429
      ? new GeminiError(429, "Quota gratuit de Gemini atteint pour le moment, réessaie plus tard.")
      : new GeminiError(503, "Gemini est surchargé en ce moment, réessaie dans quelques minutes.");
  }

  const candidate = body.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought)
    .map((part: { text: string }) => part.text)
    .join("");
  if (!text) {
    const reason = body.promptFeedback?.blockReason ?? candidate?.finishReason ?? "réponse vide";
    throw new GeminiError(422, `Gemini n'a pas pu lire cette photo (${reason}). Réessaie avec une autre photo.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiError(502, "Réponse de Gemini illisible, réessaie.");
  }
}
