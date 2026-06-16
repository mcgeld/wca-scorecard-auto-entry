import { Layers, Database, Keyboard, LogOut, Trophy, BarChart3 } from 'lucide-react';

export default function Header({ 
  activeTab, 
  setActiveTab, 
  socketConnected, 
  pendingCount, 
  onShowShortcuts, 
  wcaClientId, 
  userProfile, 
  onSignOut,
  activeCompetitionName,
  onSwitchCompetition
}) {
  
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

  return (
    <header className="glass border-b border-slate-800/80 px-6 py-4 flex items-center justify-between z-10 shrink-0">
      <div className="flex items-center gap-3">
        <div className="bg-gradient-premium p-2 rounded-xl text-white shadow-lg shadow-cyan-500/10">
          <Layers className="w-6 h-6 animate-pulse-subtle" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            WCA Scorecard <span className="text-gradient font-extrabold">Auto-Entry</span>
          </h1>
          <p className="text-xs text-slate-400">Local Speedcubing Data Assistant</p>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="flex items-center gap-2 bg-slate-900/60 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === 'dashboard'
              ? 'bg-gradient-premium text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          Dashboard
        </button>

        <button
          onClick={() => setActiveTab('review')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === 'review'
              ? 'bg-gradient-premium text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <Database className="w-4 h-4" />
          Review Queue
          {pendingCount > 0 && (
            <span className={`ml-1 px-1.5 py-0.5 text-xs rounded-full font-bold ${
              activeTab === 'review' ? 'bg-white/25 text-white' : 'bg-cyan-500/20 text-cyan-400'
            }`}>
              {pendingCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('archive')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === 'archive'
              ? 'bg-gradient-premium text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <Database className="w-4 h-4" />
          Results Archive
        </button>
      </div>

      {/* System Status and Auth Info */}
      <div className="flex items-center gap-4">
        {/* Active Competition Badge */}
        {activeCompetitionName && (
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/40 border border-slate-800/80 shadow-inner">
            <Trophy className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-xs font-bold text-slate-300 max-w-[150px] truncate" title={activeCompetitionName}>
              {activeCompetitionName}
            </span>
            <button
              onClick={onSwitchCompetition}
              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-950 hover:bg-slate-800 border border-slate-850 text-slate-450 hover:text-slate-200 font-semibold transition-all ml-1"
            >
              Switch
            </button>
          </div>
        )}

        {/* Auth Section */}
        {userProfile ? (
          <div className="flex items-center gap-3 bg-slate-900/40 pl-3 pr-2 py-1.5 rounded-xl border border-slate-800/80 shadow-inner">
            <div className="flex items-center gap-2">
              {userProfile.avatar?.thumbUrl || userProfile.avatar?.url ? (
                <img
                  src={userProfile.avatar.thumbUrl || userProfile.avatar.url}
                  alt={userProfile.name}
                  className="w-6 h-6 rounded-full border border-cyan-500/30 object-cover"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 font-bold text-xs flex items-center justify-center border border-cyan-500/20">
                  {userProfile.name ? userProfile.name[0].toUpperCase() : 'U'}
                </div>
              )}
              <span className="text-xs font-semibold text-slate-200 max-w-[100px] truncate">
                {userProfile.name}
              </span>
            </div>
            <button
              onClick={onSignOut}
              className="p-1 text-slate-400 hover:text-red-400 bg-slate-950 hover:bg-red-500/10 border border-slate-850 hover:border-red-500/25 rounded-lg transition-all"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleWcaLogin}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-gradient-premium hover:shadow-lg hover:shadow-cyan-500/15 text-white border border-cyan-500/30 transition-all duration-200"
          >
            Sign in with WCA
          </button>
        )}

        <button
          onClick={onShowShortcuts}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900/80 border border-slate-800 text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 transition-all duration-200"
        >
          <Keyboard className="w-3.5 h-3.5" />
          Shortcuts (?)
        </button>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-900">
          <span className={`w-2.5 h-2.5 rounded-full ${socketConnected ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50' : 'bg-red-500 shadow-lg shadow-red-500/50 animate-ping'}`} />
          <span className="text-xs font-semibold text-slate-400">
            {socketConnected ? 'Server Connected' : 'Connecting Server...'}
          </span>
        </div>
      </div>
    </header>
  );
}
