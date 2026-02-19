import os
import random
import sqlite3
import spacy
import uvicorn
import bcrypt
import json
import uuid
import hashlib
import time
import requests
import shutil
import logging
import asyncio
from functools import lru_cache
from llama_cpp import Llama
from huggingface_hub import hf_hub_download
from datetime import datetime
from fastapi import (
    FastAPI,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    BackgroundTasks,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from spellchecker import SpellChecker
from typing import List, Dict, Optional
from fastapi.responses import FileResponse
from wordfreq import word_frequency


# --- LOGGING CONFIGURATION ---
class EndpointFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return msg.find("/images/") == -1 and msg.find("/assets/") == -1


logging.getLogger("uvicorn.access").addFilter(EndpointFilter())

app = FastAPI()

# --- CONFIG ---
MAX_PLAYERS = 6
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(BASE_DIR, "profile_images")
MODELS_DIR = os.path.join(BASE_DIR, "models")
SHOP_CONFIG_FILE = os.path.join(BASE_DIR, "shop_config.json")
DB_FILE = os.path.join(BASE_DIR, "game.db")

# Words that are too generic/common to be meaningful guesses
STOP_WORDS = {
    # Articles & determiners
    "a",
    "an",
    "the",
    "this",
    "that",
    "these",
    "those",
    # Pronouns
    "i",
    "me",
    "my",
    "we",
    "us",
    "our",
    "you",
    "your",
    "he",
    "him",
    "his",
    "she",
    "her",
    "it",
    "its",
    "they",
    "them",
    "their",
    # Common verbs (too generic)
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "am",
    "do",
    "does",
    "did",
    "have",
    "has",
    "had",
    "will",
    "would",
    "could",
    "should",
    "can",
    "may",
    "might",
    "must",
    "shall",
    # Prepositions & conjunctions
    "of",
    "to",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "or",
    "and",
    "but",
    # Other extremely common words
    "not",
    "no",
    "yes",
    "so",
    "if",
    "then",
    "than",
    "when",
    "what",
    "who",
    "how",
    "why",
    "all",
    "any",
    "some",
    "each",
    "every",
    "both",
    "few",
    "more",
    "most",
    "other",
    "such",
    "only",
    "just",
    "also",
    "very",
    "too",
    "even",
    "still",
    "already",
    # Single letters (except as real words checked elsewhere)
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "j",
    "k",
    "l",
    "m",
    "n",
    "o",
    "p",
    "q",
    "r",
    "s",
    "t",
    "u",
    "v",
    "w",
    "x",
    "y",
    "z",
}

# --- ACHIEVEMENT DEFINITIONS (DATABASE) ---
ACHIEVEMENT_DEFS = [
    {
        "id": "rookie",
        "title": "Rookie",
        "desc": "Make 25 guesses",
        "type": "total_guesses",
        "target": 25,
        "reward": 25,
    },
    {
        "id": "learner",
        "title": "Learner",
        "desc": "Make 50 guesses",
        "type": "total_guesses",
        "target": 50,
        "reward": 75,
    },
    {
        "id": "word_smith",
        "title": "Word Smith",
        "desc": "Make 100 guesses",
        "type": "total_guesses",
        "target": 100,
        "reward": 100,
    },
    {
        "id": "chatterbox",
        "title": "Chatterbox",
        "desc": "Make 500 guesses",
        "type": "total_guesses",
        "target": 500,
        "reward": 250,
    },
    {
        "id": "encyclopedia",
        "title": "Encyclopedia",
        "desc": "Make 1000 guesses",
        "type": "total_guesses",
        "target": 1000,
        "reward": 500,
    },
    {
        "id": "getting_warm",
        "title": "Getting Warm",
        "desc": "Get 10 warm or higher guesses (50+ score)",
        "type": "good_guesses",
        "target": 10,
        "reward": 50,
    },
    {
        "id": "sharpshooter",
        "title": "Sharpshooter",
        "desc": "Get 25 warm or higher guesses",
        "type": "good_guesses",
        "target": 25,
        "reward": 75,
    },
    {
        "id": "on_fire",
        "title": "On Fire",
        "desc": "Get 50 warm or higher guesses",
        "type": "good_guesses",
        "target": 50,
        "reward": 150,
    },
    {
        "id": "sniper",
        "title": "Sniper",
        "desc": "Get 100 warm or higher guesses",
        "type": "good_guesses",
        "target": 100,
        "reward": 300,
    },
    {
        "id": "first_blood",
        "title": "First Blood",
        "desc": "Win your first game",
        "type": "games_won",
        "target": 1,
        "reward": 100,
    },
    {
        "id": "contender",
        "title": "Contender",
        "desc": "Win 5 games",
        "type": "games_won",
        "target": 5,
        "reward": 200,
    },
    {
        "id": "champion",
        "title": "Champion",
        "desc": "Win 10 games",
        "type": "games_won",
        "target": 10,
        "reward": 500,
    },
    {
        "id": "legend",
        "title": "Legend",
        "desc": "Win 25 games",
        "type": "games_won",
        "target": 25,
        "reward": 1000,
    },
]

# Legacy Config for Reward Calculation
MILESTONE_CONFIG = {
    "total_guesses": {25: 25, 50: 75, 100: 100, 500: 250, 1000: 500},
    "good_guesses": {10: 50, 25: 75, 50: 150, 100: 300},
    "games_won": {1: 100, 5: 200, 10: 500, 25: 1000},
}

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ASSET MANAGER ---
shop_items = []


def get_bytes_hash(image_bytes):
    return hashlib.md5(image_bytes).hexdigest()


def init_assets():
    global shop_items
    if not os.path.exists(IMG_DIR):
        os.makedirs(IMG_DIR)

    existing_hashes = set()
    existing_files = [f for f in os.listdir(IMG_DIR) if f.endswith(".jpg")]

    if existing_files:
        print(f"[INFO] Analyzing {len(existing_files)} existing images...")
        for f in existing_files:
            try:
                with open(os.path.join(IMG_DIR, f), "rb") as img:
                    existing_hashes.add(get_bytes_hash(img.read()))
            except:
                pass

    if len(existing_files) < 200:
        print(f"[INFO] Downloading up to 200 images...")
        for i in range(1, 201):
            filename = f"avatar_{i}.jpg"
            path = os.path.join(IMG_DIR, filename)
            if os.path.exists(path) and os.path.getsize(path) > 0:
                continue

            success = False
            attempts = 0
            while attempts < 10 and not success:
                try:
                    seed = random.randint(1000, 9999999) + attempts
                    r = requests.get(
                        f"https://picsum.photos/seed/{seed}/150/150", timeout=5
                    )
                    if r.status_code == 200:
                        h = get_bytes_hash(r.content)
                        if h not in existing_hashes:
                            with open(path, "wb") as f:
                                f.write(r.content)
                            existing_hashes.add(h)
                            success = True
                except:
                    time.sleep(0.1)
                attempts += 1

            if not success and not os.path.exists(path):
                print(f"   [X] Failed to download avatar_{i}")

    if os.path.exists(SHOP_CONFIG_FILE):
        try:
            with open(SHOP_CONFIG_FILE, "r") as f:
                shop_items = json.load(f)
            # Check for Joker
            if not any(i.get("id") == 2001 for i in shop_items):
                print("[WARN] Joker card missing in config. Regenerating shop...")
                generate_shop_config()
            else:
                print("[OK] Loaded Shop Config")
        except:
            generate_shop_config()
    else:
        generate_shop_config()


def generate_shop_config():
    global shop_items
    items = []

    # Joker Card
    items.append(
        {
            "id": 2001,
            "type": "item",
            "value": "joker_card",
            "price": 100,
            "name": "Joker Card",
            "desc": "Get a hint (maybe)",
        }
    )

    for i in range(1, 201):
        items.append(
            {
                "id": i,
                "type": "avatar",
                "value": f"avatar_{i}.jpg",
                "price": random.randint(5, 50) * 10,
            }
        )
    for i in range(1, 11):
        items.append(
            {
                "id": 1000 + i,
                "type": "wallpaper",
                "value": f"theme_{i}",
                "price": random.randint(20, 100) * 10,
            }
        )

    with open(SHOP_CONFIG_FILE, "w") as f:
        json.dump(items, f, indent=4)
    shop_items = items
    print("[OK] Generated New Shop Config")


init_assets()
app.mount("/images", StaticFiles(directory=IMG_DIR), name="images")


# --- DATABASE ---
def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        """CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, bananum INTEGER DEFAULT 0, current_pfp TEXT DEFAULT 'avatar_1.jpg', owned_pfps TEXT DEFAULT '1', current_wall TEXT DEFAULT 'theme_1', owned_walls TEXT DEFAULT '1001', total_guesses INTEGER DEFAULT 0, good_guesses INTEGER DEFAULT 0, games_won INTEGER DEFAULT 0, is_admin INTEGER DEFAULT 0)"""
    )
    c.execute(
        """CREATE TABLE IF NOT EXISTS scores (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, word TEXT, guesses INTEGER, timestamp DATETIME, mode TEXT, FOREIGN KEY(user_id) REFERENCES users(id))"""
    )

    # Persistence Tables
    c.execute(
        """CREATE TABLE IF NOT EXISTS active_games (user_id INTEGER PRIMARY KEY, word TEXT, guesses TEXT, difficulty TEXT DEFAULT 'average', last_played DATETIME)"""
    )
    c.execute(
        """CREATE TABLE IF NOT EXISTS rooms (room_id TEXT PRIMARY KEY, word TEXT, difficulty TEXT, host_username TEXT, guesses TEXT, solved INTEGER, created_at DATETIME, last_activity DATETIME)"""
    )

    try:
        c.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0")
    except:
        pass

    try:
        c.execute("ALTER TABLE users ADD COLUMN joker_cards INTEGER DEFAULT 0")
    except:
        pass

    try:
        c.execute(
            "ALTER TABLE active_games ADD COLUMN difficulty TEXT DEFAULT 'average'"
        )
    except:
        pass

    # 7-Day Cleanup
    print("[INFO] Cleaning up old games...")
    c.execute("DELETE FROM active_games WHERE last_played < date('now', '-7 days')")
    c.execute("DELETE FROM rooms WHERE last_activity < date('now', '-7 days')")

    conn.commit()
    conn.close()


