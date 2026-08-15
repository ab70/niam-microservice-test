import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";

// Resolve relative to this file (import.meta.dir), not the process cwd, so the
// sqlite DB lands in <project>/data regardless of the working directory.
const DB_PATH = join(import.meta.dir, "..", "data", "hr.db");

// Ensure data directory exists
const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// ── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT    UNIQUE NOT NULL,
    password   TEXT    NOT NULL,
    firstName  TEXT    DEFAULT '',
    lastName   TEXT    DEFAULT '',
    role       TEXT    DEFAULT 'admin',
    active     INTEGER DEFAULT 1,
    createdAt  TEXT    DEFAULT (datetime('now')),
    updatedAt  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS staff (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    firstName       TEXT    DEFAULT '',
    lastName        TEXT    DEFAULT '',
    nick_Name       TEXT    DEFAULT '',
    email           TEXT    UNIQUE NOT NULL,
    phone           TEXT    DEFAULT '',
    address         TEXT    DEFAULT '',
    employee_Id     TEXT    DEFAULT '',
    uid             TEXT    DEFAULT '',
    office          TEXT    DEFAULT '',
    joining_Date    TEXT    DEFAULT '',
    effective_Date  TEXT    DEFAULT '',
    division        TEXT    DEFAULT '',
    designation     TEXT    DEFAULT '',
    band            TEXT    DEFAULT '',
    position        TEXT    DEFAULT '',
    department      TEXT    DEFAULT '',
    section         TEXT    DEFAULT '',
    sub_Section     TEXT    DEFAULT '',
    unit            TEXT    DEFAULT '',
    supervisor      TEXT    DEFAULT '',
    supervisorName  TEXT    DEFAULT '',
    active          INTEGER DEFAULT 1,
    createdAt       TEXT    DEFAULT (datetime('now')),
    updatedAt       TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS staffUser (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT    UNIQUE NOT NULL,
    username        TEXT    DEFAULT '',
    firstName       TEXT    DEFAULT '',
    lastName        TEXT    DEFAULT '',
    employee_Id     TEXT    DEFAULT '',
    department      TEXT    DEFAULT '',
    active          INTEGER DEFAULT 1,
    source          TEXT    DEFAULT 'nIAM',
    createdAt       TEXT    DEFAULT (datetime('now')),
    updatedAt       TEXT    DEFAULT (datetime('now'))
  );
`);

// ── Seed admin user ─────────────────────────────────────────────────

function seedDatabase() {
  const existingAdmin = db
    .query("SELECT id FROM users WHERE email = ?")
    .get("admin@admin.com") as { id: number } | null;

  if (!existingAdmin) {
    db.query(
      `INSERT INTO users (email, password, firstName, lastName, role)
       VALUES (?, ?, ?, ?, ?)`
    ).run("admin@admin.com", "12345678", "Admin", "User", "admin");
    console.log("[startup] ✅ Seeded admin user: admin@admin.com / 12345678");
  } else {
    console.log("[startup] ✅ Admin user already exists (admin@admin.com)");
  }
}

seedDatabase();

export { db, seedDatabase };
