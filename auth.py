"""
auth.py
───────
User authentication helpers for Word Sense.

Provides:
  - register_user(username, password) → (ok: bool, message: str)
  - login_user(username, password)    → (ok: bool, user_id: int | None, message: str)

Passwords are hashed with bcrypt before being stored; plain-text
passwords are never written to the database.

DB schema additions (auto-created on first import):
  users(id, username, password_hash, created_at)
"""

import sqlite3
import os
import re
from datetime import datetime

try:
    import bcrypt
    _BCRYPT_AVAILABLE = True
except ImportError:
    # Graceful fallback so the rest of the app still loads even if bcrypt
    # isn't installed yet; installation instructions printed once.
    import hashlib, secrets
    _BCRYPT_AVAILABLE = False
    print(
        "[auth] WARNING: 'bcrypt' is not installed. "
        "Run  pip install bcrypt  for proper password hashing."
    )

DB_PATH = "data/sessions.db"


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_tables(conn: sqlite3.Connection) -> None:
    """Create auth-related tables if they don't exist yet."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT    NOT NULL,
            created_at    TEXT    NOT NULL
        );

        -- Add user_id column to sessions if it was created without it
        -- (SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we catch the error)
        CREATE TABLE IF NOT EXISTS sessions_new_placeholder (id INTEGER);
    """)

    # Attempt to add user_id to sessions (safe no-op if column already exists)
    try:
        conn.execute("ALTER TABLE sessions ADD COLUMN user_id INTEGER REFERENCES users(id)")
    except sqlite3.OperationalError:
        pass  # column already present

    # words_discovered table: one row per (user_id, word)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS words_discovered (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL REFERENCES users(id),
            word       TEXT    NOT NULL,
            first_seen TEXT    NOT NULL,
            UNIQUE(user_id, word)
        )
    """)

    conn.commit()


def _hash_password(plain: str) -> str:
    if _BCRYPT_AVAILABLE:
        return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()
    # Fallback: SHA-256 with random salt (not as strong as bcrypt)
    salt = secrets.token_hex(16)
    digest = hashlib.sha256((salt + plain).encode()).hexdigest()
    return f"sha256:{salt}:{digest}"


def _check_password(plain: str, stored_hash: str) -> bool:
    if _BCRYPT_AVAILABLE and not stored_hash.startswith("sha256:"):
        return bcrypt.checkpw(plain.encode(), stored_hash.encode())
    # Fallback path
    try:
        _, salt, digest = stored_hash.split(":")
        return hashlib.sha256((salt + plain).encode()).hexdigest() == digest
    except Exception:
        return False


def _validate_username(username: str) -> str | None:
    """Return an error string, or None if username is valid."""
    if not username or not username.strip():
        return "Username cannot be empty."
    if len(username) < 3:
        return "Username must be at least 3 characters long."
    if len(username) > 30:
        return "Username must be 30 characters or fewer."
    if not re.match(r'^[A-Za-z0-9_\-]+$', username):
        return "Username may only contain letters, digits, underscores, and hyphens."
    return None


def _validate_password(password: str) -> str | None:
    """Return an error string, or None if password is valid."""
    if not password:
        return "Password cannot be empty."
    if len(password) < 6:
        return "Password must be at least 6 characters long."
    return None


# ── Public API ────────────────────────────────────────────────────────────────

def register_user(username: str, password: str) -> tuple[bool, str]:
    """
    Register a new user.

    Returns
    -------
    (True,  "Registration successful.")          on success
    (False, "<reason>")                          on failure
    """
    err = _validate_username(username)
    if err:
        return False, err
    err = _validate_password(password)
    if err:
        return False, err

    conn = _get_conn()
    _ensure_tables(conn)

    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
            (username.strip(), _hash_password(password), datetime.now().isoformat(timespec="seconds"))
        )
        conn.commit()
        return True, "Registration successful."
    except sqlite3.IntegrityError:
        return False, f"Username '{username}' is already taken. Please choose another."
    finally:
        conn.close()


def login_user(username: str, password: str) -> tuple[bool, int | None, str]:
    """
    Authenticate an existing user.

    Returns
    -------
    (True,  user_id, "Login successful.")        on success
    (False, None,    "<reason>")                 on failure
    """
    if not username or not password:
        return False, None, "Username and password are required."

    conn = _get_conn()
    _ensure_tables(conn)

    try:
        row = conn.execute(
            "SELECT id, password_hash FROM users WHERE username = ? COLLATE NOCASE",
            (username.strip(),)
        ).fetchone()

        if row is None:
            return False, None, "No account found with that username."

        if not _check_password(password, row["password_hash"]):
            return False, None, "Incorrect password."

        return True, row["id"], "Login successful."
    finally:
        conn.close()


def get_user_stats(user_id: int) -> dict:
    """
    Return a stats dict for the given user:
      {
        "username":         str,
        "total_score":      int,   # cumulative across all sessions
        "words_discovered": int,   # unique words correctly guessed
        "sessions_played":  int,
        "discovered_list":  [str, ...]  # up to 50 most-recent words
      }
    """
    conn = _get_conn()
    _ensure_tables(conn)

    try:
        user_row = conn.execute(
            "SELECT username FROM users WHERE id = ?", (user_id,)
        ).fetchone()

        if not user_row:
            return {}

        score_row = conn.execute(
            "SELECT COALESCE(SUM(total_score), 0) AS total, COUNT(*) AS sessions "
            "FROM sessions WHERE user_id = ?",
            (user_id,)
        ).fetchone()

        discovered_rows = conn.execute(
            "SELECT word FROM words_discovered WHERE user_id = ? ORDER BY first_seen DESC LIMIT 50",
            (user_id,)
        ).fetchall()

        disc_count_row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM words_discovered WHERE user_id = ?",
            (user_id,)
        ).fetchone()

        return {
            "username":         user_row["username"],
            "total_score":      score_row["total"],
            "sessions_played":  score_row["sessions"],
            "words_discovered": disc_count_row["cnt"],
            "discovered_list":  [r["word"] for r in discovered_rows],
        }
    finally:
        conn.close()


def record_word_discovered(user_id: int, word: str) -> None:
    """
    Mark a word as discovered by the user (idempotent — safe to call multiple times).
    """
    if user_id is None:
        return
    conn = _get_conn()
    _ensure_tables(conn)
    try:
        conn.execute(
            "INSERT OR IGNORE INTO words_discovered (user_id, word, first_seen) VALUES (?, ?, ?)",
            (user_id, word.lower().strip(), datetime.now().isoformat(timespec="seconds"))
        )
        conn.commit()
    finally:
        conn.close()
