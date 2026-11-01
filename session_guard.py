"""
session_guard.py
────────────────
Wraps GameEngine so that no target word is repeated within the same
session (i.e. within the same Python process / run).

Usage
-----
Replace:
    from game_engine import GameEngine
    game = GameEngine()

With:
    from session_guard import SessionGuardedGame
    game = SessionGuardedGame()

Everything else (game.start_round(), game.request_hint(),
game.check_guess(), …) stays identical — SessionGuardedGame
inherits all methods from GameEngine unchanged.
"""

from game_engine import GameEngine


class SessionGuardedGame(GameEngine):
    """
    GameEngine subclass that tracks which target words have already
    appeared in this session and never serves the same word twice.

    All original GameEngine methods are left completely untouched;
    only get_random_word() and start_round() are overridden to inject
    the duplicate-prevention logic.
    """

    def __init__(self, data_path: str = "data/word_bank.json"):
        super().__init__(data_path)
        # Set that grows each round; holds every word served this session
        self._session_seen: set[str] = set()

    # ------------------------------------------------------------------ #
    #  Override: pick a word that has not been used this session           #
    # ------------------------------------------------------------------ #
    def get_random_word(self) -> str | None:
        """
        Returns a random word that:
          1. Has at least one valid WordNet sense (same check as the
             original), AND
          2. Has NOT been served as a target word in this session.

        Falls back to None if no fresh word can be found after exhausting
        the entire pool (all words have been used, or the word_pool is
        empty).
        """
        import random

        # Build the list of words that are still available this session
        available = [w for w in self.word_pool if w not in self._session_seen]

        if not available:
            return None  # every word in the pool has been used

        # Shuffle a copy so we don't bias toward the front of the list
        candidates = available[:]
        random.shuffle(candidates)

        for word in candidates:
            senses = self.wordnet.get_senses(word)
            if senses:
                return word

        # All remaining candidates had no valid senses — pool is exhausted
        return None

    # ------------------------------------------------------------------ #
    #  Override: register the chosen word before the round starts          #
    # ------------------------------------------------------------------ #
    def start_round(self) -> dict | None:
        """
        Delegates to the original start_round logic but, after a target
        word is successfully chosen, marks it as seen for this session.

        If GameEngine.start_round() returns None (no valid word found),
        this method returns None unchanged.
        """
        result = super().start_round()

        # If a round was successfully started, record the target word
        if result is not None and self.current_target:
            self._session_seen.add(self.current_target.lower())

        return result

    # ------------------------------------------------------------------ #
    #  Helper: inspect / reset session state                               #
    # ------------------------------------------------------------------ #
    def seen_words(self) -> set[str]:
        """Returns a copy of the set of words used this session."""
        return set(self._session_seen)

    def reset_session(self) -> None:
        """
        Clears the seen-words set so the session starts fresh.
        Useful for testing or for a 'new game' feature.
        """
        self._session_seen.clear()
        print("Session word history cleared. All words are available again.")
