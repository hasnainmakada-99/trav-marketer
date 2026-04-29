'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function ConnectGbpInner() {
  const searchParams = useSearchParams();
  // Developer passes ?teamId=XXX when generating the link for the client.
  // Falls back to NEXT_PUBLIC_DEFAULT_TEAM_ID set in .env.local.
  const teamId =
    searchParams.get('teamId') ||
    process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID ||
    '';

  const handleConnect = () => {
    if (!teamId) {
      alert('Invalid link — missing teamId. Please ask your service provider for a new link.');
      return;
    }
    const url = `/api/gbp/connect?teamId=${encodeURIComponent(teamId)}&redirectTo=/connect-gbp/success`;
    window.location.href = url;
  };

  const isInvalidLink = !teamId;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center px-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          {/* Logo / Brand */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">T</span>
            </div>
            <div className="text-left">
              <span className="text-white font-bold text-lg leading-none block">TravAI</span>
              <span className="text-indigo-300 text-xs">by Traventions</span>
            </div>
          </div>

          {/* Heading */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" viewBox="0 0 48 48" fill="none">
                <path d="M43.6 20.2H24v7.6h11.3C33.7 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8.1 3.1l5.7-5.7C34.4 6.5 29.5 4.5 24 4.5 12.7 4.5 3.5 13.7 3.5 25S12.7 45.5 24 45.5c10.3 0 17.5-7.2 17.5-17.8 0-1.2-.1-2.3-.3-3.5l2.4-4z" fill="#4285F4"/>
                <path d="M6.3 15.5l6.6 4.9C14.5 16.1 19 13 24 13c3.1 0 5.9 1.2 8.1 3.1l5.7-5.7C34.4 6.5 29.5 4.5 24 4.5c-7.7 0-14.3 4.4-17.7 10.9z" fill="#EA4335"/>
                <path d="M24 45.5c5.4 0 10.2-1.9 13.9-5l-6.4-5.4C29.5 36.9 26.9 38 24 38c-5.3 0-9.7-3-11.3-7.4l-6.6 5.1C9.6 41 16.3 45.5 24 45.5z" fill="#34A853"/>
                <path d="M43.6 20.2H24v7.6h11.3c-.8 2.2-2.3 4-4.2 5.3l6.4 5.4c3.7-3.4 5.9-8.5 5.9-14.5 0-1.2-.1-2.3-.3-3.5l.5-.3z" fill="#FBBC05"/>
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              Connect Google Business
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed">
              Allow TravAI to manage your Google Business Profile — publish posts, respond to
              reviews, and improve your local SEO automatically.
            </p>
          </div>

          {/* What we'll access */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-6 space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              What TravAI will access
            </p>
            {[
              { icon: '📍', text: 'Your business locations on Google' },
              { icon: '📝', text: 'Create & publish posts on your behalf' },
              { icon: '⭐', text: 'Read and reply to customer reviews' },
            ].map((item) => (
              <div key={item.text} className="flex items-center gap-3">
                <span className="text-base flex-shrink-0">{item.icon}</span>
                <span className="text-sm text-slate-300">{item.text}</span>
                <svg className="w-4 h-4 text-green-400 ml-auto flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            ))}
          </div>

          {/* Invalid link warning */}
          {isInvalidLink && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4 text-center">
              <p className="text-red-400 text-sm">
                This link is incomplete. Please ask your service provider for a valid connection link.
              </p>
            </div>
          )}

          {/* Connect Button */}
          <button
            onClick={handleConnect}
            disabled={isInvalidLink}
            className="w-full flex items-center justify-center gap-3 py-3.5 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-gray-800 font-semibold rounded-2xl transition-colors shadow-lg text-sm"
          >
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 48 48" fill="none">
              <path d="M43.6 20.2H24v7.6h11.3C33.7 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8.1 3.1l5.7-5.7C34.4 6.5 29.5 4.5 24 4.5 12.7 4.5 3.5 13.7 3.5 25S12.7 45.5 24 45.5c10.3 0 17.5-7.2 17.5-17.8 0-1.2-.1-2.3-.3-3.5l2.4-4z" fill="#4285F4"/>
            </svg>
            Connect with Google
          </button>

          {/* Privacy note */}
          <p className="text-center text-xs text-slate-500 mt-4 leading-relaxed">
            You&apos;ll be redirected to Google&apos;s sign-in page. TravAI never sees your
            password. You can revoke access at any time from your Google Account settings.
          </p>
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

export default function ConnectGbpPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400" />
        </div>
      }
    >
      <ConnectGbpInner />
    </Suspense>
  );
}
