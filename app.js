import * as api from "./api.js?v=__VERSION__";

// --- Petits utilitaires ------------------------------------------------------

const $ = (selector) => document.querySelector(selector);
const MAX_RECIPE_PAGES = 4;

// Consigne envoyée avec la photo aux apps de chat (Claude, ChatGPT, Gemini…) quand on
// passe par elles au lieu de la lecture automatique ; le format est relu par parseRecipeText.
const CHAT_PROMPT = `Réécris cette fiche recette simplement, d'abord en français puis traduite en anglais, exactement dans ce format, en texte simple (pas de tableau), sans rien avant ni après :

=== FRANÇAIS ===
TITRE : nom du plat
PORTIONS : nombre de personnes (vide si absent)
INGRÉDIENTS :
- quantité ingrédient
ÉTAPES :
1. étape courte

=== ENGLISH ===
TITLE: dish name
SERVINGS: number of servings (empty if absent)
INGREDIENTS:
- quantity ingredient
STEPS:
1. short step

Liste tous les ingrédients, y compris ceux cités seulement dans les étapes (beurre, huile, sel, poivre, sucre, eau…), sans inventer de quantité illisible. Retire les titres décoratifs et l'astuce du chef (aucune note ni astuce), mais garde les durées, feux, tailles de découpe et mentions « par personne ». En anglais, écris « tsp » pour « cc » et « tbsp » pour « cs ».`;

/** Crée un élément DOM ; les enfants texte sont insérés comme texte (jamais comme HTML). */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "value") el.value = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) el.append(child);
  }
  return el;
}

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s, n) => {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const todayStr = () => ymd(new Date());
const isTuesday = (s) => parseDay(s).getDay() === 2;
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const longDate = (s) =>
  capitalize(parseDay(s).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }));
const shortDate = (s) => parseDay(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const formatWeight = (n) =>
  Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatKg = (n) => `${formatWeight(n)} kg`;

let toastTimer;
function toast(message, kind = "ok") {
  const el = $("#toast");
  el.textContent = message;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), kind === "error" ? 6000 : 2800);
}

function errorMessage(err) {
  if (!navigator.onLine) return "Pas de connexion internet.";
  if (err?.status === 401 || /jwt|token/i.test(err?.message ?? "")) {
    return "Session expirée : reconnecte-toi.";
  }
  return err?.message || "Une erreur est survenue.";
}

// --- Photos : sélection et redimensionnement ------------------------------

/** Ouvre l'appareil photo (`camera`) ou la galerie ; renvoie la liste des fichiers choisis. */
let pickerOpen = false;

function pickImages({ camera = false, multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept: "image/*", hidden: true, multiple });
    if (camera) input.setAttribute("capture", "environment");
    const done = (files) => {
      pickerOpen = false;
      resolve(files);
      input.remove();
    };
    input.addEventListener("change", () => done([...input.files]));
    input.addEventListener("cancel", () => done([]));
    document.body.append(input);
    pickerOpen = true;
    input.click();
  });
}

/**
 * Convertit la photo en JPEG d'au plus `maxSide` pixels de côté. Avec `box`
 * ([ymin, xmin, ymax, xmax] entre 0 et 1000), ne garde que ce cadre ; avec `round`,
 * efface aussi (en blanc) tout ce qui est hors de l'ovale inscrit dans le cadre.
 */
async function toJpeg(file, maxSide, quality, box = null, round = false) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Format de photo non pris en charge.");
  }
  const { width, height } = bitmap;
  const [ymin, xmin, ymax, xmax] = box ?? [0, 0, 1000, 1000];
  const sx = Math.round((xmin / 1000) * width);
  const sy = Math.round((ymin / 1000) * height);
  const sw = Math.max(1, Math.round(((xmax - xmin) / 1000) * width));
  const sh = Math.max(1, Math.round(((ymax - ymin) / 1000) * height));
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = h("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d");
  if (round) {
    const { width: w, height: hh } = canvas;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, hh);
    ctx.beginPath();
    ctx.ellipse(w / 2, hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Conversion de la photo impossible."))),
      "image/jpeg",
      quality,
    ),
  );
}

/** Version affichée (1600 px) + miniature du calendrier (400 px), éventuellement recadrées. */
const photoVersions = (file, box = null, round = false) =>
  Promise.all([toJpeg(file, 1600, 0.85, box, round), toJpeg(file, 400, 0.75, box, round)]);

/** Élargit (ou resserre, si `margin` < 0) un cadre [ymin, xmin, ymax, xmax] exprimé entre 0 et 1000. */
function padBox([ymin, xmin, ymax, xmax], margin) {
  const dy = (ymax - ymin) * margin;
  const dx = (xmax - xmin) * margin;
  const clamp = (v) => Math.min(1000, Math.max(0, v));
  return [clamp(ymin - dy), clamp(xmin - dx), clamp(ymax + dy), clamp(xmax + dx)];
}

/** Ramène un cadre mesuré dans un zoom (`outer`) aux coordonnées de la photo entière. */
function unzoomBox([ymin, xmin, ymax, xmax], [oy, ox, oy2, ox2]) {
  const y = (v) => oy + (v / 1000) * (oy2 - oy);
  const x = (v) => ox + (v / 1000) * (ox2 - ox);
  return [y(ymin), x(xmin), y(ymax), x(xmax)];
}

/**
 * Repère l'écran de la balance en deux passes : Gemini le cherche sur la photo entière,
 * puis sur un zoom autour de ce premier cadre, pour un cadrage bien plus serré.
 * Renvoie { box, shape } dans les coordonnées de la photo entière, ou null.
 */
async function findScaleScreen(file) {
  const first = await api.frameScale(await toBase64(await toJpeg(file, 1024, 0.8)));
  if (!first) return null;
  const zoom = padBox(first.box, 0.35);
  try {
    const second = await api.frameScale(await toBase64(await toJpeg(file, 1024, 0.85, zoom)));
    if (second) return { box: unzoomBox(second.box, zoom), shape: second.shape };
  } catch {
    // seconde passe indisponible : on garde le premier cadre
  }
  return first;
}

/** Photos de balance découpées en rond : repérées par leur nom de fichier (« pesee-rond-… »). */
const isRoundPhoto = (path) => /\/pesee-rond-/.test(path ?? "");

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// --- État --------------------------------------------------------------------

