const PATHS = {
  beugro: "./adatb_beugro_qa_all.json",
  tetelek: "./adatb_tetelek_qa_all.json",
};

const STORAGE_PREFIX = "learningcards.v1";

let deckCache = {
  beugro: /** @type {Card[]|null} */ (null),
  tetelek: /** @type {Card[]|null} */ (null),
};

const el = {
  btnHome: document.getElementById("btnHome"),
  screenStart: document.getElementById("screenStart"),
  screenStudy: document.getElementById("screenStudy"),
  btnStart: document.getElementById("btnStart"),
  btnContinue: document.getElementById("btnContinue"),
  btnReset: document.getElementById("btnReset"),
  startError: document.getElementById("startError"),
  countBeugro: document.getElementById("countBeugro"),
  countTetelek: document.getElementById("countTetelek"),
  countTotal: document.getElementById("countTotal"),
  deckStatsError: document.getElementById("deckStatsError"),
  countNoClue: document.getElementById("countNoClue"),
  countPartial: document.getElementById("countPartial"),
  countKnown: document.getElementById("countKnown"),
  progressStatsError: document.getElementById("progressStatsError"),

  deckLabel: document.getElementById("deckLabel"),
  cardLabel: document.getElementById("cardLabel"),
  studyFilterAll: document.getElementById("studyFilterAll"),
  studyCountNoClue: document.getElementById("studyCountNoClue"),
  studyCountPartial: document.getElementById("studyCountPartial"),
  studyCountKnown: document.getElementById("studyCountKnown"),
  studyError: document.getElementById("studyError"),

  flashcard: document.getElementById("flashcard"),
  flashcardInner: document.getElementById("flashcardInner"),
  questionText: document.getElementById("questionText"),
  answerText: document.getElementById("answerText"),
  sourceText: document.getElementById("sourceText"),

  ratingRow: document.getElementById("ratingRow"),
  btnRate0: document.getElementById("btnRate0"),
  btnRate1: document.getElementById("btnRate1"),
  btnRate2: document.getElementById("btnRate2"),
};

/** @typedef {{ file: string, page?: number, pages?: number[], note?: string }} Source */
/** @typedef {{ id: string, question: string, answer: string, sources?: Source[], meta?: any }} Card */

let state = {
  deck: /** @type {'beugro'|'tetelek'|null} */ (null),
  cards: /** @type {Card[]} */ ([]),
  current: /** @type {Card|null} */ (null),
  showingAnswer: false,
  lastIds: /** @type {string[]} */ ([]),
  progress: /** @type {Record<string, { box: number, due: number, seen: number, grade?: 0|1|2 }>} */ ({}),
  knowledgeFilter: /** @type {null|0|1|2} */ (null),
};

function storageKey(deck) {
  return `${STORAGE_PREFIX}.progress.${deck}`;
}

function sessionKey() {
  return `${STORAGE_PREFIX}.session`;
}

function nowMs() {
  return Date.now();
}

function clampInt(v, min, max) {
  return Math.max(min, Math.min(max, v | 0));
}

function normalizeGrade(progress) {
  const grade = progress?.grade;
  if (grade === 0 || grade === 1 || grade === 2) return grade;

  // Backward-compat: infer from existing Leitner-ish state.
  const seen = clampInt(progress?.seen ?? 0, 0, 1_000_000);
  if (seen <= 0) return 0;

  const box = clampInt(progress?.box ?? 1, 1, 5);
  if (box >= 2) return 2;

  return 0;
}

function cardMatchesKnowledgeFilter(card) {
  if (state.knowledgeFilter === null) return true;
  const p = state.progress[card.id];
  return normalizeGrade(p) === state.knowledgeFilter;
}

function knowledgeFilterText(filter) {
  if (filter === 0) return "Nem tudtam";
  if (filter === 1) return "Részben";
  if (filter === 2) return "Tudtam";
  return "";
}

function updateDeckLabel() {
  if (!state.deck) return;
  const baseLabel = state.deck === "beugro" ? "Beugró" : "Tételek";
  const filterText = knowledgeFilterText(state.knowledgeFilter);
  el.deckLabel.textContent = filterText ? `${baseLabel} · ${filterText}` : baseLabel;
}

function setPillActive(pillEl, active) {
  if (!pillEl) return;
  pillEl.classList.toggle("is-active", active);
  pillEl.setAttribute("aria-pressed", active ? "true" : "false");
}

