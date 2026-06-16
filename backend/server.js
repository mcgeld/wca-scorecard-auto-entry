import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { readDatabase, writeDatabase, updateScorecard } from './db-helper.js';
import { initWatcher } from './watcher.js';
import { fetchRoundResults, submitResultToWCA, timeStringToCentiseconds, executeCardSubmission, setActiveWcaToken, registerOnTokenExpired } from './wca-api.js';

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

/**
 * Helper: Moves scorecard image files from review/error to processed folder.
 */
function moveFilesToProcessed(card) {
  const rootDir = path.resolve(__dirname, '..');
  const processedDir = path.join(rootDir, 'scans/processed');

  // Helper to extract base filename from relative path (e.g. "/scans/review/uuid_a.jpg" -> "uuid_a.jpg")
  const getFilename = (relPath) => relPath ? path.basename(relPath) : null;

  const frontName = getFilename(card.filepath);
  let relativeFrontProcessed = card.filepath;

  if (frontName) {
    const sourceFront = path.join(rootDir, card.filepath.replace(/^\//, ''));
    const destFront = path.join(processedDir, frontName);
    if (fs.existsSync(sourceFront)) {
      fs.renameSync(sourceFront, destFront);
      relativeFrontProcessed = `/scans/processed/${frontName}`;
    }
  }

  let relativeBackProcessed = card.backFilepath;
  const backName = getFilename(card.backFilepath);
  if (backName && card.backFilepath) {
    const sourceBack = path.join(rootDir, card.backFilepath.replace(/^\//, ''));
    const destBack = path.join(processedDir, backName);
    if (fs.existsSync(sourceBack)) {
      fs.renameSync(sourceBack, destBack);
      relativeBackProcessed = `/scans/processed/${backName}`;
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
  const db = readDatabase();
  const card = db.scorecards.find(c => c.id === id);

  if (!card) {
    return res.status(404).json({ error: 'Scorecard not found' });
  }

  // Move files to scans/processed
  const { filepath, backFilepath } = moveFilesToProcessed(card);

  const updated = updateScorecard(id, {
    status: 'skipped_for_manual',
    filepath,
    backFilepath
  });

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
    const updated = await executeCardSubmission(id, {
      competitorId,
      competitorName,
      eventId,
      roundNumber,
      solves
    }, token);

    io.emit('db_updated');
    res.json({ success: true, scorecard: updated });
  } catch (error) {
    console.error(`[WCA Submission Error] Failed for card ${id}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get count of unprocessed front-side scorecards in the input directory
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
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received. Closing watcher and server...');
  watcher.close();
  server.close(() => {
    console.log('[Server] Closed.');
  });
});
