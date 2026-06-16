import React, { useState } from 'react';
import { RefreshCw, CloudLightning, Calendar, MapPin, AlertOctagon, ShieldAlert, CheckCircle, BarChart3 } from 'lucide-react';

export default function Dashboard({ 
  localWcif, 
  lastSynced, 
  wcifExists, 
  isSyncing, 
  inputCount,
  onFetchWcif, 
  onPushWcif,
  onSwitchCompetition,
  onProcessRootScans
}) {
  const [showWarningModal, setShowWarningModal] = useState(false);

  if (!localWcif) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-12 text-slate-500 bg-slate-950">
        <BarChart3 className="w-16 h-16 text-slate-700 mb-4 animate-pulse-subtle" />
        <h3 className="text-xl font-bold text-slate-300">Competition Dashboard</h3>
        <p className="text-sm text-slate-500 mt-2 max-w-md">
          Please select a competition or fetch its WCIF file to initialize the dashboard.
        </p>
      </div>
    );
  }

  const handleFetchClick = () => {
    setShowWarningModal(true);
  };

  const handleFetchConfirm = () => {
    setShowWarningModal(false);
    onFetchWcif();
  };

  const formatSyncTime = (timestamp) => {
    if (!timestamp) return 'Not Synced';
    try {
      const date = new Date(timestamp);
      return `Synced: ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } catch (e) {
      return 'Not Synced';
    }
  };

  // Helper to calculate round progress
  const getRoundProgress = (roundObj, eventId) => {
    if (!localWcif || !roundObj) return { entered: 0, total: 0 };

    const isRound1 = roundObj.id.endsWith('-r1');
    const results = roundObj.results || [];

    // Count entered results (competitors who have attempts with non-zero results)
    const entered = results.filter(r => r.attempts && r.attempts.length > 0 && r.attempts.some(att => att.result !== 0)).length;

    let total = 0;
    if (isRound1) {
      // Count registered and accepted competitors for this event
      total = (localWcif.persons || []).filter(p => 
        p.registration && 
        p.registration.status === 'accepted' && 
        p.registration.eventIds && 
        p.registration.eventIds.includes(eventId)
      ).length;
    } else {
      // For subsequent rounds, advanced competitors are pre-populated in the results array
      total = results.length;
    }

    return { entered, total };
  };

  // Event ID to Name mapping
  const eventNames = {
    '333': '3x3x3 Cube',
    '222': '2x2x2 Cube',
    '444': '4x4x4 Cube',
    '555': '5x5x5 Cube',
    '666': '6x6x6 Cube',
    '777': '7x7x7 Cube',
    '333bf': '3x3x3 Blindfolded',
    '333fm': '3x3x3 Fewest Moves',
    '333oh': '3x3x3 One-Handed',
    'clock': 'Rubik\'s Clock',
    'minx': 'Megaminx',
    'pyra': 'Pyraminx',
    'skewb': 'Skewb',
    'sq1': 'Square-1',
    '444bf': '4x4x4 Blindfolded',
    '555bf': '5x5x5 Blindfolded',
    '333mbf': '3x3x3 Multi-Blindfolded'
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden relative">
      {/* Scrollable Dashboard View */}
      <div className="flex-1 overflow-y-auto p-8 space-y-8 max-w-5xl w-full mx-auto">
        
        {/* Banner Section */}
        <div className="glass-card p-6 rounded-2xl border border-slate-850 relative overflow-hidden flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 to-indigo-500/5 pointer-events-none" />
          
          <div className="space-y-2 relative">
            <h1 className="text-2xl font-black text-white sm:text-3xl leading-tight">
              {localWcif.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400">
              <div className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <span>{localWcif.startDate === localWcif.endDate ? localWcif.startDate : `${localWcif.startDate} to ${localWcif.endDate}`}</span>
              </div>
              <div className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-slate-500" />
                <span>{localWcif.city} ({localWcif.shortName})</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 relative">
            <button
              onClick={onSwitchCompetition}
              className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 transition-all active:scale-[0.98]"
            >
              Switch Competition
            </button>
          </div>
        </div>

        {inputCount > 0 && (
          <div className="glass-card p-5 rounded-2xl border border-cyan-800/30 bg-gradient-to-r from-cyan-950/40 via-indigo-950/20 to-cyan-950/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h4 className="font-bold text-cyan-300 text-sm flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
                </span>
                Unprocessed Scorecards Found
              </h4>
              <p className="text-xs text-slate-400">
                There are {inputCount} unprocessed scorecard scan{inputCount > 1 ? 's' : ''} in the import folder. Click process to import them for this competition.
              </p>
            </div>
            <button
              onClick={onProcessRootScans}
              className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-500/10 transition-all duration-200 flex items-center gap-1.5 active:scale-[0.98]"
            >
              Process Scans
            </button>
          </div>
        )}

        {/* Sync panel / Active actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Push Card */}
          <div className="glass-card p-6 rounded-2xl border border-slate-850 flex flex-col justify-between space-y-4">
            <div className="space-y-1">
              <h3 className="font-bold text-slate-200 flex items-center gap-2 text-sm uppercase tracking-wider text-slate-400">
                <CloudLightning className="w-4 h-4 text-cyan-400" />
                WCA Live Synchronization
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Export and upload all locally verified scorecard results directly to WCA Live. This will patch results for all rounds in bulk.
              </p>
            </div>
            
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-900">
              <span className="text-[11px] font-semibold text-slate-500">
                {formatSyncTime(lastSynced)}
              </span>
              
              <button
                onClick={onPushWcif}
                disabled={isSyncing || !wcifExists}
                className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-gradient-premium hover:shadow-lg hover:shadow-cyan-500/15 text-white border border-cyan-500/30 transition-all duration-200 disabled:opacity-50 flex items-center gap-1.5 active:scale-[0.98]"
              >
                <CloudLightning className="w-3.5 h-3.5" />
                {isSyncing ? 'Syncing...' : 'Push to WCA Live'}
              </button>
            </div>
          </div>

          {/* Fetch Card */}
          <div className="glass-card p-6 rounded-2xl border border-slate-850 flex flex-col justify-between space-y-4">
            <div className="space-y-1">
              <h3 className="font-bold text-slate-200 flex items-center gap-2 text-sm uppercase tracking-wider text-slate-400">
                <RefreshCw className="w-4 h-4 text-amber-500" />
                Safe WCIF Re-fetch
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Download the latest competitor list, round advancements, and scheduling details from the WCA API. Note: This will overwrite un-synced local data.
              </p>
            </div>
            
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-900">
              <span className="text-[11px] font-semibold text-slate-500">
                WCIF Cached: {wcifExists ? 'Yes' : 'No'}
              </span>
              
              <button
                onClick={handleFetchClick}
                disabled={isSyncing}
                className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 text-amber-500 hover:text-amber-400 transition-all duration-200 disabled:opacity-50 flex items-center gap-1.5 active:scale-[0.98]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                Re-fetch WCIF
              </button>
            </div>
          </div>
        </div>

        {/* Event Progress Statistics */}
        <div className="space-y-4">
          <h2 className="text-lg font-black text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-cyan-400" />
            Event Entry Progress
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(localWcif.events || []).map((ev) => {
              const evName = eventNames[ev.id] || ev.id;
              
              return (
                <div key={ev.id} className="glass-card p-5 rounded-2xl border border-slate-850 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-200 text-sm">{evName}</h3>
                    <span className="text-[10px] font-mono font-bold text-slate-500 uppercase px-2 py-0.5 rounded bg-slate-950 border border-slate-900">
                      {ev.id}
                    </span>
                  </div>

                  <div className="space-y-3.5">
                    {ev.rounds.map((round) => {
                      const { entered, total } = getRoundProgress(round, ev.id);
                      const percent = total > 0 ? Math.round((entered / total) * 100) : 0;
                      const isComplete = entered === total && total > 0;
                      
                      return (
                        <div key={round.id} className="space-y-1.5 text-xs">
                          <div className="flex items-center justify-between text-slate-400">
                            <span className="font-semibold text-slate-300">
                              Round {round.id.split('-r')[1]}
                            </span>
                            <span className="font-mono flex items-center gap-1 font-bold">
                              {isComplete && <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                              <span className={isComplete ? 'text-emerald-400' : entered > 0 ? 'text-cyan-400' : 'text-slate-500'}>
                                {entered}
                              </span>
                              <span className="text-slate-600">/</span>
                              <span className="text-slate-400">{total}</span>
                              <span className="text-slate-500 text-[10px]">({percent}%)</span>
                            </span>
                          </div>

                          {/* Progress Bar */}
                          <div className="w-full h-1.5 rounded-full bg-slate-950 overflow-hidden border border-slate-900/50">
                            <div 
                              className={`h-full rounded-full transition-all duration-500 ${
                                isComplete 
                                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500' 
                                  : 'bg-gradient-to-r from-cyan-500 to-indigo-500'
                              }`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Severe Overwrite Warning Modal */}
      {showWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-slate-900 border-2 border-amber-500/50 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center gap-3 text-amber-500">
              <AlertOctagon className="w-8 h-8 animate-bounce" />
              <h3 className="text-xl font-bold tracking-tight text-white uppercase">
                Overwrite Warning!
              </h3>
            </div>
            
            <p className="text-sm text-slate-300 leading-relaxed">
              WARNING: Fetching the WCIF will overwrite any local results that have not been pushed to WCA Live. 
              Any scorecards verified locally but not pushed to the cloud will be permanently lost.
            </p>
            
            <div className="p-3.5 bg-amber-950/20 rounded-xl border border-amber-500/10 text-xs text-amber-300/90">
              Are you absolutely sure you want to proceed and fetch the latest WCIF?
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowWarningModal(false)}
                className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-300 font-semibold rounded-xl transition text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleFetchConfirm}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-600 hover:shadow-lg hover:shadow-amber-500/20 text-white font-semibold rounded-xl transition text-xs active:scale-[0.98]"
              >
                Yes, Overwrite & Fetch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