function updateStudyFilterUi() {
  setPillActive(el.studyFilterAll, state.knowledgeFilter === null);
  setPillActive(el.studyCountNoClue, state.knowledgeFilter === 0);
  setPillActive(el.studyCountPartial, state.knowledgeFilter === 1);
  setPillActive(el.studyCountKnown, state.knowledgeFilter === 2);
}

function applyStudyKnowledgeFilter(filter) {
  if (!state.deck) return;
  state.knowledgeFilter = filter;
  updateDeckLabel();
  updateStudyFilterUi();
  saveSession();

  const allowed = state.cards.filter(cardMatchesKnowledgeFilter);
  if (!allowed.length) {
    setError(el.studyError, "Nincs kártya ebben a kategóriában.");
    clearCurrentCard();
    return;
  }

  setError(el.studyError, "");
  if (state.current && cardMatchesKnowledgeFilter(state.current)) return;
  nextCard();
}

function showScreen(name) {
  const isStart = name === "start";
  el.screenStart.classList.toggle("hidden", !isStart);
  el.screenStudy.classList.toggle("hidden", isStart);
  el.btnHome.hidden = isStart;
}

function setError(where, msg) {
  where.textContent = msg || "";
}

function loadSession() {
  try {
    const raw = localStorage.getItem(sessionKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const deck = parsed.deck === "tetelek" ? "tetelek" : parsed.deck === "beugro" ? "beugro" : null;
    if (!deck) return null;

    const knowledgeFilter =
      parsed.knowledgeFilter === 0 || parsed.knowledgeFilter === 1 || parsed.knowledgeFilter === 2 ? parsed.knowledgeFilter : null;

    const cardId = typeof parsed.cardId === "string" ? parsed.cardId : null;
    const showingAnswer = Boolean(parsed.showingAnswer);
    const lastIds = Array.isArray(parsed.lastIds) ? parsed.lastIds.filter((x) => typeof x === "string").slice(0, 3) : [];
    const savedAt = Number.isFinite(parsed.savedAt) ? Number(parsed.savedAt) : 0;

    return { deck, knowledgeFilter, cardId, showingAnswer, lastIds, savedAt };
  } catch {
    return null;
  }
}

function saveSession() {
  if (!state.deck) return;
  try {
    localStorage.setItem(
      sessionKey(),
      JSON.stringify({
        deck: state.deck,
        knowledgeFilter: state.knowledgeFilter,
        cardId: state.current?.id ?? null,
        showingAnswer: Boolean(state.showingAnswer),
        lastIds: Array.isArray(state.lastIds) ? state.lastIds.slice(0, 3) : [],
        savedAt: nowMs(),
      }),
    );
  } catch {
    // ignore
  }
}

function setRadioValue(name, value) {
  const input = document.querySelector(`input[name='${name}'][value='${value}']`);
  if (input instanceof HTMLInputElement) input.checked = true;
}

function updateContinueUi() {
  if (!el.btnContinue) return;
  el.btnContinue.hidden = !loadSession();
}

function restoreStartFromSession() {
  const session = loadSession();
  if (!session) {
    updateContinueUi();
    return;
  }

  setRadioValue("deck", session.deck);
  const filterValue = session.knowledgeFilter === null ? "all" : String(session.knowledgeFilter);
  setRadioValue("knowledgeFilter", filterValue);
  updateContinueUi();
}

function getSelectedDeck() {
  const checked = document.querySelector("input[name='deck']:checked");
  return checked?.value === "tetelek" ? "tetelek" : "beugro";
}

function getSelectedKnowledgeFilter() {
  const checked = document.querySelector("input[name='knowledgeFilter']:checked");
  const v = checked?.value;
  if (v === "0") return /** @type {0} */ (0);
  if (v === "1") return /** @type {1} */ (1);
  if (v === "2") return /** @type {2} */ (2);
  return null;
}

function computeKnowledgeCounts(cards, progress) {
  /** @type {{0: number, 1: number, 2: number}} */
  const counts = { 0: 0, 1: 0, 2: 0 };
  for (const c of cards) {
    const grade = normalizeGrade(progress?.[c.id]);
    counts[grade] += 1;
  }
  return counts;
}

function updateStartKnowledgeStats() {
  if (!el.countNoClue || !el.countPartial || !el.countKnown || !el.progressStatsError) return;

  const deck = getSelectedDeck();
  const cards = deckCache[deck];

  setError(el.progressStatsError, "");
  el.countNoClue.textContent = "–";
  el.countPartial.textContent = "–";
  el.countKnown.textContent = "–";

  if (!cards) return;

  const progress = loadProgress(deck);
  const counts = computeKnowledgeCounts(cards, progress);
  el.countNoClue.textContent = String(counts[0]);
  el.countPartial.textContent = String(counts[1]);
  el.countKnown.textContent = String(counts[2]);
}

function updateStudyKnowledgeStats() {
  if (!el.studyCountNoClue || !el.studyCountPartial || !el.studyCountKnown) return;

  if (!state.deck || !state.cards.length) {
    el.studyCountNoClue.textContent = "Nem tudtam: –";
    el.studyCountPartial.textContent = "Részben: –";
    el.studyCountKnown.textContent = "Tudtam: –";
    return;
  }

  const counts = computeKnowledgeCounts(state.cards, state.progress);
  el.studyCountNoClue.textContent = `Nem tudtam: ${counts[0]}`;
  el.studyCountPartial.textContent = `Részben: ${counts[1]}`;
  el.studyCountKnown.textContent = `Tudtam: ${counts[2]}`;
}

function compressPages(pages) {
  const nums = [...new Set(pages.filter((n) => Number.isFinite(n)).map((n) => Number(n)))].sort((a, b) => a - b);
  if (!nums.length) return "";
  /** @type {Array<[number, number]>} */
  const ranges = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i < nums.length; i++) {
    const v = nums[i];
    if (v === prev + 1) {
      prev = v;
      continue;
    }
    ranges.push([start, prev]);
    start = v;
    prev = v;
  }
  ranges.push([start, prev]);
  return ranges
    .map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`))
    .join(", ");
}

function sourcesToText(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return "Forrás: –";

  // Group by file
  /** @type {Map<string, number[]>} */
  const byFile = new Map();
  for (const s of sources) {
    const file = s?.file;
    if (!file) continue;
    const pages = [];
    if (Array.isArray(s.pages)) pages.push(...s.pages);
    if (Number.isFinite(s.page)) pages.push(Number(s.page));

    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(...pages);
  }

  if (byFile.size === 0) return "Forrás: –";

  const parts = [];
  for (const [file, pages] of byFile.entries()) {
    const pageText = compressPages(pages);
    parts.push(pageText ? `${file} (oldal: ${pageText})` : `${file}`);
  }

  return `Forrás: ${parts.join("; ")}`;
}

function cardLabel(card) {
  if (state.deck === "beugro") {
    const n = card?.meta?.number;
    return n ? `Beugró ${n}` : "Beugró";
  }

  if (state.deck === "tetelek") {
    const t = card?.meta?.topicNumber;
    const l = card?.meta?.label;
    if (t && l) return `Tétel ${t}/${l}`;
    if (t) return `Tétel ${t}`;
    return "Tétel";
  }

  return "";
}

function loadProgress(deck) {
  try {
    const raw = localStorage.getItem(storageKey(deck));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // ignore
  }
  return {};
}

function saveProgress() {
  if (!state.deck) return;
  try {
    localStorage.setItem(storageKey(state.deck), JSON.stringify(state.progress));
  } catch {
    // ignore
  }
}

function ensureProgressForCards(cards) {
  const now = nowMs();
  for (const c of cards) {
    if (!c?.id) continue;
    if (!state.progress[c.id]) {
      state.progress[c.id] = { box: 1, due: now, seen: 0, grade: 0 };
    } else {
      // sanitize
      const p = state.progress[c.id];
      p.box = clampInt(p.box ?? 1, 1, 5);
      p.due = Number.isFinite(p.due) ? p.due : now;
      p.seen = clampInt(p.seen ?? 0, 0, 1_000_000);
      p.grade = normalizeGrade(p);
    }
  }
}

function pickNextCard() {
  const now = nowMs();
  const allowed = state.cards.filter(cardMatchesKnowledgeFilter);
  if (!allowed.length) return null;

  const candidates = allowed.filter((c) => {
    const p = state.progress[c.id];
    return p && p.due <= now;
  });

  const pool = candidates.length ? candidates : allowed;
  const recent = new Set(state.lastIds);

  // Weighted random: lower box => higher weight.
  /** @type {Array<{card: Card, weight: number}>} */
  const weighted = [];
  for (const c of pool) {
    const p = state.progress[c.id];
    const box = clampInt(p?.box ?? 1, 1, 5);
    const base = (6 - box) * (6 - box); // 25..1
    const penalty = recent.has(c.id) ? 0.15 : 1;
    weighted.push({ card: c, weight: base * penalty });
  }

  let total = weighted.reduce((s, w) => s + w.weight, 0);
  if (!(total > 0)) {
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }

  let r = Math.random() * total;
  for (const w of weighted) {
    r -= w.weight;
    if (r <= 0) return w.card;
  }
  return weighted[weighted.length - 1]?.card ?? null;
}

function setCurrentCard(card) {
  state.current = card;
  state.showingAnswer = false;
  el.flashcard.classList.remove("is-flipped");
  el.ratingRow.hidden = true;

  el.questionText.textContent = card?.question ?? "";
  el.answerText.textContent = card?.answer ?? "";
  el.sourceText.textContent = sourcesToText(card?.sources);

  el.cardLabel.textContent = card ? cardLabel(card) : "–";

  if (card?.id) {
    state.lastIds = [card.id, ...state.lastIds.filter((id) => id !== card.id)].slice(0, 3);
  }

  saveSession();
}

function clearCurrentCard() {
  state.current = null;
  state.showingAnswer = false;
  el.flashcard.classList.remove("is-flipped");
  el.ratingRow.hidden = true;

  el.questionText.textContent = "";
  el.answerText.textContent = "";
  el.sourceText.textContent = "";
  el.cardLabel.textContent = "–";

  saveSession();
}

function flipCard() {
  if (!state.current) return;
  state.showingAnswer = !state.showingAnswer;
  el.flashcard.classList.toggle("is-flipped", state.showingAnswer);
  el.ratingRow.hidden = !state.showingAnswer;
  saveSession();
}

function applyRating(rating) {
  if (!state.current || !state.deck) return;
  const id = state.current.id;
  const p = state.progress[id] ?? { box: 1, due: nowMs(), seen: 0 };
  p.seen = clampInt((p.seen ?? 0) + 1, 0, 1_000_000);
  p.grade = rating === 0 || rating === 1 || rating === 2 ? rating : normalizeGrade(p);

  const now = nowMs();

  // Egyszerű, session-barát Leitner-szerű logika:
  // - Nem tudtam: doboz 1, nagyon hamar újra
  // - Részben: doboz marad, hamarosan
  // - Tudtam: doboz +1, egyre ritkábban
  if (rating === 0) {
    p.box = 1;
    p.due = now + 20_000; // 20s
  } else if (rating === 1) {
    p.box = clampInt(p.box ?? 1, 1, 5);
    p.due = now + 90_000; // 90s
  } else {
    p.box = clampInt((p.box ?? 1) + 1, 1, 5);
    const minutes = 5 * p.box; // 10..25 perc
    p.due = now + minutes * 60_000;
  }

  state.progress[id] = p;
  saveProgress();
  updateStudyKnowledgeStats();

  nextCard();
}

function nextCard() {
  const next = pickNextCard();
  if (!next) {
    const msg = state.knowledgeFilter === null ? "Nincs elérhető kártya." : "Nincs kártya ebben a kategóriában.";
    setError(el.studyError, msg);
    clearCurrentCard();
    return;
  }
  setError(el.studyError, "");
  setCurrentCard(next);
}

async function loadDeck(deck) {
  const path = deck === "tetelek" ? PATHS.tetelek : PATHS.beugro;
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Nem sikerült betölteni: ${path}`);
  return await res.json();
}

