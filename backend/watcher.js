import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { addScorecard, updateScorecard, getActiveCompetitionId } from './db-helper.js';
import { performOCR } from './ocr-service.js';
import { executeCardSubmission } from './wca-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = path.resolve(__dirname, '../scans/input');

// Map of batch states: competitionId -> { discoveredBaseNames, baseNameToPath, batchTimer, isProcessingBatch }
const batchStates = new Map();

function getBatchState(competitionId) {
  if (!batchStates.has(competitionId)) {
    batchStates.set(competitionId, {
      discoveredBaseNames: new Set(),
      baseNameToPath: new Map(),
      batchTimer: null,
      isProcessingBatch: false
    });
  }
  return batchStates.get(competitionId);
}

async function processBatch(competitionId, io) {
  const state = getBatchState(competitionId);
  if (state.isProcessingBatch) return;
  state.isProcessingBatch = true;

  try {
    // Sort base names alphabetically (natural sorting to handle number strings correctly)
    const baseNames = Array.from(state.discoveredBaseNames).sort((a, b) => 
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
    
    state.discoveredBaseNames.clear();

    console.log(`[Watcher - ${competitionId}] Preparing ${baseNames.length} scorecards in alphabetical order...`);
    const preparedCards = [];

    // Step 1: Prepare all card pairs and add them as pending_ocr
    for (const baseName of baseNames) {
      const frontPath = state.baseNameToPath.get(baseName);
      state.baseNameToPath.delete(baseName);

      if (frontPath && fs.existsSync(frontPath)) {
        try {
          const prep = await prepareFilePair(competitionId, baseName, frontPath);
          preparedCards.push(prep);
        } catch (err) {
          console.error(`[Watcher - ${competitionId}] Failed preparing ${baseName}:`, err.message);
        }
      }
    }

    // Emit db_updated so the UI gets the total count of pending_ocr cards immediately!
    if (preparedCards.length > 0) {
      io.emit('db_updated');
    }

    // Step 2: Process OCR for each prepared card sequentially
    for (const card of preparedCards) {
      console.log(`[Watcher - ${competitionId}] OCR processing started for scorecard ID: ${card.id}`);
      try {
        await triggerOCR(competitionId, card.id, card.targetFrontPath, card.targetBackPath, io);
      } catch (err) {
        console.error(`[Watcher - ${competitionId}] Failed OCR for scorecard ID ${card.id}:`, err.message);
      }
    }

    console.log(`[Watcher - ${competitionId}] Sequential batch processing completed.`);
  } finally {
    state.isProcessingBatch = false;
    if (state.discoveredBaseNames.size > 0 && !state.batchTimer) {
      console.log(`[Watcher - ${competitionId}] New files arrived during batch processing. Triggering next batch...`);
      state.batchTimer = setTimeout(() => {
        state.batchTimer = null;
        processBatch(competitionId, io);
      }, 3000);
    }
  }
}

/**
 * Initializes the folder watcher using Chokidar.
 * @param {import('socket.io').Server} io - The Socket.io server instance to broadcast updates.
 */
export function initWatcher(io) {
  if (!fs.existsSync(INPUT_DIR)) {
    fs.mkdirSync(INPUT_DIR, { recursive: true });
  }

  console.log(`[Watcher] Initializing file watcher on root scans input: ${INPUT_DIR}`);

  const watcher = chokidar.watch(INPUT_DIR, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    depth: 0, // only root files
    usePolling: true, // more reliable on local network drives / WSL / VM environments
    interval: 100,
    awaitWriteFinish: {
      stabilityThreshold: 1500,
      pollInterval: 100
    }
  });

  watcher.on('add', (filePath) => {
    const competitionId = getActiveCompetitionId();
    if (!competitionId) {
      console.log(`[Watcher] New file detected: ${path.basename(filePath)}, but no active competition is selected. Skipping automatic processing.`);
      io.emit('db_updated'); // emit so frontend updates inputCount
      return;
    }

    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Only process JPEG/JPG files
    if (ext !== '.jpg' && ext !== '.jpeg') {
      return;
    }

    console.log(`[Watcher - ${competitionId}] File detected: ${filename}`);

    // If it's a back-side file, ignore it here. The front-side debounce timer will find it.
    if (isBackFile(filename)) {
      console.log(`[Watcher - ${competitionId}] Recognized as back-side file: ${filename}. Skipping main event, waiting for front-side pairing.`);
      return;
    }

    // Determine base name (e.g. "Scorecard_0025_a" -> "Scorecard_0025", "Scorecard_0025" -> "Scorecard_0025")
    const baseName = getBaseName(filename);
    const state = getBatchState(competitionId);

    // Add to our batch collection
    state.discoveredBaseNames.add(baseName);
    state.baseNameToPath.set(baseName, filePath);

    // Reset the batch timer (debounce of 3 seconds)
    if (state.batchTimer) {
      clearTimeout(state.batchTimer);
    }
    
    console.log(`[Watcher - ${competitionId}] Front-side detected: ${baseName}. Resetting batch collection timer.`);
    
    // Emit db_updated immediately so the UI fetches the new folder count
    io.emit('db_updated');

    state.batchTimer = setTimeout(() => {
      state.batchTimer = null;
      processBatch(competitionId, io);
    }, 3000);
  });

  watcher.on('error', (error) => {
    console.error('[Watcher Error] Chokidar watcher encountered an error:', error);
  });

  return watcher;
}