function savedRecipeLang() {
  try {
    return localStorage.getItem("recipe-lang") === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

const state = {
  canEdit: false, // vrai quand le propriétaire est connecté ; sinon consultation seule
  recipeLang: savedRecipeLang(), // langue d'affichage des recettes : "fr" | "en"
  view: "jour", // "jour" | "calendrier"
  day: todayStr(),
  month: todayStr().slice(0, 7), // YYYY-MM
  days: new Map(), // cache : date -> ligne
  draft: freshDraft(),
};

function freshDraft() {
  return {
    busy: new Set(), // "food" | "recipe" | "weigh"
    recipe: { mode: "idle", pages: [], processing: 0, pasted: "", form: null, fromAI: false }, // idle | pages | reading | paste | edit
    weigh: { editing: false, weight: "" },
  };
}

function resetDraft() {
  for (const page of state.draft.recipe.pages) URL.revokeObjectURL(page.url);
  state.draft = freshDraft();
}

const rowFor = (day) => state.days.get(day) ?? null;
const isEmptyRow = (row) => !row.food_path && !row.recipe && !row.weigh_path && row.weight_kg == null;

/** Enregistre `fields` pour la journée, met le cache à jour et supprime la ligne si elle est vide. */
async function saveFields(day, fields) {
  const row = await api.saveDay(day, fields);
  if (isEmptyRow(row)) {
    await api.deleteDay(day);
    state.days.delete(day);
  } else {
    state.days.set(day, row);
  }
}

// --- Navigation --------------------------------------------------------------

function route() {
  const [view, arg] = location.hash.replace(/^#\/?/, "").split("/");
  if (view === "calendrier") {
    state.view = "calendrier";
    if (/^\d{4}-\d{2}$/.test(arg ?? "")) state.month = arg;
  } else if (view === "jour") {
    state.view = "jour";
    const day = /^\d{4}-\d{2}-\d{2}$/.test(arg ?? "") ? arg : todayStr();
    if (day !== state.day) resetDraft();
    state.day = day;
    state.month = day.slice(0, 7);
  } else {
    // Visiteurs et grand écran : calendrier ; propriétaire sur téléphone : saisie du jour.
    const wide = matchMedia("(min-width: 760px)").matches;
    location.replace(wide || !state.canEdit ? "#calendrier" : "#jour");
    return;
  }
  document.querySelectorAll("[data-view]").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.view === state.view),
  );
  $("#view-jour").hidden = state.view !== "jour";
  $("#view-calendrier").hidden = state.view !== "calendrier";
  if (state.view === "jour") renderDay({ refresh: true });
  else renderCalendar();
}

const goDay = (day) => (location.hash = `#jour/${day}`);
const goMonth = (month) => (location.hash = `#calendrier/${month}`);

/** Adresses d'affichage des photos (repas et balance) des lignes données. */
function photoUrlsFor(rows, foodKey, weighKey) {
  return new Map([
    ...api.photoUrls("repas", rows.map((r) => r[foodKey])),
    ...api.photoUrls("pesee", rows.map((r) => r[weighKey])),
  ]);
}

// --- Vue calendrier ----------------------------------------------------------

async function renderCalendar() {
  const month = state.month;
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const start = ymd(new Date(y, m - 1, 1 - ((first.getDay() + 6) % 7)));
  const end = ymd(new Date(y, m - 1, last.getDate() + ((7 - last.getDay()) % 7)));

  $("#month-title").textContent = capitalize(first.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }));
  const grid = $("#grid");
  grid.classList.add("loading");

  let rows;
  let urls;
  try {
    rows = await api.loadDays(start, end);
    urls = photoUrlsFor([...rows.values()], "food_thumb", "weigh_thumb");
  } catch (err) {
    grid.classList.remove("loading");
    toast(errorMessage(err), "error");
    return;
  }
  if (state.view !== "calendrier" || state.month !== month) return; // navigation entre-temps
  for (const [day, row] of rows) state.days.set(day, row);

  const cells = [];
  const today = todayStr();
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const row = rows.get(day);
    const foodUrl = row?.food_thumb && urls.get(row.food_thumb);
    const weighUrl = row?.weigh_thumb && urls.get(row.weigh_thumb);
    const classes = ["cell"];
    if (day.slice(0, 7) !== month) classes.push("other-month");
    if (day === today) classes.push("today");
    if (isTuesday(day)) classes.push("tuesday");
    if (foodUrl) classes.push("has-photo");

    cells.push(
      h(
        "button",
        { class: classes.join(" "), onclick: () => goDay(day), "aria-label": longDate(day) },
        foodUrl && h("img", { class: "cell-photo", src: foodUrl, alt: "", loading: "lazy" }),
        h("span", { class: "cell-num" }, String(parseDay(day).getDate())),
        (row?.weight_kg != null || weighUrl) &&
          h(
            "span",
            { class: "cell-weigh" },
            weighUrl && h("img", { src: weighUrl, alt: "" }),
            row?.weight_kg != null &&
              h("span", {}, formatWeight(row.weight_kg), h("span", { class: "unit" }, " kg")),
          ),
        row?.recipe &&
          h("span", { class: "cell-recipe", title: recipeTitle(row.recipe) }, h("span", {}, recipeTitle(row.recipe))),
      ),
    );
  }
  grid.replaceChildren(...cells);
  grid.classList.remove("loading");
}

// --- Vue jour ----------------------------------------------------------------

