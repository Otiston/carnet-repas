// Outils communs aux Edge Functions qui interrogent Gemini (offre gratuite de l'API Google) :
// lecture des photos envoyées par l'appli, appel avec repli sur plusieurs modèles, réponse JSON.
// La clé reste côté serveur (secret GEMINI_API_KEY).

// Modèles de l'offre gratuite, essayés dans l'ordre. Chacun a son propre quota gratuit : si l'un
// est surchargé, épuisé ou retiré, on passe au suivant. Les « Flash » lisent le mieux ; les
// « Flash-Lite », moins demandés, prennent le relais. Liste à jour (modèles marqués
// « Free of charge ») sur https://aistudio.google.com/docs/pricing.
const MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
];
// Temps maximum par modèle, et pour l'ensemble : les Edge Functions sont coupées à 150 s.
const ATTEMPT_TIMEOUT_MS = 45_000;
const TOTAL_BUDGET_MS = 135_000;
// En dessous, inutile de lancer un nouvel essai.
const MIN_ATTEMPT_MS = 8_000;
// Erreurs passagères (surcharge, panne, délai dépassé) : après une courte pause, on redonne
// une seconde chance aux modèles qui les ont renvoyées.
const TRANSIENT = new Set([408, 500, 502, 503, 504]);
const RETRY_PAUSE_MS = 3_000;

/** Erreur à renvoyer telle quelle à l'appli (message en français pour l'utilisateur). */
export class GeminiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Échec d'un seul modèle : on essaie le suivant. */
class ModelFailure {
  constructor(readonly status: number, readonly message: string) {}
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

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const failures: ModelFailure[] = [];
  let models = MODELS;
  for (let round = 1; round <= 2 && models.length > 0; round++) {
    if (round === 2) {
      if (deadline - Date.now() < RETRY_PAUSE_MS + MIN_ATTEMPT_MS) break;
      await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    }
    const busy: string[] = []; // modèles en panne passagère, retentés au second tour
    for (const model of models) {
      const timeLeft = deadline - Date.now();
      if (timeLeft < MIN_ATTEMPT_MS) break;
      try {
        return await callModel(model, apiKey, request, Math.min(ATTEMPT_TIMEOUT_MS, timeLeft));
      } catch (err) {
        if (!(err instanceof ModelFailure)) throw err;
        console.error(`Gemini ${model} (essai ${round}) : ${err.status} ${err.message}`);
        failures.push(err);
        if (TRANSIENT.has(err.status)) busy.push(model);
      }
    }
    models = busy;
  }
  throw finalError(failures);
}

/** Un essai sur un modèle : renvoie le JSON lu, lève ModelFailure (modèle suivant) ou GeminiError (arrêt). */
async function callModel(model: string, apiKey: string, request: string, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: request,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ModelFailure(504, `sans réponse (${String(err)})`);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json?.error?.message ?? `HTTP ${res.status}`;
    // Clé refusée : tous les modèles la refuseront, inutile d'insister.
    if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(detail))) {
      console.error(`Gemini ${model} : ${res.status} ${detail}`);
      throw new GeminiError(500, "Clé Gemini invalide : vérifie le secret GEMINI_API_KEY.");
    }
    throw new ModelFailure(res.status, detail);
  }

  const candidate = json?.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought)
    .map((part: { text: string }) => part.text)
    .join("");
  if (!text) {
    const reason = json?.promptFeedback?.blockReason ?? candidate?.finishReason ?? "réponse vide";
    throw new ModelFailure(422, `Gemini n'a pas pu lire cette photo (${reason}). Réessaie avec une autre photo.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelFailure(422, "Réponse de Gemini illisible, réessaie.");
  }
}

/** Message pour l'appli quand aucun modèle n'a répondu. */
function finalError(failures: ModelFailure[]): GeminiError {
  const statuses = failures.map((f) => f.status);
  if (statuses.length === 0 || statuses.some((s) => TRANSIENT.has(s))) {
    return new GeminiError(503, "Gemini est surchargé en ce moment, réessaie dans quelques minutes.");
  }
  if (statuses.includes(429)) {
    return new GeminiError(429, "Quota gratuit de Gemini atteint pour le moment, réessaie plus tard.");
  }
  const unread = failures.find((f) => f.status === 422);
  if (unread) return new GeminiError(422, unread.message);
  // Par exemple tous les modèles retirés (404) : le détail aide à mettre la liste à jour.
  return new GeminiError(502, `Erreur Gemini : ${failures[failures.length - 1].message}`);
}
