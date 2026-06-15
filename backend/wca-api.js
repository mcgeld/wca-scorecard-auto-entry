import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { updateScorecard, readDatabase } from './db-helper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const WCA_LIVE_ENDPOINT = 'https://live.worldcubeassociation.org/api/graphql';

let activeWcaToken = null;
let cachedWcif = null;
let lastPatchTime = 0;

export function getActiveWcaToken() {
  return activeWcaToken;
}

export function setActiveWcaToken(token) {
  activeWcaToken = token;
  console.log(`[Session] Active WCA token has been synchronized.`);
}

/**
 * Resolves a human-readable WCA competition ID (e.g. "DavisSpringSunset2026")
 * to its WCA Live database ID (e.g. "10549").
 */
async function resolveCompetitionDbId(wcaId, token) {
  if (/^\d+$/.test(wcaId)) {
    return wcaId; // Already a database ID
  }

  console.log(`[WCA] Attempting to resolve competition ID "${wcaId}" to database ID on WCA Live...`);

  // We will try a few filters:
  // 1. First word of camelCase name (e.g. "Davis" for "DavisSpringSunset2026")
  // 2. The year (e.g. "2026")
  // 3. Fallback generic substring
  const camelWords = wcaId.match(/[A-Z][a-z]+/g);
  const yearMatch = wcaId.match(/\d{4}/);
  const filters = [];
  if (camelWords && camelWords.length > 0) {
    filters.push(camelWords[0]);
  }
  if (yearMatch) {
    filters.push(yearMatch[0]);
  }
  filters.push(wcaId.replace(/\d+$/, '').substring(0, 5));

  for (const filter of filters) {
    if (!filter || filter.length < 2) continue;

    try {
      const query = `
        query ResolveCompetition($filter: String!) {
          competitions(filter: $filter) {
            id
            wcaId
          }
        }
      `;

      const response = await axios.post(
        WCA_LIVE_ENDPOINT,
        { query, variables: { filter } },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(token && token !== 'your_wca_bearer_token_here' ? { Authorization: `Bearer ${token}` } : {})
          }
        }
      );

      const matches = response.data.data?.competitions || [];
      const matched = matches.find(c => c.wcaId.toLowerCase() === wcaId.toLowerCase());
      if (matched) {
        console.log(`[WCA] Resolved "${wcaId}" to database ID: ${matched.id}`);
        return matched.id;
      }
    } catch (e) {
      console.warn(`[WCA Warning] Resolution filter "${filter}" failed:`, e.message);
    }
  }

  throw new Error(`Could not find competition "${wcaId}" on WCA Live. Please verify the competition ID or make sure the competition is imported/active on WCA Live.`);
}

/**
 * Fetches results for a specific round of an event from WCA Live.
 */
export async function fetchRoundResults(eventId, roundNumber, overrideToken) {
  const competitionId = process.env.WCA_COMPETITION_ID || 'DavisSpringSunset2026';
  const token = overrideToken || activeWcaToken || process.env.WCA_BEARER_TOKEN;

  try {
    // Resolve competitionId to numeric database ID
    const dbId = await resolveCompetitionDbId(competitionId, token);

    const query = `
      query GetCompetitionEvents($competitionId: ID!) {
        competition(id: $competitionId) {
          id
          competitionEvents {
            id
            event {
              id
            }
            rounds {
              id
              number
              results {
                id
                person {
                  name
                  wcaId
                }
              }
            }
          }
        }
      }
    `;

    const response = await axios.post(
      WCA_LIVE_ENDPOINT,
      {
        query,
        variables: {
          competitionId: dbId
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token && token !== 'your_wca_bearer_token_here' ? { Authorization: `Bearer ${token}` } : {})
        }
      }
    );

    if (response.data.errors && response.data.errors.length > 0) {
      throw new Error(response.data.errors[0].message);
    }

    const compEvents = response.data.data?.competition?.competitionEvents || [];
    const eventObj = compEvents.find(ce => ce.event.id === eventId);
    if (!eventObj) {
      throw new Error(`Event "${eventId}" not found in competition "${competitionId}" (resolved: ${dbId}) on WCA Live.`);
    }

    const roundObj = eventObj.rounds.find(r => r.number === parseInt(roundNumber, 10));
    if (!roundObj) {
      throw new Error(`Round "${roundNumber}" of event "${eventId}" not found on WCA Live.`);
    }

    return {
      source: 'wca-live',
      roundId: roundObj.id,
      results: roundObj.results || []
    };
  } catch (error) {
    console.log(`[WCA] WCA Live fetch failed: ${error.message}. Falling back to WCA Monolith WCIF API...`);
    try {
      const wcifUrl = `https://www.worldcubeassociation.org/api/v0/competitions/${competitionId}/wcif/public`;
      const wcifRes = await axios.get(wcifUrl); // public WCIF
      const wcif = wcifRes.data;

      const eventObj = wcif.events.find(e => e.id === eventId);
      if (!eventObj) {
        throw new Error(`Event "${eventId}" not found in WCIF.`);
      }

      const roundObj = eventObj.rounds.find(r => r.id === `${eventId}-r${roundNumber}`);
      if (!roundObj) {
        throw new Error(`Round "${roundNumber}" of event "${eventId}" not found in WCIF.`);
      }

      // Map WCIF format to standard WCA Live results structure for matching
      const results = wcif.persons.map(p => ({
        id: String(p.registrantId), // Use registrantId as the match result ID
        person: {
          name: p.name,
          wcaId: p.wcaId
        }
      }));

      return {
        source: 'wca-monolith',
        roundId: roundObj.id,
        results
      };
    } catch (fallbackError) {
      console.error('Fallback WCA Monolith WCIF API failed:', fallbackError.message);
      throw new Error(`Competition "${competitionId}" could not be resolved on WCA Live, and fallback WCIF fetch failed: ${fallbackError.message}`);
    }
  }
}

