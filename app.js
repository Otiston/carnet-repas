import * as api from "./api.js?v=__VERSION__";

// --- Petits utilitaires ------------------------------------------------------

const $ = (selector) => document.querySelector(selector);
const MAX_RECIPE_PAGES = 4;

// Consigne envoyée avec la photo aux apps de chat (Claude, ChatGPT, Gemini…) quand on
// passe par elles au lieu de la lecture automatique ; le format est relu par parseRecipeText.
const CHAT_PROMPT = `Réécris cette fiche recette simplement, en français, exactement dans ce format, sans rien avant ni après :

TITRE : nom du plat
PORTIONS : nombre de personnes (vide si absent)
INGRÉDIENTS :
- quantité ingrédient
ÉTAPES :
1. étape courte
NOTE : astuce utile (vide si aucune)

Liste tous les ingrédients, y compris ceux cités seulement dans les étapes (beurre, huile, sel, poivre, sucre, eau…), sans inventer de quantité illisible. Retire les titres décoratifs mais garde les durées, feux, tailles de découpe et mentions « par personne ».`;

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

async function toJpeg(file, maxSide, quality) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Format de photo non pris en charge.");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = h("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Conversion de la photo impossible."))),
      "image/jpeg",
      quality,
    ),
  );
}

/** Version affichée (1600 px) + miniature du calendrier (400 px). */
const photoVersions = (file) => Promise.all([toJpeg(file, 1600, 0.85), toJpeg(file, 400, 0.75)]);

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// --- État --------------------------------------------------------------------

const state = {
  canEdit: false, // vrai quand le propriétaire est connecté ; sinon consultation seule
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
    weigh: { editing: false, photo: null, preview: null, weight: "" },
  };
}

function resetDraft() {
  for (const page of state.draft.recipe.pages) URL.revokeObjectURL(page.url);
  if (state.draft.weigh.preview) URL.revokeObjectURL(state.draft.weigh.preview);
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
    urls = api.photoUrls([...rows.values()].flatMap((r) => [r.food_thumb, r.weigh_thumb]));
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
          h("span", { class: "cell-recipe", title: row.recipe.titre }, h("span", {}, row.recipe.titre || "Recette")),
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
  const urls = api.photoUrls([row?.food_path, row?.weigh_path]);

  const cards = state.canEdit
    ? [
        foodCard(day, row, urls),
        recipeCard(day, row),
        isTuesday(day)
          ? weighCard(day, row, urls)
          : h("p", { class: "muted center small" }, "⚖️ La pesée s'ajoute le mardi."),
      ]
    : [foodCard(day, row, urls), recipeCard(day, row), weighCard(day, row, urls)].filter(Boolean);
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

function openLightbox(src) {
  $("#lightbox img").src = src;
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
    api.removeFiles([old?.food_path, old?.food_thumb]).catch(() => {});
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
    await api.removeFiles([old?.food_path, old?.food_thumb]);
    toast("Photo supprimée");
  } catch (err) {
    toast(errorMessage(err), "error");
  }
  renderDay();
}

// Recette -------------------------------------------------------------------

