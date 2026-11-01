/* ═══════════════════════════════════════════════════════════
   WORD SENSE — game.js
   All game state, API calls, and UI updates live here.
   Backend base URL is controlled by API_BASE at the top.
   ═══════════════════════════════════════════════════════════ */

// ── Config ────────────────────────────────────────────────────────────────────
// Change this to your Vercel URL when you deploy the backend.
// In local dev mode (USE_MOCK = true) no real API calls are made.
const API_BASE  = "http://localhost:8000";
const USE_MOCK  = true;   // ← flip to false once the backend is live

// ── DOM refs ─────────────────────────────────────────────────────────────────
const scoreEl      = document.getElementById("score");
const roundEl      = document.getElementById("round");
const wordPtsEl    = document.getElementById("word-pts");
const wordsLeftEl  = document.getElementById("words-left");
const letterRow    = document.getElementById("letter-row");
const semPctEl     = document.getElementById("sem-pct");
const thermoFill   = document.getElementById("thermo-fill");
const tempLabelEl  = document.getElementById("temp-label");
const radarCircle  = document.getElementById("radar-circle");
const radarEmoji   = document.getElementById("radar-emoji");
const clueList     = document.getElementById("clue-list");
const cluePlaceholder = document.getElementById("clue-placeholder");
const guessLog     = document.getElementById("guess-log");
const guessInput   = document.getElementById("guess-input");
const submitBtn    = document.getElementById("submit-btn");
const hintBtn      = document.getElementById("hint-btn");
const skipBtn      = document.getElementById("skip-btn");
const feedbackBanner = document.getElementById("feedback-banner");
const nextBtn      = document.getElementById("next-btn");
const toast        = document.getElementById("toast");
const apiBadge     = document.getElementById("api-badge");

// ── Game State ────────────────────────────────────────────────────────────────
const state = {
  totalScore:    0,
  roundNumber:   0,
  wordLength:    0,
  wordScore:     0,
  firstLetter:   "",
  currentTarget: null,   // only known client-side in mock mode
  hintsUsed:     0,
  roundOver:     false,
};

// ── Temperature config ────────────────────────────────────────────────────────
const TEMPS = [
  { min: 0,  max: 15,  label: "❄  COLD — Unrelated concept",        color: "#94a3b8", emoji: "🥶", borderVar: "pbox-blue"  },
  { min: 15, max: 35,  label: "🌊 COOL — Slightly related",          color: "#60a5fa", emoji: "💧", borderVar: "pbox-blue"  },
  { min: 35, max: 60,  label: "⚠  WARM — Getting close in meaning",  color: "#fbbf24", emoji: "🌡️", borderVar: "pbox-yellow"},
  { min: 60, max: 85,  label: "🔥 HOT  — Right concept!",            color: "#f97316", emoji: "🔥", borderVar: "pbox-red"   },
  { min: 85, max: 101, label: "🚀 BOILING — You're right there!",    color: "#ef4444", emoji: "🚀", borderVar: "pbox-red"   },
];

function tempForPct(pct) {
  return TEMPS.find(t => pct >= t.min && pct < t.max) || TEMPS[0];
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

// ── Tile helpers ──────────────────────────────────────────────────────────────
function buildTiles(length, firstLetter) {
  letterRow.innerHTML = "";
  for (let i = 0; i < length; i++) {
    const div = document.createElement("div");
    div.className = "tile" + (i === 0 ? " revealed" : "");
    div.textContent = i === 0 ? firstLetter.toUpperCase() : "_";
    div.dataset.index = i;
    letterRow.appendChild(div);
  }
}

function revealAllTiles(word) {
  const tiles = letterRow.querySelectorAll(".tile");
  word.toUpperCase().split("").forEach((ch, i) => {
    setTimeout(() => {
      if (tiles[i]) {
        tiles[i].textContent = ch;
        tiles[i].className = "tile correct";
      }
    }, i * 80);
  });
}

// ── Thermometer ───────────────────────────────────────────────────────────────
function setThermo(pct) {
  const t = tempForPct(pct);
  thermoFill.style.width = pct + "%";
  semPctEl.textContent   = pct.toFixed(1) + "%";
  tempLabelEl.textContent = t.label;
  tempLabelEl.style.color = t.color;
  radarEmoji.textContent  = t.emoji;

  // Recolour radar rings
  document.querySelectorAll(".ring").forEach(r => {
    r.style.borderColor = t.color;
  });
}

// ── Score counter animation ───────────────────────────────────────────────────
function animateScore(from, to) {
  const duration = 600;
  const start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    scoreEl.textContent = Math.round(from + (to - from) * ease);
    if (p < 1) requestAnimationFrame(tick);
    else scoreEl.textContent = to;
  }
  requestAnimationFrame(tick);
}