async function renderDay({ refresh = false } = {}) {
  const day = state.day;
  $("#day-title").textContent = longDate(day);
  $("#day-subtitle").textContent = [day === todayStr() && "Aujourd'hui", isTuesday(day) && "Jour de pesée"]
    .filter(Boolean)
    .join(" · ");
  $("#day-picker").value = day;
  const body = $("#day-body");

  if (refresh) {
    if (!state.days.has(day)) body.replaceChildren(h("p", { class: "muted center" }, "Chargement…"));
    try {
      const rows = await api.loadDays(day, day);
      if (rows.has(day)) state.days.set(day, rows.get(day));
      else state.days.delete(day);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }
  if (state.day !== day || state.view !== "jour") return;
  const row = rowFor(day);
  const urls = photoUrlsFor(row ? [row] : [], "food_path", "weigh_path");

  const food = foodCard(day, row, urls);
  const recipe = recipeCard(day, row);
  const weigh =
    state.canEdit && !isTuesday(day)
      ? h("p", { class: "muted center small weigh-hint" }, "⚖️ La pesée s'ajoute le mardi.")
      : weighCard(day, row, urls);
  // Sur grand écran : photo (et pesée) à gauche, recette à droite.
  body.classList.toggle("split", Boolean((food || weigh) && recipe));
  const cards = [food, recipe, weigh].filter(Boolean);
  body.replaceChildren(...(cards.length ? cards : [h("p", { class: "muted center" }, "Rien de noté ce jour-là.")]));
}

function card(kind, icon, title, ...content) {
  return h(
    "section",
    { class: `card card-${kind}` },
    h("h3", { class: "card-title" }, h("span", { "aria-hidden": "true" }, icon), " ", title),
    ...content,
  );
}

function photoButtons(onPick, { cameraLabel = "Prendre une photo", galleryLabel = "Galerie", extra } = {}) {
  return h(
    "div",
    { class: "actions" },
    h("button", { class: "primary", onclick: () => onPick(true) }, "📷 ", cameraLabel),
    h("button", { onclick: () => onPick(false) }, "🖼️ ", galleryLabel),
    extra,
  );
}

const spinner = (text) => h("p", { class: "busy" }, h("span", { class: "spin", "aria-hidden": "true" }), text);

function openLightbox(src, round = false) {
  $("#lightbox img").src = src;
  $("#lightbox img").classList.toggle("round", round);
  $("#lightbox").hidden = false;
}

// Repas ---------------------------------------------------------------------

function foodCard(day, row, urls) {
  if (!state.canEdit) {
    const url = row?.food_path && urls.get(row.food_path);
    return url ? card("food", "🍽️", "Repas", h("img", { class: "photo", src: url, alt: "Photo du repas", onclick: () => openLightbox(url) })) : null;
  }
  if (state.draft.busy.has("food")) return card("food", "🍽️", "Repas", spinner("Envoi de la photo…"));
  const url = row?.food_path && urls.get(row.food_path);
  if (!url) {
    return card("food", "🍽️", "Repas", photoButtons((camera) => addFood(day, camera)));
  }
  return card(
    "food",
    "🍽️",
    "Repas",
    h("img", { class: "photo", src: url, alt: "Photo du repas", onclick: () => openLightbox(url) }),
    h(
      "div",
      { class: "actions" },
      h("button", { onclick: () => addFood(day, true) }, "📷 Remplacer"),
      h("button", { onclick: () => addFood(day, false) }, "🖼️ Galerie"),
      h("button", { class: "danger", onclick: () => deleteFood(day) }, "Supprimer"),
    ),
  );
}

async function addFood(day, camera) {
  const [file] = await pickImages({ camera });
  if (!file) return;
  state.draft.busy.add("food");
  renderDay();
  try {
    const [full, thumb] = await photoVersions(file);
    const old = rowFor(day);
    const paths = await api.uploadPhoto(day, "repas", full, thumb);
    await saveFields(day, { food_path: paths.path, food_thumb: paths.thumb });
    api.removeFiles("repas", [old?.food_path, old?.food_thumb]).catch(() => {});
    toast(`Photo du repas enregistrée (${shortDate(day)}) ✓`);
  } catch (err) {
    toast(errorMessage(err), "error");
  } finally {
    state.draft.busy.delete("food");
    renderDay();
  }
}

async function deleteFood(day) {
  if (!confirm("Supprimer la photo du repas ?")) return;
  const old = rowFor(day);
  try {
    await saveFields(day, { food_path: null, food_thumb: null });
    await api.removeFiles("repas", [old?.food_path, old?.food_thumb]);
    toast("Photo supprimée");
  } catch (err) {
    toast(errorMessage(err), "error");
  }
  renderDay();
}

// Recette -------------------------------------------------------------------
//
// Une recette est enregistrée en français, avec sa traduction anglaise dans `en` :
// { titre, portions, ingredients[], etapes[], en: { title, servings, ingredients[], steps[] } }
// (les recettes plus anciennes peuvent avoir un champ `note`, qui n'est plus affiché)

const RECIPE_LABELS = {
  fr: { ingredients: "Ingrédients", steps: "Étapes", untitled: "Recette sans titre" },
  en: { ingredients: "Ingredients", steps: "Steps", untitled: "Untitled recipe" },
};

/** Contenu de la recette dans une langue, ou null si cette langue est vide. */
function recipeIn(r, lang) {
  const v =
    lang === "en"
      ? { title: r?.en?.title, servings: r?.en?.servings, ingredients: r?.en?.ingredients ?? [], steps: r?.en?.steps ?? [] }
      : { title: r?.titre, servings: r?.portions, ingredients: r?.ingredients ?? [], steps: r?.etapes ?? [] };
  return v.title || v.ingredients.length || v.steps.length ? v : null;
}

/** Langue affichée : celle choisie si la recette l'a, sinon l'autre. */
const shownLang = (r) => (recipeIn(r, state.recipeLang) ? state.recipeLang : state.recipeLang === "en" ? "fr" : "en");
const recipeTitle = (r) => recipeIn(r, shownLang(r))?.title || RECIPE_LABELS[shownLang(r)].untitled;

function setRecipeLang(lang) {
  state.recipeLang = lang;
  try {
    localStorage.setItem("recipe-lang", lang);
  } catch {
    // stockage indisponible : le choix vaut pour cette visite seulement
  }
  renderDay();
}

function langToggle() {
  return h(
    "div",
    { class: "lang-toggle", role: "group", "aria-label": "Langue de la recette" },
    ["fr", "en"].map((lang) =>
      h(
        "button",
        {
          class: state.recipeLang === lang ? "active" : "",
          "aria-pressed": String(state.recipeLang === lang),
          onclick: () => setRecipeLang(lang),
        },
        lang.toUpperCase(),
      ),
    ),
  );
}

/** Affichage : titre (+ FR | EN), puis ingrédients à gauche et étapes à droite. */
function recipeDetails(r) {
  const lang = shownLang(r);
  const v = recipeIn(r, lang) ?? { ingredients: [], steps: [] };
  const t = RECIPE_LABELS[lang];
  const bilingual = recipeIn(r, "fr") && recipeIn(r, "en");
  return [
    h(
      "div",
      { class: "recipe-head" },
      h("h4", { class: "recipe-title", lang }, v.title || t.untitled),
      bilingual && langToggle(),
    ),
    v.servings && h("p", { class: "muted small", lang }, v.servings),
    h(
      "div",
      { class: "recipe-columns", lang },
      h(
        "div",
        { class: "recipe-col" },
        h("h5", {}, t.ingredients),
        v.ingredients.length
          ? h("ul", { class: "ingredients" }, v.ingredients.map((i) => h("li", {}, i)))
          : h("p", { class: "muted small" }, "—"),
      ),
      h(
        "div",
        { class: "recipe-col recipe-steps" },
        h("h5", {}, t.steps),
        v.steps.length
          ? h("ol", { class: "steps" }, v.steps.map((s) => h("li", {}, s)))
          : h("p", { class: "muted small" }, "—"),
      ),
    ),
  ];
}

function recipeCard(day, row) {
  const draft = state.draft.recipe;
  const title = "Recette";
  if (!state.canEdit) return row?.recipe ? card("recipe", "📖", title, recipeDetails(row.recipe)) : null;

  if (state.draft.busy.has("recipe")) return card("recipe", "📖", title, spinner("Enregistrement…"));

  if (draft.mode === "reading") {
    return card(
      "recipe",
      "📖",
      title,
      spinner("Lecture et traduction de la recette… (10 à 40 secondes)"),
      pageStrip(false),
    );
  }

  if (draft.mode === "pages") {
    const full = draft.pages.length >= MAX_RECIPE_PAGES;
    const disabled = draft.processing > 0 || !draft.pages.length;
    const readButton = h(
      "button",
      { class: draft.aiFailed ? "" : "primary big", disabled, onclick: () => readRecipe(day) },
      draft.aiFailed ? "✨ Réessayer Gemini" : "✨ Lire la recette",
    );
    const shareButton = h(
      "button",
      { class: draft.aiFailed ? "primary big" : "", disabled, onclick: shareRecipe },
      "↗️ Envoyer à une app IA",
    );
    return card(
      "recipe",
      "📖",
      title,
      draft.aiFailed
        ? h(
            "p",
            { class: "hint" },
            `${draft.aiFailed} Envoie plutôt la photo à ChatGPT (ou Claude) avec ↗️, puis colle sa réponse : la recette se remplira toute seule, en français et en anglais.`,
          )
        : h("p", { class: "muted small" }, "Ajoute le recto et le verso si la liste d'ingrédients est sur une autre face."),
      pageStrip(true),
      draft.processing > 0 && spinner("Préparation de la photo…"),
      !full &&
        photoButtons((camera) => addRecipePages(camera), {
          cameraLabel: "Autre page",
          galleryLabel: "Galerie",
        }),
      h(
        "div",
        { class: "actions" },
        draft.aiFailed ? [shareButton, readButton] : [readButton, shareButton],
        h("button", { class: "ghost", onclick: cancelRecipe }, "Annuler"),
      ),
    );
  }

  if (draft.mode === "paste") return card("recipe", "📖", title, pasteForm());

  if (draft.mode === "edit") return card("recipe", "📖", title, recipeForm(day));

  if (!row?.recipe) {
    return card(
      "recipe",
      "📖",
      title,
      photoButtons((camera) => addRecipePages(camera), {
        cameraLabel: "Photographier la recette",
        extra: [
          h("button", { class: "ghost", onclick: startPaste }, "📋 Coller une réponse d'IA"),
          h("button", { class: "ghost", onclick: () => editRecipe(null) }, "✍️ Écrire à la main"),
        ],
      }),
    );
  }

  const r = row.recipe;
  return card(
    "recipe",
    "📖",
    title,
    recipeDetails(r),
    h(
      "div",
      { class: "actions" },
      h("button", { onclick: () => editRecipe(r) }, "Modifier"),
      h("button", { onclick: () => addRecipePages(true) }, "📷 Relire une fiche"),
      h("button", { class: "danger", onclick: () => deleteRecipe(day) }, "Supprimer"),
    ),
  );
}

function pageStrip(removable) {
  return h(
    "div",
    { class: "pages" },
    state.draft.recipe.pages.map((page, index) =>
      h(
        "figure",
        { class: "page" },
        h("img", { src: page.url, alt: `Page ${index + 1}`, onclick: () => openLightbox(page.url) }),
        removable &&
          h("button", { class: "remove", "aria-label": "Retirer cette page", onclick: () => removeRecipePage(index) }, "×"),
      ),
    ),
  );
}

async function addRecipePages(camera) {
  const files = await pickImages({ camera, multiple: !camera });
  if (!files.length) return;
  const draft = state.draft.recipe;
  if (draft.mode === "idle" || draft.mode === "edit") draft.mode = "pages";
  if (draft.mode !== "pages") return;
  draft.processing++;
  renderDay();
  try {
    for (const file of files) {
      if (draft.pages.length >= MAX_RECIPE_PAGES) {
        toast(`${MAX_RECIPE_PAGES} pages maximum.`, "error");
        break;
      }
      const blob = await toJpeg(file, 2000, 0.85);
      draft.pages.push({ blob, url: URL.createObjectURL(blob) });
    }
  } catch (err) {
    toast(errorMessage(err), "error");
  } finally {
    draft.processing--;
  }
  if (state.draft.recipe !== draft) return; // annulé ou autre jour entre-temps
  if (!draft.pages.length && !draft.processing) draft.mode = "idle";
  renderDay();
}

function removeRecipePage(index) {
  const draft = state.draft.recipe;
  const [page] = draft.pages.splice(index, 1);
  URL.revokeObjectURL(page.url);
  if (!draft.pages.length && !draft.processing) draft.mode = "idle";
  renderDay();
}

async function readRecipe(day) {
  const draft = state.draft.recipe;
  draft.mode = "reading";
  renderDay();
  try {
    const images = await Promise.all(draft.pages.map((p) => toBase64(p.blob)));
    const recipe = await api.readRecipe(images);
    if (state.draft.recipe !== draft) return; // annulé ou autre jour entre-temps
    if (!recipeIn(recipe, "fr") && !recipeIn(recipe, "en")) {
      throw new Error("Gemini n'a reconnu aucune recette sur la photo.");
    }
    draft.form = recipeToForm(recipe);
    draft.fromAI = true;
    draft.mode = "edit";
  } catch (err) {
    if (state.draft.recipe !== draft) return;
    draft.aiFailed = errorMessage(err);
    draft.mode = "pages";
  }
  renderDay();
}

/** Envoie les photos et la consigne à une app de chat via le menu de partage du téléphone. */
async function shareRecipe() {
  const draft = state.draft.recipe;
  const files = draft.pages.map((p, i) => new File([p.blob], `recette-${i + 1}.jpg`, { type: "image/jpeg" }));
  // Copie la consigne aussi : certaines apps ne gardent que la photo partagée.
  const copied = navigator.clipboard
    ? navigator.clipboard.writeText(CHAT_PROMPT).then(() => true, () => false)
    : Promise.resolve(false);
  let shared = false;
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, text: CHAT_PROMPT });
      shared = true;
    } catch (err) {
      if (err.name === "AbortError") return; // menu de partage fermé
    }
  }
  const promptCopied = await copied;
  if (shared) {
    if (promptCopied) toast("Consigne copiée aussi : colle-la dans l'app si elle n'apparaît pas.");
  } else if (promptCopied) {
    toast("Consigne copiée : ouvre ton app IA, colle-la et ajoute la photo.");
  } else {
    toast("Partage impossible sur cet appareil.", "error");
  }
  if (state.draft.recipe === draft) {
    draft.mode = "paste";
    renderDay();
  }
}

