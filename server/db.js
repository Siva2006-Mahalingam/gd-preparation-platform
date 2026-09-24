/* ══════════════════════════════════════════════════════════
   GD Platform — Database Layer
   Uses PostgreSQL (Supabase) in production, SQLite locally.
   Exposes a unified API: db.prepare(sql).get/all/run(params)
   ══════════════════════════════════════════════════════════ */

require('dotenv').config();
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const isPostgres = !!DATABASE_URL;

let db;

if (isPostgres) {
  // ═══════════════════════════════════════════════════════
  //  POSTGRESQL (Production — Supabase)
  // ═══════════════════════════════════════════════════════
  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Log connection status
  pool.on('error', (err) => {
    console.error('⚠️  Unexpected PG pool error:', err.message);
  });

  /**
   * Convert SQLite-style `?` placeholders to PostgreSQL-style `$1, $2, ...`.
   * Also converts `INSERT OR REPLACE` to PostgreSQL `ON CONFLICT DO UPDATE`.
   */
  function convertSQL(sql) {
    let converted = sql.trim().replace(/;\s*$/, '');
    let idx = 0;
    converted = converted.replace(/\?/g, () => `$${++idx}`);

    // Handle INSERT OR REPLACE -> PostgreSQL ON CONFLICT
    if (/INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)/i.test(converted)) {
      converted = converted.replace(/INSERT\s+OR\s+REPLACE\s+INTO/i, 'INSERT INTO');

      // For evaluations table (session_id, user_id) is the unique constraint
      if (/evaluations/i.test(converted)) {
        converted = converted.replace(
          /VALUES\s*\(([\s\S]*?)\)\s*$/i,
          (match) => {
            return match + ` ON CONFLICT (session_id, user_id) DO UPDATE SET
              overall_score = EXCLUDED.overall_score,
              communication_score = EXCLUDED.communication_score,
              content_score = EXCLUDED.content_score,
              participation_score = EXCLUDED.participation_score,
              collaboration_score = EXCLUDED.collaboration_score,
              leadership_score = EXCLUDED.leadership_score,
              strengths = EXCLUDED.strengths,
              improvements = EXCLUDED.improvements,
              feedback = EXCLUDED.feedback`;
          }
        );
      }
    }

    return converted;
  }

  // Create an API-compatible wrapper around pg Pool
  db = {
    prepare(sql) {
      const pgSQL = convertSQL(sql);

      return {
        async get(...params) {
          const result = await pool.query(pgSQL, params);
          return result.rows[0] || null;
        },
        async all(...params) {
          const result = await pool.query(pgSQL, params);
          return result.rows;
        },
        async run(...params) {
          const result = await pool.query(pgSQL + ' RETURNING *', params).catch(async () => {
            // If RETURNING fails (e.g., UPDATE/DELETE), try without
            return pool.query(pgSQL, params);
          });
          const row = result.rows?.[0];
          return {
            lastInsertRowid: row?.id || null,
            changes: result.rowCount || 0,
          };
        },
      };
    },

    async exec(sql) {
      await pool.query(sql);
    },

    pragma() {
      // No-op for PostgreSQL
    },

    _pool: pool,
  };

  console.log('🐘 Using PostgreSQL (Supabase)');

} else {
  // ═══════════════════════════════════════════════════════
  //  SQLITE (Local Development)
  // ═══════════════════════════════════════════════════════
  const Database = require('better-sqlite3');

  const dbPath = path.join(__dirname, '..', 'gd_platform.db');
  const sqliteDb = new Database(dbPath);

  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  db = sqliteDb;

  console.log('📦 Using SQLite (local)');
}

// ── Schema Initialization ────────────────────────────────
async function initialize() {
  if (isPostgres) {
    // PostgreSQL: schema should already exist via supabase_schema.sql
    // But let's verify connectivity
    try {
      await db._pool.query('SELECT 1');
      console.log('✅ PostgreSQL connected');
    } catch (err) {
      console.error('❌ PostgreSQL connection failed:', err.message);
      if (err.message.includes('ENOTFOUND') || err.message.includes('timeout')) {
        console.error('💡 TIP: Use the Supabase Connection Pooler URI (port 6543) for IPv4 cloud hosts like Render.');
      }
      process.exit(1);
    }
  } else {
    // SQLite: create tables
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
  }

  console.log('✅ Database initialized');
}

module.exports = { db, initialize, isPostgres };