function recipeDetails(r) {
  return [
    h("h4", { class: "recipe-title" }, r.titre || "Recette sans titre"),
    r.portions && h("p", { class: "muted small" }, r.portions),
    r.ingredients?.length > 0 &&
      h("div", {}, h("h5", {}, "Ingrédients"), h("ul", { class: "ingredients" }, r.ingredients.map((i) => h("li", {}, i)))),
    r.etapes?.length > 0 &&
      h("div", {}, h("h5", {}, "Étapes"), h("ol", { class: "steps" }, r.etapes.map((s) => h("li", {}, s)))),
    r.note && h("p", { class: "note" }, "💡 ", r.note),
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
      spinner("Lecture de la recette… (10 à 30 secondes)"),
      pageStrip(false),
    );
  }

  if (draft.mode === "pages") {
    const full = draft.pages.length >= MAX_RECIPE_PAGES;
    return card(
      "recipe",
      "📖",
      title,
      h("p", { class: "muted small" }, "Ajoute le recto et le verso si la liste d'ingrédients est sur une autre face."),
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
        h(
          "button",
          {
            class: "primary big",
            disabled: draft.processing > 0 || !draft.pages.length,
            onclick: () => readRecipe(day),
          },
          "✨ Lire la recette",
        ),
        h(
          "button",
          { disabled: draft.processing > 0 || !draft.pages.length, onclick: shareRecipe },
          "↗️ Envoyer à une app IA",
        ),
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
    draft.form = recipeToForm(recipe);
    draft.fromAI = true;
    draft.mode = "edit";
  } catch (err) {
    if (state.draft.recipe !== draft) return;
    toast(`${errorMessage(err)} Tu peux aussi utiliser « Envoyer à une app IA ».`, "error");
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
    h("p", { class: "hint" }, "Dans l'app (Claude, ChatGPT, Gemini…), copie la réponse puis colle-la ici."),
    h(
      "label",
      { class: "field" },
      h("span", {}, "Réponse de l'IA"),
      h("textarea", {
        name: "pasted",
        rows: 10,
        value: draft.pasted,
        placeholder: "TITRE : …\nINGRÉDIENTS :\n- …\nÉTAPES :\n1. …",
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

const HEADER =
  /^(titre|portions?|ingr[ée]dients?|[ée]tapes?|pr[ée]paration|instructions|notes?|astuces?)\b(?:[^:]{0,40}:\s*(.*)|\s*(?:\([^)]*\))?\s*)$/i;

function sectionKey(word) {
  const w = word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (w.startsWith("titre")) return "titre";
  if (w.startsWith("portion")) return "portions";
  if (w.startsWith("ingredient")) return "ingredients";
  if (w.startsWith("etape") || w.startsWith("preparation") || w.startsWith("instruction")) return "etapes";
  return "note";
}

/**
 * Transforme la réponse d'une app de chat (format TITRE / INGRÉDIENTS / ÉTAPES / NOTE, Markdown
 * toléré) en recette. Sans ces rubriques : 1re ligne = titre, puces = ingrédients, numéros = étapes.
 */
function parseRecipeText(text) {
  const sections = { titre: [], portions: [], ingredients: [], etapes: [], note: [] };
  const loose = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\*\*|__/g, "").replace(/^\s*#+\s*/, "").trim();
    if (!line) continue;
    const match = line.replace(/^[^\p{L}\p{N}\-•]+/u, "").match(HEADER);
    if (match) {
      current = sectionKey(match[1]);
      if (match[2]?.trim()) sections[current].push(match[2].trim());
    } else if (current) {
      sections[current].push(line);
    } else {
      loose.push(line);
    }
  }
  if (!current) {
    for (const line of loose) {
      if (/^[-•*]\s+/.test(line)) sections.ingredients.push(line);
      else if (/^\d+[.)]\s+/.test(line)) sections.etapes.push(line);
      else if (!sections.titre.length) sections.titre.push(line);
      else sections.note.push(line);
    }
    if (!sections.ingredients.length && !sections.etapes.length) return null;
  }
  const recipe = {
    titre: sections.titre.join(" "),
    portions: sections.portions.join(" "),
    ingredients: lines(sections.ingredients.join("\n")),
    etapes: lines(sections.etapes.join("\n")),
    note: sections.note.join(" "),
  };
  return recipe.titre || recipe.ingredients.length || recipe.etapes.length ? recipe : null;
}

const recipeToForm = (r) => ({
  titre: r?.titre ?? "",
  portions: r?.portions ?? "",
  ingredients: (r?.ingredients ?? []).join("\n"),
  etapes: (r?.etapes ?? []).join("\n"),
  note: r?.note ?? "",
});

const lines = (text) =>
  text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim())
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
    field("titre", "Titre", { placeholder: "Nom du plat" }),
    field("portions", "Portions", { placeholder: "ex. 2 personnes" }),
    field("ingredients", "Ingrédients (un par ligne)", { rows: 8 }),
    field("etapes", "Étapes (une par ligne)", { rows: 8 }),
    field("note", "Note", { rows: 2 }),
    h(
      "div",
      { class: "actions" },
      h("button", { class: "primary big", type: "submit" }, "Enregistrer la recette"),
      h("button", { type: "button", class: "ghost", onclick: cancelRecipe }, "Annuler"),
    ),
  );
}

async function saveRecipe(day) {
  const form = state.draft.recipe.form;
  const recipe = {
    titre: form.titre.trim(),
    portions: form.portions.trim(),
    ingredients: lines(form.ingredients),
    etapes: lines(form.etapes),
    note: form.note.trim(),
  };
  if (!recipe.titre && !recipe.ingredients.length && !recipe.etapes.length) {
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
  const savedUrl = row?.weigh_path && urls.get(row.weigh_path);
  const hasSaved = row?.weight_kg != null || savedUrl;
  const details = () =>
    h(
      "div",
      { class: "weigh-view" },
      savedUrl && h("img", { class: "photo small-photo", src: savedUrl, alt: "Photo de la balance", onclick: () => openLightbox(savedUrl) }),
      row.weight_kg != null && h("p", { class: "weight" }, formatKg(row.weight_kg)),
    );

  if (!state.canEdit) return hasSaved ? card("weigh", "⚖️", title, details()) : null;
  if (state.draft.busy.has("weigh")) return card("weigh", "⚖️", title, spinner("Enregistrement…"));

  if (hasSaved && !draft.editing) {
    return card(
      "weigh",
      "⚖️",
      title,
      details(),
      h(
        "div",
        { class: "actions" },
        h("button", { onclick: () => editWeigh(row) }, "Modifier"),
        h("button", { class: "danger", onclick: () => deleteWeigh(day) }, "Supprimer"),
      ),
    );
  }

  const preview = draft.preview ?? savedUrl;
  return card(
    "weigh",
    "⚖️",
    title,
    h(
      "form",
      {
        class: "weigh-form",
        onsubmit: (e) => {
          e.preventDefault();
          saveWeigh(day);
        },
      },
      preview && h("img", { class: "photo small-photo", src: preview, alt: "Photo de la balance" }),
      photoButtons((camera) => pickWeighPhoto(camera), {
        cameraLabel: preview ? "Reprendre la photo" : "Photo de la balance",
      }),
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
        h("button", { class: "primary big", type: "submit" }, "Enregistrer la pesée"),
        draft.editing && h("button", { type: "button", class: "ghost", onclick: cancelWeigh }, "Annuler"),
      ),
    ),
  );
}

