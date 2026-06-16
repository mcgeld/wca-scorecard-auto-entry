import React, { useState, useEffect } from 'react';
import { Search, Trophy, Calendar, MapPin, Loader, ShieldAlert, LogIn } from 'lucide-react';

export default function CompetitionSetup({ onSelectCompetition, wcaToken, wcaClientId, userProfile }) {
  const [competitions, setCompetitions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const BACKEND_URL = 'http://localhost:5000';

  const fetchCompetitions = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/competitions`, {
        headers: {
          ...(wcaToken ? { 'Authorization': `Bearer ${wcaToken}` } : {})
        }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch competitions.');
      }
      setCompetitions(data);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompetitions();
  }, [wcaToken]);

  const handleWcaLogin = () => {
    if (!wcaClientId) {
      alert('WCA Client ID is not configured on the backend. Please add WCA_CLIENT_ID to your .env file and restart the server.');
      return;
    }
    const redirectUri = encodeURIComponent('http://localhost:5173/oauth-callback');
    const scope = encodeURIComponent('public manage_competitions');
    const authUrl = `https://www.worldcubeassociation.org/oauth/authorize?client_id=${wcaClientId}&redirect_uri=${redirectUri}&response_type=token&scope=${scope}`;
    window.location.href = authUrl;
  };

  const filteredCompetitions = competitions.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.city.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-950 overflow-y-auto w-full h-full">
      <div className="max-w-4xl w-full space-y-8 my-auto animate-fade-in">
        <div className="text-center space-y-3">
          <div className="inline-flex bg-gradient-premium p-3 rounded-2xl text-white shadow-xl shadow-cyan-500/10 mb-2">
            <Trophy className="w-8 h-8 animate-pulse-subtle" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
            Select WCA <span className="text-gradient font-extrabold">Competition</span>
          </h1>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Choose a competition to load its schedule, competitor list, and begin entering scorecards.
          </p>
        </div>

        {/* Authentication Warning */}
        {!wcaToken && (
          <div className="glass border-amber-500/20 bg-amber-500/5 p-6 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 max-w-2xl mx-auto shadow-lg">
            <div className="flex items-center gap-3 text-amber-400">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <div className="text-left">
                <h4 className="text-sm font-bold">WCA Sign-In Required</h4>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Sign in with your WCA account to retrieve your upcoming managed competitions.
                </p>
              </div>
            </div>
            <button
              onClick={handleWcaLogin}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-gradient-premium hover:shadow-lg hover:shadow-cyan-500/15 text-white border border-cyan-500/30 transition-all duration-200 shrink-0"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign in with WCA
            </button>
          </div>
        )}

        {/* Main Interface */}
        {(wcaToken || competitions.length > 0) && (
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative max-w-md mx-auto">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search competitions by name, ID, or city..."
                className="w-full pl-10 pr-4 py-3 bg-slate-900/60 border border-slate-800 text-slate-200 rounded-xl outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/5 placeholder-slate-500 text-sm font-medium transition-all"
              />
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
                <Loader className="w-8 h-8 text-cyan-500 animate-spin" />
                <span className="text-xs font-medium">Loading competitions...</span>
              </div>
            ) : error ? (
              <div className="glass border-red-500/20 bg-red-500/5 p-6 rounded-2xl text-center max-w-md mx-auto space-y-3">
                <ShieldAlert className="w-8 h-8 text-red-500 mx-auto" />
                <h4 className="text-sm font-bold text-red-400">Failed to Load Competitions</h4>
                <p className="text-xs text-slate-400 leading-relaxed">{error}</p>
                <button
                  onClick={fetchCompetitions}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all"
                >
                  Retry Fetch
                </button>
              </div>
            ) : filteredCompetitions.length === 0 ? (
              <div className="text-center py-16 text-slate-500 border border-dashed border-slate-850 rounded-2xl">
                <Calendar className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                <h4 className="text-sm font-bold text-slate-400">No Competitions Found</h4>
                <p className="text-xs text-slate-500 mt-1">
                  {searchQuery ? 'Try adjusting your search terms.' : 'You are not registered as an organizer or delegate for any upcoming competitions.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[50vh] overflow-y-auto pr-1">
                {filteredCompetitions.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onSelectCompetition(c.id)}
                    className="glass-card flex flex-col p-5 rounded-2xl text-left border border-slate-855 hover:border-cyan-500/30 transition-all group relative overflow-hidden"
                  >
                    {/* Hover Glow Effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 to-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                    
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between">
                        <span className="text-[10px] font-mono font-bold text-slate-500 group-hover:text-cyan-400 transition-colors uppercase">
                          {c.id}
                        </span>
                      </div>
                      
                      <h3 className="font-bold text-slate-200 group-hover:text-white transition-colors text-sm line-clamp-1">
                        {c.name}
                      </h3>

                      <div className="space-y-1.5 pt-1 text-[11px] text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span>{c.start_date === c.end_date ? c.start_date : `${c.start_date} to ${c.end_date}`}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="truncate">{c.city}, {c.venue}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-850 flex items-center justify-between w-full">
                      <span className="text-[10px] text-slate-500">
                        {c.event_ids ? `${c.event_ids.length} Events` : ''}
                      </span>
                      <span className="text-[10px] font-bold text-cyan-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all flex items-center gap-0.5">
                        Select Competition <ArrowRight className="w-3 h-3 text-cyan-400" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Inline ArrowRight component if not imported
function ArrowRight(props) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2.5" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      {...props}
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