function startPaste() {
  state.draft.recipe.mode = "paste";
  renderDay();
}

function pasteForm() {
  const draft = state.draft.recipe;
  return h(
    "form",
    {
      class: "recipe-form",
      onsubmit: (e) => {
        e.preventDefault();
        fillFromPaste();
      },
    },
    h(
      "p",
      { class: "hint" },
      "Dans l'app (ChatGPT, Claude, Gemini…), copie toute la réponse puis colle-la ici : titre, ingrédients et étapes se rangent tout seuls, en français et en anglais.",
    ),
    h(
      "label",
      { class: "field" },
      h("span", {}, "Réponse de l'IA"),
      h("textarea", {
        name: "pasted",
        rows: 10,
        value: draft.pasted,
        placeholder: "=== FRANÇAIS ===\nTITRE : …\nINGRÉDIENTS :\n- …\nÉTAPES :\n1. …\n\n=== ENGLISH ===\nTITLE: …\nINGREDIENTS:\n- …\nSTEPS:\n1. …",
        oninput: (e) => (draft.pasted = e.target.value),
      }),
    ),
    h(
      "div",
      { class: "actions" },
      h("button", { class: "primary big", type: "submit" }, "Remplir la recette"),
      navigator.clipboard?.readText && h("button", { type: "button", onclick: pasteFromClipboard }, "📋 Coller"),
      draft.pages.length > 0 && h("button", { type: "button", onclick: shareRecipe }, "↗️ Renvoyer"),
      h("button", { type: "button", class: "ghost", onclick: cancelRecipe }, "Annuler"),
    ),
  );
}

