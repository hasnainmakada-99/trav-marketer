'use client';

export default function ConnectGbpSuccessPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center px-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-green-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md text-center">
        {/* Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-10 shadow-2xl">
          {/* Success icon */}
          <div className="w-20 h-20 bg-green-500/20 border border-green-500/30 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-10 h-10 text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          {/* Heading */}
          <h1 className="text-2xl font-bold text-white mb-3">
            You&apos;re all connected!
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-8">
            Your Google Business Profile has been successfully linked to TravAI. Posts will
            start appearing on your listing and reviews will be monitored for auto-replies.
          </p>

          {/* What happens next */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-left space-y-3 mb-6">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              What happens next
            </p>
            {[
              { icon: '🤖', text: 'AI will start generating SEO posts for your listing' },
              { icon: '⭐', text: 'New reviews will receive auto-generated replies' },
              { icon: '📈', text: 'Your local search visibility will improve over time' },
            ].map((item) => (
              <div key={item.text} className="flex items-start gap-3">
                <span className="text-base flex-shrink-0 mt-0.5">{item.icon}</span>
                <span className="text-sm text-slate-300">{item.text}</span>
              </div>
            ))}
          </div>

          {/* Close instruction */}
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3">
            <p className="text-indigo-300 text-sm">
              You can safely close this tab. Your service provider will take care of the rest.
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-600 mt-6">
          Powered by <span className="text-indigo-400">TravAI Marketer</span> · Built by{' '}
          <span className="text-indigo-400">CodeSphere Agency LLP</span>
        </p>
      </div>
    </div>
  );
}
