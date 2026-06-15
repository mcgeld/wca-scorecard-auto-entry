import React, { useState } from 'react';
import { Search, Filter, ShieldAlert, Eye, X, ZoomIn, ZoomOut, Check, FileText } from 'lucide-react';

const BACKEND_URL = 'http://localhost:5000';
const EVENT_NAMES = {
  '333': '3x3x3 Cube',
  '222': '2x2x2 Cube',
  '444': '4x4x4 Cube',
  '555': '5x5x5 Cube',
  '333oh': '3x3x3 One-Handed',
  'pyra': 'Pyraminx',
  'skewb': 'Skewb',
  'clock': 'Clock',
  'minx': 'Megaminx'
};

function getEventName(eventId) {
  return EVENT_NAMES[eventId] || eventId;
}

export default function ResultsArchive({ archiveCards }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'submitted', 'skipped_for_manual'
  const [eventFilter, setEventFilter] = useState('all');
  const [selectedCard, setSelectedCard] = useState(null);
  const [activeSide, setActiveSide] = useState('front');
  const [imageZoom, setImageZoom] = useState(1);

  // Filter cards
  const filteredCards = archiveCards.filter(card => {
    // 1. Search Query Match
    const matchesSearch = 
      card.competitorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(card.competitorId).toLowerCase().includes(searchQuery.toLowerCase());
    
    // 2. Status Filter Match
    const matchesStatus = statusFilter === 'all' || card.status === statusFilter;
    
    // 3. Event Filter Match
    const matchesEvent = eventFilter === 'all' || card.eventId === eventFilter;

    return matchesSearch && matchesStatus && matchesEvent;
  });

  // Get list of unique events for event filter dropdown
  const uniqueEvents = Array.from(new Set(archiveCards.map(c => c.eventId))).filter(Boolean);

  const handleRowClick = (card) => {
    setSelectedCard(card);
    setActiveSide('front');
    setImageZoom(1);
  };

  const handleClosePanel = () => {
    setSelectedCard(null);
  };

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-slate-950 relative">
      <div className="flex-1 flex flex-col overflow-hidden p-6 space-y-6">
        {/* Filters and Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between shrink-0">
          <div>
            <h2 className="text-xl font-bold text-white">Results Archive</h2>
            <p className="text-xs text-slate-400 mt-0.5">Audit log of all entered and skipped scorecards</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search competitor..."
                className="input-premium pl-9 w-60 py-1.5 text-sm"
              />
            </div>

            {/* Event Filter */}
            <select
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              className="input-premium py-1.5 text-sm"
            >
              <option value="all">All Events</option>
              {uniqueEvents.map(ev => (
                <option key={ev} value={ev}>{getEventName(ev)}</option>
              ))}
            </select>

            {/* Status Tabs */}
            <div className="flex rounded-lg bg-slate-900/80 p-0.5 border border-slate-800 text-xs font-semibold">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  statusFilter === 'all' ? 'bg-slate-800 text-cyan-400 border border-slate-700/50' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setStatusFilter('submitted')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  statusFilter === 'submitted' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Submitted
              </button>
              <button
                onClick={() => setStatusFilter('skipped_for_manual')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  statusFilter === 'skipped_for_manual' ? 'bg-slate-700/50 text-slate-300 border border-slate-800' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Skipped
              </button>
            </div>
          </div>
        </div>

        {/* Database Table View */}
        <div className="flex-1 overflow-auto rounded-2xl border border-slate-800/80 glass shadow-xl">
          {filteredCards.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-slate-500">
              <FileText className="w-12 h-12 mb-3 text-slate-700" />
              <p className="text-sm font-semibold">No records found</p>
              <p className="text-xs text-slate-600 mt-1">There are no scorecards in the archive matching these filters</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-900/25 text-xs font-bold text-slate-400 uppercase tracking-wider">
                  <th className="p-4 pl-6">Competitor</th>
                  <th className="p-4">Event</th>
                  <th className="p-4">Round</th>
                  <th className="p-4">Group</th>
                  <th className="p-4 text-center">Attempts</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Scanned At</th>
                  <th className="p-4 pr-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-sm">
                {filteredCards.map(card => {
                  const isSubmitted = card.status === 'submitted';
                  
                  return (
                    <tr
                      key={card.id}
                      onClick={() => handleRowClick(card)}
                      className="hover:bg-slate-900/35 transition-colors cursor-pointer group"
                    >
                      <td className="p-4 pl-6">
                        <div className="font-semibold text-slate-200 group-hover:text-cyan-400 transition-colors">
                          {card.competitorName}
                        </div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">
                          ID: {card.competitorId}
                        </div>
                      </td>
                      <td className="p-4 font-medium text-slate-300">
                        {getEventName(card.eventId)}
                      </td>
                      <td className="p-4 text-slate-400 font-semibold">{card.roundNumber}</td>
                      <td className="p-4 text-slate-400 font-semibold">{card.groupNumber}</td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-1.5 font-mono text-xs">
                          {card.solves.map((s, idx) => (
                            <span
                              key={idx}
                              className={`px-2 py-0.5 rounded border ${
                                s.finalValue === 'DNF'
                                  ? 'bg-red-500/10 border-red-500/20 text-red-400'
                                  : s.finalValue === 'DNS'
                                  ? 'bg-slate-800 border-slate-700 text-slate-400'
                                  : s.isManuallyEdited
                                  ? 'bg-amber-500/5 border-amber-500/20 text-amber-300'
                                  : 'bg-slate-900 border-slate-800 text-slate-300'
                              }`}
                            >
                              {s.finalValue}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-4">
                        {isSubmitted ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <Check className="w-3 h-3" />
                            Submitted
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700">
                            Manual / Skipped
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-xs text-slate-500">
                        {new Date(card.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
                        {new Date(card.scannedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="p-4 pr-6 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRowClick(card);
                          }}
                          className="p-1.5 bg-slate-900 border border-slate-800 text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 rounded-lg transition-all"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Slide-out Panel from the Right */}
      {selectedCard && (
        <div 
          className="absolute top-0 right-0 h-full w-[500px] glass border-l border-slate-800/80 shadow-2xl flex flex-col z-20 animate-slide-in-right"
        >
          {/* Header */}
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/40">
            <div>
              <h3 className="font-bold text-white text-base">Audit Scan Details</h3>
              <p className="text-xs text-slate-500 font-mono truncate max-w-[380px] mt-0.5">
                File: {selectedCard.filename}
              </p>
            </div>
            <button
              onClick={handleClosePanel}
              className="p-1.5 rounded-lg hover:bg-slate-800/80 text-slate-400 hover:text-slate-200 transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Competitor Profile */}
            <div className="bg-slate-900/35 border border-slate-800/60 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Competitor Info</span>
                {selectedCard.status === 'submitted' ? (
                  <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    WCA Submitted
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">
                    Skipped / Manual
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <div className="text-slate-500">Name:</div>
                <div className="font-semibold text-slate-200 text-right">{selectedCard.competitorName}</div>
                
                <div className="text-slate-500">Competitor ID:</div>
                <div className="font-mono text-slate-300 text-right">{selectedCard.competitorId}</div>
                
                <div className="text-slate-500">Event / Round:</div>
                <div className="font-semibold text-slate-300 text-right">
                  {getEventName(selectedCard.eventId)} (Round {selectedCard.roundNumber})
                </div>

                <div className="text-slate-500">Group:</div>
                <div className="font-semibold text-slate-300 text-right">Group {selectedCard.groupNumber}</div>
              </div>
            </div>

            {/* Results Table */}
            <div className="space-y-3">
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block">Solves Audit Log</span>
              <div className="grid grid-cols-5 gap-2 font-mono text-center">
                {selectedCard.solves.map((s, idx) => (
                  <div key={idx} className="bg-slate-900/60 border border-slate-850 p-2.5 rounded-xl flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500 font-sans font-bold">#{idx + 1}</span>
                    <span className={`text-sm font-bold ${
                      s.finalValue === 'DNF' ? 'text-red-400' : s.finalValue === 'DNS' ? 'text-slate-500' : 'text-cyan-400'
                    }`}>
                      {s.finalValue}
                    </span>
                    <span className="text-[8px] text-slate-600 block opacity-85">
                      OCR: {s.ocrValue}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Scan Image Audit */}
            <div className="space-y-3 flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Scanned Image</span>
                
                {selectedCard.backFilepath && (
                  <div className="flex rounded-md bg-slate-950 p-0.5 border border-slate-800 text-[10px] font-semibold">
                    <button
                      onClick={() => setActiveSide('front')}
                      className={`px-2 py-1 rounded transition-all ${
                        activeSide === 'front' ? 'bg-cyan-500/10 text-cyan-400' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Front
                    </button>
                    <button
                      onClick={() => setActiveSide('back')}
                      className={`px-2 py-1 rounded transition-all ${
                        activeSide === 'back' ? 'bg-amber-500/10 text-amber-400' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Back
                    </button>
                  </div>
                )}
              </div>

              {/* Image viewport inside audit panel */}
              <div className="border border-slate-850 rounded-2xl overflow-hidden bg-slate-950 flex flex-col relative h-[320px]">
                <div className="absolute right-3 top-3 bg-slate-950/80 border border-slate-800 rounded-lg p-0.5 flex z-10">
                  <button
                    onClick={() => setImageZoom(z => Math.max(0.5, z - 0.25))}
                    className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-200"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setImageZoom(z => Math.min(3, z + 0.25))}
                    className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-200"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
                  <img
                    src={activeSide === 'front' ? `${BACKEND_URL}${selectedCard.filepath}` : `${BACKEND_URL}${selectedCard.backFilepath}`}
                    alt="Audit scan"
                    style={{ transform: `scale(${imageZoom})`, transformOrigin: 'center center' }}
                    className="max-h-full object-contain rounded-lg transition-transform duration-100"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