async function pasteFromClipboard() {
  try {
    state.draft.recipe.pasted = await navigator.clipboard.readText();
    renderDay();
  } catch {
    toast("Colle le texte dans la zone (appui long → Coller).", "error");
  }
}

function fillFromPaste() {
  const draft = state.draft.recipe;
  const recipe = parseRecipeText(draft.pasted);
  if (!recipe) {
    toast("Je ne trouve pas de recette dans ce texte.", "error");
    return;
  }
  draft.form = recipeToForm(recipe);
  draft.fromAI = true;
  draft.mode = "edit";
  renderDay();
}

// Intitulés de rubriques reconnus dans une réponse d'app de chat, en français ou en anglais.
const HEADER =
  /^(titre|title|portions?|servings?|serves|ingr[ée]dients?|[ée]tapes?|steps?|pr[ée]paration|instructions?|method|directions|notes?|astuces?|tips?)\b(?:[^:]{0,40}:\s*(.*)|\s*(?:\([^)]*\))?\s*)$/i;
// Lignes qui annoncent une langue (« === FRANÇAIS === », « 🇬🇧 English version »…), lettres seules.
const FR_MARKERS = new Set(["francais", "french", "enfrancais", "versionfrancaise", "frenchversion"]);
const EN_MARKERS = new Set(["english", "anglais", "enanglais", "versionanglaise", "englishversion", "inenglish", "englishtranslation", "traductionanglaise"]);

/** Langue et rubrique d'un intitulé ; `currentLang` sert pour les intitulés communs aux deux langues. */
function sectionOf(word, currentLang) {
  const lower = word.toLowerCase();
  const w = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (w === "titre") return ["fr", "title"];
  if (w === "title") return ["en", "title"];
  if (w.startsWith("portion")) return ["fr", "servings"];
  if (w.startsWith("serv")) return ["en", "servings"];
  if (w.startsWith("ingredient")) return [lower !== w ? "fr" : currentLang, "ingredients"];
  if (w.startsWith("etape") || w.startsWith("preparation")) return ["fr", "steps"];
  if (w.startsWith("step") || w === "method" || w === "directions") return ["en", "steps"];
  if (w.startsWith("instruction")) return [currentLang, "steps"];
  // Notes, astuces du chef, tips : rubrique écartée (plus affichée ni enregistrée).
  if (w.startsWith("astuce")) return ["fr", "ignored"];
  if (w.startsWith("tip")) return ["en", "ignored"];
  return [currentLang, "ignored"];
}

/**
 * Transforme la réponse d'une app de chat (ChatGPT, Claude, Gemini…) en recette bilingue.
 * Format attendu : celui de CHAT_PROMPT, mais le gras, les titres Markdown, les emojis, les
 * séparateurs et les intitulés approchants sont tolérés. Sans aucune rubrique : 1re ligne = titre,
 * puces = ingrédients, lignes numérotées = étapes (en français).
 */