/**
 * Checks if a filename represents a back-side scorecard file (ends with _b).
 */
function isBackFile(filename) {
  const nameWithoutExt = path.basename(filename, path.extname(filename)).toLowerCase();
  return nameWithoutExt.endsWith('_b');
}

/**
 * Extracts the base name without _a or _b suffix.
 */
function getBaseName(filename) {
  const nameWithoutExt = path.basename(filename, path.extname(filename));
  // Remove _a or _b suffix
  return nameWithoutExt.replace(/_[ab]$/i, '');
}

/**
 * Processes a front-back file pair after the debounce window.
 */
async function prepareFilePair(competitionId, baseName, frontPath) {
  const id = uuidv4();
  const frontFilename = path.basename(frontPath);
  const ext = path.extname(frontPath);

  const compDir = path.resolve(__dirname, `../competitions/${competitionId}`);
  const reviewDir = path.join(compDir, 'scans/review');
  const errorDir = path.join(compDir, 'scans/error');

  // Look for a matching back-side file in the root input directory
  const filesInInput = fs.readdirSync(INPUT_DIR);
  let backFilename = null;
  let hasBackSideContent = false;

  for (const file of filesInInput) {
    if (isBackFile(file) && getBaseName(file) === baseName) {
      backFilename = file;
      hasBackSideContent = true;
      break;
    }
  }

  const newFrontFilename = `${id}_a${ext}`;
  const targetFrontPath = path.join(reviewDir, newFrontFilename);
  
  let targetBackPath = null;
  if (hasBackSideContent && backFilename) {
    const backExt = path.extname(backFilename);
    const newBackFilename = `${id}_b${backExt}`;
    targetBackPath = path.join(reviewDir, newBackFilename);
  }

  try {
    // Ensure competition folders exist just in case
    if (!fs.existsSync(reviewDir)) {
      fs.mkdirSync(reviewDir, { recursive: true });
    }
    if (!fs.existsSync(errorDir)) {
      fs.mkdirSync(errorDir, { recursive: true });
    }

    // 1. Move the front file to scans/review in competition folder
    if (fs.existsSync(frontPath)) {
      fs.renameSync(frontPath, targetFrontPath);
    } else {
      throw new Error(`Front file not found at path: ${frontPath}`);
    }

    // 2. Move the back file to scans/review in competition folder if present
    if (hasBackSideContent && backFilename) {
      const sourceBackPath = path.join(INPUT_DIR, backFilename);
      if (fs.existsSync(sourceBackPath)) {
        fs.renameSync(sourceBackPath, targetBackPath);
      } else {
        console.warn(`[Watcher Warning - ${competitionId}] Back-side file ${backFilename} was detected but could not be found to move.`);
        hasBackSideContent = false;
        targetBackPath = null;
      }
    }

    // 3. Create initial pending scorecard record in database.json
    const relativeFrontPath = `/competitions/${competitionId}/scans/review/${newFrontFilename}`;
    const relativeBackPath = targetBackPath ? `/competitions/${competitionId}/scans/review/${path.basename(targetBackPath)}` : null;

    const initialCard = {
      id,
      filename: frontFilename,
      filepath: relativeFrontPath,
      backFilepath: relativeBackPath,
      scannedAt: new Date().toISOString(),
      status: 'pending_ocr',
      hasBackSideContent,
      competitorName: '',
      competitorId: 0,
      eventId: '',
      roundNumber: 0,
      groupNumber: 0,
      solves: Array.from({ length: 5 }, (_, i) => ({
        attempt: i + 1,
        ocrValue: '',
        confidence: 1.0,
        finalValue: '',
        isManuallyEdited: false
      }))
    };

    addScorecard(initialCard, competitionId);
    console.log(`[Watcher - ${competitionId}] Added scorecard ${id} to database (pending_ocr).`);
    
    return {
      id,
      targetFrontPath,
      targetBackPath,
      frontFilename,
      backFilename,
      hasBackSideContent
    };
  } catch (error) {
    console.error(`[Watcher Error - ${competitionId}] Failed to prepare file pair for ${baseName}:`, error.message);
    
    // Move front file to error directory if possible
    try {
      if (fs.existsSync(frontPath)) {
        fs.renameSync(frontPath, path.join(errorDir, frontFilename));
      }
      if (hasBackSideContent && backFilename) {
        const sourceBackPath = path.join(INPUT_DIR, backFilename);
        if (fs.existsSync(sourceBackPath)) {
          fs.renameSync(sourceBackPath, path.join(errorDir, backFilename));
        }
      }
    } catch (moveErr) {
      console.error(`[Watcher Error - ${competitionId}] Failed to move corrupted files to error folder:`, moveErr.message);
    }
    throw error;
  }
}

/**
 * Runs OCR processing on the front scorecard image and updates the database.
 */
