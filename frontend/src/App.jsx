import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { ShieldAlert, AlertCircle, X, Check } from 'lucide-react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ReviewInterface from './components/ReviewInterface';
import ResultsArchive from './components/ResultsArchive';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp';

const BACKEND_URL = 'http://localhost:5000';

export default function App() {
  const [scorecards, setScorecards] = useState([]);
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [activeTab, setActiveTab] = useState('review');
  const [socketConnected, setSocketConnected] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorToast, setErrorToast] = useState(null);
  const [successToast, setSuccessToast] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  
  // WCA Session states
  const [wcaClientId, setWcaClientId] = useState(null);
  const [wcaToken, setWcaToken] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [inputCount, setInputCount] = useState(0);
  
  const socketRef = useRef(null);

  // Fetch scorecards from backend API
  const fetchScorecards = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/scorecards`);
      const data = await res.json();
      setScorecards(data);

      // Also fetch the count of scorecards in input directory
      const countRes = await fetch(`${BACKEND_URL}/api/input-count`);
      if (countRes.ok) {
        const countData = await countRes.json();
        setInputCount(countData.count || 0);
      }
    } catch (err) {
      console.error('Error fetching scorecards:', err);
    }
  };

  // Fetch configuration parameters from backend
  const fetchConfig = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/config`);
      const data = await res.json();
      setWcaClientId(data.wcaClientId);
    } catch (err) {
      console.error('Error fetching config:', err);
    }
  };

  // Connect to Socket.io backend and load config/OAuth callback
  useEffect(() => {
    fetchScorecards();
    fetchConfig();

    // 1. Detect OAuth Callback hash in URL
    const hash = window.location.hash;
    if (window.location.pathname === '/oauth-callback' && hash) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get('access_token');
      if (token) {
        localStorage.setItem('wca_access_token', token);
        // Clear hash and go to home route
        window.history.replaceState({}, document.title, '/');
      }
    }

    // 2. Load cached WCA session token
    const token = localStorage.getItem('wca_access_token');
    if (token) {
      setWcaToken(token);
      
      // Sync token with backend for background auto-submissions
      fetch(`${BACKEND_URL}/api/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      }).catch(err => console.error('Failed to sync session token with backend:', err));

      // Fetch user details from WCA API
      fetch('https://www.worldcubeassociation.org/api/v0/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => {
          if (!res.ok) throw new Error('Token expired');
          return res.json();
        })
        .then(data => {
          setUserProfile(data.me);
        })
        .catch(err => {
          console.warn('WCA session invalid or expired:', err.message);
          localStorage.removeItem('wca_access_token');
          setWcaToken(null);
          setUserProfile(null);
        });
    }

    socketRef.current = io(BACKEND_URL);

    socketRef.current.on('connect', () => {
      setSocketConnected(true);
      console.log('Socket.io connected to backend');
    });

    socketRef.current.on('disconnect', () => {
      setSocketConnected(false);
    });

    // Listening for live database updates
    socketRef.current.on('db_updated', () => {
      console.log('Database updated, refetching...');
      fetchScorecards();
    });

    // Listening for WCA Token expiration
    socketRef.current.on('wca_token_expired', () => {
      console.warn('WCA session token expired!');
      triggerErrorToast('WCA API Error: Session Token Expired. Please sign in to WCA Live, copy a new token, and update your settings.');
      localStorage.removeItem('wca_access_token');
      setWcaToken(null);
      setUserProfile(null);
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  // Handle Logout
  const handleSignOut = async () => {
    localStorage.removeItem('wca_access_token');
    setWcaToken(null);
    setUserProfile(null);
    try {
      await fetch(`${BACKEND_URL}/api/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: null })
      });
      triggerSuccessToast('Successfully signed out.');
    } catch (err) {
      console.error(err);
    }
  };

  // Compute pending queue vs archive lists
  const pendingCards = scorecards.filter(c => c.status === 'review_needed');
  const archiveCards = scorecards.filter(c => c.status === 'submitted' || c.status === 'skipped_for_manual');
  const pendingOcrCount = scorecards.filter(c => c.status === 'pending_ocr').length;
  const totalProcessingCount = pendingOcrCount + inputCount;

  // Auto-select the first pending scorecard when the queue changes and nothing is selected
  useEffect(() => {
    if (pendingCards.length > 0) {
      const isStillInQueue = pendingCards.some(c => c.id === selectedCardId);
      if (!selectedCardId || !isStillInQueue) {
        // Find the first card that finished OCR, or just the first card
        const nextCard = pendingCards.find(c => c.status === 'review_needed') || pendingCards[0];
        setSelectedCardId(nextCard.id);
      }
    } else {
      setSelectedCardId(null);
    }
  }, [scorecards, selectedCardId]);

  // Global keyboard shortcuts (Escape to skip)
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape' && activeTab === 'review' && selectedCardId) {
        // If focus is in an input, verify it's not currently saving/submitting
        e.preventDefault();
        
        // Find current card status to make sure we don't skip an already processing card
        const currentCard = pendingCards.find(c => c.id === selectedCardId);
        if (currentCard && currentCard.status === 'review_needed') {
          console.log('[Shortcuts] Escape key pressed: skipping card', selectedCardId);
          handleSkipCard(selectedCardId);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeTab, selectedCardId, pendingCards]);

  // Update scorecard changes in backend
  const handleUpdateCard = async (id, updates) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/scorecards/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!res.ok) throw new Error('Failed to update scorecard');
    } catch (err) {
      console.error(err);
      triggerErrorToast('Failed to save manual edits');
    }
  };

  // Skip scorecard
  const handleSkipCard = async (id) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/scorecards/${id}/skip`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Failed to skip scorecard');
      
      triggerSuccessToast('Scorecard marked as skipped for manual entry.');
    } catch (err) {
      console.error(err);
      triggerErrorToast('Failed to skip scorecard');
    }
  };

  // Submit scorecard to WCA Live
  const handleSubmitCard = async (id, data) => {
    setIsSubmitting(true);
    setErrorToast(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/scorecards/${id}/submit`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(wcaToken ? { 'Authorization': `Bearer ${wcaToken}` } : {})
        },
        body: JSON.stringify(data)
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'WCA Live API submission failed.');
      }

      triggerSuccessToast('Result successfully entered to WCA Live!');
      
      // Auto-load next pending card
      const nextPending = pendingCards.filter(c => c.id !== id);
      if (nextPending.length > 0) {
        setSelectedCardId(nextPending[0].id);
      } else {
        setSelectedCardId(null);
      }

    } catch (err) {
      console.error(err);
      triggerErrorToast(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show transient toasts
  const triggerErrorToast = (message) => {
    setErrorToast(message);
    setTimeout(() => {
      setErrorToast(null);
    }, 8000);
  };

  const triggerSuccessToast = (message) => {
    setSuccessToast(message);
    setTimeout(() => {
      setSuccessToast(null);
    }, 4000);
  };

  const activeCard = pendingCards.find(c => c.id === selectedCardId);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-950">
      {totalProcessingCount > 0 && (
        <div className="bg-gradient-to-r from-cyan-950 via-indigo-950 to-cyan-950 border-b border-cyan-800/40 px-4 py-2 flex items-center justify-center gap-2 text-xs font-semibold text-cyan-200 shadow-md shrink-0">
          <div className="w-3.5 h-3.5 border-2 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin" />
          <span>Processing {totalProcessingCount} new scorecard{totalProcessingCount > 1 ? 's' : ''}...</span>
        </div>
      )}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        socketConnected={socketConnected}
        pendingCount={pendingCards.length}
        onShowShortcuts={() => setShowShortcuts(true)}
        wcaClientId={wcaClientId}
        userProfile={userProfile}
        onSignOut={handleSignOut}
      />

      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'review' ? (
          <>
            <Sidebar
              pendingCards={pendingCards}
              selectedCardId={selectedCardId}
              onSelectCard={setSelectedCardId}
            />
            
            <ReviewInterface
              card={activeCard}
              onUpdateCard={handleUpdateCard}
              onSkipCard={handleSkipCard}
              onSubmitCard={handleSubmitCard}
              isSubmitting={isSubmitting}
            />
          </>
        ) : (
          <ResultsArchive archiveCards={archiveCards} />
        )}
      </div>

      {/* Floating Error Toast */}
      {errorToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md bg-red-950/85 border border-red-800 text-red-100 p-4 rounded-2xl shadow-2xl backdrop-blur flex items-start gap-3 animate-pulse-subtle">
          <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h5 className="font-bold text-sm text-red-400">
              {errorToast.startsWith('WCA API Error') ? 'Authentication Error' : 'Submission Failed'}
            </h5>
            <p className="text-xs text-red-200 mt-1 leading-relaxed">{errorToast}</p>
          </div>
          <button 
            onClick={() => setErrorToast(null)}
            className="p-1 rounded-lg hover:bg-red-900/40 text-red-400 hover:text-red-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Floating Success Toast */}
      {successToast && (
        <div className="fixed bottom-6 left-6 z-50 max-w-sm bg-emerald-950/85 border border-emerald-850 text-emerald-100 p-4 rounded-2xl shadow-2xl backdrop-blur flex items-center gap-3">
          <div className="bg-emerald-500/20 p-1 rounded-full text-emerald-400 border border-emerald-500/20">
            <Check className="w-4 h-4" />
          </div>
          <span className="text-xs font-semibold">{successToast}</span>
          <button 
            onClick={() => setSuccessToast(null)}
            className="ml-auto p-1 rounded-lg hover:bg-emerald-900/40 text-emerald-400 hover:text-emerald-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Shortcuts Guide Overlay */}
      <KeyboardShortcutsHelp
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </div>
  );
}
