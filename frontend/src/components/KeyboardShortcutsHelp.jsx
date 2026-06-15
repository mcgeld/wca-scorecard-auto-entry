import React from 'react';
import { X, Keyboard, ArrowRight, CornerDownLeft, Space } from 'lucide-react';

export default function KeyboardShortcutsHelp({ isOpen, onClose }) {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'Tab', desc: 'Focus next input field' },
    { key: 'Shift + Tab', desc: 'Focus previous input field' },
    { key: 'S', desc: 'Instantly fill "DNS" (Did Not Start) in solve input' },
    { key: 'F / D', desc: 'Instantly fill "DNF" (Did Not Finish) in solve input' },
    { key: 'Escape', desc: 'Skip current scorecard and mark as skipped' },
    { key: 'Enter', desc: 'Submit scorecard to WCA Live (when in final field)' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
      <div className="w-full max-w-md glass rounded-2xl border border-slate-800 shadow-2xl overflow-hidden animate-pulse-subtle" style={{ animationIterationCount: 1, animationDuration: '0.2s' }}>
        {/* Header */}
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/30">
          <div className="flex items-center gap-2 text-cyan-400">
            <Keyboard className="w-5 h-5" />
            <h3 className="font-bold text-white text-base">Rapid Data Entry Guide</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-800/80 text-slate-400 hover:text-slate-200 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-400 leading-relaxed">
            The data entry workflow is optimized for speed and typists. You can complete verification and submissions entirely without using a mouse.
          </p>

          <div className="space-y-3.5">
            {shortcuts.map((s, idx) => (
              <div key={idx} className="flex items-center justify-between gap-4 py-1.5 border-b border-slate-900 last:border-b-0">
                <span className="text-xs font-semibold text-slate-300">{s.desc}</span>
                <span className="px-2 py-1 bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-[10px] font-bold shadow-inner shrink-0">
                  {s.key}
                </span>
              </div>
            ))}
          </div>

          {/* Quick Tip */}
          <div className="mt-2 p-3 bg-cyan-950/30 border border-cyan-800/20 rounded-xl text-xs text-cyan-400/90 leading-relaxed">
            <strong>Time Formatting Tip:</strong> Just type the raw digits without decimals or colons. E.g., type <code className="bg-slate-950 px-1 py-0.5 rounded text-[10px] border border-slate-900 text-cyan-200 font-mono">10532</code> which auto-formats to <code className="text-white font-bold font-mono">1:05.32</code>. Type <code className="bg-slate-950 px-1 py-0.5 rounded text-[10px] border border-slate-900 text-cyan-200 font-mono">532</code> for <code className="text-white font-bold font-mono">5.32</code>.
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-900/40 border-t border-slate-800/80 text-right">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gradient-premium hover:shadow-lg text-white font-semibold rounded-lg text-xs transition-all active:scale-[0.98]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