function parseRecipeText(text) {
  const empty = () => ({ title: [], servings: [], ingredients: [], steps: [], ignored: [] });
  const sections = { fr: empty(), en: empty() };
  const loose = [];
  let lang = "fr";
  let current = null; // [langue, rubrique]
  let sawHeader = false;
  let afterMarker = false; // juste après « Version française » : la ligne suivante peut être le titre
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\*\*|__/g, "").replace(/^\s*#+\s*/, "").trim();
    const letters = line.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
    if (!letters && !/\d/.test(line)) continue; // ligne vide ou séparateur (---, ===, emoji seul)
    if (FR_MARKERS.has(letters) || EN_MARKERS.has(letters)) {
      lang = FR_MARKERS.has(letters) ? "fr" : "en";
      current = null;
      afterMarker = true;
      continue;
    }
    const match = line.replace(/^[^\p{L}\p{N}\-•]+/u, "").match(HEADER);
    if (match) {
      const [l, key] = sectionOf(match[1], lang);
      lang = l;
      current = [l, key];
      sawHeader = true;
      afterMarker = false;
      if (key === "title") sections[l].title = []; // un « TITRE : » explicite remplace un titre deviné
      if (match[2]?.trim()) sections[l][key].push(match[2].trim());
    } else if (current) {
      sections[current[0]][current[1]].push(line);
    } else if (afterMarker && !sections[lang].title.length) {
      sections[lang].title.push(line); // « ### Bœuf glacé » juste sous « Version française »
    } else {
      loose.push([lang, line]);
    }
  }
  if (!sawHeader) {
    for (const [l, line] of loose) {
      const t = sections[l];
      if (/^[-•*–]\s+/.test(line)) t.ingredients.push(line);
      else if (/^(?:\d+[.)]|\d\uFE0F?\u20E3)\s*/.test(line)) t.steps.push(line);
      else if (!t.title.length) t.title.push(line);
      else t.ignored.push(line);
    }
    const hasList = (t) => t.ingredients.length || t.steps.length;
    if (!hasList(sections.fr) && !hasList(sections.en)) return null;
  }
  const finish = (s) => ({
    title: s.title.join(" "),
    servings: s.servings.join(" "),
    ingredients: lines(s.ingredients.join("\n")),
    steps: lines(s.steps.join("\n")),
  });
  const fr = finish(sections.fr);
  const en = finish(sections.en);
  const filled = (v) => v.title || v.ingredients.length || v.steps.length;
  if (!filled(fr) && !filled(en)) return null;
  const recipe = { titre: fr.title, portions: fr.servings, ingredients: fr.ingredients, etapes: fr.steps };
  if (filled(en)) recipe.en = en;
  return recipe;
}

const recipeToForm = (r) => ({
  titre: r?.titre ?? "",
  portions: r?.portions ?? "",
  ingredients: (r?.ingredients ?? []).join("\n"),
  etapes: (r?.etapes ?? []).join("\n"),
  en_title: r?.en?.title ?? "",
  en_servings: r?.en?.servings ?? "",
  en_ingredients: (r?.en?.ingredients ?? []).join("\n"),
  en_steps: (r?.en?.steps ?? []).join("\n"),
});

function formToRecipe(f) {
  const recipe = {
    titre: f.titre.trim(),
    portions: f.portions.trim(),
    ingredients: lines(f.ingredients),
    etapes: lines(f.etapes),
  };
  const en = {
    title: f.en_title.trim(),
    servings: f.en_servings.trim(),
    ingredients: lines(f.en_ingredients),
    steps: lines(f.en_steps),
  };
  if (en.title || en.ingredients.length || en.steps.length) recipe.en = en;
  return recipe;
}

/** Une ligne par élément, sans puces ni numéros (« - », « • », « 1. », « 2) », « 3️⃣ »…). */
const lines = (text) =>
  text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-•*–▪]|\d+[.)]|\d\uFE0F?\u20E3)\s*/, "").trim())
    .filter(Boolean);

function editRecipe(recipe) {
  const draft = state.draft.recipe;
  draft.form = recipeToForm(recipe);
  draft.fromAI = false;
  draft.mode = "edit";
  renderDay();
}

function recipeForm(day) {
  const draft = state.draft.recipe;
  const form = draft.form;
  const field = (name, label, props = {}) =>
    h(
      "label",
      { class: "field" },
      h("span", {}, label),
      props.rows
        ? h("textarea", { name, rows: props.rows, value: form[name], placeholder: props.placeholder })
        : h("input", { name, value: form[name], placeholder: props.placeholder }),
    );
  // Un bloc par langue : titre et portions, puis ingrédients | étapes côte à côte.
  const block = (legend, lang, names, labels) =>
    h(
      "fieldset",
      { class: "recipe-lang-block", lang },
      h("legend", {}, legend),
      h("div", { class: "form-row" }, field(names[0], labels[0]), field(names[1], labels[1])),
      h("div", { class: "recipe-columns" }, field(names[2], labels[2], { rows: 10 }), field(names[3], labels[3], { rows: 10 })),
    );

  return h(
    "form",
    {
      class: "recipe-form",
      oninput: (e) => (form[e.target.name] = e.target.value),
      onsubmit: (e) => {
        e.preventDefault();
        saveRecipe(day);
      },
    },
    draft.fromAI && h("p", { class: "hint" }, "Relis et corrige si besoin avant d'enregistrer."),
    block(
      "🇫🇷 Français",
      "fr",
      ["titre", "portions", "ingredients", "etapes"],
      ["Titre", "Portions", "Ingrédients (un par ligne)", "Étapes (une par ligne)"],
    ),
    block(
      "🇬🇧 English",
      "en",
      ["en_title", "en_servings", "en_ingredients", "en_steps"],
      ["Title", "Servings", "Ingredients (one per line)", "Steps (one per line)"],
    ),
    h(
      "div",
      { class: "actions" },
      h("button", { class: "primary big", type: "submit" }, "Enregistrer la recette"),
      h("button", { type: "button", class: "ghost", onclick: cancelRecipe }, "Annuler"),
    ),
  );
}

async function saveRecipe(day) {
  const recipe = formToRecipe(state.draft.recipe.form);
  if (!recipeIn(recipe, "fr") && !recipeIn(recipe, "en")) {
    toast("La recette est vide.", "error");
    return;
  }
  state.draft.busy.add("recipe");
  renderDay();
  try {
    await saveFields(day, { recipe });
    cancelRecipe({ render: false });
    toast(`Recette enregistrée (${shortDate(day)}) ✓`);
  } catch (err) {
    toast(errorMessage(err), "error");
  } finally {
    state.draft.busy.delete("recipe");
    renderDay();
  }
}

