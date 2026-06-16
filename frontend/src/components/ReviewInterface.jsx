import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, AlertCircle, CheckCircle, SkipForward, ArrowRight, Eye, ShieldAlert, Award, ShieldCheck, X } from 'lucide-react';

const BACKEND_URL = 'http://localhost:5000';

// Helper to convert formatted time string to centiseconds
export function timeStringToCentiseconds(timeStr) {
  if (timeStr === undefined || timeStr === null || String(timeStr).trim() === '') return 0;
  const cleanStr = timeStr.trim().toUpperCase();

  if (cleanStr === 'DNF' || cleanStr === 'F' || cleanStr === 'D') return -1;
  if (cleanStr === 'DNS' || cleanStr === 'S') return -2;

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
    return parseInt(cleanStr, 10) || 0;
  }
}

// Helper to calculate best/average in centiseconds
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

export default function ReviewInterface({ card, onUpdateCard, onSkipCard, onSubmitCard, isSubmitting, localWcif, wcaRecords }) {
  const [formData, setFormData] = useState({
    competitorName: '',
    competitorId: '',
    eventId: '',
    roundNumber: '',
    groupNumber: '',
    solves: []
  });

  const [activeSide, setActiveSide] = useState('front'); // 'front' or 'back'
  const [backReviewed, setBackReviewed] = useState(false);
  const [imageZoom, setImageZoom] = useState(1);
  const solveInputRefs = [useRef(null), useRef(null), useRef(null), useRef(null), useRef(null)];

  // Bypass modal states
  const [bypassModal, setBypassModal] = useState(null); // null, 'anomaly', 'record'
  const [bypassInput, setBypassInput] = useState('');
  const [recordBypassType, setRecordBypassType] = useState(''); // 'WORLD RECORD' or 'NATIONAL RECORD'

  // Helper to find roundObj in localWcif
  const getRoundObj = (evId, rNum) => {
    if (!localWcif || !evId || !rNum) return null;
    const eventObj = localWcif.events?.find(e => e.id === evId);
    const roundId = `${evId}-r${rNum}`;
    return eventObj?.rounds?.find(r => r.id === roundId);
  };

  // Helper to apply Time Limit and Cutoff rules
  const applyRules = (solves, rObj) => {
    if (!rObj || !solves) return solves;
    const newSolves = JSON.parse(JSON.stringify(solves));
    const timeLimit = rObj.timeLimit;
    const cutoff = rObj.cutoff;

    // 1. Time Limits
    if (timeLimit) {
      for (let i = 0; i < newSolves.length; i++) {
        const centis = timeStringToCentiseconds(newSolves[i].finalValue);
        if (centis >= timeLimit.centiseconds && centis > 0) {
          newSolves[i].finalValue = 'DNF';
          newSolves[i].isManuallyEdited = true;
        }
      }
    }

    // 2. Cutoffs
    if (cutoff) {
      const numAttempts = cutoff.numberOfAttempts;
      const firstAttempts = newSolves.slice(0, numAttempts);
      const allFirstCompleted = firstAttempts.every(s => s.finalValue !== '');
      if (allFirstCompleted) {
        const centisList = firstAttempts.map(s => timeStringToCentiseconds(s.finalValue));
        const validCentis = centisList.filter(c => c > 0);
        const bestFirst = validCentis.length > 0 ? Math.min(...validCentis) : Infinity;
        if (bestFirst >= cutoff.attemptResult) {
          // Cutoff failed: clear attempts after numAttempts
          for (let i = numAttempts; i < newSolves.length; i++) {
            newSolves[i].finalValue = '';
            newSolves[i].isManuallyEdited = newSolves[i].ocrValue !== '';
          }
        }
      }
    }

    return newSolves;
  };

  // Synchronize state when card changes
  useEffect(() => {
    if (card) {
      const evId = card.eventId || '';
      const rNum = card.roundNumber || '';
      const rObj = getRoundObj(evId, rNum);
      const initialSolves = card.solves ? JSON.parse(JSON.stringify(card.solves)) : [];
      const sanitizedSolves = applyRules(initialSolves, rObj);

      setFormData({
        competitorName: card.competitorName || '',
        competitorId: card.competitorId || '',
        eventId: card.eventId || '',
        roundNumber: card.roundNumber || '',
        groupNumber: card.groupNumber || '',
        solves: sanitizedSolves
      });
      setBackReviewed(false);
      setActiveSide('front');
      setImageZoom(1);

      // Auto-focus logic: Focus the first low-confidence solve input, or default to solve 1
      setTimeout(() => {
        if (card.status !== 'pending_ocr' && card.solves) {
          const firstLowConfIdx = card.solves.findIndex(s => s.confidence < 0.85);
          const focusIdx = firstLowConfIdx !== -1 ? firstLowConfIdx : 0;
          if (solveInputRefs[focusIdx] && solveInputRefs[focusIdx].current) {
            solveInputRefs[focusIdx].current.focus();
            solveInputRefs[focusIdx].current.select();
          }
        }
      }, 100);
    }
  }, [card?.id]);

  // Apply rules when localWcif loads or changes
  useEffect(() => {
    if (card && localWcif) {
      const evId = formData.eventId || card.eventId || '';
      const rNum = formData.roundNumber || card.roundNumber || '';
      const rObj = getRoundObj(evId, rNum);
      if (rObj) {
        setFormData(prev => ({
          ...prev,
          solves: applyRules(prev.solves, rObj)
        }));
      }
    }
  }, [localWcif]);

  // Apply rules when event or round fields are modified manually in the form
  useEffect(() => {
    const rObj = getRoundObj(formData.eventId, formData.roundNumber);
    if (rObj && formData.solves.length > 0) {
      setFormData(prev => ({
        ...prev,
        solves: applyRules(prev.solves, rObj)
      }));
    }
  }, [formData.eventId, formData.roundNumber]);

  if (!card) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-12 text-slate-500 bg-slate-950">
        <AlertCircle className="w-16 h-16 text-slate-700 mb-4 animate-pulse-subtle" />
        <h3 className="text-xl font-bold text-slate-300">No Scorecard Selected</h3>
        <p className="text-sm text-slate-500 mt-2 max-w-md">
          Select a scorecard from the queue on the left, or drop scanned scorecard JPEGs into scans/input to begin.
        </p>
      </div>
    );
  }

  if (card.status === 'pending_ocr') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-12 text-slate-400 bg-slate-950">
        <div className="relative w-24 h-24 mb-6">
          <div className="absolute inset-0 rounded-full border-4 border-cyan-500/10 border-t-cyan-500 animate-spin" />
          <div className="absolute inset-2 rounded-full border-4 border-indigo-500/15 border-b-indigo-505 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
        </div>
        <h3 className="text-lg font-bold text-white">OCR Processing in Progress</h3>
        <p className="text-sm text-slate-500 mt-2 max-w-sm">
          OpenAI GPT-4o Vision API is currently reading competitor details and handwritten times from the scorecard...
        </p>
      </div>
    );
  }

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  /**
   * Auto-formats speedcubing keyboard input.
   * Typing numbers: 10532 -> 1:05.32
   * Shortcuts: s -> DNS, f/d -> DNF
   */
  const handleSolveChange = (index, value) => {
    let cleanVal = value.toUpperCase();
    
    // Check for immediate shortcuts
    if (cleanVal.includes('S')) {
      cleanVal = 'DNS';
    } else if (cleanVal.includes('F') || cleanVal.includes('D')) {
      cleanVal = 'DNF';
    } else {
      // Strip out anything that isn't a digit
      const digits = cleanVal.replace(/\D/g, '');
      
      if (digits.length === 0) {
        cleanVal = '';
      } else {
        // Format digit string calculator style (right-to-left decimal placement)
        const num = digits.replace(/^0+/, ''); // strip leading zeros
        
        if (num.length === 0) {
          cleanVal = '0.00';
        } else if (num.length === 1) {
          cleanVal = `0.0${num}`;
        } else if (num.length === 2) {
          cleanVal = `0.${num}`;
        } else if (num.length === 3) {
          cleanVal = `${num[0]}.${num.slice(1)}`;
        } else if (num.length === 4) {
          cleanVal = `${num.slice(0, 2)}.${num.slice(2)}`;
        } else {
          // Format as M:SS.CC
          const centis = num.slice(-2);
          const secs = num.slice(-4, -2);
          const mins = num.slice(0, -4);
          cleanVal = `${mins}:${secs}.${centis}`;
        }
      }
    }

    const newSolves = [...formData.solves];
    newSolves[index] = {
      ...newSolves[index],
      finalValue: cleanVal,
      isManuallyEdited: cleanVal !== newSolves[index].ocrValue
    };

    // Apply rules dynamically
    const evId = formData.eventId || card?.eventId;
    const rNum = formData.roundNumber || card?.roundNumber;
    const rObj = getRoundObj(evId, rNum);
    const sanitizedSolves = applyRules(newSolves, rObj);

    setFormData(prev => ({
      ...prev,
      solves: sanitizedSolves
    }));
  };

  const handleKeyPress = (e, index) => {
    // Enter or Tab key submits or moves focus
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      
      // Check if this input is disabled. If we pressed Tab/Enter, we skip focus to the next enabled one.
      let nextIdx = index + 1;
      const evId = formData.eventId || card?.eventId;
      const rNum = formData.roundNumber || card?.roundNumber;
      const rObj = getRoundObj(evId, rNum);
      
      const cutoff = rObj?.cutoff;
      let cutoffFailed = false;
      if (cutoff) {
        const numAttempts = cutoff.numberOfAttempts;
        const firstAttempts = formData.solves.slice(0, numAttempts);
        const allFirstCompleted = firstAttempts.every(s => s.finalValue !== '');
        if (allFirstCompleted) {
          const centisList = firstAttempts.map(s => timeStringToCentiseconds(s.finalValue));
          const validCentis = centisList.filter(c => c > 0);
          const bestFirst = validCentis.length > 0 ? Math.min(...validCentis) : Infinity;
          if (bestFirst >= cutoff.attemptResult) {
            cutoffFailed = true;
          }
        }
      }

      while (nextIdx < 5 && cutoff && nextIdx >= cutoff.numberOfAttempts && cutoffFailed) {
        nextIdx++;
      }

      if (nextIdx < 5) {
        if (solveInputRefs[nextIdx].current) {
          solveInputRefs[nextIdx].current.focus();
          solveInputRefs[nextIdx].current.select();
        }
      } else {
        // Final field pressed Enter/Tab -> Submit scorecard
        attemptSubmit();
      }
    }
  };

  const checkAnomaly = () => {
    const centis = formData.solves.map(s => timeStringToCentiseconds(s.finalValue));
    const validCentis = centis.filter(c => c > 0);
    if (validCentis.length < 2) return false;

    const minVal = Math.min(...validCentis);
    const minIdx = centis.indexOf(minVal);
    const otherCentis = centis.filter((_, idx) => idx !== minIdx && centis[idx] > 0);
    if (otherCentis.length === 0) return false;

    const sum = otherCentis.reduce((a, b) => a + b, 0);
    const avgOther = sum / otherCentis.length;

    return minVal < 0.5 * avgOther;
  };

  const checkRecords = () => {
    if (!wcaRecords || !localWcif) return null;

    const evId = formData.eventId || card?.eventId;
    const recordEventId = evId === 'pyra' ? 'pyram' : evId;
    
    const competitorId = formData.competitorId || card?.competitorId;
    const competitorName = formData.competitorName || card?.competitorName;
    
    const searchId = String(competitorId).trim().toUpperCase();
    const searchName = String(competitorName).trim().toLowerCase();
    
    const person = localWcif.persons?.find(p => {
      const wcaId = p.wcaId ? String(p.wcaId).toUpperCase() : '';
      const regId = String(p.registrantId);
      const name = String(p.name).toLowerCase();
      return (searchId && (wcaId === searchId || regId === searchId)) || 
             (name === searchName || name.includes(searchName) || searchName.includes(name));
    });

    const countryId = person?.countryId;
    const attemptsCentis = formData.solves.map(s => timeStringToCentiseconds(s.finalValue));
    const validAttempts = attemptsCentis.filter(c => c > 0);
    
    if (validAttempts.length === 0) return null;

    const bestAttempt = Math.min(...validAttempts);

    const evIdRaw = formData.eventId || card?.eventId;
    const rNumRaw = formData.roundNumber || card?.roundNumber;
    const rObj = getRoundObj(evIdRaw, rNumRaw);
    const format = rObj?.format;
    
    let bestAverage = 0;
    if (format && (format === 'a' || format === 'm')) {
      const { average } = calculateWcifStats(attemptsCentis, format);
      bestAverage = average;
    }

    // 1. World Record
    const wr = wcaRecords.world_records?.[recordEventId];
    if (wr) {
      if (wr.single && bestAttempt < wr.single) {
        return 'WORLD RECORD';
      }
      if (wr.average && bestAverage > 0 && bestAverage < wr.average) {
        return 'WORLD RECORD';
      }
    }

    // 2. National Record
    if (countryId) {
      let normalizedCountryId = countryId;
      if (countryId === 'United States') normalizedCountryId = 'USA';
      if (countryId === 'UK') normalizedCountryId = 'United Kingdom';
      
      const nr = wcaRecords.national_records?.[normalizedCountryId]?.[recordEventId];
      if (nr) {
        if (nr.single && bestAttempt < nr.single) {
          return 'NATIONAL RECORD';
        }
        if (nr.average && bestAverage > 0 && bestAverage < nr.average) {
          return 'NATIONAL RECORD';
        }
      }
    }

    return null;
  };

  const attemptSubmit = () => {
    if (card.hasBackSideContent && !backReviewed) {
      alert("Please review the Delegate Notes on the back and check the verification box first.");
      return;
    }

    const recordBypass = checkRecords();
    if (recordBypass) {
      setRecordBypassType(recordBypass);
      setBypassInput('');
      setBypassModal('record');
      return;
    }

    if (checkAnomaly()) {
      setBypassModal('anomaly');
      return;
    }
    
    onSubmitCard(card.id, formData);
  };

  const handleRecordBypassConfirm = (e) => {
    if (e) e.preventDefault();
    if (bypassInput.trim().toUpperCase() === recordBypassType) {
      setBypassModal(null);
      setBypassInput('');
      if (checkAnomaly()) {
        setBypassModal('anomaly');
      } else {
        onSubmitCard(card.id, formData);
      }
    } else {
      alert(`Incorrect confirmation phrase. Please type "${recordBypassType}" exactly.`);
    }
  };

  const handleAnomalyBypassConfirm = () => {
    setBypassModal(null);
    onSubmitCard(card.id, formData);
  };

  const handleCancelBypass = () => {
    setBypassModal(null);
    setBypassInput('');
  };

  if (!card) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-12 text-slate-500 bg-slate-950">
        <CheckCircle className="w-16 h-16 text-slate-700 mb-4 animate-pulse-subtle" />
        <h3 className="text-xl font-bold text-slate-300">Review Queue Empty</h3>
        <p className="text-sm text-slate-500 mt-2 max-w-md">
          There are no scorecards currently awaiting human verification. All scanned cards have been processed and verified successfully.
        </p>
      </div>
    );
  }

  const roundObj = getRoundObj(formData.eventId || card.eventId, formData.roundNumber || card.roundNumber);
  const hasBackContent = card.hasBackSideContent;
  const imageSource = activeSide === 'front' 
    ? `${BACKEND_URL}${card.filepath}` 
    : `${BACKEND_URL}${card.backFilepath}`;

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-slate-950">
      {/* LEFT COLUMN: Image Viewport */}
      <div className="flex-1 flex flex-col border-r border-slate-800/80 bg-slate-900/10 overflow-hidden relative">
        {/* Toggle between Front and Back image */}
        <div className="p-3 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/30">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-300">Scorecard Viewport</span>
          </div>

          <div className="flex items-center gap-2">
            {hasBackContent && (
              <div className="flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
                <button
                  onClick={() => setActiveSide('front')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    activeSide === 'front' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Front
                </button>
                <button
                  onClick={() => setActiveSide('back')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1 ${
                    activeSide === 'back' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <AlertTriangle className="w-3 h-3" />
                  Back (Notes)
                </button>
              </div>
            )}
            
            {/* Zoom Controls */}
            <div className="flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
              <button
                onClick={() => setImageZoom(z => Math.max(0.5, z - 0.25))}
                className="w-7 h-7 text-xs font-bold rounded-md text-slate-400 hover:text-slate-200 flex items-center justify-center"
              >
                -
              </button>
              <span className="px-2 text-xs text-slate-400 flex items-center justify-center min-w-[48px]">
                {Math.round(imageZoom * 100)}%
              </span>
              <button
                onClick={() => setImageZoom(z => Math.min(3, z + 0.25))}
                className="w-7 h-7 text-xs font-bold rounded-md text-slate-400 hover:text-slate-200 flex items-center justify-center"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable scorecard image container */}
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-950/60">
          <div 
            className="transition-transform duration-200 shadow-2xl rounded-lg overflow-hidden border border-slate-800"
            style={{ 
              transform: `scale(${imageZoom})`,
              transformOrigin: 'center center',
              maxHeight: '100%',
              maxWidth: '100%'
            }}
          >
            <img 
              src={imageSource} 
              alt="Scanned scorecard" 
              className="max-h-[70vh] object-contain rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Review Form */}
      <div className="w-[450px] flex flex-col bg-slate-900/20 overflow-y-auto">
        {/* Delegate Notes Warning Banner */}
        {hasBackContent && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 p-4 flex items-start gap-3">
            <ShieldAlert className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-amber-400">Delegate Notes on Back Side</h4>
              <p className="text-xs text-amber-300/80 mt-0.5 leading-relaxed">
                The scanner detected content on the back of this scorecard. Review notes, then check the box below to unlock submission.
              </p>
            </div>
          </div>
        )}

        <div className="p-6 space-y-6 flex-1">
          {/* Metadata Section */}
          <div className="space-y-4">
            <h3 className="text-md font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800/80 pb-2">
              Competitor & Round Details
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5 col-span-2">
                <label className="text-xs font-semibold text-slate-400">Competitor Name</label>
                <input
                  type="text"
                  value={formData.competitorName}
                  onChange={(e) => handleInputChange('competitorName', e.target.value)}
                  className="input-premium font-semibold"
                  placeholder="Competitor Name"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-400">Competitor ID / WCA ID</label>
                <input
                  type="text"
                  value={formData.competitorId}
                  onChange={(e) => handleInputChange('competitorId', e.target.value)}
                  className="input-premium font-mono"
                  placeholder="e.g. 2024ABCD01 or ID"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-400">Event</label>
                <input
                  type="text"
                  value={formData.eventId}
                  onChange={(e) => handleInputChange('eventId', e.target.value)}
                  className="input-premium font-semibold"
                  placeholder="e.g. 333, 333oh"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-400">Round</label>
                <input
                  type="number"
                  value={formData.roundNumber}
                  onChange={(e) => handleInputChange('roundNumber', parseInt(e.target.value, 10) || '')}
                  className="input-premium font-semibold"
                  placeholder="Round"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-400">Group</label>
                <input
                  type="number"
                  value={formData.groupNumber}
                  onChange={(e) => handleInputChange('groupNumber', parseInt(e.target.value, 10) || '')}
                  className="input-premium font-semibold"
                  placeholder="Group"
                />
              </div>
            </div>
          </div>

          {/* Solve Times Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <h3 className="text-md font-bold uppercase tracking-wider text-slate-400">
                Solve Attempts
              </h3>
              {roundObj && (
                <div className="flex flex-col items-end text-[10px] text-slate-500 font-semibold">
                  {roundObj.timeLimit && (
                    <span>Limit: {roundObj.timeLimit.centiseconds / 100}s</span>
                  )}
                  {roundObj.cutoff && (
                    <span>Cutoff: {roundObj.cutoff.attemptResult / 100}s ({roundObj.cutoff.numberOfAttempts} att)</span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3.5">
              {formData.solves.map((solve, idx) => {
                const isLowConf = solve.confidence < 0.85;

                // Calculate cutoff status for this attempt
                const cutoff = roundObj?.cutoff;
                let cutoffFailed = false;
                if (cutoff) {
                  const numAttempts = cutoff.numberOfAttempts;
                  const firstAttempts = formData.solves.slice(0, numAttempts);
                  const allFirstCompleted = firstAttempts.every(s => s.finalValue !== '');
                  if (allFirstCompleted) {
                    const centisList = firstAttempts.map(s => timeStringToCentiseconds(s.finalValue));
                    const validCentis = centisList.filter(c => c > 0);
                    const bestFirst = validCentis.length > 0 ? Math.min(...validCentis) : Infinity;
                    if (bestFirst >= cutoff.attemptResult) {
                      cutoffFailed = true;
                    }
                  }
                }
                const isCutoffDisabled = cutoff && idx >= cutoff.numberOfAttempts && cutoffFailed;

                return (
                  <div key={idx} className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 w-20">
                      <span className={`text-xs font-bold ${isCutoffDisabled ? 'text-slate-600' : 'text-slate-400'}`}>
                        Solve {idx + 1}
                      </span>
                    </div>

                    <div className="flex-1 flex flex-col gap-1 relative">
                      <input
                        ref={solveInputRefs[idx]}
                        type="text"
                        value={solve.finalValue}
                        onChange={(e) => handleSolveChange(idx, e.target.value)}
                        onKeyDown={(e) => handleKeyPress(e, idx)}
                        disabled={isCutoffDisabled}
                        className={`input-premium text-center font-mono text-lg font-bold tracking-wide ${
                          isCutoffDisabled 
                            ? 'bg-slate-900/10 border-slate-900 text-slate-600 opacity-40 cursor-not-allowed select-none' 
                            : isLowConf 
                              ? 'border-amber-500/60 focus:border-amber-500 focus:ring-amber-500/15 text-amber-200' 
                              : ''
                        }`}
                        placeholder={isCutoffDisabled ? "Cutoff Failed" : "0.00 / DNF / DNS"}
                      />
                      
                      {/* OCR value overlay / confidence info */}
                      {!isCutoffDisabled ? (
                        <div className="flex items-center justify-between px-1 text-[10px] text-slate-500 mt-0.5">
                          <span className="truncate">
                            OCR read: <strong className="font-mono text-slate-400">{solve.ocrValue || 'None'}</strong>
                          </span>
                          
                          <span className={`font-semibold flex items-center gap-0.5 ${
                            isLowConf ? 'text-amber-500' : 'text-slate-500'
                          }`}>
                            {isLowConf && <AlertTriangle className="w-2.5 h-2.5" />}
                            Conf: {Math.round(solve.confidence * 100)}%
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between px-1 text-[10px] text-slate-600 mt-0.5">
                          <span>Attempt cut-off (cutoff is {cutoff.attemptResult / 100}s)</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Visual hotkey indicators legend */}
            <div className="flex items-center justify-between gap-1.5 text-slate-500 text-[10px] bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/40 mt-3 shadow-inner select-none animate-fade-in">
              <span className="font-semibold text-slate-400">Keys:</span>
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[9px] border border-slate-700 shadow-sm">s</kbd> = DNS</span>
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[9px] border border-slate-700 shadow-sm">f</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[9px] border border-slate-700 shadow-sm">d</kbd> = DNF</span>
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[9px] border border-slate-700 shadow-sm">Esc</kbd> = Skip</span>
            </div>
          </div>

          {/* Verification for back notes */}
          {hasBackContent && (
            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-3">
              <input
                id="backReviewedCheckbox"
                type="checkbox"
                checked={backReviewed}
                onChange={(e) => setBackReviewed(e.target.checked)}
                className="w-5 h-5 rounded border-slate-700 text-cyan-600 bg-slate-950 focus:ring-cyan-500 focus:ring-offset-slate-950"
              />
              <label htmlFor="backReviewedCheckbox" className="text-xs font-medium text-slate-300 select-none cursor-pointer">
                I have reviewed the back side Delegate Notes and verified any modifications.
              </label>
            </div>
          )}
        </div>

        {/* Footer Action Buttons */}
        <div className="p-4 bg-slate-900/60 border-t border-slate-800/80 flex items-center gap-3 shrink-0">
          <button
            onClick={() => onSkipCard(card.id)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 border border-slate-800 hover:bg-slate-800/60 text-slate-300 font-semibold rounded-xl transition-all duration-200 text-sm active:scale-[0.98]"
          >
            <SkipForward className="w-4 h-4" />
            Skip (Esc)
          </button>

          <button
            disabled={isSubmitting || (hasBackContent && !backReviewed)}
            onClick={attemptSubmit}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 font-semibold rounded-xl text-sm transition-all duration-200 active:scale-[0.98] ${
              hasBackContent && !backReviewed
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-800/40'
                : 'bg-gradient-premium hover:shadow-lg hover:shadow-cyan-500/20 text-white border border-cyan-500/30'
            }`}
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Verify (Enter)
                <ArrowRight className="w-4 h-4 opacity-50" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Bypass Modals */}
      {bypassModal === 'record' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fade-in">
          <form 
            onSubmit={handleRecordBypassConfirm}
            className="bg-slate-900 border-2 border-red-500/50 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-up"
          >
            <div className="flex items-center gap-3 text-red-500">
              <Award className="w-8 h-8 animate-bounce" />
              <h3 className="text-xl font-bold tracking-tight text-white uppercase">
                {recordBypassType} Breaker Detected!
              </h3>
            </div>
            
            <p className="text-sm text-slate-300 leading-relaxed">
              You entered a result that is faster than the current WCA {recordBypassType === 'WORLD RECORD' ? 'World' : 'National'} Record. 
              This is extremely unusual and often points to a writing, decimal, or event selection mismatch.
            </p>
            
            <div className="p-3 bg-red-950/20 rounded-xl border border-red-500/10 text-xs text-red-300/95 space-y-1">
              <p className="font-semibold flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                CRITICAL INSTRUCTION:
              </p>
              <p>Double-check the paper scorecard, verify the competitor WCA ID, round number, and time units.</p>
            </div>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                To bypass, type <span className="font-mono text-red-400 font-bold select-all">"{recordBypassType}"</span>:
              </label>
              <input
                type="text"
                required
                value={bypassInput}
                onChange={(e) => setBypassInput(e.target.value)}
                className="input-premium text-center font-bold tracking-wider placeholder-slate-800 focus:border-red-500 focus:ring-red-500/15"
                placeholder={recordBypassType}
                autoFocus
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleCancelBypass}
                className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-300 font-semibold rounded-xl transition text-xs"
              >
                Go Back & Edit
              </button>
              <button
                type="submit"
                disabled={bypassInput.trim().toUpperCase() !== recordBypassType}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-red-600 to-amber-600 hover:shadow-lg hover:shadow-red-500/20 text-white font-semibold rounded-xl transition text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Authorize & Submit
              </button>
            </div>
          </form>
        </div>
      )}

      {bypassModal === 'anomaly' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center gap-3 text-amber-500">
              <AlertTriangle className="w-8 h-8 animate-pulse" />
              <h3 className="text-xl font-bold tracking-tight text-white uppercase">
                Statistical Anomaly Detected
              </h3>
            </div>
            
            <p className="text-sm text-slate-300 leading-relaxed">
              The fastest attempt is <strong>less than 50%</strong> of the average of the other attempts. 
              This commonly indicates a decimal typo (e.g. typing <code>3.00</code> instead of <code>30.00</code>) or an out-of-order solve.
            </p>
            
            <div className="p-3.5 bg-amber-950/20 rounded-xl border border-amber-500/10 text-xs text-amber-300/95">
              Please confirm you have verified that this result is written correctly on the physical scorecard.
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCancelBypass}
                className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-300 font-semibold rounded-xl transition text-xs"
              >
                Go Back & Edit
              </button>
              <button
                onClick={handleAnomalyBypassConfirm}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-600 hover:shadow-lg hover:shadow-amber-500/20 text-white font-semibold rounded-xl transition text-xs"
              >
                Yes, Verified Correct
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
