import json
import os
import ssl
import numpy as np
import gensim.downloader as api
from difflib import SequenceMatcher

# Bypass unverified SSL context issues common on macOS / corporate proxies
try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context


class EmbeddingEngine:
    def __init__(self, model_name: str = "glove-wiki-gigaword-50"):
        """Initializes and loads the pre-trained embedding model."""
        print(f"Loading embedding model: '{model_name}'...")
        try:
            self.model = api.load(model_name)
            self.is_ready = True
            print("Embedding model loaded successfully.")
        except Exception as e:
            print(f"Failed to load embedding model: {e}")
            self.model = None
            self.is_ready = False

        # In-memory vector cache: { "word": np.ndarray }
        self.word_vectors: dict[str, np.ndarray] = {}

    def get_vector(self, word: str) -> np.ndarray | None:
        """Retrieves the vector for a single word, using cache if available."""
        if not self.is_ready or not word:
            return None

        clean_word = word.strip().lower()

        # Check local cache first
        if clean_word in self.word_vectors:
            return self.word_vectors[clean_word]

        # Check pre-trained model vocabulary
        if clean_word in self.model:
            vector = self.model[clean_word]
            self.word_vectors[clean_word] = vector
            return vector

        return None

    def build_dataset_vectors(self, word_bank_path: str = "data/word_bank.json") -> int:
        """
        Reads words from word_bank.json, filters out synset IDs,
        and converts all valid words into cached vectors.
        """
        if not self.is_ready:
            print("Model not ready. Cannot build vectors.")
            return 0

        if not os.path.exists(word_bank_path):
            print(f"File not found: {word_bank_path}")
            return 0

        with open(word_bank_path, "r", encoding="utf-8") as f:
            raw_data = json.load(f)

        # Extract only plain words (skipping synset keys like '02193771-s')
        words = [
            k.strip().lower()
            for k in raw_data.keys()
            if not k.endswith(("-n", "-v", "-a", "-r", "-s")) and len(k) > 1
        ]

        converted_count = 0
        for word in words:
            if word in self.model:
                self.word_vectors[word] = self.model[word]
                converted_count += 1

        print(f"Cached {converted_count}/{len(words)} words into vectors.")
        return converted_count

    # GloVe-50 unrelated pairs cluster around ~0.22 alignment
    _BASELINE = 0.22
    _TANH_LOW = 20.0
    _TANH_HIGH = 80.0

    def _adjusted_alignment(self, v1: np.ndarray, v2: np.ndarray) -> float | None:
        """Returns baseline-centered vector alignment, or None if vectors are zero."""
        norm1 = np.linalg.norm(v1)
        norm2 = np.linalg.norm(v2)
        if norm1 == 0.0 or norm2 == 0.0:
            return None

        alignment = float(np.dot(v1, v2) / (norm1 * norm2))
        return alignment - self._BASELINE

    def _linear_estimate(self, adjusted: float) -> float:
        """Rough 0–100 estimate used to route between tanh and ReLU activations."""
        return max(0.0, min(100.0, (adjusted / (1.0 - self._BASELINE)) * 100.0))

    def _apply_tanh_score(self, adjusted: float) -> float:
        """Tanh activation mapped to the 20–80% band for mid-range semantic matches."""
        tanh_val = float(np.tanh(adjusted * 5.0))
        return self._TANH_LOW + ((tanh_val + 1.0) / 2.0) * (self._TANH_HIGH - self._TANH_LOW)

    def _apply_relu_score(self, adjusted: float, linear_estimate: float) -> float:
        """
        ReLU activation for scores outside the 20–80% band.
        Provides sharper cutoffs at the low end and linear amplification at the high end.
        """
        if linear_estimate < self._TANH_LOW:
            return min(self._TANH_LOW, float(np.maximum(0.0, adjusted * 8.0) * 100.0))

        high_threshold = 0.38
        excess = float(np.maximum(0.0, adjusted - high_threshold))
        return min(100.0, self._TANH_HIGH + excess * 250.0)

    def _hybrid_similarity(self, v1: np.ndarray, v2: np.ndarray) -> float:
        """
        Hybrid semantic scorer:
        - 20–80% range  → tanh (smooth mid-range discrimination)
        - below 20%     → ReLU (sharp cutoff for unrelated pairs)
        - above 80%     → ReLU (linear boost for very strong matches)
        """
        adjusted = self._adjusted_alignment(v1, v2)
        if adjusted is None:
            return 0.0

        linear_estimate = self._linear_estimate(adjusted)

        if self._TANH_LOW <= linear_estimate <= self._TANH_HIGH:
            return self._apply_tanh_score(adjusted)

        return self._apply_relu_score(adjusted, linear_estimate)

    def compute_similarity(self, word1: str, word2: str) -> float:
        """
        Calculates semantic similarity using a hybrid tanh/ReLU activation
        on vector alignment scores.
        """
        if not self.is_ready or not word1 or not word2:
            return 0.0

        w1 = word1.strip().lower()
        w2 = word2.strip().lower()

        if w1 == w2:
            return 100.0

        v1 = self.get_vector(w1)
        v2 = self.get_vector(w2)
        if v1 is None or v2 is None:
            return 0.0

        return round(self._hybrid_similarity(v1, v2), 2)

    def evaluate_guess(self, guess: str, target: str) -> dict:
        spelling_pct = round(SequenceMatcher(None, guess, target).ratio() * 100, 1)
        semantic_pct = self.compute_similarity(guess, target)

        TYPO_THRESHOLD = 85.0

        is_likely_typo = spelling_pct >= TYPO_THRESHOLD

        if is_likely_typo:
                temperature = "SO CLOSE! (Check your spelling)"
        elif semantic_pct >= 60.0:
            temperature = "BOILING HOT (Right concept!)"
        elif semantic_pct >= 35.0:
            temperature = "WARM (Getting close in meaning)"
        elif semantic_pct >= 15.0:
            temperature = "COOL (Slightly related)"
        else:
            temperature = "COLD (Unrelated concept)"

        return {
            "spelling_pct": spelling_pct,
            "semantic_pct": semantic_pct,
            "is_likely_typo": is_likely_typo,
            "temperature": temperature
        }

if __name__ == "__main__":
    engine = EmbeddingEngine()

    if engine.is_ready:
        # Pre-cache words from data/word_bank.json
        engine.build_dataset_vectors("data/word_bank.json")

        # Test similarity calculations
        sample_pairs = [
            ("king", "monarch"),
            ("dog", "puppy"),
            ("hot", "cold"),
            ("apple", "tractor"),
        ]

        print("\n--- Similarity Verification ---")
        for w1, w2 in sample_pairs:
            sim = engine.compute_similarity(w1, w2)
            print(f"'{w1}' <-> '{w2}' = {sim}%")