// ── Guess log ─────────────────────────────────────────────────────────────────
function addGuessRow(guess, result) {
  const t = tempForPct(result.semantic_pct || 0);

  const row = document.createElement("div");
  row.className = "guess-row";
  row.style.borderLeftColor = t.color;

  let extra = "";
  if (result.is_antonym) {
    extra += `<span class="guess-antonym">⟺ ANTONYM</span>`;
  }
  if (result.is_likely_typo) {
    extra += `<span class="guess-spell">📝 Spelling: ${result.spelling_pct}%</span>`;
  }

  row.innerHTML = `
    <span class="guess-word">${guess}</span>
    ${extra}
    <span class="guess-spell">✏ ${result.spelling_pct?.toFixed(1) ?? "—"}%</span>
    <span class="guess-temp" style="color:${t.color}">${result.semantic_pct?.toFixed(1) ?? "—"}%</span>
  `;

  // newest on top
  guessLog.prepend(row);
}

// ── Clue / Hint display ───────────────────────────────────────────────────────
function addClue(type, text, accentColor = "var(--purple-lt)") {
  if (cluePlaceholder) cluePlaceholder.style.display = "none";

  const card = document.createElement("div");
  card.className = "clue-card";
  card.style.borderLeftColor = accentColor;
  card.innerHTML = `<div class="clue-type" style="color:${accentColor}">${type}</div>${text}`;
  clueList.appendChild(card);
}

// ── Control lock / unlock ─────────────────────────────────────────────────────
function lockControls() {
  guessInput.disabled = true;
  submitBtn.disabled  = true;
  hintBtn.disabled    = true;
  skipBtn.disabled    = true;
}

function unlockControls() {
  guessInput.disabled = false;
  submitBtn.disabled  = false;
  hintBtn.disabled    = false;
  skipBtn.disabled    = false;
  guessInput.focus();
}