async function pickWeighPhoto(camera) {
  const [file] = await pickImages({ camera });
  if (!file) return;
  const draft = state.draft.weigh;
  if (draft.preview) URL.revokeObjectURL(draft.preview);
  draft.photo = file;
  draft.preview = URL.createObjectURL(file);
  renderDay();
}

function editWeigh(row) {
  const draft = state.draft.weigh;
  draft.editing = true;
  draft.weight = row.weight_kg != null ? String(row.weight_kg).replace(".", ",") : "";
  renderDay();
}

function cancelWeigh() {
  if (state.draft.weigh.preview) URL.revokeObjectURL(state.draft.weigh.preview);
  state.draft.weigh = { editing: false, photo: null, preview: null, weight: "" };
  renderDay();
}

async function saveWeigh(day) {
  const draft = state.draft.weigh;
  const weight = Number(draft.weight.replace(",", ".").replace(/[^\d.]/g, ""));
  if (!weight || weight < 20 || weight > 400) {
    toast("Indique un poids valide (ex. 72,4).", "error");
    return;
  }
  state.draft.busy.add("weigh");
  renderDay();
  try {
    const fields = { weight_kg: Math.round(weight * 10) / 10 };
    const old = rowFor(day);
    if (draft.photo) {
      const [full, thumb] = await photoVersions(draft.photo);
      const paths = await api.uploadPhoto(day, "pesee", full, thumb);
      fields.weigh_path = paths.path;
      fields.weigh_thumb = paths.thumb;
    }
    await saveFields(day, fields);
    if (draft.photo) api.removeFiles([old?.weigh_path, old?.weigh_thumb]).catch(() => {});
    if (draft.preview) URL.revokeObjectURL(draft.preview);
    state.draft.weigh = { editing: false, photo: null, preview: null, weight: "" };
    toast(`Pesée enregistrée : ${formatKg(fields.weight_kg)} ✓`);
  } catch (err) {
    toast(errorMessage(err), "error");
  } finally {
    state.draft.busy.delete("weigh");
    renderDay();
  }
}

async function deleteWeigh(day) {
  if (!confirm("Supprimer la pesée (photo et poids) ?")) return;
  const old = rowFor(day);
  try {
    await saveFields(day, { weight_kg: null, weigh_path: null, weigh_thumb: null });
    await api.removeFiles([old?.weigh_path, old?.weigh_thumb]);
    toast("Pesée supprimée");
  } catch (err) {
    toast(errorMessage(err), "error");
  }
  renderDay();
}

// --- Mises à jour -------------------------------------------------------------

// Remplacés au déploiement par GitHub Actions ; restent tels quels en local.
const APP_VERSION = "__VERSION__";
const APP_BUILD_DATE = "__BUILD_DATE__";
const IS_DEPLOYED = !APP_VERSION.startsWith("__");
const UPDATE_CHECK_MS = 30 * 60 * 1000;
let updateReady = false;

/** Vrai quand recharger la page ne fait rien perdre (pas d'envoi, de brouillon ni de saisie en cours). */
function isIdle() {
  const { busy, recipe, weigh } = state.draft;
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  return (
    !busy.size && !pickerOpen && !typing && recipe.mode === "idle" && !weigh.editing && !weigh.photo && !weigh.weight
  );
}

async function checkForUpdate() {
  if (!IS_DEPLOYED || updateReady || !navigator.onLine) return;
  let latest;
  try {
    const res = await fetch("version.json", { cache: "no-store" });
    latest = (await res.json()).version;
  } catch {
    return;
  }
  if (!latest || latest === APP_VERSION) return;
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
  $("#version").textContent = IS_DEPLOYED
    ? `Version du ${APP_BUILD_DATE} · ${APP_VERSION}`
    : "Version locale (non déployée)";
  $("#update-now").addEventListener("click", applyUpdate);
  try {
    if (sessionStorage.getItem("just-updated")) {
      sessionStorage.removeItem("just-updated");
      toast("Application mise à jour ✓");
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
