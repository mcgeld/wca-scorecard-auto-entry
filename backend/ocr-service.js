import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

/**
 * Converts a local file to Base64 string.
 */
function fileToBase64(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return fileBuffer.toString('base64');
}

/**
 * Extracts OCR data from a scorecard image using OpenAI GPT-4o Vision API.
 * If the API key is not configured, it falls back to generating mock data.
 */
export async function performOCR(imagePath) {
  const apiKey = process.env.OPENAI_API_KEY;
  const filename = path.basename(imagePath);

  const openaiEnabled = process.env.OPENAI_ENABLED === 'true';

  if (!openaiEnabled || !apiKey || apiKey.startsWith('your_openai') || apiKey === '') {
    console.warn(`[OCR] OpenAI OCR disabled or API key missing. Generating mock OCR data for ${filename}...`);
    return generateMockOCRData(filename);
  }

  try {
    const base64Image = fileToBase64(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

    const prompt = `You are an OCR assistant parsing a WCA speedcubing scorecard. 
Extract the Competitor Name, Competitor ID (WCA ID), Event ID, Round Number, Group Number, and the 5 solve times.
Note: Competitor IDs (WCA IDs) always follow the format of 4 digits, 4 letters, and 2 digits (e.g., YYYYLLLLDD like 2025LEEB01). If the competitor is new and has no WCA ID, this field should be empty.

For each solve time, provide a 'confidence' score between 0.0 and 1.0. 
If handwriting is ambiguous or crossed out, assign a score below 0.8.

Return ONLY a JSON object matching this exact schema:
{
  "competitorName": "string",
  "competitorId": "string (the WCA ID in 4-digits 4-letters 2-digits format, or empty string if new competitor)",
  "eventId": "string (e.g. 333, 444, 333oh, pyra, minx, clock)",
  "roundNumber": "number",
  "groupNumber": "number",
  "solves": [
    { "attempt": 1, "ocrValue": "string (e.g. 12.34, 1:05.32, DNF, DNS)", "confidence": 0.95 },
    { "attempt": 2, "ocrValue": "string", "confidence": 0.92 },
    { "attempt": 3, "ocrValue": "string", "confidence": 0.88 },
    { "attempt": 4, "ocrValue": "string", "confidence": 0.70 },
    { "attempt": 5, "ocrValue": "string", "confidence": 0.99 }
  ]
}`;

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 1000
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        }
      }
    );

    const jsonText = response.data.choices[0].message.content;
    const parsedData = JSON.parse(jsonText);

    // Validate and format the response structure
    return formatOCRResponse(parsedData);
  } catch (error) {
    console.error(`[OCR Error] Failed to process scorecard ${filename}:`, error.message);
    throw error;
  }
}

function truncateTimeToTwoDecimals(timeStr) {
  if (!timeStr) return '';
  const trimmed = timeStr.trim().toUpperCase();
  if (trimmed === 'DNF' || trimmed === 'DNS') return trimmed;

  if (trimmed.includes('.')) {
    const parts = trimmed.split('.');
    if (parts[1] && parts[1].length > 2) {
      return `${parts[0]}.${parts[1].substring(0, 2)}`;
    }
  }
  return trimmed;
}

/**
 * Validates and normalizes the parsed OCR structure.
 */