function cancelRecipe({ render = true } = {}) {
  for (const page of state.draft.recipe.pages) URL.revokeObjectURL(page.url);
  state.draft.recipe = { mode: "idle", pages: [], processing: 0, pasted: "", form: null, fromAI: false };
  if (render !== false) renderDay();
}

async function deleteRecipe(day) {
  if (!confirm("Supprimer la recette de cette journée ?")) return;
  try {
    await saveFields(day, { recipe: null });
    toast("Recette supprimée");
  } catch (err) {
    toast(errorMessage(err), "error");
  }
  renderDay();
}

// Pesée ---------------------------------------------------------------------

function weighCard(day, row, urls) {
  const draft = state.draft.weigh;
  const title = "Pesée du mardi";
  const photoUrl = row?.weigh_path && urls.get(row.weigh_path);
  const weight = row?.weight_kg;
  const photo =
    photoUrl &&
    h("img", {
      class: `photo small-photo${isRoundPhoto(row.weigh_path) ? " round" : ""}`,
      src: photoUrl,
      alt: "Photo de la balance",
      onclick: () => openLightbox(photoUrl, isRoundPhoto(row.weigh_path)),
    });
  const bigWeight = weight != null && h("p", { class: "weight" }, formatKg(weight));

  if (!state.canEdit) {
    return photoUrl || weight != null ? card("weigh", "⚖️", title, h("div", { class: "weigh-view" }, photo, bigWeight)) : null;
  }

  // La photo et le poids s'enregistrent chacun de leur côté : la photo part dès qu'elle est prise,
  // pour ne pas la perdre si le téléphone recharge la page pendant la saisie.
  const photoPart = state.draft.busy.has("weigh-photo")
    ? spinner(state.draft.weighStatus ?? "Envoi de la photo…")
    : [
        photo,
        photoButtons((camera) => addWeighPhoto(day, camera), {
          cameraLabel: photoUrl ? "Reprendre la photo" : "Photo de la balance",
        }),
      ];

  let weightPart;
  if (state.draft.busy.has("weigh-weight")) {
    weightPart = spinner("Enregistrement du poids…");
  } else if (weight != null && !draft.editing) {
    weightPart = h(
      "div",
      { class: "weigh-view" },
      bigWeight,
      h("button", { onclick: () => editWeight(weight) }, "Modifier le poids"),
    );
  } else {
    weightPart = h(
      "form",
      {
        class: "weigh-form",
        onsubmit: (e) => {
          e.preventDefault();
          saveWeight(day);
        },
      },
      h(
        "label",
        { class: "field weight-field" },
        h("span", {}, "Poids"),
        h(
          "div",
          { class: "with-unit" },
          h("input", {
            name: "weight",
            inputmode: "decimal",
            autocomplete: "off",
            placeholder: "72,4",
            value: draft.weight,
            required: true,
            oninput: (e) => (draft.weight = e.target.value),
          }),
          h("span", {}, "kg"),
        ),
      ),
      h(
        "div",
        { class: "actions" },
        h("button", { class: "primary", type: "submit" }, "Enregistrer le poids"),
        draft.editing && h("button", { type: "button", class: "ghost", onclick: cancelWeight }, "Annuler"),
      ),
    );
  }

  return card(
    "weigh",
    "⚖️",
    title,
    photoPart,
    h("div", { class: "weigh-weight" }, weightPart),
    (photoUrl || weight != null) &&
      h(
        "div",
        { class: "actions" },
        h("button", { class: "danger", onclick: () => deleteWeigh(day) }, "Supprimer la pesée"),
      ),
  );
}

/**
 * Photo de la balance : Gemini repère l'écran, le téléphone recadre la photo dessus
 * (ni pieds ni sol), puis seule la version recadrée est enregistrée.
 */
async function addWeighPhoto(day, camera) {
  const [file] = await pickImages({ camera });
  if (!file) return;
  const draft = state.draft;
  const setStatus = (text) => {
    draft.weighStatus = text;
    renderDay();
  };
  draft.busy.add("weigh-photo");
  setStatus("Recadrage sur l'écran de la balance…");
  try {
    let screen = null;
    let problem = "L'écran de la balance n'a pas été trouvé sur la photo.";
    try {
      screen = await findScaleScreen(file);
    } catch (err) {
      problem = errorMessage(err);
    }
    const keepWhole = `${problem}\n\nEnregistrer la photo entière quand même ? Elle sera visible par tous, pieds compris.`;
    if (!screen && !confirm(keepWhole)) return;

    setStatus("Envoi de la photo…");
    const round = screen?.shape === "rond";
    // Cadran rond : découpe au ras du cercle ; afficheur : petite marge autour des chiffres.
    const box = screen && padBox(screen.box, round ? 0.02 : 0.05);
    const [full, thumb] = await photoVersions(file, box, round);
    const old = rowFor(day);
    const paths = await api.uploadPhoto(day, "pesee", full, thumb, round ? "rond" : "");
    await saveFields(day, { weigh_path: paths.path, weigh_thumb: paths.thumb });
    api.removeFiles("pesee", [old?.weigh_path, old?.weigh_thumb]).catch(() => {});
    toast(screen ? "Photo recadrée sur l'écran et enregistrée ✓" : "Photo de la balance enregistrée ✓");
  } catch (err) {
    toast(errorMessage(err), "error");
  } finally {
    draft.busy.delete("weigh-photo");
    draft.weighStatus = null;
    renderDay();
  }
}

function editWeight(weight) {
  state.draft.weigh = { editing: true, weight: String(weight).replace(".", ",") };
  renderDay();
}

function cancelWeight() {
  state.draft.weigh = { editing: false, weight: "" };
  renderDay();
}

async function saveWeight(day) {
  const value = Number(state.draft.weigh.weight.replace(",", ".").replace(/[^\d.]/g, ""));
  if (!value || value < 20 || value > 400) {
    toast("Indique un poids valide (ex. 72,4).", "error");
    return;
  }
  const weight_kg = Math.round(value * 10) / 10;
  state.draft.busy.add("weigh-weight");
  renderDay();
  try {
    await saveFields(day, { weight_kg });
    state.draft.weigh = { editing: false, weight: "" };
    toast(`Poids enregistré : ${formatKg(weight_kg)} ✓`);
  } catch (err) {
    toast(errorMessage(err), "error");
  } finally {
    state.draft.busy.delete("weigh-weight");
    renderDay();
  }
}