async function updateDeckCounts() {
  if (!el.countBeugro || !el.countTetelek || !el.countTotal || !el.deckStatsError) return;

  setError(el.deckStatsError, "");
  el.countBeugro.textContent = "–";
  el.countTetelek.textContent = "–";
  el.countTotal.textContent = "–";

  try {
    const [rawBeugro, rawTetelek] = await Promise.all([loadDeck("beugro"), loadDeck("tetelek")]);
    const beugroCards = normalizeBeugro(rawBeugro);
    const tetelekCards = normalizeTetelek(rawTetelek);
    deckCache.beugro = beugroCards;
    deckCache.tetelek = tetelekCards;

    const beugroCount = beugroCards.length;
    const tetelekCount = tetelekCards.length;

    el.countBeugro.textContent = String(beugroCount);
    el.countTetelek.textContent = String(tetelekCount);
    el.countTotal.textContent = String(beugroCount + tetelekCount);
    updateStartKnowledgeStats();
  } catch {
    deckCache.beugro = null;
    deckCache.tetelek = null;
    setError(el.deckStatsError, "Nem sikerült betölteni a statisztikát. Indíts helyi szervert (lásd lent).");
  }
}

function normalizeBeugro(json) {
  if (!Array.isArray(json)) return [];
  return json
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      /** @type {Card} */
      const card = {
        id: String(x.id ?? ""),
        question: String(x.question ?? ""),
        answer: String(x.answer ?? ""),
        sources: Array.isArray(x.sources) ? x.sources : [],
        meta: { number: x.number },
      };
      return card;
    })
    .filter((c) => c.id && c.question && c.answer);
}

