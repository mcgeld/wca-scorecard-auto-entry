import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../database.json');

/**
 * Safely reads the database.json file.
 */
export function readDatabase() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify({ scorecards: [] }, null, 2), 'utf8');
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[DB] Error reading database.json:', err.message);
    return { scorecards: [] };
  }
}

/**
 * Safely and atomically writes to database.json.
 */
export function writeDatabase(data) {
  try {
    const tempPath = DB_PATH + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, DB_PATH);
  } catch (err) {
    console.error('[DB] Error writing database.json:', err.message);
    throw err;
  }
}

/**
 * Updates a single scorecard in the database.
 */
export function updateScorecard(id, updates) {
  const db = readDatabase();
  const index = db.scorecards.findIndex(card => card.id === id);
  if (index !== -1) {
    db.scorecards[index] = { ...db.scorecards[index], ...updates };
    writeDatabase(db);
    return db.scorecards[index];
  }
  return null;
}

/**
 * Adds a new scorecard to the database.
 */
export function addScorecard(card) {
  const db = readDatabase();
  db.scorecards.push(card);
  writeDatabase(db);
  return card;
}
