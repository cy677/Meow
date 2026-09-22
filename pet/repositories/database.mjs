import { DatabaseSync } from 'node:sqlite';

export function openHouseholdDatabase(filename) {
  const db = new DatabaseSync(filename);
  try {
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), childName TEXT NOT NULL, petName TEXT NOT NULL,
      balance INTEGER NOT NULL CHECK(balance>=0 AND balance<=10000000), lifetime INTEGER NOT NULL CHECK(lifetime>=0 AND lifetime<=10000000), version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS owned (id TEXT PRIMARY KEY, obtainedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS equipped (slot TEXT PRIMARY KEY, id TEXT NOT NULL REFERENCES owned(id));
    CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, kind TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, rewardId TEXT, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS credentials (role TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, role TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    INSERT OR IGNORE INTO profile VALUES (1,'小朋友','小橘',0,0,0);`);
  } catch(error) { db.close(); throw error; }
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const result=fn(); db.exec('COMMIT'); return result; } catch(error) { db.exec('ROLLBACK'); throw error; } };
  return { db, tx };
}