function normalizeTetelek(json) {
  const topics = Array.isArray(json?.topics) ? json.topics : [];
  /** @type {Card[]} */
  const cards = [];
  for (const topic of topics) {
    const qs = Array.isArray(topic?.questions) ? topic.questions : [];
    for (const q of qs) {
      if (!q?.id || !q?.question || !q?.answer) continue;
      cards.push({
        id: String(q.id),
        question: String(q.question),
        answer: String(q.answer),
        sources: Array.isArray(q.sources) ? q.sources : [],
        meta: {
          topicNumber: topic?.number,
          topicTitle: topic?.title,
          label: q?.label,
        },
      });
    }
  }
  return cards;
}

async function startStudy(deck, knowledgeFilter, resume) {
  setError(el.startError, "");
  setError(el.studyError, "");

  state.deck = deck;
  state.knowledgeFilter = knowledgeFilter ?? null;
  updateDeckLabel();

  try {
    const raw = await loadDeck(deck);
    const cards = deck === "beugro" ? normalizeBeugro(raw) : normalizeTetelek(raw);

    if (!cards.length) {
      throw new Error("A betöltött kérdéssor üres vagy hibás.");
    }

    state.cards = cards;
    state.progress = loadProgress(deck);
    ensureProgressForCards(cards);
    saveProgress();

    state.lastIds = Array.isArray(resume?.lastIds) ? resume.lastIds.filter((x) => typeof x === "string").slice(0, 3) : [];

    if (state.knowledgeFilter !== null) {
      const allowed = cards.filter(cardMatchesKnowledgeFilter);
      if (!allowed.length) {
        throw new Error("Ebben a kategóriában még nincs kártya. Válassz \"Minden\"-t, majd értékeld a kártyákat.");
      }
    }

    showScreen("study");
    updateStudyKnowledgeStats();
    updateStudyFilterUi();

    const resumeCardId = typeof resume?.cardId === "string" ? resume.cardId : null;
    const resumeCard = resumeCardId ? cards.find((c) => c.id === resumeCardId) : null;

    if (resumeCard && cardMatchesKnowledgeFilter(resumeCard)) {
      setCurrentCard(resumeCard);
      if (resume?.showingAnswer) flipCard();
      setError(el.studyError, "");
    } else {
      nextCard();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setError(el.startError, msg);
  }
}

function resetProgress() {
  const deck = getSelectedDeck();
  try {
    localStorage.removeItem(storageKey(deck));
  } catch {
    // ignore
  }
  setError(el.startError, "Haladás törölve ehhez a kérdéssorhoz.");
  updateStartKnowledgeStats();
}

// Events
el.btnHome.addEventListener("click", () => {
  state.deck = null;
  state.cards = [];
  state.current = null;
  state.lastIds = [];
  state.progress = {};
  state.knowledgeFilter = null;
  showScreen("start");
  updateStartKnowledgeStats();
  updateContinueUi();
});

el.btnStart.addEventListener("click", () => {
  const deck = getSelectedDeck();
  const knowledgeFilter = getSelectedKnowledgeFilter();
  startStudy(deck, knowledgeFilter);
});

el.btnContinue?.addEventListener("click", () => {
  const session = loadSession();
  if (!session) {
    setError(el.startError, "Nincs mentett munkamenet.");
    updateContinueUi();
    return;
  }
  startStudy(session.deck, session.knowledgeFilter, session);
});

el.btnReset.addEventListener("click", resetProgress);

document.querySelectorAll("input[name='deck']").forEach((input) => {
  input.addEventListener("change", updateStartKnowledgeStats);
});

el.studyFilterAll?.addEventListener("click", () => applyStudyKnowledgeFilter(null));
el.studyCountNoClue?.addEventListener("click", () => applyStudyKnowledgeFilter(state.knowledgeFilter === 0 ? null : 0));
el.studyCountPartial?.addEventListener("click", () => applyStudyKnowledgeFilter(state.knowledgeFilter === 1 ? null : 1));
el.studyCountKnown?.addEventListener("click", () => applyStudyKnowledgeFilter(state.knowledgeFilter === 2 ? null : 2));

el.flashcard.addEventListener("click", () => flipCard());

el.flashcard.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    flipCard();
  }
});

el.btnRate0.addEventListener("click", () => applyRating(0));
el.btnRate1.addEventListener("click", () => applyRating(1));
el.btnRate2.addEventListener("click", () => applyRating(2));

// Init
restoreStartFromSession();
showScreen("start");
void updateDeckCounts();