/**
 * Submits attempts to WCA Live using the enterResult mutation.
 * Attempts should be an array of centisecond values (e.g. 6532, -1 for DNF, -2 for DNS).
 */
export async function submitResultToWCA(roundId, resultId, centisecondAttempts, overrideToken) {
  const token = overrideToken || activeWcaToken || process.env.WCA_BEARER_TOKEN;
  if (!token || token === 'your_wca_bearer_token_here') {
    throw new Error('WCA Live Authentication Token is missing or not configured.');
  }

  const mutation = `
    mutation EnterResults($input: EnterResultsInput!) {
      enterResults(input: $input) {
        round {
          id
        }
      }
    }
  `;

  try {
    const response = await axios.post(
      WCA_LIVE_ENDPOINT,
      {
        query: mutation,
        variables: {
          input: {
            id: roundId,
            results: [
              {
                id: resultId,
                attempts: centisecondAttempts.map(res => ({ result: res }))
              }
            ]
          }
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (response.data.errors && response.data.errors.length > 0) {
      throw new Error(response.data.errors[0].message);
    }

    const data = response.data.data?.enterResults;
    return data?.round;
  } catch (error) {
    console.error('Error submitting result to WCA Live:', error.message);
    throw error;
  }
}

/**
 * Submits results directly to the WCA monolith database using the WCIF PATCH endpoint.
 */
export function calculateWcifStats(attempts, format) {
  let best = 0;
  const validAttempts = attempts.filter(a => a > 0);
  const dnfCount = attempts.filter(a => a === -1).length;
  const dnsCount = attempts.filter(a => a === -2).length;

  if (validAttempts.length > 0) {
    best = Math.min(...validAttempts);
  } else if (dnfCount > 0) {
    best = -1;
  } else if (dnsCount > 0) {
    best = -2;
  }

  let average = 0;
  const hasZero = attempts.some(a => a === 0);

  if (!hasZero) {
    if (format === 'a') {
      if (attempts.length === 5) {
        const nonValidCount = dnfCount + dnsCount;
        if (nonValidCount >= 2) {
          average = -1;
        } else {
          const sorted = [...attempts].sort((x, y) => {
            const valX = x < 0 ? Infinity : x;
            const valY = y < 0 ? Infinity : y;
            return valX - valY;
          });
          const middle = sorted.slice(1, 4);
          const sum = middle.reduce((sumVal, a) => sumVal + a, 0);
          average = Math.round(sum / 3);
        }
      }
    } else if (format === 'm') {
      if (attempts.length === 3) {
        if (dnfCount > 0 || dnsCount > 0) {
          average = -1;
        } else {
          const sum = attempts.reduce((sumVal, a) => sumVal + a, 0);
          average = Math.round(sum / 3);
        }
      }
    }
  }

  return { best, average };
}

async function submitResultToWcaMonolith(competitionId, roundId, registrantId, centisecondAttempts, token) {
  if (!token || token === 'your_wca_bearer_token_here') {
    throw new Error('WCA Authentication Token is missing or not configured.');
  }

  // 1. Fetch the private/full WCIF to get all current events and results (including pre-populated results)
  const wcifUrl = `https://www.worldcubeassociation.org/api/v0/competitions/${competitionId}/wcif`;
  let wcif;
  const CACHE_TTL = 10000; // 10 seconds cache TTL

  if (cachedWcif && (Date.now() - lastPatchTime < CACHE_TTL)) {
    console.log(`[WCA Monolith] Using cached WCIF (last updated ${Date.now() - lastPatchTime}ms ago) to avoid replication lag...`);
    wcif = cachedWcif;
  } else {
    console.log(`[WCA Monolith] Fetching full WCIF for "${competitionId}" to merge results...`);
    try {
      const wcifRes = await axios.get(wcifUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      wcif = wcifRes.data;
    } catch (err) {
      console.error(`[WCA Monolith] Failed to fetch full WCIF: ${err.message}`);
      throw new Error(`Failed to fetch full WCIF: ${err.message}`);
    }
  }

  const eventId = roundId.split('-r')[0]; // e.g. "333" from "333-r1"
  const personIdNum = parseInt(registrantId, 10);

  // 2. Find and update the specific round results inside the fetched events list
  const eventObj = wcif.events.find(e => e.id === eventId);
  if (!eventObj) {
    throw new Error(`Event "${eventId}" not found in WCIF events list.`);
  }

  const roundObj = eventObj.rounds.find(r => r.id === roundId);
  if (!roundObj) {
    throw new Error(`Round "${roundId}" not found in event "${eventId}" in WCIF.`);
  }

  if (!roundObj.results) {
    roundObj.results = [];
  }

  const attemptsPayload = centisecondAttempts.map(res => ({ result: res }));
  const format = roundObj.format;
  const { best, average } = calculateWcifStats(centisecondAttempts, format);

  let existingResult = roundObj.results.find(r => r.personId === personIdNum);
  if (existingResult) {
    console.log(`[WCA Monolith] Updating attempts, best (${best}), average (${average}) for competitor ${registrantId} in round ${roundId}`);
    existingResult.attempts = attemptsPayload;
    existingResult.best = best;
    existingResult.average = average;
    existingResult.ranking = existingResult.ranking || null;
  } else {
    console.log(`[WCA Monolith] Creating new result entry for competitor ${registrantId} in round ${roundId}`);
    roundObj.results.push({
      personId: personIdNum,
      attempts: attemptsPayload,
      best,
      average,
      ranking: null
    });
  }

  // 3. Submit the entire events array to prevent "Cannot remove events" error
  const patchUrl = `https://www.worldcubeassociation.org/api/v0/competitions/${competitionId}/wcif`;
  const payload = {
    events: wcif.events
  };

  try {
    const response = await axios.patch(
      patchUrl,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }
    );
    console.log(`[WCA Monolith PATCH] Submitted results for person ${registrantId}. Status: ${response.status}`);
    
    // Update the cache with the response WCIF if it is returned correctly
    if (response.data && response.data.events) {
      cachedWcif = response.data;
    } else {
      cachedWcif = wcif;
    }
    lastPatchTime = Date.now();
    console.log(`[WCA Monolith] Cache updated with fresh PATCH response.`);
  } catch (error) {
    console.error('Error patching WCIF results to WCA Monolith:', error.message);
    if (error.response && error.response.data) {
      console.error('Response error data:', JSON.stringify(error.response.data));
      throw new Error(error.response.data.error || error.response.data.message || 'WCA Monolith WCIF PATCH submission failed.');
    }
    throw error;
  }
}

/**
 * Converts formatted string time (like "1:05.32", "5.32", "DNF", "DNS") to centiseconds.
 */
export function timeStringToCentiseconds(timeStr) {
  if (timeStr === undefined || timeStr === null || String(timeStr).trim() === '') return 0;
  const cleanStr = timeStr.trim().toUpperCase();

  if (cleanStr === 'DNF' || cleanStr === 'F' || cleanStr === 'D') return -1;
  if (cleanStr === 'DNS' || cleanStr === 'S') return -2;

  // Format: M:SS.CC or S.CC or SS.CC
  if (cleanStr.includes(':')) {
    const [minStr, rest] = cleanStr.split(':');
    const [secStr, centiStr] = rest.split('.');
    const mins = parseInt(minStr, 10) || 0;
    const secs = parseInt(secStr, 10) || 0;
    let centis = parseInt(centiStr, 10) || 0;
    if (centiStr && centiStr.length === 1) centis *= 10;
    return (mins * 60 + secs) * 100 + centis;
  } else if (cleanStr.includes('.')) {
    const [secStr, centiStr] = cleanStr.split('.');
    const secs = parseInt(secStr, 10) || 0;
    let centis = parseInt(centiStr, 10) || 0;
    if (centiStr && centiStr.length === 1) centis *= 10;
    return secs * 100 + centis;
  } else {
    // If no dots, treat as number of centiseconds directly
    return parseInt(cleanStr, 10) || 0;
  }
}

/**
 * Orchestrates WCA Live matching, submission (or mock bypass), database status update, and moving scans to processed.
 */
let submissionQueue = Promise.resolve();

export async function executeCardSubmission(cardId, data, overrideToken) {
  const resultPromise = submissionQueue.then(() =>
    executeCardSubmissionInternal(cardId, data, overrideToken)
  );
  submissionQueue = resultPromise.catch(() => {});
  return resultPromise;
}

async function executeCardSubmissionInternal(cardId, { competitorId, competitorName, eventId, roundNumber, solves }, overrideToken) {
  const wcaLiveEnabled = process.env.WCA_LIVE_ENABLED === 'true';
  const db = readDatabase();
  const card = db.scorecards.find(c => c.id === cardId);
  if (!card) {
    throw new Error('Scorecard not found in database');
  }

  // Use values from argument or default to card values
  const compId = competitorId !== undefined ? competitorId : card.competitorId;
  const compName = competitorName !== undefined ? competitorName : card.competitorName;
  const evId = eventId !== undefined ? eventId : card.eventId;
  const rNum = roundNumber !== undefined ? roundNumber : card.roundNumber;
  const attemptSolves = solves !== undefined ? solves : card.solves;

  if (wcaLiveEnabled) {
    // Real submission
    console.log(`[WCA Submission] Fetching results for ${evId} Round ${rNum}...`);
    const fetchRes = await fetchRoundResults(evId, rNum, overrideToken);

    let matchedResult = null;
    const searchId = String(compId).trim().toUpperCase();
    const searchName = String(compName).trim().toLowerCase();

    for (const r of fetchRes.results) {
      const wcaId = r.person.wcaId ? String(r.person.wcaId).toUpperCase() : '';
      const name = String(r.person.name).toLowerCase();
      
      if (searchId && wcaId === searchId) {
        matchedResult = r;
        break;
      }
      
      if (name === searchName || name.includes(searchName) || searchName.includes(name)) {
        matchedResult = r;
        break;
      }
    }

    if (!matchedResult) {
      throw new Error(`Could not find a matching competitor/result on WCA Live/Monolith for "${compName}" (${compId}) in ${evId} Round ${rNum}. Please verify the competitor details or make sure they are in this round.`);
    }

    console.log(`[WCA Submission] Matched competitor to WCA ID/Registrant ID: ${matchedResult.id}`);
    const centisecondAttempts = attemptSolves.map(s => timeStringToCentiseconds(s.finalValue));
    console.log(`[WCA Submission] Submitting attempts: ${JSON.stringify(centisecondAttempts)}`);
    
    if (fetchRes.source === 'wca-monolith') {
      const competitionId = process.env.WCA_COMPETITION_ID || 'DavisSpringSunset2026';
      const token = overrideToken || activeWcaToken || process.env.WCA_BEARER_TOKEN;
      await submitResultToWcaMonolith(competitionId, fetchRes.roundId, matchedResult.id, centisecondAttempts, token);
    } else {
      await submitResultToWCA(fetchRes.roundId, matchedResult.id, centisecondAttempts, overrideToken);
    }
  } else {
    // Mock / Test mode
    console.log(`[WCA Submission] WCA Live Submission disabled (Test Mode). Skipping GraphQL call, pretending it succeeded.`);
  }

  // Move files to processed
  const rootDir = path.resolve(__dirname, '..');
  const processedDir = path.join(rootDir, 'scans/processed');
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

  // Update scorecard in database
  const updated = updateScorecard(cardId, {
    status: 'submitted',
    filepath: relativeFrontProcessed,
    backFilepath: relativeBackProcessed,
    competitorId: compId,
    competitorName: compName,
    eventId: evId,
    roundNumber: rNum,
    solves: attemptSolves.map(s => ({ ...s, isManuallyEdited: s.isManuallyEdited || false }))
  });

  return updated;
}
