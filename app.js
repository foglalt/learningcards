const PATHS = {
  beugro: "./adatb_beugro_qa_all.json",
  tetelek: "./adatb_tetelek_qa_all.json",
};

const STORAGE_PREFIX = "learningcards.v1";

const el = {
  btnHome: document.getElementById("btnHome"),
  screenStart: document.getElementById("screenStart"),
  screenStudy: document.getElementById("screenStudy"),
  btnStart: document.getElementById("btnStart"),
  btnReset: document.getElementById("btnReset"),
  startError: document.getElementById("startError"),

  deckLabel: document.getElementById("deckLabel"),
  cardLabel: document.getElementById("cardLabel"),
  studyError: document.getElementById("studyError"),

  flashcard: document.getElementById("flashcard"),
  flashcardInner: document.getElementById("flashcardInner"),
  questionText: document.getElementById("questionText"),
  answerText: document.getElementById("answerText"),
  sourceText: document.getElementById("sourceText"),

  btnFlip: document.getElementById("btnFlip"),
  ratingRow: document.getElementById("ratingRow"),
  btnRate0: document.getElementById("btnRate0"),
  btnRate1: document.getElementById("btnRate1"),
  btnRate2: document.getElementById("btnRate2"),
  btnSkip: document.getElementById("btnSkip"),
};

/** @typedef {{ file: string, page?: number, pages?: number[], note?: string }} Source */
/** @typedef {{ id: string, question: string, answer: string, sources?: Source[], meta?: any }} Card */

let state = {
  deck: /** @type {'beugro'|'tetelek'|null} */ (null),
  cards: /** @type {Card[]} */ ([]),
  current: /** @type {Card|null} */ (null),
  showingAnswer: false,
  lastIds: /** @type {string[]} */ ([]),
  progress: /** @type {Record<string, { box: number, due: number, seen: number }>} */ ({}),
};

function storageKey(deck) {
  return `${STORAGE_PREFIX}.progress.${deck}`;
}

function nowMs() {
  return Date.now();
}

function clampInt(v, min, max) {
  return Math.max(min, Math.min(max, v | 0));
}

function showScreen(name) {
  const isStart = name === "start";
  el.screenStart.classList.toggle("hidden", !isStart);
  el.screenStudy.classList.toggle("hidden", isStart);
}

function setError(where, msg) {
  where.textContent = msg || "";
}

function getSelectedDeck() {
  const checked = document.querySelector("input[name='deck']:checked");
  return checked?.value === "tetelek" ? "tetelek" : "beugro";
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
      state.progress[c.id] = { box: 1, due: now, seen: 0 };
    } else {
      // sanitize
      const p = state.progress[c.id];
      p.box = clampInt(p.box ?? 1, 1, 5);
      p.due = Number.isFinite(p.due) ? p.due : now;
      p.seen = clampInt(p.seen ?? 0, 0, 1_000_000);
    }
  }
}

function pickNextCard() {
  const now = nowMs();
  const candidates = state.cards.filter((c) => {
    const p = state.progress[c.id];
    return p && p.due <= now;
  });

  const pool = candidates.length ? candidates : state.cards;
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
  el.btnFlip.disabled = false;

  el.questionText.textContent = card?.question ?? "";
  el.answerText.textContent = card?.answer ?? "";
  el.sourceText.textContent = sourcesToText(card?.sources);

  el.cardLabel.textContent = card ? cardLabel(card) : "–";

  if (card?.id) {
    state.lastIds = [card.id, ...state.lastIds].slice(0, 3);
  }
}

function flipCard() {
  if (!state.current) return;
  state.showingAnswer = !state.showingAnswer;
  el.flashcard.classList.toggle("is-flipped", state.showingAnswer);
  el.ratingRow.hidden = !state.showingAnswer;
}

function applyRating(rating) {
  if (!state.current || !state.deck) return;
  const id = state.current.id;
  const p = state.progress[id] ?? { box: 1, due: nowMs(), seen: 0 };
  p.seen = clampInt((p.seen ?? 0) + 1, 0, 1_000_000);

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

  nextCard();
}

function nextCard() {
  const next = pickNextCard();
  if (!next) {
    setError(el.studyError, "Nincs elérhető kártya.");
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

async function startStudy(deck) {
  setError(el.startError, "");
  setError(el.studyError, "");

  state.deck = deck;
  el.deckLabel.textContent = deck === "beugro" ? "Beugró" : "Tételek";

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

    showScreen("study");
    nextCard();
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
}

// Events
el.btnHome.addEventListener("click", () => {
  state.deck = null;
  state.cards = [];
  state.current = null;
  state.lastIds = [];
  state.progress = {};
  showScreen("start");
});

el.btnStart.addEventListener("click", () => {
  const deck = getSelectedDeck();
  startStudy(deck);
});

el.btnReset.addEventListener("click", resetProgress);

el.btnFlip.addEventListener("click", () => {
  flipCard();
});

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

el.btnSkip.addEventListener("click", () => nextCard());

// Init
showScreen("start");
