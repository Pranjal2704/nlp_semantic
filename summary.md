📖 Project Summary: Semantic Word Guessing Game Engine
1. Overview & Architecture
This project is a modular, terminal-based word-guessing game featuring multi-layered guess evaluation (spelling, antonyms, and semantic closeness), dynamic hint revealing, and progressive scoring penalties.

The system is decoupled into three core layers:

Game Engine (game_engine.py): Controls game state, round transitions, word selection safety loops, progressive scoring penalties, multi-metric evaluations, and user interaction loops.

Lexical Data Engine (nlp/wordnet_engine.py): Accesses WordNet datasets for primary synset selection, definitions, masked example sentences, and direct antonym pointers (!).

Semantic Vector Engine (nlp/embedding_engine.py): Uses pre-trained GloVe vectors (gensim) to calculate cosine similarity math between word embeddings for conceptual "Hot or Cold" feedback.

2. Key Game Mechanics & Logic
Word Selection Loop: Uses up to 10 safety attempts to randomly select target words from data/word_bank.json that have valid WordNet synsets.

Primary Synset Selection: Uses senses[0] to ensure clues reflect dominant, recognizable word meanings rather than obscure secondary senses.

Progressive Hint System:

Default State: No clues shown at start.

Hint 1 (Definition): Reveals synset definition at a 30% score penalty.

Hint 2+ (Examples): Reveals masked example sentences (______) at a 20% score penalty per example.

Minimum Floor: Score value for a word never drops below 5 points.

Multi-Layered Evaluation Pipeline:

Exact Match: Direct string equality check for round completion.

Spelling Closeness: Character overlap matching via difflib.SequenceMatcher.

Antonym Check: Structural pointer lookup via WordNet (!).

Semantic Closeness: Cosine similarity via gensim vector embeddings.

3. Project File Structure
Plaintext
word_guessing_game/
│
├── data/
│   └── word_bank.json          # Pre-processed WordNet dictionary mappings
│
├── nlp/
│   ├── __init__.py
│   ├── wordnet_engine.py       # Handles synsets, definitions, examples, & antonyms
│   └── embedding_engine.py     # Handles vector lookup & cosine similarity
│
├── game_engine.py              # Central controller, state manager, & CLI interface
└── PROJECT_SUMMARY.md          # Project documentation
4. Complete Code Implementation
A. Vector Embedding Engine (nlp/embedding_engine.py)
Python
import numpy as np
import gensim.downloader as api


class EmbeddingEngine:
    def __init__(self, model_name: str = "glove-wiki-gigaword-50"):
        """
        Loads pre-trained word vectors from gensim.
        Downloads ~66MB GloVe model on first run and caches it.
        """
        print(f"Loading embedding model '{model_name}'... (This may take a moment on first run)")
        try:
            self.model = api.load(model_name)
            self.is_ready = True
            print("Embedding model loaded successfully!")
        except Exception as e:
            print(f"Warning: Failed to load embedding model ({e}). Embeddings offline.")
            self.model = None
            self.is_ready = False

    def get_vector(self, word: str) -> np.ndarray | None:
        """Retrieves the numeric vector array for a given word."""
        if not self.is_ready or not word:
            return None
        
        w = word.strip().lower()
        if w in self.model:
            return self.model[w]
        return None

    def get_similarity(self, word1: str, word2: str) -> float:
        """
        Calculates cosine similarity between two words.
        Returns a percentage match score from 0.0% to 100.0%.
        """
        if not self.is_ready or not word1 or not word2:
            return 0.0

        w1 = word1.strip().lower()
        w2 = word2.strip().lower()

        if w1 not in self.model or w2 not in self.model:
            return 0.0

        raw_similarity = float(self.model.similarity(w1, w2))
        pct = max(0.0, raw_similarity) * 100
        return round(pct, 1)

    def get_most_similar(self, word: str, top_n: int = 5) -> list[tuple[str, float]]:
        """Retrieves top N closest words in vector space."""
        if not self.is_ready or not word:
            return []
            
        w = word.strip().lower()
        if w not in self.model:
            return []

        similar_items = self.model.most_similar(w, topn=top_n)
        return [(match, round(score * 100, 1)) for match, score in similar_items]


if __name__ == "__main__":
    engine = EmbeddingEngine()
    if engine.is_ready:
        print("Embedding engine test passed.")
B. Game Controller Engine (game_engine.py)
Python
import random
from difflib import SequenceMatcher
from nlp.wordnet_engine import WordNetEngine
from nlp.embedding_engine import EmbeddingEngine