init_db()

# --- AI ---
nlp = None
for model_name in ("en_core_web_lg", "en_core_web_md", "en_core_web_sm"):
    try:
        nlp = spacy.load(
            model_name,
            exclude=[
                "tok2vec",
                "tagger",
                "parser",
                "attribute_ruler",
                "lemmatizer",
                "ner",
            ],
        )
        print(f"[OK] AI Loaded ({model_name}) [vectors-only mode]")
        break
    except Exception:
        continue

if nlp is None:
    print(
        "[ERR] ERROR: No SpaCy English model found. Install one with: python -m spacy download en_core_web_lg"
    )
    exit(1)

spell = SpellChecker()


@lru_cache(maxsize=2048)
def get_word_doc(word):
    """Cached word vector lookup - avoids re-processing the same words."""
    return nlp(word)


# --- GAME STATE ---
# --- LLM INIT (lazy load + auto-unload) ---
llm = None
llm_lock = None
_llm_unload_task = None
LLM_UNLOAD_DELAY = 5  # seconds of inactivity before unloading


def _get_model_path():
    return os.path.join(MODELS_DIR, "Llama-3.2-1B-Instruct-Q4_K_M.gguf")


def _load_llm():
    """Load the LLM into memory. Call from async context via to_thread."""
    global llm
    if llm is not None:
        return
    model_path = _get_model_path()
    if not os.path.exists(model_path):
        return
    try:
        llm = Llama(model_path=model_path, n_ctx=2048, n_gpu_layers=0, verbose=False)
        print("[OK] Local LLM loaded on-demand (CPU mode)")
    except Exception as e:
        print(f"[ERR] Failed to load local LLM: {e}")


