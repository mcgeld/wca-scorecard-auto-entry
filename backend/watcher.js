import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { addScorecard, updateScorecard } from './db-helper.js';
import { performOCR } from './ocr-service.js';
import { executeCardSubmission } from './wca-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const INPUT_DIR = path.resolve(__dirname, '../scans/input');
const REVIEW_DIR = path.resolve(__dirname, '../scans/review');
const ERROR_DIR = path.resolve(__dirname, '../scans/error');

// Collection of discovered base names for batching
const discoveredBaseNames = new Set();
const baseNameToPath = new Map();
let batchTimer = null;
let isProcessingBatch = false;

async function processBatch(io) {
  if (isProcessingBatch) return;
  isProcessingBatch = true;

  try {
    // Sort base names alphabetically (natural sorting to handle number strings correctly)
    const baseNames = Array.from(discoveredBaseNames).sort((a, b) => 
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
    
    discoveredBaseNames.clear();

    console.log(`[Watcher] Preparing ${baseNames.length} scorecards in alphabetical order...`);
    const preparedCards = [];

    // Step 1: Prepare all card pairs and add them as pending_ocr
    for (const baseName of baseNames) {
      const frontPath = baseNameToPath.get(baseName);
      baseNameToPath.delete(baseName);

      if (frontPath && fs.existsSync(frontPath)) {
        try {
          const prep = await prepareFilePair(baseName, frontPath);
          preparedCards.push(prep);
        } catch (err) {
          console.error(`[Watcher] Failed preparing ${baseName}:`, err.message);
        }
      }
    }

    // Emit db_updated so the UI gets the total count of pending_ocr cards immediately!
    if (preparedCards.length > 0) {
      io.emit('db_updated');
    }

    // Step 2: Process OCR for each prepared card sequentially
    for (const card of preparedCards) {
      console.log(`[Watcher] OCR processing started for scorecard ID: ${card.id}`);
      try {
        await triggerOCR(card.id, card.targetFrontPath, card.targetBackPath, io);
      } catch (err) {
        console.error(`[Watcher] Failed OCR for scorecard ID ${card.id}:`, err.message);
      }
    }

    console.log(`[Watcher] Sequential batch processing completed.`);
  } finally {
    isProcessingBatch = false;
    if (discoveredBaseNames.size > 0 && !batchTimer) {
      console.log(`[Watcher] New files arrived during batch processing. Triggering next batch...`);
      batchTimer = setTimeout(() => {
        batchTimer = null;
        processBatch(io);
      }, 3000);
    }
  }
}

/**
 * Initializes the folder watcher using Chokidar.
 * @param {import('socket.io').Server} io - The Socket.io server instance to broadcast updates.
 */
export function initWatcher(io) {
  console.log(`[Watcher] Initializing file watcher on: ${INPUT_DIR}`);

  const watcher = chokidar.watch(INPUT_DIR, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    depth: 0,
    usePolling: true, // more reliable on local network drives / WSL / VM environments
    interval: 100,
    awaitWriteFinish: {
      stabilityThreshold: 1500,
      pollInterval: 100
    }
  });

  watcher.on('add', (filePath) => {
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Only process JPEG/JPG files
    if (ext !== '.jpg' && ext !== '.jpeg') {
      return;
    }

    console.log(`[Watcher] File detected: ${filename}`);

    // If it's a back-side file, ignore it here. The front-side debounce timer will find it.
    if (isBackFile(filename)) {
      console.log(`[Watcher] Recognized as back-side file: ${filename}. Skipping main event, waiting for front-side pairing.`);
      return;
    }

    // Determine base name (e.g. "Scorecard_0025_a" -> "Scorecard_0025", "Scorecard_0025" -> "Scorecard_0025")
    const baseName = getBaseName(filename);

    // Add to our batch collection
    discoveredBaseNames.add(baseName);
    baseNameToPath.set(baseName, filePath);

    // Reset the batch timer (debounce of 3 seconds)
    if (batchTimer) {
      clearTimeout(batchTimer);
    }
    
    console.log(`[Watcher] Front-side detected: ${baseName}. Resetting batch collection timer.`);
    
    // Emit db_updated immediately so the UI fetches the new folder count
    io.emit('db_updated');

    batchTimer = setTimeout(() => {
      batchTimer = null;
      processBatch(io);
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
async function prepareFilePair(baseName, frontPath) {
  const id = uuidv4();
  const frontFilename = path.basename(frontPath);
  const ext = path.extname(frontPath);

  // Look for a matching back-side file in the input directory
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
  const targetFrontPath = path.join(REVIEW_DIR, newFrontFilename);
  
  let targetBackPath = null;
  if (hasBackSideContent && backFilename) {
    const backExt = path.extname(backFilename);
    const newBackFilename = `${id}_b${backExt}`;
    targetBackPath = path.join(REVIEW_DIR, newBackFilename);
  }

  try {
    // 1. Move the front file to scans/review
    if (fs.existsSync(frontPath)) {
      fs.renameSync(frontPath, targetFrontPath);
    } else {
      throw new Error(`Front file not found at path: ${frontPath}`);
    }

    // 2. Move the back file to scans/review if present
    if (hasBackSideContent && backFilename) {
      const sourceBackPath = path.join(INPUT_DIR, backFilename);
      if (fs.existsSync(sourceBackPath)) {
        fs.renameSync(sourceBackPath, targetBackPath);
      } else {
        console.warn(`[Watcher Warning] Back-side file ${backFilename} was detected but could not be found to move.`);
        hasBackSideContent = false;
        targetBackPath = null;
      }
    }

    // 3. Create initial pending scorecard record in database.json
    const relativeFrontPath = `/scans/review/${newFrontFilename}`;
    const relativeBackPath = targetBackPath ? `/scans/review/${path.basename(targetBackPath)}` : null;

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

    addScorecard(initialCard);
    console.log(`[Watcher] Added scorecard ${id} to database (pending_ocr).`);
    
    return {
      id,
      targetFrontPath,
      targetBackPath,
      frontFilename,
      backFilename,
      hasBackSideContent
    };
  } catch (error) {
    console.error(`[Watcher Error] Failed to prepare file pair for ${baseName}:`, error.message);
    
    // Move front file to error directory if possible
    try {
      if (fs.existsSync(frontPath)) {
        fs.renameSync(frontPath, path.join(ERROR_DIR, frontFilename));
      }
      if (hasBackSideContent && backFilename) {
        const sourceBackPath = path.join(INPUT_DIR, backFilename);
        if (fs.existsSync(sourceBackPath)) {
          fs.renameSync(sourceBackPath, path.join(ERROR_DIR, backFilename));
        }
      }
    } catch (moveErr) {
      console.error('[Watcher Error] Failed to move corrupted files to error folder:', moveErr.message);
    }
    throw error;
  }
}

/**
 * Runs OCR processing on the front scorecard image and updates the database.
 */
async function triggerOCR(id, frontImagePath, backImagePath, io) {
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
      console.log(`[Watcher] High confidence and no back-side content detected. Auto-submitting card ${id} to WCA Live...`);
      try {
        // Pre-save details with pending status to allow execution script to read them
        updateScorecard(id, {
          competitorName: ocrData.competitorName,
          competitorId: ocrData.competitorId,
          eventId: ocrData.eventId,
          roundNumber: ocrData.roundNumber,
          groupNumber: ocrData.groupNumber,
          solves: formattedSolves
        });

        await executeCardSubmission(id, {
          competitorId: ocrData.competitorId,
          competitorName: ocrData.competitorName,
          eventId: ocrData.eventId,
          roundNumber: ocrData.roundNumber,
          solves: formattedSolves
        });

        console.log(`[Watcher] Auto-submission successful for card ${id}.`);
        io.emit('db_updated');
        return; // Success! Skip setting review_needed status
      } catch (submitError) {
        console.error(`[Watcher Error] Auto-submission failed for card ${id}:`, submitError.message);
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
    });

    console.log(`[Watcher] OCR complete for scorecard ${id}. Status: ${cardStatus}`);
    io.emit('db_updated');

  } catch (error) {
    console.error(`[Watcher Error] OCR failed for card ${id}:`, error.message);

    // Move files to scans/error folder
    const ext = path.extname(frontImagePath);
    const errorFrontPath = path.join(ERROR_DIR, `${id}_a${ext}`);
    let errorBackPath = null;

    try {
      if (fs.existsSync(frontImagePath)) {
        fs.renameSync(frontImagePath, errorFrontPath);
      }
      if (backImagePath && fs.existsSync(backImagePath)) {
        const backExt = path.extname(backImagePath);
        errorBackPath = path.join(ERROR_DIR, `${id}_b${backExt}`);
        fs.renameSync(backImagePath, errorBackPath);
      }
    } catch (moveErr) {
      console.error('[Watcher Error] Failed to move image files to error directory:', moveErr.message);
    }

    const relativeFrontErrorPath = `/scans/error/${path.basename(errorFrontPath)}`;
    const relativeBackErrorPath = errorBackPath ? `/scans/error/${path.basename(errorBackPath)}` : null;

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
    });

    io.emit('db_updated');
  }
}
