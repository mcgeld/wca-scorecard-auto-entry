import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Reads the active competition ID from active_competition.json.
 */
export function getActiveCompetitionId() {
  try {
    const activePath = path.join(__dirname, '../active_competition.json');
    if (fs.existsSync(activePath)) {
      const data = JSON.parse(fs.readFileSync(activePath, 'utf8'));
      return data.activeCompetitionId || null;
    }
  } catch (err) {
    console.error('[DB] Error reading active_competition.json:', err.message);
  }
  return null;
}

/**
 * Saves the active competition ID to active_competition.json.
 */
export function setActiveCompetitionId(competitionId) {
  try {
    const activePath = path.join(__dirname, '../active_competition.json');
    fs.writeFileSync(activePath, JSON.stringify({ activeCompetitionId: competitionId }, null, 2), 'utf8');
    console.log(`[DB] Saved active competition ID to active_competition.json: ${competitionId}`);
  } catch (err) {
    console.error('[DB] Error writing active_competition.json:', err.message);
  }
}

/**
 * Ensures all scans and data directories exist for a competition.
 */
export function ensureCompetitionFolders(competitionId) {
  if (!competitionId) return;
  const compDir = path.resolve(__dirname, `../competitions/${competitionId}`);
  const dirs = [
    path.join(compDir, 'scans/input'),
    path.join(compDir, 'scans/review'),
    path.join(compDir, 'scans/processed'),
    path.join(compDir, 'scans/error')
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Safely reads the database.json file for a specific competition.
 */
export function readDatabase(competitionId) {
  const compId = competitionId || getActiveCompetitionId();
  if (!compId) {
    return { scorecards: [] };
  }
  ensureCompetitionFolders(compId);
  
  const dbPath = path.resolve(__dirname, `../competitions/${compId}/database.json`);
  try {
    if (!fs.existsSync(dbPath)) {
      fs.writeFileSync(dbPath, JSON.stringify({ scorecards: [] }, null, 2), 'utf8');
    }
    const data = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`[DB - ${compId}] Error reading database.json:`, err.message);
    return { scorecards: [] };
  }
}

/**
 * Safely and atomically writes to a competition's database.json.
 */
export function writeDatabase(data, competitionId) {
  const compId = competitionId || getActiveCompetitionId();
  if (!compId) return;
  const compDir = path.join(__dirname, `../competitions/${compId}`);
  if (!fs.existsSync(compDir)) {
    fs.mkdirSync(compDir, { recursive: true });
  }

  const dbPath = path.join(compDir, 'database.json');
  try {
    const tempPath = dbPath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, dbPath);
  } catch (err) {
    console.error(`[DB - ${compId}] Error writing database.json:`, err.message);
    throw err;
  }
}

/**
 * Updates a single scorecard in the database.
 */
export function updateScorecard(id, updates, competitionId) {
  const compId = competitionId || getActiveCompetitionId();
  if (!compId) return null;
  const db = readDatabase(compId);
  const index = db.scorecards.findIndex(card => card.id === id);
  if (index !== -1) {
    db.scorecards[index] = { ...db.scorecards[index], ...updates };
    writeDatabase(db, compId);
    return db.scorecards[index];
  }
  return null;
}

/**
 * Adds a new scorecard to the database.
 */
export function addScorecard(card, competitionId) {
  const compId = competitionId || getActiveCompetitionId();
  if (!compId) return card;
  const db = readDatabase(compId);
  db.scorecards.push(card);
  writeDatabase(db, compId);
  return card;
}