def _unload_llm():
    """Release the LLM from memory."""
    global llm
    if llm is not None:
        del llm
        llm = None
        print("[OK] Local LLM unloaded (idle timeout)")


async def _schedule_llm_unload():
    """Cancel any pending unload and schedule a new one after LLM_UNLOAD_DELAY."""
    global _llm_unload_task

    if _llm_unload_task is not None:
        _llm_unload_task.cancel()

    async def _delayed_unload():
        await asyncio.sleep(LLM_UNLOAD_DELAY)
        async with llm_lock:
            _unload_llm()

    _llm_unload_task = asyncio.create_task(_delayed_unload())


@app.on_event("startup")
async def startup_event():
    global llm_lock
    llm_lock = asyncio.Lock()

    if not os.path.exists(MODELS_DIR):
        os.makedirs(MODELS_DIR)

    model_path = _get_model_path()

    if not os.path.exists(model_path):
        print("[INFO] Downloading Llama 3.2 1B model (this may take a while)...")
        try:
            hf_hub_download(
                repo_id="unsloth/Llama-3.2-1B-Instruct-GGUF",
                filename="Llama-3.2-1B-Instruct-Q4_K_M.gguf",
                local_dir=MODELS_DIR,
            )
            print("[OK] Model Downloaded")
        except Exception as e:
            print(f"[ERR] Failed to download model: {e}")

    print(
        "[INFO] LLM will load on-demand when joker is used (auto-unloads after 5s idle)"
    )


class GameState:
    word_lists = {"easy": [], "average": [], "difficult": []}
    sessions = {}


game = GameState()


def load_words():
    def read_list(f):
        path = os.path.join(BASE_DIR, f)
        if not os.path.exists(path):
            print(f"[WARN] Word list file not found: {path}")
            return []
        words = list(
            set(
                [
                    l.strip().lower()
                    for l in open(path, "r", encoding="utf-8")
                    if l.strip()
                ]
            )
        )
        return words

    game.word_lists["easy"] = read_list("easy_words.txt")
    game.word_lists["average"] = read_list("average_difficulty_words.txt")
    game.word_lists["difficult"] = read_list("difficult_words.txt")

    if not game.word_lists["average"]:
        game.word_lists["average"] = ["apple", "banana", "cherry"]

    print(
        f"[INFO] Loaded words: Easy={len(game.word_lists['easy'])}, Avg={len(game.word_lists['average'])}, Diff={len(game.word_lists['difficult'])}"
    )


def get_user_word(user_id):
    if user_id in game.sessions:
        print(
            f"[INFO] [Single] Current Word for User {user_id}: {game.sessions[user_id].upper()}"
        )
        return game.sessions[user_id]

    # Check DB
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT word FROM active_games WHERE user_id=?", (user_id,))
    row = c.fetchone()
    conn.close()

    if row:
        game.sessions[user_id] = row[0]
        print(f"[INFO] [Single] Loaded Word for User {user_id}: {row[0].upper()}")
        return row[0]

    # No saved game - return None, don't auto-create
    return None