async function triggerOCR(competitionId, id, frontImagePath, backImagePath, io) {
  try {
    const ocrData = await performOCR(frontImagePath);

    // Evaluate confidence scores to determine status
    let requiresReview = false;
    const formattedSolves = ocrData.solves.map(solve => {
      const isLowConfidence = solve.confidence < 0.85;
      if (isLowConfidence) {
        requiresReview = true;
      }
      return {
        ...solve,
        finalValue: solve.ocrValue,
        isManuallyEdited: false
      };
    });

    const hasBackSide = !!backImagePath;

    // Auto-submit if high confidence and no back-side delegate notes
    if (!requiresReview && !hasBackSide) {
      console.log(`[Watcher - ${competitionId}] High confidence and no back-side content detected. Auto-submitting card ${id} to WCA Live...`);
      try {
        // Pre-save details with pending status to allow execution script to read them
        updateScorecard(id, {
          competitorName: ocrData.competitorName,
          competitorId: ocrData.competitorId,
          eventId: ocrData.eventId,
          roundNumber: ocrData.roundNumber,
          groupNumber: ocrData.groupNumber,
          solves: formattedSolves
        }, competitionId);

        await executeCardSubmission(id, {
          competitorId: ocrData.competitorId,
          competitorName: ocrData.competitorName,
          eventId: ocrData.eventId,
          roundNumber: ocrData.roundNumber,
          solves: formattedSolves
        }, undefined, competitionId);

        console.log(`[Watcher - ${competitionId}] Auto-submission successful for card ${id}.`);
        io.emit('db_updated');
        return; // Success! Skip setting review_needed status
      } catch (submitError) {
        console.error(`[Watcher Error - ${competitionId}] Auto-submission failed for card ${id}:`, submitError.message);
        // Fall back to review_needed queue below
      }
    }

    // Default: Require human verification
    const cardStatus = 'review_needed';

    updateScorecard(id, {
      status: cardStatus,
      competitorName: ocrData.competitorName,
      competitorId: ocrData.competitorId,
      eventId: ocrData.eventId,
      roundNumber: ocrData.roundNumber,
      groupNumber: ocrData.groupNumber,
      solves: formattedSolves
    }, competitionId);

    console.log(`[Watcher - ${competitionId}] OCR complete for scorecard ${id}. Status: ${cardStatus}`);
    io.emit('db_updated');

  } catch (error) {
    console.error(`[Watcher Error - ${competitionId}] OCR failed for card ${id}:`, error.message);

    const compDir = path.resolve(__dirname, `../competitions/${competitionId}`);
    const errorDir = path.join(compDir, 'scans/error');

    // Move files to scans/error folder
    const ext = path.extname(frontImagePath);
    const errorFrontPath = path.join(errorDir, `${id}_a${ext}`);
    let errorBackPath = null;

    try {
      if (fs.existsSync(frontImagePath)) {
        fs.renameSync(frontImagePath, errorFrontPath);
      }
      if (backImagePath && fs.existsSync(backImagePath)) {
        const backExt = path.extname(backImagePath);
        errorBackPath = path.join(errorDir, `${id}_b${backExt}`);
        fs.renameSync(backImagePath, errorBackPath);
      }
    } catch (moveErr) {
      console.error(`[Watcher Error - ${competitionId}] Failed to move image files to error directory:`, moveErr.message);
    }

    const relativeFrontErrorPath = `/competitions/${competitionId}/scans/error/${path.basename(errorFrontPath)}`;
    const relativeBackErrorPath = errorBackPath ? `/competitions/${competitionId}/scans/error/${path.basename(errorBackPath)}` : null;

    updateScorecard(id, {
      status: 'review_needed', // Leave it in review queue so user can enter manually
      filepath: relativeFrontErrorPath,
      backFilepath: relativeBackErrorPath,
      competitorName: 'OCR Failed - Manual Entry Needed',
      solves: Array.from({ length: 5 }, (_, i) => ({
        attempt: i + 1,
        ocrValue: '',
        confidence: 0.0, // Low confidence triggers highlights
        finalValue: '',
        isManuallyEdited: true
      }))
    }, competitionId);

    io.emit('db_updated');
  }
}

/**
 * Queues all unprocessed root scans for processing under a specific competition.
 * @returns {number} The count of scorecards queued.
 */
export function queueRootScansForProcessing(competitionId, io) {
  if (!fs.existsSync(INPUT_DIR)) return 0;

  const files = fs.readdirSync(INPUT_DIR);
  const frontFiles = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    if (ext !== '.jpg' && ext !== '.jpeg') return false;
    const nameWithoutExt = path.basename(file, ext).toLowerCase();
    return !nameWithoutExt.endsWith('_b');
  });

  if (frontFiles.length === 0) return 0;

  const state = getBatchState(competitionId);

  for (const file of frontFiles) {
    const baseName = getBaseName(file);
    const filePath = path.join(INPUT_DIR, file);
    state.discoveredBaseNames.add(baseName);
    state.baseNameToPath.set(baseName, filePath);
  }

  // Trigger processBatch immediately
  processBatch(competitionId, io);

  return frontFiles.length;
}
