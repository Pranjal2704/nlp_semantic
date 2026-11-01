import sqlite3
import os 
from datetime import datetime

class GameLogger:
    def __init__(self, db_path: str="data/sessions.db"):
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.db_path = db_path
        self.conn = sqlite3.connect(self.db_path)
        self._create_tables()

        self.sessions_id = self._start_session()
        self.current_round_id = None


    def _create_tables(self) -> None:
        cur = self.conn.cursor()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_time TEXT NOT NULL,
                end_time TEXT,
                total_score INTEGER DEFAULT 0,
                rounds_played INTEGER DEFAULT 0
            )
        """)

        cur.execute("""
        CREATE TABLE IF NOT EXISTS rounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            target_word TEXT NOT NULL,
            definition TEXT,
            word_length INTEGER,
            potential_score INTEGER,
            hints_used INTEGER DEFAULT 0,
            final_score INTEGER,
            outcome TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS guesses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                round_id INTEGER NOT NULL,
                guess_text TEXT NOT NULL,
                spelling_pct REAL,
                semantic_pct REAL,
                temperature TEXT,
                is_antonym INTEGER DEFAULT 0,
                is_correct INTEGER DEFAULT 0,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (round_id) REFERENCES rounds(id)
            )
        """)

        self.conn.commit()

    #Writing methods to write inside the DB. This will be called/run during the gameplay 

    def _start_session(self) -> int:
        cur = self.conn.cursor()
        cur.execute(
            "INSERT INTO sessions (start_time, total_score, rounds_played) VALUES (?, 0, 0)",
            (datetime.now().isoformat(timespec="seconds"),)
        )
        self.conn.commit()
        return cur.lastrowid

    def log_round_start(self, target_word: str, definition: str | None, word_length: int, potential_score: int) -> None:
        cur = self.conn.cursor()
        cur.execute("""
            INSERT INTO rounds
            (session_id, target_word, definition, word_length, potential_score, start_time)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            self.sessions_id, target_word, definition, word_length, potential_score, datetime.now().isoformat(timespec="seconds")                    
        ))

        self.conn.commit()
        self.current_round_id = cur.lastrowid

    def log_hint_used(self) -> None:
        if self.current_round_id is None:
            return 
        self.conn.execute(
            "UPDATE rounds SET hints_used = hints_used + 1 WHERE id = ?",
            (self.current_round_id,)
        )
        self.conn.commit()

    def log_guess(self, guess_text: str, result: dict)-> None:
        if self.current_round_id is None:
            return 

        is_correct = 1 if result.get("status") == "correct" else 0
        cur = self.conn.cursor()
        cur.execute("""
            INSERT INTO guesses
        (round_id, guess_text, spelling_pct, semantic_pct, temperature,
            is_antonym, is_correct, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            self.current_round_id,
            guess_text,
            result.get("spelling_pct"),
            result.get("semantic_pct"),
            result.get("temperature"),
            1 if result.get("is+_antonym") else 0,
            is_correct,
            datetime.now().isoformat(timespec="seconds")
        ))
        self.conn.commit()

    def log_round_end(self, outcome: str, final_score: int) -> None:
        if self.current_round_id is None:
            return 
        self.conn.execute("""
            UPDATE rounds
            set outcome = ?, final_score = ?, end_time = ?
            WHERE id = ?
        """, (outcome, final_score, datetime.now().isoformat(timespec="seconds"),self.current_round_id))

        self.conn.execute("UPDATE sessions SET rounds_played = rounds_played + 1 WHEER id = ?",
                          (self.sessions_id)
        )
        self.conn.commit()
        self.current_round_id = None


    def end_sessions(self, total_score: int) -> None:
        self.conn.execute(
            "UPDATE sessions SET end_time = ?, total_score = ?, WHERE id = ?",
            (datetime.now().isoformat(timespec="seconds"), total_score, self.sessions_id)
        )
        self.conn.commit()
        self.close()

    def close(self) -> None:
        self.conn.close()

    #Read Methods where for future use or learning we can access the previous attempts
    #NOTE= We can implement ML algo which learns on the history data and improves as kept on playing\

    def get_all_sessions(self) -> list[dict]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM sessions ORDER BY start_time DESC")
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def get_rounds_for_session(self, session_id: int) -> list[dict]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM rounds WHERE session_id = ? ORDER BY start_time", (session_id,))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def get_guesses_for_round(self, round_id: int) -> list[dict]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM guesses WHERE round_id = ? ORDER BY timestamp", (round_id,))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row) for row in cur.fetchall())]

    def get_word_history(self, word: str) -> list[dict]:
        cur  = self.conn.cursor()
        cur.execute("SELECT * FROM rounds WHERE target_word = ? ORDER BY start_time DESC", (word,))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