// ── Mock data bank (used when USE_MOCK = true) ────────────────────────────────
const MOCK_WORDS = [
  {
    "word": "species",
    "length": 7,
    "firstLetter": "s",
    "score": 70,
    "definition": "A group of organisms sharing common characteristics and capable of interbreeding.",
    "examples": [
      "The _______ of finches Darwin observed differed in beak shape.",
      "Over 8 million _______ are estimated to live on Earth."
    ]
  },
  {
    "word": "eclipse",
    "length": 7,
    "firstLetter": "e",
    "score": 70,
    "definition": "An astronomical event where one celestial body moves into the shadow of another.",
    "examples": [
      "The solar _______ left the city in total darkness for two minutes.",
      "Ancient cultures feared the lunar _______ as a bad omen."
    ]
  },
  {
    "word": "metaphor",
    "length": 8,
    "firstLetter": "m",
    "score": 80,
    "definition": "A figure of speech in which a word or phrase is applied to something it doesn't literally denote.",
    "examples": [
      "\"Life is a journey\" is a common _______ used in poetry.",
      "He used a powerful _______ to describe his grief."
    ]
  },
  {
    "word": "neuron",
    "length": 6,
    "firstLetter": "n",
    "score": 60,
    "definition": "A specialised cell transmitting nerve impulses throughout the body.",
    "examples": [
      "Each _______ can connect to thousands of other cells.",
      "The _______ fired rapidly as the subject processed the image."
    ]
  },
  {
    "word": "gravity",
    "length": 7,
    "firstLetter": "g",
    "score": 70,
    "definition": "The natural force that attracts objects with mass towards one another.",
    "examples": [
      "Isaac Newton described _______ after observing a falling apple.",
      "Without _______, the astronaut floated freely inside the capsule."
    ]
  },
  {
    "word": "ancient",
    "length": 7,
    "firstLetter": "a",
    "score": 70,
    "definition": "belonging to a very long time ago",
    "examples": [
      "they visited an _______ temple"
    ]
  },
  {
    "word": "apple",
    "length": 5,
    "firstLetter": "a",
    "score": 50,
    "definition": "fruit with red or yellow or green skin and sweet to tart crisp whitish flesh",
    "examples": [
      "she ate a crisp green _______"
    ]
  },
  {
    "word": "arrive",
    "length": 6,
    "firstLetter": "a",
    "score": 60,
    "definition": "reach a place at the end of a journey",
    "examples": [
      "the train _______s at noon"
    ]
  },
  {
    "word": "banana",
    "length": 6,
    "firstLetter": "b",
    "score": 60,
    "definition": "elongated crescent-shaped yellow fruit with soft sweet flesh",
    "examples": [
      "peel a _______ for breakfast"
    ]
  },
  {
    "word": "basket",
    "length": 6,
    "firstLetter": "b",
    "score": 60,
    "definition": "a container woven from strips of material",
    "examples": [
      "the _______ was full of fresh bread"
    ]
  },
  {
    "word": "blanket",
    "length": 7,
    "firstLetter": "b",
    "score": 70,
    "definition": "a warm covering used on a bed",
    "examples": [
      "he wrapped himself in a wool _______"
    ]
  },
  {
    "word": "book",
    "length": 4,
    "firstLetter": "b",
    "score": 40,
    "definition": "a written or printed work consisting of pages glued or sewn together along one side",
    "examples": [
      "she opened the _______ and read a page"
    ]
  },
  {
    "word": "borrow",
    "length": 6,
    "firstLetter": "b",
    "score": 60,
    "definition": "take something with the intention of returning it",
    "examples": [
      "may I _______ your pen"
    ]
  },
  {
    "word": "bottle",
    "length": 6,
    "firstLetter": "b",
    "score": 60,
    "definition": "a narrow-necked container for liquids",
    "examples": [
      "he filled the _______ with water"
    ]
  },
  {
    "word": "brave",
    "length": 5,
    "firstLetter": "b",
    "score": 50,
    "definition": "ready to face danger without fear",
    "examples": [
      "the _______ firefighter saved the cat"
    ]
  },
  {
    "word": "bridge",
    "length": 6,
    "firstLetter": "b",
    "score": 60,
    "definition": "a structure that allows people or vehicles to cross a river or road",
    "examples": [
      "the old _______ was closed for repairs"
    ]
  },
  {
    "word": "butter",
    "length": 6,
    "firstLetter": "b",
    "score": 60,
    "definition": "a soft yellow fat made from cream",
    "examples": [
      "spread _______ on the toast"
    ]
  },
  {
    "word": "can",
    "length": 3,
    "firstLetter": "c",
    "score": 30,
    "definition": "airtight sealed metal container of food or drink",
    "examples": [
      "a _______ of soup"
    ]
  },
  {
    "word": "candle",
    "length": 6,
    "firstLetter": "c",
    "score": 60,
    "definition": "a stick of wax with a wick that burns to give light",
    "examples": [
      "they lit a _______ during the power cut"
    ]
  },
  {
    "word": "cat",
    "length": 3,
    "firstLetter": "c",
    "score": 30,
    "definition": "feline mammal usually having thick soft fur and being unable to roar",
    "examples": [
      "the _______ purred on the windowsill"
    ]
  },
  {
    "word": "chair",
    "length": 5,
    "firstLetter": "c",
    "score": 50,
    "definition": "a seat for one person, with a support for the back",
    "examples": [
      "he sat down on the wooden _______"
    ]
  },
  {
    "word": "cheese",
    "length": 6,
    "firstLetter": "c",
    "score": 60,
    "definition": "a food made from pressed milk curds",
    "examples": [
      "he grated _______ over the pasta"
    ]
  },
  {
    "word": "compare",
    "length": 7,
    "firstLetter": "c",
    "score": 70,
    "definition": "examine two things to see how they are alike or different",
    "examples": [
      "_______ the two prices before buying"
    ]
  },
  {
    "word": "courage",
    "length": 7,
    "firstLetter": "c",
    "score": 70,
    "definition": "the ability to face danger or fear",
    "examples": [
      "it took _______ to speak up"
    ]
  },
  {
    "word": "cup",
    "length": 3,
    "firstLetter": "c",
    "score": 30,
    "definition": "a small open container usually used for drinking hot beverages",
    "examples": [
      "a _______ of hot coffee"
    ]
  },
  {
    "word": "curious",
    "length": 7,
    "firstLetter": "c",
    "score": 70,
    "definition": "eager to know or learn something",
    "examples": [
      "the _______ child asked many questions"
    ]
  },
  {
    "word": "danger",
    "length": 6,
    "firstLetter": "d",
    "score": 60,
    "definition": "the possibility of harm or loss",
    "examples": [
      "the sign warned of _______ ahead"
    ]
  },
  {
    "word": "decide",
    "length": 6,
    "firstLetter": "d",
    "score": 60,
    "definition": "make a choice after thinking about it",
    "examples": [
      "we _______d to stay home"
    ]
  },
  {
    "word": "divide",
    "length": 6,
    "firstLetter": "d",
    "score": 60,
    "definition": "separate into parts or groups",
    "examples": [
      "_______ the cake into eight pieces"
    ]
  },
  {
    "word": "doctor",
    "length": 6,
    "firstLetter": "d",
    "score": 60,
    "definition": "a person trained to treat illness and injury",
    "examples": [
      "the _______ examined the patient carefully"
    ]
  },
  {
    "word": "dog",
    "length": 3,
    "firstLetter": "d",
    "score": 30,
    "definition": "a common domestic canine companion animal",
    "examples": [
      "the _______ barked at the stranger"
    ]
  },
  {
    "word": "door",
    "length": 4,
    "firstLetter": "d",
    "score": 40,
    "definition": "a movable entrance barrier to a building, room, or vehicle",
    "examples": [
      "close the front _______ behind you"
    ]
  },
  {
    "word": "eagle",
    "length": 5,
    "firstLetter": "e",
    "score": 50,
    "definition": "a large bird of prey with excellent eyesight",
    "examples": [
      "an _______ circled above the valley"
    ]
  },
  {
    "word": "explain",
    "length": 7,
    "firstLetter": "e",
    "score": 70,
    "definition": "make something clear by describing it",
    "examples": [
      "please _______ how this machine works"
    ]
  },
  {
    "word": "familiar",
    "length": 8,
    "firstLetter": "f",
    "score": 80,
    "definition": "well known from long or close experience",
    "examples": [
      "his face looked _______"
    ]
  },
  {
    "word": "farmer",
    "length": 6,
    "firstLetter": "f",
    "score": 60,
    "definition": "a person who grows crops or raises animals",
    "examples": [
      "the _______ woke before sunrise"
    ]
  },
  {
    "word": "feather",
    "length": 7,
    "firstLetter": "f",
    "score": 70,
    "definition": "one of the light growths that cover a bird's body",
    "examples": [
      "she found a white _______ on the path"
    ]
  },
  {
    "word": "forest",
    "length": 6,
    "firstLetter": "f",
    "score": 60,
    "definition": "a large area covered with trees",
    "examples": [
      "deer live deep in the _______"
    ]
  },
  {
    "word": "forget",
    "length": 6,
    "firstLetter": "f",
    "score": 60,
    "definition": "fail to remember something",
    "examples": [
      "i forgot my keys this morning"
    ]
  },
  {
    "word": "fragile",
    "length": 7,
    "firstLetter": "f",
    "score": 70,
    "definition": "easily broken or damaged",
    "examples": [
      "the glass vase is very _______"
    ]
  },
  {
    "word": "garden",
    "length": 6,
    "firstLetter": "g",
    "score": 60,
    "definition": "a plot of ground where plants such as flowers or vegetables are grown",
    "examples": [
      "we planted tomatoes in the _______"
    ]
  },
  {
    "word": "gather",
    "length": 6,
    "firstLetter": "g",
    "score": 60,
    "definition": "bring or come together in one place",
    "examples": [
      "children _______ around the fire"
    ]
  },
  {
    "word": "generous",
    "length": 8,
    "firstLetter": "g",
    "score": 80,
    "definition": "willing to give more than is expected",
    "examples": [
      "a _______ neighbor shared her harvest"
    ]
  },
  {
    "word": "gentle",
    "length": 6,
    "firstLetter": "g",
    "score": 60,
    "definition": "soft and kind in manner",
    "examples": [
      "she has a _______ voice"
    ]
  },
  {
    "word": "habit",
    "length": 5,
    "firstLetter": "h",
    "score": 50,
    "definition": "something a person does regularly and almost without thinking",
    "examples": [
      "biting nails is a bad _______"
    ]
  },
  {
    "word": "hammer",
    "length": 6,
    "firstLetter": "h",
    "score": 60,
    "definition": "a tool with a heavy head used for hitting nails",
    "examples": [
      "she used a _______ to fix the fence"
    ]
  },
  {
    "word": "holiday",
    "length": 7,
    "firstLetter": "h",
    "score": 70,
    "definition": "a period of time spent away from work or school",
    "examples": [
      "we spent the _______ at the beach"
    ]
  },
  {
    "word": "honest",
    "length": 6,
    "firstLetter": "h",
    "score": 60,
    "definition": "telling the truth and not cheating",
    "examples": [
      "an _______ answer is always best"
    ]
  },
  {
    "word": "honey",
    "length": 5,
    "firstLetter": "h",
    "score": 50,
    "definition": "a sweet sticky substance made by bees",
    "examples": [
      "she stirred _______ into her tea"
    ]
  },
  {
    "word": "improve",
    "length": 7,
    "firstLetter": "i",
    "score": 70,
    "definition": "become or make something better",
    "examples": [
      "her writing _______d over the year"
    ]
  },
  {
    "word": "island",
    "length": 6,
    "firstLetter": "i",
    "score": 60,
    "definition": "a piece of land completely surrounded by water",
    "examples": [
      "we took a ferry to the _______"
    ]
  },
  {
    "word": "journey",
    "length": 7,
    "firstLetter": "j",
    "score": 70,
    "definition": "an act of traveling from one place to another",
    "examples": [
      "the _______ took six hours by train"
    ]
  },
  {
    "word": "kitchen",
    "length": 7,
    "firstLetter": "k",
    "score": 70,
    "definition": "a room where food is prepared and cooked",
    "examples": [
      "dinner smelled wonderful from the _______"
    ]
  },
  {
    "word": "ladder",
    "length": 6,
    "firstLetter": "l",
    "score": 60,
    "definition": "equipment with rungs used for climbing up or down",
    "examples": [
      "he leaned the _______ against the wall"
    ]
  },
  {
    "word": "lion",
    "length": 4,
    "firstLetter": "l",
    "score": 40,
    "definition": "large gregarious predatory feline mammal of Africa and India",
    "examples": [
      "a pride of _______s rested in the shade"
    ]
  },
  {
    "word": "lonely",
    "length": 6,
    "firstLetter": "l",
    "score": 60,
    "definition": "sad because of being alone",
    "examples": [
      "he felt _______ in the new city"
    ]
  },
  {
    "word": "market",
    "length": 6,
    "firstLetter": "m",
    "score": 60,
    "definition": "a place where people buy and sell goods",
    "examples": [
      "she bought vegetables at the _______"
    ]
  },
  {
    "word": "memory",
    "length": 6,
    "firstLetter": "m",
    "score": 60,
    "definition": "the ability to remember things from the past",
    "examples": [
      "she has a good _______ for faces"
    ]
  },
  {
    "word": "mention",
    "length": 7,
    "firstLetter": "m",
    "score": 70,
    "definition": "refer to something briefly",
    "examples": [
      "she _______ed that she was tired"
    ]
  },
  {
    "word": "mirror",
    "length": 6,
    "firstLetter": "m",
    "score": 60,
    "definition": "a surface that reflects an image",
    "examples": [
      "she checked her hair in the _______"
    ]
  },
  {
    "word": "mountain",
    "length": 8,
    "firstLetter": "m",
    "score": 80,
    "definition": "a very high natural elevation of land",
    "examples": [
      "they climbed the _______ at dawn"
    ]
  },
  {
    "word": "narrow",
    "length": 6,
    "firstLetter": "n",
    "score": 60,
    "definition": "small in width compared to length",
    "examples": [
      "the _______ path led to the lake"
    ]
  },
  {
    "word": "neighbor",
    "length": 8,
    "firstLetter": "n",
    "score": 80,
    "definition": "a person who lives next door or nearby",
    "examples": [
      "our _______ waters our plants when we travel"
    ]
  },
  {
    "word": "nervous",
    "length": 7,
    "firstLetter": "n",
    "score": 70,
    "definition": "feeling worried or uneasy",
    "examples": [
      "she felt _______ before the exam"
    ]
  },
  {
    "word": "notice",
    "length": 6,
    "firstLetter": "n",
    "score": 60,
    "definition": "become aware of something by seeing or hearing it",
    "examples": [
      "did you _______ the new sign"
    ]
  },
  {
    "word": "orange",
    "length": 6,
    "firstLetter": "o",
    "score": 60,
    "definition": "round yellow to orange citrus fruit with thick rind and sweet juicy pulp",
    "examples": [
      "freshly squeezed _______ juice"
    ]
  },
  {
    "word": "ordinary",
    "length": 8,
    "firstLetter": "o",
    "score": 80,
    "definition": "normal and not special in any way",
    "examples": [
      "it was an _______ Tuesday"
    ]
  },
  {
    "word": "pepper",
    "length": 6,
    "firstLetter": "p",
    "score": 60,
    "definition": "a hot-tasting powder or vegetable used to season food",
    "examples": [
      "add salt and _______ to taste"
    ]
  },
  {
    "word": "pillow",
    "length": 6,
    "firstLetter": "p",
    "score": 60,
    "definition": "a soft cushion used to support the head in bed",
    "examples": [
      "she fell asleep on the _______"
    ]
  },
  {
    "word": "pretend",
    "length": 7,
    "firstLetter": "p",
    "score": 70,
    "definition": "behave as if something is true when it is not",
    "examples": [
      "the children _______ed to be pirates"
    ]
  },
  {
    "word": "protect",
    "length": 7,
    "firstLetter": "p",
    "score": 70,
    "definition": "keep safe from harm or danger",
    "examples": [
      "helmets _______ your head"
    ]
  },
  {
    "word": "rabbit",
    "length": 6,
    "firstLetter": "r",
    "score": 60,
    "definition": "a small furry animal with long ears",
    "examples": [
      "a _______ hopped across the lawn"
    ]
  },
  {
    "word": "refuse",
    "length": 6,
    "firstLetter": "r",
    "score": 60,
    "definition": "say that one will not accept or do something",
    "examples": [
      "he _______d to answer the question"
    ]
  },
  {
    "word": "repeat",
    "length": 6,
    "firstLetter": "r",
    "score": 60,
    "definition": "say or do something again",
    "examples": [
      "could you _______ the question"
    ]
  },
  {
    "word": "river",
    "length": 5,
    "firstLetter": "r",
    "score": 50,
    "definition": "a large natural stream of water flowing to the sea or a lake",
    "examples": [
      "the _______ flooded after the storm"
    ]
  },
  {
    "word": "rough",
    "length": 5,
    "firstLetter": "r",
    "score": 50,
    "definition": "not smooth and having an uneven surface",
    "examples": [
      "the _______ rope scratched his hands"
    ]
  },
  {
    "word": "secret",
    "length": 6,
    "firstLetter": "s",
    "score": 60,
    "definition": "something kept hidden from others",
    "examples": [
      "can you keep a _______"
    ]
  },
  {
    "word": "shadow",
    "length": 6,
    "firstLetter": "s",
    "score": 60,
    "definition": "a dark shape made when something blocks the light",
    "examples": [
      "his _______ stretched across the road"
    ]
  },
  {
    "word": "silence",
    "length": 7,
    "firstLetter": "s",
    "score": 70,
    "definition": "complete absence of sound",
    "examples": [
      "a long _______ followed her question"
    ]
  },
  {
    "word": "silent",
    "length": 6,
    "firstLetter": "s",
    "score": 60,
    "definition": "making no sound",
    "examples": [
      "the room fell _______"
    ]
  },
  {
    "word": "spider",
    "length": 6,
    "firstLetter": "s",
    "score": 60,
    "definition": "an eight-legged creature that spins webs",
    "examples": [
      "a _______ built a web in the corner"
    ]
  },
  {
    "word": "spoon",
    "length": 5,
    "firstLetter": "s",
    "score": 50,
    "definition": "an eating or cooking utensil consisting of a small shallow bowl with a handle",
    "examples": [
      "stir the mixture with a _______"
    ]
  },
  {
    "word": "teacher",
    "length": 7,
    "firstLetter": "t",
    "score": 70,
    "definition": "a person whose job is to educate students",
    "examples": [
      "our _______ explained the lesson twice"
    ]
  },
  {
    "word": "tiny",
    "length": 4,
    "firstLetter": "t",
    "score": 40,
    "definition": "extremely small",
    "examples": [
      "a _______ ant crawled over the leaf"
    ]
  },
  {
    "word": "tomato",
    "length": 6,
    "firstLetter": "t",
    "score": 60,
    "definition": "a soft red fruit eaten raw or cooked as a vegetable",
    "examples": [
      "she sliced a _______ for the salad"
    ]
  },
  {
    "word": "turtle",
    "length": 6,
    "firstLetter": "t",
    "score": 60,
    "definition": "a reptile with a hard shell that lives mostly in water",
    "examples": [
      "the _______ slowly crossed the beach"
    ]
  },
  {
    "word": "umbrella",
    "length": 8,
    "firstLetter": "u",
    "score": 80,
    "definition": "a folding canopy held over the head as protection from rain",
    "examples": [
      "take an _______ because it may rain"
    ]
  },
  {
    "word": "victory",
    "length": 7,
    "firstLetter": "v",
    "score": 70,
    "definition": "success in a contest or struggle",
    "examples": [
      "the team celebrated its _______"
    ]
  },
  {
    "word": "wander",
    "length": 6,
    "firstLetter": "w",
    "score": 60,
    "definition": "walk slowly without a fixed destination",
    "examples": [
      "they _______ed through the old town"
    ]
  },
  {
    "word": "water",
    "length": 5,
    "firstLetter": "w",
    "score": 50,
    "definition": "binary compound that occurs at room temperature as a clear odorless liquid",
    "examples": [
      "he poured a glass of cold _______"
    ]
  },
  {
    "word": "weather",
    "length": 7,
    "firstLetter": "w",
    "score": 70,
    "definition": "the day-to-day state of the atmosphere such as rain or sun",
    "examples": [
      "the _______ is lovely today"
    ]
  },
  {
    "word": "whisper",
    "length": 7,
    "firstLetter": "w",
    "score": 70,
    "definition": "speak very softly using little breath",
    "examples": [
      "she _______ed a secret in his ear"
    ]
  },
  {
    "word": "window",
    "length": 6,
    "firstLetter": "w",
    "score": 60,
    "definition": "an opening in a wall fitted with glass to let in light",
    "examples": [
      "he opened the _______ to get fresh air"
    ]
  }
];