async function deleteWeigh(day) {
  if (!confirm("Supprimer la pesée (photo et poids) ?")) return;
  const old = rowFor(day);
  try {
    await saveFields(day, { weight_kg: null, weigh_path: null, weigh_thumb: null });
    await api.removeFiles("pesee", [old?.weigh_path, old?.weigh_thumb]);
    toast("Pesée supprimée");
  } catch (err) {
    toast(errorMessage(err), "error");
  }
  renderDay();
}

// --- Mises à jour -------------------------------------------------------------

// Remplacés au déploiement par GitHub Actions ; restent tels quels en local.
const APP_VERSION = "__APP_VERSION__"; // numéro de version (fichier VERSION), ex. 1.2.0
const APP_BUILD = "__VERSION__"; // identifiant du déploiement : sert à détecter les nouvelles versions
const APP_BUILD_DATE = "__BUILD_DATE__";
const IS_DEPLOYED = !APP_BUILD.startsWith("__");
const UPDATE_CHECK_MS = 30 * 60 * 1000;
let updateReady = false;

/** Vrai quand recharger la page ne fait rien perdre (pas d'envoi, de brouillon ni de saisie en cours). */
function isIdle() {
  const { busy, recipe, weigh } = state.draft;
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  return (
    !busy.size && !pickerOpen && !typing && recipe.mode === "idle" && !weigh.editing && !weigh.weight
  );
}

/** Bas de page : « Version 1.2.0 · 30/09/2026 », suivi de l'état (à jour, nouvelle version…). */
function showVersion(status = "") {
  const base = IS_DEPLOYED ? `Version ${APP_VERSION} · ${APP_BUILD_DATE}` : "Version locale (non déployée)";
  $("#version").textContent = status ? `${base} · ${status}` : base;
}

async function checkForUpdate() {
  if (!IS_DEPLOYED || updateReady || !navigator.onLine) return;
  let latest;
  try {
    latest = await (await fetch("version.json", { cache: "no-store" })).json();
  } catch {
    return;
  }
  if (!latest?.build) return;
  if (latest.build === APP_BUILD) {
    showVersion("à jour ✓");
    return;
  }
  const label = latest.version ? `version ${latest.version}` : "nouvelle version";
  showVersion(`${label} disponible`);
  $("#update-banner span").textContent = `Nouvelle ${label} disponible`;
  // Rafraîchit la page d'accueil en cache : elle pointe vers les fichiers de la nouvelle version.
  await Promise.all(["./", "index.html"].map((url) => fetch(url, { cache: "reload" }).catch(() => {})));
  updateReady = true;
  if (isIdle()) applyUpdate();
  else $("#update-banner").hidden = false;
}

function applyUpdate() {
  try {
    sessionStorage.setItem("just-updated", "1");
  } catch {
    // stockage indisponible : pas de message après rechargement
  }
  location.reload();
}

function wireUpdates() {
  showVersion();
  $("#update-now").addEventListener("click", applyUpdate);
  try {
    if (sessionStorage.getItem("just-updated")) {
      sessionStorage.removeItem("just-updated");
      toast(`Application mise à jour : version ${APP_VERSION} ✓`);
    }
  } catch {
    // stockage indisponible
  }
  checkForUpdate();
  setInterval(checkForUpdate, UPDATE_CHECK_MS);
  // Au retour sur l'appli (depuis l'écran d'accueil ou l'appareil photo), après un court délai.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") setTimeout(checkForUpdate, 3000);
  });
}

// --- Démarrage ---------------------------------------------------------------

/** Mode édition quand le propriétaire est connecté, sinon consultation seule. */
function setSignedIn(signedIn) {
  state.canEdit = signedIn;
  $("#auth-button").textContent = signedIn ? "Déconnexion" : "Se connecter";
  $("#login").hidden = true;
  $("#shell").hidden = false;
  route();
}

function openLogin() {
  $("#login-error").textContent = "";
  $("#login").hidden = false;
  $("#login-form [name=email]").focus();
}

function wireStaticControls() {
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const button = e.target.querySelector("button[type=submit]");
    button.disabled = true;
    $("#login-error").textContent = "";
    try {
      await api.signIn(form.get("email"), form.get("password"));
      e.target.reset();
      setSignedIn(true);
      toast("Connecté : tu peux modifier ✓");
    } catch {
      $("#login-error").textContent = "Email ou mot de passe incorrect.";
    } finally {
      button.disabled = false;
    }
  });
  $("#login-cancel").addEventListener("click", () => ($("#login").hidden = true));

  $("#auth-button").addEventListener("click", async () => {
    if (!state.canEdit) openLogin();
    else if (confirm("Se déconnecter ?")) await api.signOut();
  });
  api.onSignedOut(() => {
    state.days.clear();
    resetDraft();
    setSignedIn(false);
  });

  document.querySelectorAll("[data-view]").forEach((btn) =>
    btn.addEventListener("click", () =>
      btn.dataset.view === "jour" ? goDay(state.day) : goMonth(state.month),
    ),
  );

  const shiftMonth = (delta) => {
    const [y, m] = state.month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    goMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };
  $("#prev-month").addEventListener("click", () => shiftMonth(-1));
  $("#next-month").addEventListener("click", () => shiftMonth(1));
  $("#this-month").addEventListener("click", () => goMonth(todayStr().slice(0, 7)));

  $("#prev-day").addEventListener("click", () => goDay(addDays(state.day, -1)));
  $("#next-day").addEventListener("click", () => goDay(addDays(state.day, 1)));
  $("#day-picker").addEventListener("change", (e) => e.target.value && goDay(e.target.value));

  $("#lightbox").addEventListener("click", () => ($("#lightbox").hidden = true));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $("#lightbox").hidden = true;
      $("#login").hidden = true;
    }
  });

  window.addEventListener("hashchange", () => {
    if (!$("#shell").hidden) route();
  });
}

wireStaticControls();
wireUpdates();
setSignedIn(Boolean(await api.currentUser()));