function formatOCRResponse(data) {
  const solves = Array.isArray(data.solves) ? data.solves : [];
  
  // Pad solves to 5 if less are returned
  const formattedSolves = [];
  for (let i = 1; i <= 5; i++) {
    const originalSolve = solves.find(s => s.attempt === i);
    const rawVal = originalSolve?.ocrValue !== undefined && originalSolve?.ocrValue !== null ? String(originalSolve.ocrValue) : '';
    const truncatedVal = truncateTimeToTwoDecimals(rawVal);
    formattedSolves.push({
      attempt: i,
      ocrValue: truncatedVal,
      confidence: originalSolve?.confidence !== undefined ? parseFloat(originalSolve.confidence) : 0.5,
      finalValue: truncatedVal,
      isManuallyEdited: false
    });
  }

  // Convert competitorId to number if possible, or keep as string (WCA ID)
  let competitorId = data.competitorId;
  if (typeof competitorId === 'string' && /^\d+$/.test(competitorId)) {
    competitorId = parseInt(competitorId, 10);
  }

  return {
    competitorName: data.competitorName || 'Unknown Competitor',
    competitorId: competitorId || 0,
    eventId: data.eventId || '333',
    roundNumber: parseInt(data.roundNumber, 10) || 1,
    groupNumber: parseInt(data.groupNumber, 10) || 1,
    solves: formattedSolves
  };
}

/**
 * Generates realistic mock OCR data based on file name or random selection.
 * Helps with testing without API keys.
 */
async function generateMockOCRData(filename) {
  // Simulate network latency (1.5 seconds)
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Parse details from filename if matching: event_round_group_compID.jpg
  // Example: 333oh_r1_g1_2019THOM01_a.jpg
  const nameWithoutExt = path.basename(filename, path.extname(filename));
  const parts = nameWithoutExt.split('_');

  let eventId = '333';
  let roundNumber = 1;
  let groupNumber = 1;
  let competitorId = '2022MALC01';
  let competitorName = 'Malcolm Cubist';

  if (parts.length >= 4) {
    eventId = parts[0];
    // parse "r1" -> 1
    roundNumber = parseInt(parts[1].replace('r', ''), 10) || 1;
    // parse "g2" -> 2
    groupNumber = parseInt(parts[2].replace('g', ''), 10) || 1;
    competitorId = parts[3];
    
    // Give some realistic names based on competitor ID
    if (competitorId.startsWith('20')) {
      competitorName = 'Alexander Mercer';
    } else {
      competitorName = 'Sophia Sterling';
      competitorId = parseInt(competitorId, 10) || 12;
    }
  } else {
    // Generate random mock profile
    const firstNames = ['John', 'Emily', 'Michael', 'Chloe', 'David', 'Emma', 'WCA'];
    const lastNames = ['Smith', 'Johnson', 'Rodriguez', 'Chen', 'Davis', 'Hansen'];
    const events = ['333', '222', '333oh', 'pyra', 'skewb', 'clock'];
    
    eventId = events[Math.floor(Math.random() * events.length)];
    roundNumber = Math.floor(Math.random() * 3) + 1;
    groupNumber = Math.floor(Math.random() * 4) + 1;
    competitorId = `202${Math.floor(Math.random()*9)}${String.fromCharCode(65+Math.floor(Math.random()*26))}${String.fromCharCode(65+Math.floor(Math.random()*26))}${String.fromCharCode(65+Math.floor(Math.random()*26))}0${Math.floor(Math.random()*9)}`;
    competitorName = `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
  }

  // Generate realistic solve times
  // We make one solve have low confidence occasionally to trigger human-in-the-loop review
  const solves = [
    { attempt: 1, ocrValue: '12.54', confidence: 0.98, finalValue: '12.54', isManuallyEdited: false },
    { attempt: 2, ocrValue: '14.21', confidence: 0.95, finalValue: '14.21', isManuallyEdited: false },
    { attempt: 3, ocrValue: '11.89', confidence: 0.91, finalValue: '11.89', isManuallyEdited: false },
    // Low confidence solve (ambiguous handwriting / smudge)
    { attempt: 4, ocrValue: 'DNF', confidence: 0.68, finalValue: 'DNF', isManuallyEdited: false },
    { attempt: 5, ocrValue: '13.02', confidence: 0.96, finalValue: '13.02', isManuallyEdited: false }
  ];

  return {
    competitorName,
    competitorId,
    eventId,
    roundNumber,
    groupNumber,
    solves
  };
}