let mockIndex    = 0;
let mockCurrent  = null;
let mockHintIdx  = 0;
let usedIndices  = [];

function getMockWord() {
  // Prevent repeats within session
  const available = MOCK_WORDS
    .map((w, i) => i)
    .filter(i => !usedIndices.includes(i));

  if (available.length === 0) return null;

  const idx = available[Math.floor(Math.random() * available.length)];
  usedIndices.push(idx);
  mockCurrent  = MOCK_WORDS[idx];
  mockHintIdx  = 0;
  return {
    word_length:     mockCurrent.length,
    first_letter:    mockCurrent.firstLetter,
    potential_score: mockCurrent.score,
  };
}

function getMockHint() {
  if (!mockCurrent) return { hint: "No active round." };
  if (mockHintIdx === 0) {
    mockHintIdx++;
    return { type: "📖 Definition", hint: mockCurrent.definition };
  }
  const ex = mockCurrent.examples[mockHintIdx - 1];
  mockHintIdx++;
  return ex
    ? { type: "✏️ Example", hint: ex }
    : { type: "ℹ️ Info", hint: "No more hints available for this word!" };
}

function editDistance(s1, s2) {
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) costs[j] = j;
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1))
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return (Math.max(s1.length, s2.length) - costs[s2.length]) / Math.max(s1.length, s2.length);
}

