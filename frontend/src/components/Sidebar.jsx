import React, { useState } from 'react';
import { ChevronDown, ChevronRight, AlertCircle, RefreshCw, CheckCircle2, Inbox } from 'lucide-react';

const EVENT_NAMES = {
  '333': '3x3x3 Cube',
  '222': '2x2x2 Cube',
  '444': '4x4x4 Cube',
  '555': '5x5x5 Cube',
  '333oh': '3x3x3 One-Handed',
  'pyra': 'Pyraminx',
  'skewb': 'Skewb',
  'clock': 'Rubik\'s Clock',
  'minx': 'Megaminx',
  'sq1': 'Square-1',
  '333bf': '3x3x3 Blindfolded'
};

function getEventName(eventId) {
  return EVENT_NAMES[eventId] || eventId;
}

export default function Sidebar({ pendingCards, selectedCardId, onSelectCard }) {
  const [expandedGroups, setExpandedGroups] = useState({});

  const toggleGroup = (key) => {
    setExpandedGroups(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // Grouping logic: Event -> Round -> Group
  const groups = {};

  pendingCards.forEach(card => {
    const eId = card.eventId || 'Unknown Event';
    const rNum = card.roundNumber || 1;
    const gNum = card.groupNumber || 1;

    if (!groups[eId]) groups[eId] = {};
    if (!groups[eId][rNum]) groups[eId][rNum] = {};
    if (!groups[eId][rNum][gNum]) groups[eId][rNum][gNum] = [];

    groups[eId][rNum][gNum].push(card);
  });

  const hasPending = pendingCards.length > 0;

  return (
    <aside className="w-80 glass border-r border-slate-800/80 flex flex-col shrink-0">
      <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
          Review Queue
        </h2>
        <span className="bg-slate-800 text-slate-300 text-xs px-2.5 py-0.5 rounded-full font-bold">
          {pendingCards.length} Cards
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {!hasPending ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-slate-500">
            <Inbox className="w-10 h-10 mb-3 text-slate-600" />
            <p className="text-sm font-medium">Queue is Empty</p>
            <p className="text-xs text-slate-600 mt-1">
              Drop scanned scorecards in scans/input directory
            </p>
          </div>
        ) : (
          Object.keys(groups).map(eventId => {
            const eventName = getEventName(eventId);
            const rounds = groups[eventId];

            return (
              <div key={eventId} className="space-y-1">
                {/* Event Level Header */}
                <div className="px-2 py-1 text-xs font-bold text-cyan-400/90 uppercase tracking-wide">
                  {eventName}
                </div>

                {Object.keys(rounds).map(roundNumber => {
                  const roundKey = `${eventId}-r${roundNumber}`;
                  const roundExpanded = expandedGroups[roundKey] !== false; // Default expanded
                  const groupsInRound = rounds[roundNumber];

                  return (
                    <div key={roundNumber} className="pl-2 space-y-1">
                      <button
                        onClick={() => toggleGroup(roundKey)}
                        className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
                      >
                        {roundExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        Round {roundNumber}
                      </button>

                      {roundExpanded && (
                        <div className="pl-2 space-y-2">
                          {Object.keys(groupsInRound).map(groupNumber => {
                            const groupKey = `${roundKey}-g${groupNumber}`;
                            const groupExpanded = expandedGroups[groupKey] !== false; // Default expanded
                            const cards = groupsInRound[groupNumber];

                            return (
                              <div key={groupNumber} className="space-y-1">
                                <button
                                  onClick={() => toggleGroup(groupKey)}
                                  className="w-full flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
                                >
                                  {groupExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                  Group {groupNumber}
                                </button>

                                {groupExpanded && (
                                  <div className="space-y-1 pl-1">
                                    {cards.map(card => {
                                      const isSelected = selectedCardId === card.id;
                                      
                                      // Determine if card contains low-confidence reads
                                      const hasLowConfidence = card.solves.some(
                                        s => s.confidence < 0.85
                                      );

                                      return (
                                        <button
                                          key={card.id}
                                          onClick={() => onSelectCard(card.id)}
                                          className={`w-full text-left p-2.5 rounded-xl transition-all duration-200 flex flex-col gap-1 border ${
                                            isSelected
                                              ? 'bg-cyan-500/10 border-cyan-500/50 shadow-md shadow-cyan-500/5'
                                              : 'bg-slate-900/30 hover:bg-slate-900/60 border-slate-800/40'
                                          }`}
                                        >
                                          <div className="flex items-start justify-between w-full">
                                            <span className={`font-semibold text-sm truncate ${
                                              isSelected ? 'text-cyan-400' : 'text-slate-200'
                                            }`}>
                                              {card.competitorName || 'Extracting...'}
                                            </span>
                                            
                                            {/* Status Indicators */}
                                            {card.status === 'pending_ocr' ? (
                                              <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0 mt-0.5" />
                                            ) : hasLowConfidence ? (
                                              <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" title="Review low-confidence fields" />
                                            ) : (
                                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" title="Ready to submit" />
                                            )}
                                          </div>

                                          <div className="flex items-center justify-between text-[11px] text-slate-500">
                                            <span>
                                              ID: {card.competitorId || 'Pending'}
                                            </span>
                                            <span className="opacity-80 truncate max-w-[120px]">
                                              {card.filename}
                                            </span>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
