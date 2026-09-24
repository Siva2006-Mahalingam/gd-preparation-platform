const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'gd_platform.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────
function initialize() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      topic TEXT,
      host_id INTEGER NOT NULL,
      is_public INTEGER DEFAULT 0,
      max_participants INTEGER DEFAULT 6,
      status TEXT DEFAULT 'waiting',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (host_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS room_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      topic TEXT NOT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      duration INTEGER DEFAULT 0,
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME,
      duration REAL DEFAULT 0,
      audio_path TEXT,
      transcript TEXT,
      contribution_order INTEGER DEFAULT 1,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      overall_score REAL DEFAULT 0,
      communication_score REAL DEFAULT 0,
      content_score REAL DEFAULT 0,
      participation_score REAL DEFAULT 0,
      collaboration_score REAL DEFAULT 0,
      leadership_score REAL DEFAULT 0,
      strengths TEXT DEFAULT '[]',
      improvements TEXT DEFAULT '[]',
      feedback TEXT DEFAULT '',
      evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(session_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
    CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
    CREATE INDEX IF NOT EXISTS idx_room_participants_room ON room_participants(room_id);
    CREATE INDEX IF NOT EXISTS idx_contributions_session_user ON contributions(session_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_evaluations_session_user ON evaluations(session_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_room ON sessions(room_id);
  `);

  // Migration: add transcript column if it doesn't exist
  try {
    const tableInfo = db.prepare("PRAGMA table_info(contributions)").all();
    const hasTranscript = tableInfo.some(col => col.name === 'transcript');
    if (!hasTranscript) {
      db.exec('ALTER TABLE contributions ADD COLUMN transcript TEXT;');
      console.log('✅ Added transcript column to contributions');
    }
  } catch (err) {
    console.warn('Transcript migration check note:', err.message);
  }

  console.log('✅ Database initialized');
}

module.exports = { db, initialize };