function getMockGuess(guess) {
  if (!mockCurrent) return { status: "error" };
  const g = guess.trim().toLowerCase();
  const t = mockCurrent.word.toLowerCase();

  if (g === t) {
    return { status: "correct", earned_score: state.wordScore, total_score: state.totalScore + state.wordScore };
  }

  const ratio = editDistance(g, t);
  const spelling_pct = Math.round(ratio * 100);

  const sharedChars = new Set([...g].filter(c => t.includes(c))).size;
  const charOverlap = sharedChars / Math.max(new Set([...t]).size, 1);
  const lengthMatch = 1 - Math.min(Math.abs(g.length - t.length) / Math.max(g.length, t.length), 1);
  const semantic_pct = Math.min(95, Math.round((charOverlap * 0.7 + lengthMatch * 0.3) * 90));

  return {
    status:       "incorrect",
    spelling_pct: Math.min(99, spelling_pct),
    semantic_pct: Math.min(95, semantic_pct),
    is_antonym:   false,
    is_likely_typo: spelling_pct >= 75,
    temperature:  tempForPct(semantic_pct).label,
  };
}

// ── API wrappers ──────────────────────────────────────────────────────────────
async function apiStartRound() {
  if (USE_MOCK) return getMockWord();
  const res = await fetch(`${API_BASE}/start_round`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiHint() {
  if (USE_MOCK) return getMockHint();
  const res = await fetch(`${API_BASE}/hint`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiGuess(guess) {
  if (USE_MOCK) return getMockGuess(guess);
  const res = await fetch(`${API_BASE}/guess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guess }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiSkip() {
  if (USE_MOCK) return { target_word: mockCurrent?.word ?? "???" };
  const res = await fetch(`${API_BASE}/skip`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Round lifecycle ───────────────────────────────────────────────────────────
async function startRound() {
  feedbackBanner.style.display = "none";
  nextBtn.style.display        = "none";
  clueList.innerHTML           = `<p id="clue-placeholder" style="color:var(--muted);font-size:.85rem;font-style:italic;">Press 💡 Hint to reveal clues…</p>`;
  guessLog.innerHTML           = `<p style="color:var(--muted);font-size:.82rem;font-style:italic;">No guesses yet this round.</p>`;
  setThermo(0);

  lockControls();
  submitBtn.innerHTML = `<span class="loader"></span> Loading…`;

  try {
    const data = await apiStartRound();

    if (!data) {
      showToast("🎉 All words played! Resetting session…");
      usedIndices = [];
      await startRound();
      return;
    }

    state.wordLength   = data.word_length;
    state.wordScore    = data.potential_score;
    state.firstLetter  = data.first_letter;
    state.hintsUsed    = 0;
    state.roundOver    = false;
    state.roundNumber += 1;

    roundEl.textContent   = state.roundNumber;
    wordPtsEl.textContent = state.wordScore;
    buildTiles(state.wordLength, state.firstLetter);
    unlockControls();
    submitBtn.innerHTML = "▶ Guess";

    // Words left: total pool minus how many have been used
    const total     = USE_MOCK ? MOCK_WORDS.length : "?";
    const used      = USE_MOCK ? usedIndices.length : state.roundNumber;
    const remaining = USE_MOCK ? (MOCK_WORDS.length - usedIndices.length) : "?";
    wordsLeftEl.textContent = `${remaining}/${total}`;

    showToast(`Round ${state.roundNumber} started — ${state.wordLength}-letter word!`);
  } catch (err) {
    submitBtn.innerHTML = "▶ Guess";
    unlockControls();
    showToast("⚠ Error loading word. Retrying…");
    console.error(err);
    setTimeout(startRound, 2000);
  }
}

// ── Hint handler ──────────────────────────────────────────────────────────────
async function requestHint() {
  if (state.roundOver) return;
  hintBtn.disabled = true;

  try {
    const data = await apiHint();
    state.hintsUsed++;

    // Deduct score for hints
    const newScore = Math.max(5, Math.floor(state.wordScore * (state.hintsUsed === 1 ? 0.7 : 0.85)));
    state.wordScore = newScore;
    wordPtsEl.textContent = newScore;

    if (data.hint === "No more hints available for this word!") {
      showToast("No more hints for this word!");
    } else {
      addClue(data.type || "💡 Hint", data.hint);
    }
  } catch (err) {
    showToast("⚠ Could not fetch hint.");
    console.error(err);
  } finally {
    hintBtn.disabled = false;
  }
}

// ── Guess handler ─────────────────────────────────────────────────────────────
async function submitGuess() {
  if (state.roundOver) return;
  const raw = guessInput.value.trim();
  if (!raw) { guessInput.focus(); return; }

  const guess = raw.toLowerCase();
  guessInput.value = "";
  lockControls();
  submitBtn.innerHTML = `<span class="loader"></span>`;

  try {
    const result = await apiGuess(guess);

    if (result.status === "correct") {
      // ── Correct ──
      const earned = result.earned_score ?? state.wordScore;
      const prev   = state.totalScore;
      state.totalScore = result.total_score ?? (state.totalScore + earned);

      animateScore(prev, state.totalScore);
      revealAllTiles(USE_MOCK ? mockCurrent.word : guess);
      setThermo(100);

      feedbackBanner.style.display = "flex";
      feedbackBanner.style.color   = "#4ade80";
      feedbackBanner.style.background = "rgba(74,222,128,0.08)";
      feedbackBanner.style.border  = "2px solid #4ade80";
      feedbackBanner.innerHTML     = `🎉 CORRECT! +${earned} pts`;

      nextBtn.style.display = "block";
      nextBtn.textContent   = "▶ NEXT WORD";
      state.roundOver = true;
      submitBtn.innerHTML = "▶ Guess";

    } else {
      // ── Incorrect ──
      const pct = result.semantic_pct ?? 0;
      setThermo(pct);
      addGuessRow(guess, result);

      // Brief shake on input
      guessInput.style.animation = "none";
      void guessInput.offsetWidth;
      guessInput.style.animation = "shake 0.3s ease";

      submitBtn.innerHTML = "▶ Guess";
      unlockControls();

      if (result.is_antonym) showToast("⟺ That's the opposite word!");
      else if (result.is_likely_typo) showToast(`📝 Almost! Check your spelling (${result.spelling_pct}% match)`);
    }
  } catch (err) {
    submitBtn.innerHTML = "▶ Guess";
    unlockControls();
    showToast("⚠ Error checking guess.");
    console.error(err);
  }
}

// ── Skip handler ──────────────────────────────────────────────────────────────
async function skipWord() {
  if (state.roundOver) return;
  lockControls();

  try {
    const data = await apiSkip();
    const word  = data.target_word ?? "???";

    revealAllTiles(word);
    setThermo(0);

    feedbackBanner.style.display = "flex";
    feedbackBanner.style.color   = "#f87171";
    feedbackBanner.style.background = "rgba(248,113,113,0.08)";
    feedbackBanner.style.border  = "2px solid #f87171";
    feedbackBanner.innerHTML     = `⏭ Skipped — the word was <b style="margin-left:6px">${word.toUpperCase()}</b>`;

    nextBtn.style.display = "block";
    nextBtn.textContent   = "▶ TRY NEXT WORD";
    state.roundOver = true;
    submitBtn.innerHTML = "▶ Guess";
  } catch (err) {
    unlockControls();
    submitBtn.innerHTML = "▶ Guess";
    showToast("⚠ Error skipping.");
    console.error(err);
  }
}

// ── Keyboard shortcut (Enter) ─────────────────────────────────────────────────
guessInput.addEventListener("keydown", e => {
  if (e.key === "Enter") submitGuess();
});

// ── Shake keyframe (injected) ─────────────────────────────────────────────────
const shakeStyle = document.createElement("style");
shakeStyle.textContent = `
  @keyframes shake {
    0%,100%{transform:translateX(0)}
    20%{transform:translateX(-6px)}
    40%{transform:translateX(6px)}
    60%{transform:translateX(-4px)}
    80%{transform:translateX(4px)}
  }
`;
document.head.appendChild(shakeStyle);

// ── Badge ─────────────────────────────────────────────────────────────────────
apiBadge.textContent = USE_MOCK ? "✨ ONLINE" : "🌐 LIVE API";
apiBadge.style.color = USE_MOCK ? "var(--green-lt)" : "var(--yellow-lt)";
apiBadge.style.borderColor = USE_MOCK ? "var(--green)" : "var(--yellow)";

// ── Boot ──────────────────────────────────────────────────────────────────────
startRound();