class GameEngine:
    def __init__(self, data_path: str = "data/word_bank.json"):
        """Initializes WordNet engine, Embedding engine, and game structures."""
        print("Initializing Game Engine...")
        self.wordnet = WordNetEngine(data_path)
        self.embeddings = EmbeddingEngine()
        self.total_score = 0
        
        # Filter candidate words
        self.word_pool = [
            key for key in self.wordnet.data.keys() 
            if not key.endswith(("-n", "-v", "-a", "-r", "-s")) and len(key) > 1
        ]
        
        # Current round state
        self.current_target = None
        self.primary_synset = None
        self.current_word_score = 0
        self.hints_revealed = 0

    def get_random_word(self) -> str | None:
        """Picks a valid target word with up to 10 safety retries."""
        if not self.word_pool:
            return None
            
        for _ in range(10):
            word = random.choice(self.word_pool)
            senses = self.wordnet.get_senses(word)
            if senses:
                return word
        return None

    def start_new_word(self) -> dict | None:
        """Resets word state and calculates starting score."""
        target = self.get_random_word()
        if not target:
            return None

        self.current_target = target
        senses = self.wordnet.get_senses(target)
        self.primary_synset = senses[0]
        
        self.current_word_score = len(target) * 10
        self.hints_revealed = 0

        return {
            "word_length": len(target),
            "potential_score": self.current_word_score
        }

    def request_hint(self) -> str:
        """Progressively reveals hints at score penalty costs."""
        if not self.current_target:
            return "No active word. Start a new round first!"

        self.hints_revealed += 1

        if self.hints_revealed == 1:
            self.current_word_score = max(5, int(self.current_word_score * 0.7))
            definition = self.wordnet.get_definition(self.primary_synset)
            return f"HINT (Definition): {definition or 'No definition found.'}"

        examples = self.wordnet.get_examples(self.primary_synset)
        example_index = self.hints_revealed - 2

        if examples and example_index < len(examples):
            self.current_word_score = max(5, int(self.current_word_score * 0.8))
            masked_example = examples[example_index].lower().replace(self.current_target.lower(), "______")
            return f"HINT (Example): {masked_example}"

        return "No more hints available for this word!"

    def check_guess(self, user_guess: str) -> dict:
        """Evaluates guess across spelling, antonym, and semantic dimensions."""
        guess = user_guess.strip().lower()
        target = self.current_target.lower()

        # 1. Exact Match
        if guess == target:
            earned_points = self.current_word_score
            self.total_score += earned_points
            return {
                "status": "correct",
                "earned_score": earned_points,
                "total_score": self.total_score
            }

        # 2. Antonym Check
        antonyms = [a.lower() for a in self.wordnet.get_antonyms(self.primary_synset)]
        is_antonym = guess in antonyms

        # 3. Spelling Similarity
        spelling_pct = round(SequenceMatcher(None, guess, target).ratio() * 100, 1)

        # 4. Semantic Similarity (Gensim Embeddings)
        semantic_pct = self.embeddings.get_similarity(guess, target)

        if semantic_pct >= 75.0:
            temp = "BOILING HOT (Right concept!)"
        elif semantic_pct >= 50.0:
            temp = "WARM (Getting close in meaning)"
        elif semantic_pct >= 30.0:
            temp = "COOL (Slightly related)"
        else:
            temp = "COLD (Unrelated concept)"

        return {
            "status": "incorrect",
            "is_antonym": is_antonym,
            "spelling_pct": spelling_pct,
            "semantic_pct": semantic_pct,
            "temperature": temp
        }


# --- Interactive CLI ---
if __name__ == "__main__":
    game = GameEngine()

    print("\n==================================================")
    print("  WORDNET + EMBEDDINGS INTERACTIVE GAME LOOP      ")
    print("==================================================")
    print("Commands: 'hint' for clues | 'skip' to give up | 'quit' to exit\n")

    while True:
        round_info = game.start_new_word()
        if not round_info:
            print("Failed to start round.")
            break

        print(f"\nNEW WORD LOADED! Length: {round_info['word_length']} letters.")
        print(f"Max potential score: {round_info['potential_score']} points.")

        while True:
            action = input(f"\n[{game.current_target[0]}... ({round_info['word_length']} letters) | Score: {game.current_word_score}] Your Guess > ").strip().lower()

            if action in ["quit", "exit"]:
                print(f"\nFinal Score: {game.total_score}. Thanks for playing!")
                exit()

            if action == "skip":
                print(f"Given up! The target word was: '{game.current_target}'")
                print(f"Current Total Score: {game.total_score}")
                break

            if action == "hint":
                hint_text = game.request_hint()
                print(f"--> {hint_text}")
                continue

            result = game.check_guess(action)

            if result["status"] == "correct":
                print(f"\nCORRECT! You earned {result['earned_score']} points!")
                print(f"Total Cumulative Score: {result['total_score']}")
                break
            else:
                print(f"--> WRONG!")
                if result["is_antonym"]:
                    print("    OPPOSITE ALERT! You guessed a direct antonym!")
                print(f"    Semantic Match: {result['semantic_pct']}% -> {result['temperature']}")
                print(f"    Spelling Match: {result['spelling_pct']}%")