def get_saved_game(user_id):
    """Get the full saved game state from DB including guesses and difficulty"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "SELECT word, guesses, difficulty FROM active_games WHERE user_id=?", (user_id,)
    )
    row = c.fetchone()
    conn.close()

    if row:
        try:
            guesses = json.loads(row[1]) if row[1] else []
        except:
            guesses = []
        return {
            "word": row[0],
            "guesses": guesses,
            "difficulty": row[2] or "average",
            "game_id": get_word_hash(row[0]),
        }
    return None


def pick_new_word_for_user(user_id, difficulty="average"):
    difficulty = difficulty.lower().strip()

    # Explicit mapping to ensure correct list is picked
    if difficulty not in ["easy", "average", "difficult"]:
        print(f"[WARN] Invalid difficulty '{difficulty}', defaulting to 'average'")
        difficulty = "average"

    lst = game.word_lists.get(difficulty)
    if not lst:
        print(f"[WARN] List for {difficulty} is empty! Defaulting to average list.")
        lst = game.word_lists["average"]

    w = random.choice(lst)
    game.sessions[user_id] = w

    # Save to DB with difficulty
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "INSERT OR REPLACE INTO active_games (user_id, word, guesses, difficulty, last_played) VALUES (?, ?, '[]', ?, datetime('now'))",
        (user_id, w, difficulty),
    )
    conn.commit()
    conn.close()

    print(
        f"[INFO] [Single] New Word for User {user_id}: {w.upper()} (Difficulty: {difficulty})"
    )
    return w


def get_word_hash(word):
    return hashlib.md5(word.encode()).hexdigest()


# --- ROOMS ---
class Room:
    def __init__(
        self, room_id, word, difficulty, host_username=None, guesses=None, solved=False
    ):
        self.room_id = room_id
        self.word = word
        self.difficulty = difficulty
        self.word_hash = get_word_hash(word)
        self.host_username = host_username
        self.active_connections = []
        self.guesses = guesses if guesses else []
        self.solved = solved


class ConnectionManager:
    def __init__(self):
        self.rooms = {}
        self.load_rooms_from_db()

    def load_rooms_from_db(self):
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute(
            "SELECT room_id, word, difficulty, host_username, guesses, solved FROM rooms"
        )
        rows = c.fetchall()
        for r in rows:
            try:
                g_list = json.loads(r[4])
            except:
                g_list = []
            self.rooms[r[0]] = Room(r[0], r[1], r[2], r[3], g_list, bool(r[5]))
        conn.close()
        print(f"[INFO] Loaded {len(self.rooms)} rooms from DB")

    def create_room(self, difficulty):
        room_id = str(uuid.uuid4())[:8]
        if not game.word_lists["easy"]:
            load_words()
        word = random.choice(
            game.word_lists.get(difficulty, game.word_lists["average"])
        )
        self.rooms[room_id] = Room(room_id, word, difficulty)

        # Save to DB
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute(
            "INSERT INTO rooms (room_id, word, difficulty, host_username, guesses, solved, created_at, last_activity) VALUES (?, ?, ?, ?, '[]', 0, datetime('now'), datetime('now'))",
            (room_id, word, difficulty, None),
        )
        conn.commit()
        conn.close()

        print(f"[INFO] [Co-op] Room {room_id} Created. Word: {word.upper()}")
        return room_id

    async def connect(self, websocket: WebSocket, room_id: str, username: str):
        await websocket.accept()
        if room_id.startswith("sp-"):
            # For single player rooms, always sync with DB state
            # The word/guesses may have changed via HTTP endpoints (new-game, guess, etc.)
            try:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute("SELECT id FROM users WHERE username=?", (username,))
                row = c.fetchone()
                conn.close()
                if row:
                    user_id = row[0]
                    # Fetch correct difficulty and guess history from DB
                    saved = get_saved_game(user_id)
                    diff = saved["difficulty"] if saved else "average"
                    saved_guesses = saved["guesses"] if saved else []
                    word = get_user_word(user_id)
                    if not word:
                        if not game.word_lists["easy"]:
                            load_words()
                        word = pick_new_word_for_user(user_id, diff)
                        saved_guesses = []
                    self.rooms[room_id] = Room(
                        room_id, word, diff, username, saved_guesses
                    )
                    print(
                        f"[INFO] [Single] WS Synced for {username}. Word: {word.upper()} Diff: {diff} Guesses: {len(saved_guesses)}"
                    )
            except Exception as e:
                print(f"[WARN] [Single] Failed to create/sync room: {e}")
                await websocket.close(code=4000)
                return False

        if room_id not in self.rooms:
            await websocket.close(code=4000)
            return False

        room = self.rooms[room_id]
        if len(room.active_connections) >= MAX_PLAYERS:
            await websocket.close(code=4003)
            return False

        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT current_pfp FROM users WHERE username = ?", (username,))
        row = c.fetchone()
        conn.close()

        websocket.pfp = row[0] if row else "avatar_1.jpg"
        websocket.username = username
        room.active_connections.append(websocket)

        if room.host_username is None:
            room.host_username = username
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute(
                "UPDATE rooms SET host_username=? WHERE room_id=?", (username, room_id)
            )
            conn.commit()
            conn.close()

        print(
            f"[INFO] [Co-op] {username} joined Room {room_id}. Word is: {room.word.upper()}"
        )
        return True

    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.rooms:
            room = self.rooms[room_id]
            if websocket in room.active_connections:
                room.active_connections.remove(websocket)

    async def broadcast(self, room_id: str, message: dict):
        if room_id in self.rooms:
            for cx in self.rooms[room_id].active_connections[:]:
                try:
                    await cx.send_json(message)
                except:
                    pass

    async def broadcast_player_list(self, room_id: str):
        if room_id in self.rooms:
            room = self.rooms[room_id]
            # distinct players by username
            unique_players = {}
            for cx in room.active_connections:
                if cx.username not in unique_players:
                    unique_players[cx.username] = {
                        "username": cx.username,
                        "pfp": cx.pfp,
                    }

            players = list(unique_players.values())
            print(
                f"[INFO] Broadcasting player list for room {room_id}: {[p['username'] for p in players]}"
            )
            await self.broadcast(room_id, {"type": "player_list", "players": players})

    async def close_room(self, room_id: str):
        if room_id in self.rooms:
            await self.broadcast(room_id, {"type": "room_closed"})
            del self.rooms[room_id]
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("DELETE FROM rooms WHERE room_id=?", (room_id,))
            conn.commit()
            conn.close()


manager = ConnectionManager()

# --- LOGIC & REWARDS ---


def calculate_similarity_with_variations(user_word, secret_word):
    def get_sim(u_text, s_text):
        u = get_word_doc(u_text)
        s = get_word_doc(s_text)
        if not u.has_vector or u.vector_norm == 0:
            return 0
        return max(0, s.similarity(u))

    best_sim = get_sim(user_word, secret_word)
    best_word = user_word

    variations = []
    if user_word.endswith("s"):
        variations.append(user_word[:-1])
    else:
        variations.append(user_word + "s")

    if user_word.endswith("y"):
        variations.append(user_word[:-1] + "ies")
    elif user_word.endswith("ies"):
        variations.append(user_word[:-3] + "y")

    for v in variations:
        if not spell.unknown([v]):
            sim = get_sim(v, secret_word)
            if sim > best_sim:
                best_sim = sim
                best_word = v

    return best_sim, best_word


def calculate_score(user_word, secret_word):
    if user_word == secret_word:
        return {"score": 100, "temperature": "SOLVED", "isCorrect": True}

    # Block stop words - too generic to be meaningful
    if user_word in STOP_WORDS:
        return {
            "score": 0,
            "temperature": "Unknown",
            "isCorrect": False,
            "error": "Word too common",
        }

    # Minimum length check
    if len(user_word) < 2:
        return {
            "score": 0,
            "temperature": "Unknown",
            "isCorrect": False,
            "error": "Word too short",
        }

    if spell.unknown([user_word]):
        return {
            "score": 0,
            "temperature": "Unknown",
            "isCorrect": False,
            "error": "Unknown word",
        }

    best_sim, _ = calculate_similarity_with_variations(user_word, secret_word)

    score = int(best_sim * 145)

    if score >= 100:
        score = 99

    # Check for frequency but don't penalize - just flag it
    freq = word_frequency(user_word, "en")
    is_common = False
    if freq > 0.0002:
        is_common = True

    sub = (
        len(user_word) > 3
        and len(secret_word) > 3
        and (user_word in secret_word or secret_word in user_word)
    )
    if sub:
        score += 25

    if score >= 100:
        score = 99

    temps = [(15, "Cold"), (35, "Chilly"), (50, "Warm"), (65, "Hot"), (85, "Burning")]
    t = "Frozen"
    for th, val in temps:
        if score >= th:
            t = val

    return {
        "score": score,
        "temperature": t,
        "isCorrect": False,
        "is_common": is_common,
    }


def process_win_rewards(user_id):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("UPDATE users SET games_won = games_won + 1 WHERE id = ?", (user_id,))
    c.execute("SELECT games_won FROM users WHERE id = ?", (user_id,))
    wins = c.fetchone()[0]

    reward = 50
    messages = []

    if wins in MILESTONE_CONFIG["games_won"]:
        bonus = MILESTONE_CONFIG["games_won"][wins]
        reward += bonus
        messages.append(f"Milestone: {wins} Wins! (+{bonus})")

    c.execute("UPDATE users SET bananum = bananum + ? WHERE id = ?", (reward, user_id))
    conn.commit()
    conn.close()
    return reward, messages


def process_guess_rewards(user_id, score, is_win):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()

    c.execute(
        "UPDATE users SET total_guesses = total_guesses + 1 WHERE id = ?", (user_id,)
    )
    c.execute("SELECT total_guesses, good_guesses FROM users WHERE id = ?", (user_id,))
    row = c.fetchone()
    total_g, good_g = row[0], row[1]

    reward = 0
    messages = []

    if total_g in MILESTONE_CONFIG["total_guesses"]:
        amt = MILESTONE_CONFIG["total_guesses"][total_g]
        reward += amt
        messages.append(f"Milestone: {total_g} Guesses! (+{amt})")

    if score >= 50:
        c.execute(
            "UPDATE users SET good_guesses = good_guesses + 1 WHERE id = ?", (user_id,)
        )
        good_g += 1
        if good_g in MILESTONE_CONFIG["good_guesses"]:
            amt = MILESTONE_CONFIG["good_guesses"][good_g]
            reward += amt
            messages.append(f"Milestone: {good_g} Good Guesses! (+{amt})")

    if score >= 95 and not is_win:
        reward += 5
    elif score >= 85 and not is_win:
        reward += 2

    if reward > 0:
        c.execute(
            "UPDATE users SET bananum = bananum + ? WHERE id = ?", (reward, user_id)
        )

    conn.commit()
    conn.close()
    return reward, " | ".join(messages)


def get_algo_scores(secret_word, guess_word):
    best_raw, _ = calculate_similarity_with_variations(guess_word, secret_word)
    s1 = int(best_raw * 145)
    if s1 > 100:
        s1 = 99
    s2 = int(best_raw * 100)
    s3 = int((best_raw**2) * 100)
    s4 = int((best_raw**3) * 100)
    s5 = int(((best_raw - 0.2) / 0.8) * 100)
    if s5 < 0:
        s5 = 0
    return {
        "raw_sim": round(best_raw, 4),
        "current": s1,
        "linear": s2,
        "squared": s3,
        "cubed": s4,
        "steep": s5,
    }


# --- MODELS ---
class UserAuth(BaseModel):
    username: str
    password: str


class GuessRequest(BaseModel):
    user_id: int
    guess: str
    difficulty: Optional[str] = "average"


class NewGameRequest(BaseModel):
    user_id: int
    difficulty: str = "average"


class ScoreSubmission(BaseModel):
    user_id: int
    username: str
    guesses_count: int
    mode: str = "single"


class HistoryCheck(BaseModel):
    user_id: int
    game_id: Optional[str] = None


class CreateRoomRequest(BaseModel):
    difficulty: str = "average"


class ShopAction(BaseModel):
    user_id: int
    item_id: int


class AdminAction(BaseModel):
    admin_id: int
    target_user_id: int
    action: str
    amount: Optional[int] = 0


class GiftRequest(BaseModel):
    sender_id: int
    receiver_id: int
    amount: int


class CompareRequest(BaseModel):
    user_id: int
    secret: str
    guesses: List[str]


# --- ENDPOINTS ---


@app.post("/api/register")
def register(user: UserAuth):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM users")
    is_admin = 1 if c.fetchone()[0] == 0 else 0
    rand_id = random.randint(1, 200)
    hashed = bcrypt.hashpw(user.password.encode("utf-8"), bcrypt.gensalt())
    try:
        c.execute(
            "INSERT INTO users (username, password, bananum, is_admin, current_pfp, owned_pfps) VALUES (?, ?, 150, ?, ?, ?)",
            (
                user.username,
                hashed.decode("utf-8"),
                is_admin,
                f"avatar_{rand_id}.jpg",
                str(rand_id),
            ),
        )
        conn.commit()
        return {
            "message": "Registered",
            "user_id": c.lastrowid,
            "username": user.username,
            "is_admin": is_admin,
        }
    except:
        raise HTTPException(400, "Username taken")
    finally:
        conn.close()


@app.post("/api/login")
def login(user: UserAuth):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "SELECT id, password, is_admin FROM users WHERE username = ?", (user.username,)
    )
    row = c.fetchone()
    conn.close()
    if not row or not bcrypt.checkpw(
        user.password.encode("utf-8"), row[1].encode("utf-8")
    ):
        raise HTTPException(401, "Invalid")
    return {"user_id": row[0], "username": user.username, "is_admin": row[2]}


@app.get("/api/user/{user_id}")
def get_user_data(user_id: int):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "SELECT bananum, current_pfp, owned_pfps, total_guesses, good_guesses, games_won, current_wall, owned_walls, is_admin, joker_cards FROM users WHERE id = ?",
        (user_id,),
    )
    row = c.fetchone()
    conn.close()
    if row:
        return {
            "bananum": row[0],
            "pfp": row[1],
            "owned_pfps": row[2].split(",") if row[2] else [],
            "total_guesses": row[3],
            "good_guesses": row[4],
            "games_won": row[5],
            "wall": row[6],
            "owned_walls": row[7].split(",") if row[7] else [],
            "is_admin": row[8],
            "joker_cards": row[9] if row[9] is not None else 0,
        }
    return {}


@app.get("/api/users/list")
def get_all_users():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT id, username FROM users")
    users = [{"id": r[0], "username": r[1]} for r in c.fetchall()]
    conn.close()
    return users


@app.get("/api/achievements/{user_id}")
def get_achievements(user_id: int):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "SELECT total_guesses, good_guesses, games_won FROM users WHERE id=?",
        (user_id,),
    )
    row = c.fetchone()
    conn.close()

    if not row:
        return []

    stats = {"total_guesses": row[0], "good_guesses": row[1], "games_won": row[2]}

    res = []
    for a in ACHIEVEMENT_DEFS:
        current = stats.get(a["type"], 0)
        res.append({**a, "current": current, "completed": current >= a["target"]})
    return res


@app.post("/api/gift")
def gift_bananas(data: GiftRequest):
    if data.amount <= 0:
        return {"success": False, "message": "Amount must be positive"}
    if data.sender_id == data.receiver_id:
        return {"success": False, "message": "Cannot gift self"}
    # Logic for gifting would go here (update balances)
    return {"success": True, "message": "Gift sent!"}


@app.get("/api/shop")
def get_shop():
    return shop_items


@app.post("/api/shop/buy")
def buy_item(data: ShopAction):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "SELECT bananum, owned_pfps, owned_walls FROM users WHERE id = ?",
        (data.user_id,),
    )
    row = c.fetchone()
    if not row:
        raise HTTPException(404)

    balance, op, ow = row
    item = next((x for x in shop_items if x["id"] == data.item_id), None)
    if not item:
        raise HTTPException(404)

    if balance < item["price"]:
        return {"success": False, "message": "Too poor"}

    new_bal = balance - item["price"]

    if item["type"] == "item":
        # Consumable
        c.execute(
            "UPDATE users SET bananum = ?, joker_cards = coalesce(joker_cards, 0) + 1 WHERE id = ?",
            (new_bal, data.user_id),
        )
        conn.commit()
        conn.close()
        return {"success": True}

    is_wall = item["type"] == "wallpaper"
    owned = (ow if is_wall else op).split(",")

    if str(data.item_id) in owned:
        return {"success": False, "message": "Already owned"}

    owned.append(str(data.item_id))
    new_owned_str = ",".join(owned)

    col = "owned_walls" if is_wall else "owned_pfps"
    c.execute(
        f"UPDATE users SET bananum = ?, {col} = ? WHERE id = ?",
        (new_bal, new_owned_str, data.user_id),
    )
    conn.commit()
    conn.close()
    return {"success": True}


@app.post("/api/shop/equip")
def equip_item(data: ShopAction):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT owned_pfps, owned_walls FROM users WHERE id = ?", (data.user_id,))
    row = c.fetchone()

    item = next((x for x in shop_items if x["id"] == data.item_id), None)
    if not item:
        raise HTTPException(404)

    is_wall = item["type"] == "wallpaper"
    owned = (row[1] if is_wall else row[0]).split(",")

    if str(data.item_id) not in owned:
        raise HTTPException(403, "Cheat attempt detected")

    col = "current_wall" if is_wall else "current_pfp"
    c.execute(f"UPDATE users SET {col} = ? WHERE id = ?", (item["value"], data.user_id))
    conn.commit()
    conn.close()
    return {"success": True}


@app.post("/api/new-game")
def new_game(req: NewGameRequest):
    load_words()
    w = pick_new_word_for_user(req.user_id, req.difficulty)
    return {"message": "Start", "game_id": get_word_hash(w)}


@app.post("/api/give-up")
def give_up(req: NewGameRequest):
    if req.user_id not in game.sessions:
        return {"error": "No active game"}
    word = game.sessions[req.user_id]
    return {"word": word}


@app.post("/api/game-state")
def get_state(req: HistoryCheck):
    saved = get_saved_game(req.user_id)
    if saved:
        # Restore to session
        game.sessions[req.user_id] = saved["word"]
        return {
            "game_id": saved["game_id"],
            "guesses": saved["guesses"],
            "difficulty": saved["difficulty"],
            "has_saved_game": True,
        }
    return {"has_saved_game": False}


@app.get("/api/has-saved-game/{user_id}")
def has_saved_game(user_id: int):
    saved = get_saved_game(user_id)
    if saved:
        return {
            "has_saved_game": True,
            "difficulty": saved["difficulty"],
            "guess_count": len(saved["guesses"]),
        }
    return {"has_saved_game": False}


@app.post("/api/guess")
def handle_guess(req: GuessRequest):
    if req.user_id not in game.sessions:
        # Try to restore from DB if possible
        saved = get_saved_game(req.user_id)
        if saved:
            game.sessions[req.user_id] = saved["word"]
        else:
            try:
                if not game.word_lists["average"]:
                    load_words()
                pick_new_word_for_user(req.user_id, req.difficulty or "average")
            except Exception as e:
                print(f"[ERR] Failed to auto-start game for user {req.user_id}: {e}")

    if req.user_id not in game.sessions:
        return {"error": "No active game"}
    secret = game.sessions[req.user_id]
    guessed_word = req.guess.strip().lower()

    result = calculate_score(guessed_word, secret)
    if result.get("error"):
        return result

    # Include the guessed word before persisting so saved games can be resumed safely.
    result["guess"] = guessed_word

    # Update DB with guess
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT guesses FROM active_games WHERE user_id=?", (req.user_id,))
    row = c.fetchone()
    current_guesses = json.loads(row[0]) if row else []
    current_guesses.append(result)
    c.execute(
        "UPDATE active_games SET guesses=?, last_played=datetime('now') WHERE user_id=?",
        (json.dumps(current_guesses), req.user_id),
    )
    conn.commit()
    conn.close()

    reward, msg = process_guess_rewards(
        req.user_id, result["score"], result["isCorrect"]
    )

    if result["isCorrect"]:
        win_reward, win_msg = process_win_rewards(req.user_id)
        reward += win_reward
        if win_msg:
            msg = msg + " | " + " | ".join(win_msg) if msg else " | ".join(win_msg)

        del game.sessions[req.user_id]
        # Remove from DB
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("DELETE FROM active_games WHERE user_id=?", (req.user_id,))
        conn.commit()
        conn.close()

    result.update({"reward": reward, "milestone": msg})
    return result


class JokerRequest(BaseModel):
    user_id: int
    room_id: Optional[str] = None


async def call_llm_joker(word):
    global llm, llm_lock
    is_helpful = random.random() > 0.5

    system_prompt = "You are a hint generator for a word game. Be concise."
    user_prompt = ""

    if is_helpful:
        user_prompt = f"The secret word is '{word}'. Give a, helpful, cryptic hint about this word without using the word itself."
    else:
        user_prompt = f"You are a chaotic joker. Give a completely misleading, nonsensical, or useless hint that sounds real but is actually unhelpful or wrong, but you act like youre giving a real answer."

    if llm_lock:
        try:
            async with llm_lock:
                # Lazy-load LLM if not in memory
                if llm is None:
                    await asyncio.to_thread(_load_llm)
                if llm is None:
                    raise RuntimeError("LLM failed to load")
                # Run blocking inference in thread
                output = await asyncio.to_thread(
                    llm.create_chat_completion,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.9,
                    max_tokens=60,
                )
            # Schedule unload after inference (outside lock)
            await _schedule_llm_unload()
            return output["choices"][0]["message"]["content"].strip(), is_helpful
        except Exception as e:
            print(f"LLM Error: {e}")
            if is_helpful:
                return (
                    "Think about related categories first, then narrow to specifics.",
                    True,
                )
            return (
                "A penguin with a laptop definitely knows the answer. Probably.",
                False,
            )

    if is_helpful:
        return "Start broad, then move toward concrete nouns tied to the theme.", True
    return "The answer is somewhere between a volcano and a cucumber.", False


async def process_joker_task(room_id: str, word: str, username: str):
    hint, is_helpful = await call_llm_joker(word)

    result_data = {
        "type": "joker_used",
        "username": username,
        "hint": hint,
        "is_helpful": is_helpful,
    }

    if room_id and room_id in manager.rooms:
        await manager.broadcast(room_id, result_data)


@app.post("/api/use-joker")
async def use_joker(req: JokerRequest, background_tasks: BackgroundTasks):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT joker_cards, username FROM users WHERE id=?", (req.user_id,))
    row = c.fetchone()

    if not row or (row[0] or 0) < 1:
        conn.close()
        return {"success": False, "message": "No Joker Cards!"}

    username = row[1]
    c.execute(
        "UPDATE users SET joker_cards = joker_cards - 1 WHERE id=?", (req.user_id,)
    )
    conn.commit()
    conn.close()

    # Get the word
    word = "banana"
    final_room_id = req.room_id

    if req.room_id and req.room_id in manager.rooms:
        word = manager.rooms[req.room_id].word
    else:
        # Assuming Single Player, we can use the SP room ID format
        # But the frontend might not have sent a room_id for single player in the old logic
        # We need to handle this.
        # Let's assume frontend sends "sp-{user_id}" if connected via WS
        # Or we can derive it.
        word = get_user_word(req.user_id)
        if not word:
            saved = get_saved_game(req.user_id)
            diff = saved["difficulty"] if saved else "average"
            if not game.word_lists["easy"]:
                load_words()
            word = pick_new_word_for_user(req.user_id, diff)
        if not final_room_id:
            final_room_id = f"sp-{req.user_id}"

    # Ensure room exists in manager for broadcast (if SP and not yet connected, broadcast might fail, but frontend should connect first)
    # If frontend is connected via WS, the room "sp-{user_id}" should exist in manager.rooms

    if final_room_id and final_room_id in manager.rooms:
        background_tasks.add_task(process_joker_task, final_room_id, word, username)
        return {"success": True, "message": "Joker summoned!"}

    # Fallback if no active WS room exists (still return a usable hint).
    hint, is_helpful = await call_llm_joker(word)
    return {
        "success": True,
        "message": "Joker summoned!",
        "username": username,
        "hint": hint,
        "is_helpful": is_helpful,
    }


@app.post("/api/win")
def log_win(data: ScoreSubmission):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "INSERT INTO scores (user_id, username, word, guesses, timestamp, mode) VALUES (?, ?, ?, ?, ?, ?)",
        (
            data.user_id,
            data.username,
            "secret",
            data.guesses_count,
            datetime.now(),
            data.mode,
        ),
    )
    conn.commit()
    conn.close()
    return {"status": "logged"}


@app.post("/api/check-played")
def check_played(data: HistoryCheck):
    return {"hasPlayed": False}


@app.get("/api/admin/users")
def admin_users():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT id, username FROM users")
    u = [{"id": r[0], "username": r[1]} for r in c.fetchall()]
    conn.close()
    return u


@app.post("/api/admin/action")
def admin_action(data: AdminAction):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT is_admin FROM users WHERE id=?", (data.admin_id,))
    if not c.fetchone()[0]:
        raise HTTPException(403)

    if data.action == "add_currency":
        c.execute(
            "UPDATE users SET bananum = bananum + ? WHERE id=?",
            (data.amount, data.target_user_id),
        )
    elif data.action == "reset_currency":
        c.execute("UPDATE users SET bananum=0 WHERE id=?", (data.target_user_id,))
    elif data.action == "reset_stats":
        c.execute(
            "UPDATE users SET total_guesses=0, good_guesses=0, games_won=0 WHERE id=?",
            (data.target_user_id,),
        )
    elif data.action == "reset_inventory":
        c.execute(
            "UPDATE users SET owned_pfps='1', owned_walls='1001', current_pfp='avatar_1.jpg', current_wall='theme_1' WHERE id=?",
            (data.target_user_id,),
        )
    elif data.action == "delete_user":
        c.execute("DELETE FROM scores WHERE user_id=?", (data.target_user_id,))
        c.execute("DELETE FROM users WHERE id=?", (data.target_user_id,))
    elif data.action == "close_all_rooms":
        c.execute("DELETE FROM rooms")
        manager.rooms.clear()

    conn.commit()
    conn.close()
    return {"success": True}


@app.post("/api/admin/compare")
def admin_compare(req: CompareRequest):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT is_admin FROM users WHERE id=?", (req.user_id,))
    row = c.fetchone()
    conn.close()
    if not row or row[0] != 1:
        raise HTTPException(403)

    results = []
    for guess in req.guesses:
        clean_guess = guess.strip().lower()
        if not clean_guess:
            continue
        scores = get_algo_scores(req.secret.lower(), clean_guess)
        if scores:
            results.append({"word": clean_guess, "scores": scores})
        else:
            results.append({"word": clean_guess, "error": "Unknown"})

    results.sort(key=lambda x: x.get("scores", {}).get("raw_sim", 0), reverse=True)
    return results


@app.post("/api/room/create")
def create_room(req: CreateRoomRequest):
    return {"room_id": manager.create_room(req.difficulty)}


@app.websocket("/ws/{room_id}/{username}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, username: str):
    if not await manager.connect(websocket, room_id, username):
        return
    room = manager.rooms[room_id]
    await websocket.send_json(
        {
            "type": "init",
            "history": room.guesses,
            "solved": room.solved,
            "game_id": room.word_hash,
            "is_owner": (room.host_username == username),
            "difficulty": room.difficulty,
        }
    )
    await manager.broadcast_player_list(room_id)

    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT id FROM users WHERE username=?", (username,))
    row = c.fetchone()
    conn.close()

    if not row:
        print(f"[ERR] [Error] User {username} not found in DB. Closing WS.")
        await websocket.close(code=4001)  # Custom code for User Not Found
        return

    uid = row[0]

    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)

            if payload.get("type") == "close_room":
                if room.host_username == username:
                    await manager.close_room(room_id)
                    break

            elif payload.get("type") == "next_game":
                if room.host_username == username:
                    if not game.word_lists["easy"]:
                        load_words()
                    old_word = room.word
                    was_solved = room.solved  # Check if it was solved before resetting
                    room.word = random.choice(
                        game.word_lists.get(room.difficulty, game.word_lists["average"])
                    )
                    room.word_hash = get_word_hash(room.word)
                    room.guesses = []
                    room.solved = False

                    # Update DB
                    conn = sqlite3.connect(DB_FILE)
                    c = conn.cursor()
                    c.execute(
                        "UPDATE rooms SET word=?, guesses='[]', solved=0, last_activity=datetime('now') WHERE room_id=?",
                        (room.word, room_id),
                    )
                    conn.commit()
                    conn.close()

                    print(
                        f"[INFO] [Co-op] Room {room_id} Reset. Word: {room.word.upper()}"
                    )
                    # Only reveal word if it was skipped (not solved)
                    if not was_solved:
                        await manager.broadcast(
                            room_id, {"type": "reveal", "word": old_word}
                        )
                    await manager.broadcast(
                        room_id, {"type": "reset_game", "game_id": room.word_hash}
                    )

            elif payload.get("type") == "guess":
                if room.solved:
                    continue
                guess = payload.get("word", "").strip().lower()
                res = calculate_score(guess, room.word)
                if res.get("error"):
                    await websocket.send_json(
                        {"type": "error", "message": res["error"]}
                    )
                    continue

                reward, msg = process_guess_rewards(uid, res["score"], res["isCorrect"])

                # Public data (no milestone - that's private)
                public_data = {
                    "pfp": getattr(websocket, "pfp", "avatar_1.jpg"),
                    "guess": guess,
                    "username": username,
                    "score": res["score"],
                    "temperature": res["temperature"],
                    "isCorrect": res["isCorrect"],
                    "is_common": res.get("is_common", False),
                }
                room.guesses.append(public_data)

                # Update DB
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute(
                    "UPDATE rooms SET guesses=?, last_activity=datetime('now') WHERE room_id=?",
                    (json.dumps(room.guesses), room_id),
                )

                conn.commit()
                conn.close()

                # Broadcast public guess to everyone FIRST
                await manager.broadcast(
                    room_id, {"type": "new_guess", "data": public_data}
                )

                if res["isCorrect"]:
                    room.solved = True
                    # Broadcast win immediately so UI updates fast
                    await manager.broadcast(
                        room_id,
                        {"type": "game_won", "winner": username, "word": room.word},
                    )

                    # Process rewards in background (after broadcast)
                    conn = sqlite3.connect(DB_FILE)
                    c = conn.cursor()
                    c.execute("UPDATE rooms SET solved=1 WHERE room_id=?", (room_id,))
                    conn.commit()

                    for cx in room.active_connections:
                        try:
                            c.execute(
                                "SELECT id FROM users WHERE username=?", (cx.username,)
                            )
                            row = c.fetchone()
                            if row:
                                process_win_rewards(row[0])
                        except:
                            pass
                    conn.close()

                # Send private milestone only to the user who earned it
                if msg:
                    await websocket.send_json(
                        {"type": "milestone", "message": msg, "reward": reward}
                    )

    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)
        await manager.broadcast_player_list(room_id)
    except Exception as e:
        # Handle unexpected connection drops (like WinError 121) gracefully
        print(f"[WARN] WebSocket connection lost for {username}: {e}")
        manager.disconnect(websocket, room_id)
        await manager.broadcast_player_list(room_id)


# --- STATIC FILES ---
DIST_DIR = os.path.join(BASE_DIR, "dist")
frontend_dist = os.path.join(os.path.dirname(BASE_DIR), "frontend", "dist")

if os.path.exists(frontend_dist):
    DIST_DIR = frontend_dist

if os.path.exists(DIST_DIR):
    assets_path = os.path.join(DIST_DIR, "assets")
    if os.path.exists(assets_path):
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")


@app.get("/")
async def read_index():
    index_path = os.path.join(DIST_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {
        "error": f"Frontend not found at {DIST_DIR}. Run 'npm run build' in frontend/"
    }


@app.get("/{full_path:path}")
async def catch_all(full_path: str):
    file_path = os.path.join(DIST_DIR, full_path)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)

    index_path = os.path.join(DIST_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"error": "Frontend not found"}


if __name__ == "__main__":
    load_words()
    uvicorn.run(app, host="0.0.0.0", port=3010)
