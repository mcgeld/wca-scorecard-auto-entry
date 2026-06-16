import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { readDatabase, writeDatabase, updateScorecard, getActiveCompetitionId, setActiveCompetitionId } from './db-helper.js';
import { initWatcher } from './watcher.js';
import { 
  fetchRoundResults, 
  submitResultToWCA, 
  timeStringToCentiseconds, 
  executeCardSubmission, 
  setActiveWcaToken, 
  registerOnTokenExpired,
  downloadAndSaveWcif,
  pushLocalWcifToWca,
  fetchAndCacheWcaRecords,
  getWcaRecordsCache,
  getActiveWcaToken
} from './wca-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Register WCA Token expiration callback to emit socket event
registerOnTokenExpired(() => {
  console.log('[Server] WCA Token expiration detected. Emitting wca_token_expired to clients.');
  io.emit('wca_token_expired');
});

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Serve scorecard scans as static resources (accessible from React frontend)
app.use('/scans', express.static(path.resolve(__dirname, '../scans')));
app.use('/competitions', express.static(path.resolve(__dirname, '../competitions')));

/**
 * Helper: Moves scorecard image files from review/error to processed folder.
 */
function moveFilesToProcessed(card, competitionId) {
  const compId = competitionId || getActiveCompetitionId();
  const rootDir = path.resolve(__dirname, '..');
  const processedDir = path.join(rootDir, `competitions/${compId}/scans/processed`);
  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  // Helper to extract base filename from relative path (e.g. "/competitions/{compId}/scans/review/uuid_a.jpg" -> "uuid_a.jpg")
  const getFilename = (relPath) => relPath ? path.basename(relPath) : null;

  const frontName = getFilename(card.filepath);
  let relativeFrontProcessed = card.filepath;

  if (frontName) {
    const sourceFront = path.join(rootDir, card.filepath.replace(/^\//, ''));
    const destFront = path.join(processedDir, frontName);
    if (fs.existsSync(sourceFront)) {
      fs.renameSync(sourceFront, destFront);
      relativeFrontProcessed = `/competitions/${compId}/scans/processed/${frontName}`;
    }
  }

  let relativeBackProcessed = card.backFilepath;
  const backName = getFilename(card.backFilepath);
  if (backName && card.backFilepath) {
    const sourceBack = path.join(rootDir, card.backFilepath.replace(/^\//, ''));
    const destBack = path.join(processedDir, backName);
    if (fs.existsSync(sourceBack)) {
      fs.renameSync(sourceBack, destBack);
      relativeBackProcessed = `/competitions/${compId}/scans/processed/${backName}`;
    }
  }

  return {
    filepath: relativeFrontProcessed,
    backFilepath: relativeBackProcessed
  };
}

// ==========================================
// REST API ENDPOINTS
// ==========================================

// Get all scorecards
app.get('/api/scorecards', (req, res) => {
  const db = readDatabase();
  res.json(db.scorecards);
});

// Update scorecard values manually (saved from Review UI)
app.put('/api/scorecards/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const updatedCard = updateScorecard(id, updates);
  if (updatedCard) {
    io.emit('db_updated');
    res.json({ success: true, scorecard: updatedCard });
  } else {
    res.status(404).json({ error: 'Scorecard not found' });
  }
});

// Skip scorecard (manual entry mode)
app.post('/api/scorecards/:id/skip', (req, res) => {
  const { id } = req.params;
  const compId = getActiveCompetitionId();
  const db = readDatabase(compId);
  const card = db.scorecards.find(c => c.id === id);

  if (!card) {
    return res.status(404).json({ error: 'Scorecard not found' });
  }

  // Move files to scans/processed
  const { filepath, backFilepath } = moveFilesToProcessed(card, compId);

  const updated = updateScorecard(id, {
    status: 'skipped_for_manual',
    filepath,
    backFilepath
  }, compId);

  io.emit('db_updated');
  res.json({ success: true, scorecard: updated });
});

// Submit scorecard data to WCA Live API (with optional authorization token)
app.post('/api/scorecards/:id/submit', async (req, res) => {
  const { id } = req.params;
  const { competitorId, competitorName, eventId, roundNumber, solves } = req.body;
  
  // Extract Bearer token from Authorization header if present
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  try {
    const compId = getActiveCompetitionId();
    const updated = await executeCardSubmission(id, {
      competitorId,
      competitorName,
      eventId,
      roundNumber,
      solves
    }, token, compId);

    io.emit('db_updated');
    res.json({ success: true, scorecard: updated });
  } catch (error) {
    console.error(`[WCA Submission Error] Failed for card ${id}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get count of unprocessed front-side scorecards in the root input directory
app.get('/api/input-count', (req, res) => {
  try {
    const inputDir = path.resolve(__dirname, '../scans/input');
    if (!fs.existsSync(inputDir)) {
      return res.json({ count: 0 });
    }
    const files = fs.readdirSync(inputDir);
    const frontFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      if (ext !== '.jpg' && ext !== '.jpeg') return false;
      const nameWithoutExt = path.basename(file, ext).toLowerCase();
      return !nameWithoutExt.endsWith('_b');
    });
    res.json({ count: frontFiles.length });
  } catch (err) {
    console.error('[API] Error reading input directory count:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve local wcif.json
app.get('/api/wcif', (req, res) => {
  const compId = getActiveCompetitionId();
  const dbPath = path.resolve(__dirname, `../competitions/${compId}/wcif.json`);
  if (fs.existsSync(dbPath)) {
    try {
      const wcif = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      res.json(wcif);
    } catch (err) {
      res.status(500).json({ error: 'Failed to parse local WCIF.' });
    }
  } else {
    res.status(404).json({ error: 'Local WCIF file not found.' });
  }
});

// Serve local WCIF status (existence and last synced timestamp)
app.get('/api/wcif/status', (req, res) => {
  const compId = getActiveCompetitionId();
  const db = readDatabase(compId);
  const wcifPath = path.resolve(__dirname, `../competitions/${compId}/wcif.json`);
  const wcifExists = fs.existsSync(wcifPath);
  
  let activeCompName = null;
  if (wcifExists) {
    try {
      const wcif = JSON.parse(fs.readFileSync(wcifPath, 'utf8'));
      activeCompName = wcif.name;
    } catch (e) {
      console.error('Failed to parse local wcif name:', e.message);
    }
  }

  res.json({
    lastSynced: db.lastSynced || null,
    wcifExists,
    activeCompetitionId: compId,
    activeCompetitionName: activeCompName
  });
});

// Fetch user's manageable competitions from WCA API
app.get('/api/competitions', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const actualToken = token || getActiveWcaToken() || process.env.WCA_BEARER_TOKEN;

  if (process.env.WCA_LIVE_ENABLED !== 'true') {
    console.log('[API MOCK] WCA_LIVE_ENABLED is false. Returning mock competitions list.');
    return res.json([
      {
        id: 'DavisCountyShowdown2026',
        name: 'Davis County Showdown 2026',
        start_date: '2026-06-16',
        end_date: '2026-06-17',
        city: 'Farmington, Utah',
        venue: 'Davis County Fairgrounds',
        event_ids: ['333', 'sq1', '222', 'skewb']
      },
      {
        id: 'DavisSpringSunset2026',
        name: 'Davis Spring Sunset 2026',
        start_date: '2026-04-20',
        end_date: '2026-04-20',
        city: 'Farmington, Utah',
        venue: 'Davis County Fairgrounds',
        event_ids: ['333', 'pyra', 'skewb']
      }
    ]);
  }

  if (!actualToken || actualToken === 'your_wca_bearer_token_here') {
    return res.status(401).json({ error: 'Please sign in with WCA to retrieve your competitions.' });
  }

  try {
    const response = await fetch('https://www.worldcubeassociation.org/api/v0/competitions?managed_by_me=true', {
      headers: {
        'Authorization': `Bearer ${actualToken}`
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        return res.status(401).json({ error: 'WCA token is invalid or expired. Please sign in again.' });
      }
      throw new Error(`WCA API returned status ${response.status}`);
    }

    const data = await response.json();
    
    // Map WCA API format to a unified frontend format
    const list = data.map(c => ({
      id: c.id,
      name: c.name,
      start_date: c.start_date,
      end_date: c.end_date,
      city: c.city,
      venue: c.venue,
      event_ids: c.event_ids
    }));

    res.json(list);
  } catch (error) {
    console.error('[API] Failed to fetch manageable competitions:', error.message);
    res.status(500).json({ error: 'Failed to retrieve manageable competitions: ' + error.message });
  }
});

// Set active competition ID and download its WCIF
app.post('/api/competition/active', async (req, res) => {
  const { competitionId } = req.body;
  if (competitionId === undefined) {
    return res.status(400).json({ error: 'Competition ID is required.' });
  }

  try {
    if (competitionId === null) {
      setActiveCompetitionId(null);
      io.emit('db_updated');
      return res.json({ success: true, competitionId: null, wcif: null });
    }

    // Save to active_competition.json first so that subsequent reads of getActiveCompetitionId return this ID
    setActiveCompetitionId(competitionId);

    // Initialise database and directories for this competition
    const db = readDatabase(competitionId);
    db.activeCompetitionId = competitionId;
    writeDatabase(db, competitionId);

    console.log(`[API] Active competition set to ${competitionId}. Downloading WCIF...`);

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    
    const wcif = await downloadAndSaveWcif(token);

    io.emit('db_updated'); // Reload frontend data

    res.json({ success: true, competitionId, wcif });
  } catch (error) {
    console.error('[API] Failed to select active competition:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Trigger manual processing of scans in root input folder for the active competition
app.post('/api/scans/process-root', async (req, res) => {
  const compId = getActiveCompetitionId();
  if (!compId) {
    return res.status(400).json({ error: 'No active competition selected.' });
  }

  try {
    const { queueRootScansForProcessing } = await import('./watcher.js');
    const count = queueRootScansForProcessing(compId, io);

    res.json({ success: true, count });
  } catch (error) {
    console.error('[API] Failed to process root scans:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Force download and save the latest WCIF from WCA API
app.post('/api/wcif/fetch', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  
  try {
    const wcif = await downloadAndSaveWcif(token);
    res.json({ success: true, message: 'WCIF downloaded and saved locally.', wcif });
  } catch (error) {
    console.error('[API Fetch WCIF Error]:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Push local verified results (local WCIF payload) to WCA Live
app.post('/api/wcif/push', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  try {
    const compId = getActiveCompetitionId();
    await pushLocalWcifToWca(token);
    
    // Update lastSynced timestamp in database
    const db = readDatabase(compId);
    db.lastSynced = new Date().toISOString();
    writeDatabase(db, compId);

    io.emit('db_updated');
    res.json({ success: true, message: 'WCIF successfully pushed to WCA Live.', lastSynced: db.lastSynced });
  } catch (error) {
    console.error('[API Push WCIF Error]:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Serve cached WCA Records
app.get('/api/wca-records', (req, res) => {
  const records = getWcaRecordsCache();
  if (records) {
    res.json(records);
  } else {
    res.status(503).json({ error: 'WCA Records are not cached yet. Please try again in a few seconds.' });
  }
});

// Expose public configuration parameters for frontend
app.get('/api/config', (req, res) => {
  res.json({
    wcaClientId: process.env.WCA_CLIENT_ID || '',
    wcaLiveEnabled: process.env.WCA_LIVE_ENABLED === 'true',
    openaiEnabled: process.env.OPENAI_ENABLED === 'true'
  });
});

// Synchronize WCA token with backend for background auto-submissions
app.post('/api/auth/session', async (req, res) => {
  const { token } = req.body;
  if (token !== undefined) {
    setActiveWcaToken(token);

    // Proactively download WCIF when a new token is synced
    if (token) {
      downloadAndSaveWcif(token).catch(err => console.error('[Session Sync] Failed to download WCIF:', err.message));
    }
    
    // Proactively query WCA Live using the fresh token to debug competition listing
    try {
      const WCA_LIVE_ENDPOINT = 'https://live.worldcubeassociation.org/api/graphql';
      const query = `
        query DebugSession {
          currentUser {
            id
            wcaUserId
            name
          }
          importableCompetitions {
            wcaId
            name
          }
          competitions(from: "2026-06-11", limit: 100) {
            id
            wcaId
            name
          }
        }
      `;
      
      const response = await fetch(WCA_LIVE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ query })
      });
      
      const debugData = await response.json();
      console.log("[WCA Auth Debug] Successfully retrieved WCA Live session details:");
      console.log("- Current User:", debugData.data?.currentUser || "null");
      console.log("- Importable Competitions:", debugData.data?.importableCompetitions || []);
      const matchedComps = (debugData.data?.competitions || []).filter(c => 
        c.wcaId.toLowerCase().includes('davis') || 
        c.name.toLowerCase().includes('davis') || 
        c.name.toLowerCase().includes('showdown')
      );
      console.log("- Active Competitions Matching 'Davis/Showdown':", matchedComps);
    } catch (err) {
      console.warn("[WCA Auth Debug] Failed to fetch session debug info:", err.message);
    }

    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Token is missing' });
  }
});

// Test connection endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ==========================================
// WATCHER & SERVER LIFECYCLE
// ==========================================

// Initialize Socket.io connection logging
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// Start folder watcher
const watcher = initWatcher(io);

// Start server
server.listen(PORT, () => {
  console.log(`[Server] WCA Auto-Entry backend running on http://localhost:${PORT}`);
  
  // Cache WCA records and fetch initial WCIF on server boot
  fetchAndCacheWcaRecords().catch(err => console.error('[Startup] Failed to cache WCA records:', err));
  downloadAndSaveWcif().catch(err => console.warn('[Startup] Failed to fetch initial WCIF (token might be missing):', err.message));
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received. Closing watcher and server...');
  watcher.close();
  server.close(() => {
    console.log('[Server] Closed.');
  });
});
