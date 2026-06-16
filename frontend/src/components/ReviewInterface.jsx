import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, AlertCircle, CheckCircle, SkipForward, ArrowRight, Eye, ShieldAlert } from 'lucide-react';

const BACKEND_URL = 'http://localhost:5000';

export default function ReviewInterface({ card, onUpdateCard, onSkipCard, onSubmitCard, isSubmitting }) {
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

  // Synchronize state when card changes
  useEffect(() => {
    if (card) {
      setFormData({
        competitorName: card.competitorName || '',
        competitorId: card.competitorId || '',
        eventId: card.eventId || '',
        roundNumber: card.roundNumber || '',
        groupNumber: card.groupNumber || '',
        solves: card.solves ? JSON.parse(JSON.stringify(card.solves)) : []
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
          <div className="absolute inset-2 rounded-full border-4 border-indigo-500/15 border-b-indigo-500 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
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

    setFormData(prev => ({
      ...prev,
      solves: newSolves
    }));
  };

  const handleKeyPress = (e, index) => {
    // Enter or Tab key submits or moves focus
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (index < 4) {
        // Move focus to next input
        if (solveInputRefs[index + 1].current) {
          solveInputRefs[index + 1].current.focus();
          solveInputRefs[index + 1].current.select();
        }
      } else {
        // Final field pressed Enter/Tab -> Submit scorecard
        attemptSubmit();
      }
    }
  };

  const attemptSubmit = () => {
    // If has back content and it's not reviewed yet, we block submit
    if (card.hasBackSideContent && !backReviewed) {
      alert("Please review the Delegate Notes on the back and check the verification box first.");
      return;
    }
    
    onSubmitCard(card.id, formData);
  };

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
            <h3 className="text-md font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800/80 pb-2">
              Solve Attempts
            </h3>

            <div className="space-y-3.5">
              {formData.solves.map((solve, idx) => {
                const isLowConf = solve.confidence < 0.85;

                return (
                  <div key={idx} className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 w-20">
                      <span className="text-xs font-bold text-slate-400">Solve {idx + 1}</span>
                    </div>

                    <div className="flex-1 flex flex-col gap-1 relative">
                      <input
                        ref={solveInputRefs[idx]}
                        type="text"
                        value={solve.finalValue}
                        onChange={(e) => handleSolveChange(idx, e.target.value)}
                        onKeyDown={(e) => handleKeyPress(e, idx)}
                        className={`input-premium text-center font-mono text-lg font-bold tracking-wide ${
                          isLowConf 
                            ? 'border-amber-500/60 focus:border-amber-500 focus:ring-amber-500/15 text-amber-200' 
                            : ''
                        }`}
                        placeholder="0.00 / DNF / DNS"
                      />
                      
                      {/* OCR value overlay / confidence info */}
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
    </div>
  );
}
