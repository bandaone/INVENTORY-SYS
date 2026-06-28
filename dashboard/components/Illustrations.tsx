export function DashboardIllustration() {
  return (
    <svg viewBox="0 0 400 300" className="w-full h-auto mt-8 opacity-90 drop-shadow-2xl transition-transform hover:scale-105 duration-500" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background Frame */}
      <rect x="20" y="40" width="360" height="240" rx="16" fill="#16181d" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="2" />
      <rect x="20" y="40" width="360" height="40" rx="16" fill="#1a1d24" />
      {/* Mac Dots */}
      <circle cx="45" cy="60" r="4" fill="#ef4444" opacity="0.8" />
      <circle cx="60" cy="60" r="4" fill="#eab308" opacity="0.8" />
      <circle cx="75" cy="60" r="4" fill="#22c55e" opacity="0.8" />
      
      {/* Sidebar */}
      <rect x="20" y="80" width="80" height="200" fill="#0f1115" />
      <rect x="35" y="100" width="50" height="6" rx="3" fill="#ffffff" opacity="0.1" />
      <rect x="35" y="120" width="40" height="6" rx="3" fill="#ffffff" opacity="0.1" />
      <rect x="35" y="140" width="45" height="6" rx="3" fill="#10b981" opacity="0.8" />
      <rect x="35" y="160" width="35" height="6" rx="3" fill="#ffffff" opacity="0.1" />
      
      {/* Main Content Area */}
      {/* Metric Cards */}
      <rect x="120" y="100" width="110" height="60" rx="8" fill="#1e222b" />
      <rect x="135" y="115" width="20" height="20" rx="4" fill="#10b981" opacity="0.2" />
      <rect x="135" y="145" width="40" height="4" rx="2" fill="#ffffff" opacity="0.6" />
      
      <rect x="245" y="100" width="110" height="60" rx="8" fill="#1e222b" />
      <rect x="260" y="115" width="20" height="20" rx="4" fill="#6366f1" opacity="0.2" />
      <rect x="260" y="145" width="60" height="4" rx="2" fill="#ffffff" opacity="0.6" />
      
      {/* Chart Area */}
      <rect x="120" y="180" width="235" height="85" rx="8" fill="#1e222b" />
      {/* Flat Bar Chart */}
      <rect x="140" y="220" width="20" height="30" rx="4" fill="#10b981" />
      <rect x="175" y="200" width="20" height="50" rx="4" fill="#10b981" opacity="0.7" />
      <rect x="210" y="235" width="20" height="15" rx="4" fill="#10b981" opacity="0.4" />
      <rect x="245" y="190" width="20" height="60" rx="4" fill="#10b981" />
      <rect x="280" y="210" width="20" height="40" rx="4" fill="#10b981" opacity="0.7" />
      <rect x="315" y="230" width="20" height="20" rx="4" fill="#10b981" opacity="0.5" />
      
      {/* Floating Elements (Glassmorphism overlay) */}
      <rect x="280" y="60" width="120" height="50" rx="12" fill="#ffffff" fillOpacity="0.05" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="1" />
      <circle cx="305" cy="85" r="10" fill="#10b981" />
      <path d="M301 85l3 3l5-5" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="325" y="80" width="50" height="4" rx="2" fill="#ffffff" opacity="0.8" />
      <rect x="325" y="90" width="30" height="3" rx="1.5" fill="#ffffff" opacity="0.4" />
    </svg>
  );
}

export function SetupIllustration() {
  return (
    <svg viewBox="0 0 400 300" className="w-full h-auto mt-8 opacity-90 drop-shadow-2xl transition-transform hover:scale-105 duration-500" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Abstract Store Setup Flow */}
      <rect x="20" y="30" width="360" height="250" rx="24" fill="#16181d" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="2" />
      
      {/* Connected Nodes representing the steps */}
      <path d="M 80 150 L 320 150" stroke="#10b981" strokeWidth="4" strokeOpacity="0.3" strokeDasharray="8 8" />
      
      {/* Node 1: Completed */}
      <circle cx="80" cy="150" r="24" fill="#10b981" fillOpacity="0.2" stroke="#10b981" strokeWidth="2" />
      <circle cx="80" cy="150" r="12" fill="#10b981" />
      <path d="M75 150l3 3l5-5" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      
      {/* Node 2: Active */}
      <circle cx="200" cy="150" r="32" fill="#1e222b" stroke="#10b981" strokeWidth="4" />
      <circle cx="200" cy="150" r="12" fill="#10b981" className="animate-pulse" />
      <rect x="160" y="200" width="80" height="30" rx="8" fill="#ffffff" fillOpacity="0.05" />
      <rect x="175" y="213" width="50" height="4" rx="2" fill="#ffffff" opacity="0.8" />
      
      {/* Node 3: Pending */}
      <circle cx="320" cy="150" r="24" fill="#1e222b" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="2" />
      <circle cx="320" cy="150" r="8" fill="#ffffff" opacity="0.2" />

      {/* Floating UI cards */}
      <rect x="40" y="60" width="120" height="40" rx="12" fill="#ffffff" fillOpacity="0.05" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="1" />
      <rect x="55" y="78" width="60" height="4" rx="2" fill="#10b981" opacity="0.8" />
      
      <rect x="240" y="50" width="130" height="50" rx="12" fill="#ffffff" fillOpacity="0.05" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="1" />
      <rect x="255" y="65" width="20" height="20" rx="6" fill="#6366f1" opacity="0.3" />
      <rect x="285" y="73" width="60" height="4" rx="2" fill="#ffffff" opacity="0.6" />
    </svg>
  );
}
