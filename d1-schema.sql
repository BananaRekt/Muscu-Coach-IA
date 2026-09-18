PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_date TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_date
  ON workout_sessions(user_id, session_date DESC);

CREATE TABLE IF NOT EXISTS session_exercises (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  exercise_type TEXT NOT NULL DEFAULT 'strength',
  gif TEXT NOT NULL DEFAULT '',
  sets_planned INTEGER NOT NULL DEFAULT 1,
  reps_min INTEGER,
  reps_max INTEGER,
  rest_seconds INTEGER,
  duration_minutes INTEGER,
  intensity TEXT,
  is_extra INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_exercises_session
  ON session_exercises(session_id, sort_order);

CREATE TABLE IF NOT EXISTS performance_sets (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  session_exercise_id TEXT NOT NULL,
  set_number INTEGER NOT NULL,
  load_value REAL,
  load_text TEXT NOT NULL DEFAULT '',
  load_mode TEXT NOT NULL DEFAULT 'central',
  left_load REAL,
  right_load REAL,
  reps INTEGER,
  difficulty TEXT,
  pain INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_exercise_id) REFERENCES session_exercises(id) ON DELETE CASCADE,
  UNIQUE(session_exercise_id, set_number)
);

CREATE INDEX IF NOT EXISTS idx_sets_session_recorded
  ON performance_sets(session_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS cardio_sessions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  session_exercise_id TEXT,
  cardio_name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  intensity TEXT NOT NULL DEFAULT 'modérée',
  pain INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_exercise_id) REFERENCES session_exercises(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cardio_session
  ON cardio_sessions(session_id, recorded_at DESC);

INSERT OR IGNORE INTO users(id) VALUES ('default');
