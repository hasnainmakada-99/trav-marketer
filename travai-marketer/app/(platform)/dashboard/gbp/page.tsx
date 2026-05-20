'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/appwrite-client';

interface AppwriteUser { $id: string; name: string; email: string }
interface GbpPost {
  $id: string; teamId: string; title: string; content: string;
  status: 'draft' | 'posted' | 'failed'; googlePostId: string | null;
  postedAt: string | null; type: string; createdBy: string; createdAt: string;
}
interface GbpReview {
  $id?: string; name?: string; reviewId?: string; googleReviewId?: string;
  reviewer: string; rating: number; reviewText: string;
  reply: string | null; replyStatus: 'pending' | 'replied'; createdAt: string;
}
interface GbpAccountLocation {
  resourceName: string; v4LocationName: string; title?: string;
}
interface GbpAccount {
  accountName: string; accountDisplayName?: string; locations: GbpAccountLocation[];
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(s => (
        <svg key={s} className={`w-4 h-4 ${s <= rating ? 'text-yellow-400' : 'text-gray-200'}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
        </svg>
      ))}
    </div>
  );
}

function Badge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    posted: 'bg-green-50 text-green-700 border-green-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
    pending: 'bg-orange-50 text-orange-700 border-orange-200',
    replied: 'bg-green-50 text-green-700 border-green-200',
  };
  const labels: Record<string, string> = { draft: 'Draft', posted: 'Live', failed: 'Failed', pending: 'Needs Reply', replied: 'Replied' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
      {labels[status] || status}
    </span>
  );
}

type Tab = 'posts' | 'reviews' | 'setup';

function GbpPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<AppwriteUser | null>(null);
  const [teamId, setTeamId] = useState('');

  // Connection
  const [connected, setConnected] = useState(false);
  const [hasLocation, setHasLocation] = useState(false);
  const [savedLocationId, setSavedLocationId] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Locations from Google API
  const [accounts, setAccounts] = useState<GbpAccount[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);

  // UI
  const [tab, setTab] = useState<Tab>('posts');
  const [toast, setToast] = useState<{msg: string; ok: boolean} | null>(null);

  // Posts
  const [posts, setPosts] = useState<GbpPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [showPostModal, setShowPostModal] = useState(false);
  const [postForm, setPostForm] = useState({
    title: '', content: '', keywords: '',
    autoGenerate: true, publishNow: false,
    callToAction: 'NONE', callToActionUrl: '', callToActionPhone: '',
  });
  const [postSubmitting, setPostSubmitting] = useState(false);

  // Auto-generate single post
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiPostPreview, setAiPostPreview] = useState('');

  // Reviews
  const [reviews, setReviews] = useState<GbpReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [autoReplying, setAutoReplying] = useState(false);
  const [replyModal, setReplyModal] = useState<{review: GbpReview; text: string; loading: boolean} | null>(null);

  const flash = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4500);
  };

  // ── Auth ──
  useEffect(() => {
    getCurrentUser().then(u => {
      if (!u) { router.push('/login'); return; }
      const ud = u as AppwriteUser;
      setUser(ud);
      setTeamId(ud.$id);
    });
  }, [router]);

  // ── OAuth callback toast ──
  useEffect(() => {
    const c = searchParams.get('connected');
    if (c === 'true') flash('Google Business Profile connected!');
    else if (c === 'false') flash(`Connection failed: ${searchParams.get('reason') || 'Unknown error'}`, false);
  }, [searchParams]);

  // ── Status check (DB only, fast) ──
  const checkStatus = useCallback(async (tid: string) => {
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/gbp/status?teamId=${encodeURIComponent(tid)}`);
      const data = await res.json();
      setConnected(!!data.connected);
      setHasLocation(!!data.hasLocation);
      setSavedLocationId(data.googleLocationId || null);
    } catch {
      setConnected(false);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => { if (teamId) checkStatus(teamId); }, [teamId, checkStatus]);

  // ── Load Google locations (only when connected, separate from connection check) ──
  const loadGoogleLocations = useCallback(async (tid: string) => {
    setLocationsLoading(true);
    setLocationsError(null);
    try {
      const res = await fetch(`/api/gbp/locations?teamId=${encodeURIComponent(tid)}`);
      const data = await res.json();
      setAccounts(data.accounts || []);
      if (data.error) setLocationsError(data.reason || data.error);
    } catch (e) {
      setLocationsError(String(e));
    } finally {
      setLocationsLoading(false);
    }
  }, []);

  useEffect(() => { if (teamId && connected) loadGoogleLocations(teamId); }, [teamId, connected, loadGoogleLocations]);

  // ── Posts ──
  const loadPosts = useCallback(async () => {
    if (!teamId) return;
    setPostsLoading(true);
    try {
      const res = await fetch(`/api/gbp/posts?teamId=${encodeURIComponent(teamId)}&limit=50`);
      if (res.ok) { const d = await res.json(); setPosts(d.documents || []); }
    } finally { setPostsLoading(false); }
  }, [teamId]);

  // ── Reviews ──
  const loadReviews = useCallback(async () => {
    if (!teamId) return;
    setReviewsLoading(true);
    try {
      const res = await fetch(`/api/gbp/reviews?teamId=${encodeURIComponent(teamId)}&limit=50`);
      if (res.ok) { const d = await res.json(); setReviews(d.documents || []); }
    } finally { setReviewsLoading(false); }
  }, [teamId]);

  useEffect(() => {
    if (!teamId || !connected) return;
    if (tab === 'posts') loadPosts();
    if (tab === 'reviews') loadReviews();
  }, [tab, teamId, connected, loadPosts, loadReviews]);

  const handleConnect = () => {
    if (!teamId) return;
    window.location.href = `/api/gbp/connect?teamId=${encodeURIComponent(teamId)}&redirectTo=/dashboard/gbp`;
  };

  // ── Select & save location ──
  const handleSelectLocation = async (v4LocationName: string) => {
    try {
      await fetch('/api/gbp/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, googleLocationId: v4LocationName }),
      });
      setSavedLocationId(v4LocationName);
      setHasLocation(true);
      flash('Location saved! Posts and reviews will now use this location.');
    } catch {
      flash('Failed to save location', false);
    }
  };

  // ── AI Generate post preview ──
  const handleAiGeneratePreview = async () => {
    setAiGenerating(true);
    setAiPostPreview('');
    try {
      const body = {
        teamId, title: postForm.title || 'AI Travel Post',
        content: '', type: 'auto_generated', createdBy: user?.$id,
        autoGenerate: true,
        keywords: postForm.keywords.split(',').map(k => k.trim()).filter(Boolean),
        publishNow: false,
      };
      const res = await fetch('/api/gbp/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        const d = await res.json();
        setAiPostPreview(d.content || '');
        setPostForm(p => ({ ...p, content: d.content || '', autoGenerate: false }));
        flash('AI content generated! Edit if needed, then post.');
        loadPosts();
      } else {
        const e = await res.json();
        flash(e.error || 'AI generation failed', false);
      }
    } finally { setAiGenerating(false); }
  };

  // ── Create post ──
  const handleCreatePost = async () => {
    if (!user) return;
    if (!postForm.content.trim()) { flash('Enter content or click "Generate with AI" first', false); return; }
    setPostSubmitting(true);
    try {
      const ctaPayload =
        postForm.callToAction !== 'NONE'
          ? {
              actionType: postForm.callToAction,
              ...(postForm.callToAction === 'CALL'
                ? { phoneNumber: postForm.callToActionPhone }
                : { url: postForm.callToActionUrl }),
            }
          : undefined;
      const body = {
        teamId, title: postForm.title || 'GBP Post', content: postForm.content,
        type: postForm.autoGenerate ? 'auto_generated' : 'manual', createdBy: user.$id,
        autoGenerate: postForm.autoGenerate,
        keywords: postForm.keywords.split(',').map(k => k.trim()).filter(Boolean),
        publishNow: postForm.publishNow,
        googleLocationName: savedLocationId,
        callToAction: ctaPayload,
      };
      const res = await fetch('/api/gbp/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        flash(postForm.publishNow ? 'Post published to Google!' : 'Post saved as draft.');
        setShowPostModal(false);
        setPostForm({ title: '', content: '', keywords: '', autoGenerate: true, publishNow: false, callToAction: 'NONE', callToActionUrl: '', callToActionPhone: '' });
        setAiPostPreview('');
        loadPosts();
      } else {
        const e = await res.json();
        flash(e.error || 'Failed to create post', false);
      }
    } finally { setPostSubmitting(false); }
  };

  // ── Publish draft ──
  const handlePublishDraft = async (post: GbpPost) => {
    try {
      const res = await fetch('/api/gbp/posts', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.$id, status: 'posted', publishNow: true }),
      });
      if (res.ok) { flash('Published!'); loadPosts(); }
      else { const e = await res.json(); flash(e.error || 'Failed', false); }
    } catch { flash('Network error', false); }
  };

  // ── Delete post ──
  const handleDeletePost = async (postId: string) => {
    if (!confirm('Delete this post?')) return;
    try {
      const res = await fetch(`/api/gbp/posts?postId=${encodeURIComponent(postId)}`, { method: 'DELETE' });
      if (res.ok) { flash('Deleted.'); setPosts(p => p.filter(x => x.$id !== postId)); }
    } catch { flash('Network error', false); }
  };

  // ── Sync reviews ──
  const handleSyncReviews = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/gbp/reviews?teamId=${encodeURIComponent(teamId)}&syncFromGoogle=true`);
      if (res.ok) {
        const d = await res.json();
        flash(`Synced ${d.reviews?.length || 0} reviews from Google.`);
        loadReviews();
      } else {
        const e = await res.json();
        flash(e.error || 'Sync failed', false);
      }
    } finally { setSyncing(false); }
  };

  // ── Auto-reply all ──
  const handleAutoReplyAll = async () => {
    const pending = reviews.filter(r => r.replyStatus === 'pending');
    if (!pending.length) { flash('No pending reviews.', false); return; }
    if (!confirm(`Auto-generate and publish AI replies for ${pending.length} review(s)?`)) return;
    setAutoReplying(true);
    try {
      const res = await fetch('/api/gbp/reviews', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, autoReplyAll: true }),
      });
      if (res.ok) {
        const d = await res.json();
        flash(`AI replied to ${d.replied || 0} reviews!`);
        loadReviews();
      } else {
        const e = await res.json();
        flash(e.error || 'Auto-reply failed', false);
      }
    } finally { setAutoReplying(false); }
  };

  // ── Generate single AI reply ──
  const handleGenerateAiReply = async () => {
    if (!replyModal) return;
    setReplyModal(p => p && ({ ...p, loading: true }));
    try {
      const res = await fetch('/api/gbp/reviews', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: replyModal.review.$id || replyModal.review.reviewId, teamId, autoGenerate: true, publishNow: false }),
      });
      if (res.ok) { const d = await res.json(); setReplyModal(p => p && ({ ...p, text: d.reply || '', loading: false })); }
      else { flash('Failed to generate reply', false); setReplyModal(p => p && ({ ...p, loading: false })); }
    } catch { setReplyModal(p => p && ({ ...p, loading: false })); }
  };

  // ── Submit reply ──
  const handleSubmitReply = async () => {
    if (!replyModal?.text.trim()) return;
    setReplyModal(p => p && ({ ...p, loading: true }));
    try {
      const res = await fetch('/api/gbp/reviews', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: replyModal.review.$id || replyModal.review.reviewId, teamId, autoGenerate: false, customReply: replyModal.text, publishNow: true }),
      });
      if (res.ok) { flash('Reply published to Google!'); setReplyModal(null); loadReviews(); }
      else { const e = await res.json(); flash(e.error || 'Failed', false); setReplyModal(p => p && ({ ...p, loading: false })); }
    } catch { setReplyModal(p => p && ({ ...p, loading: false })); }
  };

  const allLocations = accounts.flatMap(a => a.locations.map(l => ({ ...l, accountName: a.accountName })));
  const postStats = { total: posts.length, live: posts.filter(p => p.status === 'posted').length, drafts: posts.filter(p => p.status === 'draft').length };
  const reviewStats = { total: reviews.length, pending: reviews.filter(r => r.replyStatus === 'pending').length, avg: reviews.length ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : '—' };

  if (!user || statusLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4" />
          <p className="text-sm text-gray-500">Loading Google Business Profile…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.ok ? '✓' : '✕'} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Google Business Profile</h1>
            <p className="text-sm text-gray-500 mt-0.5">AI-powered posts, reviews & local SEO</p>
          </div>
          {connected && (
            <div className="flex items-center gap-2 text-xs bg-green-50 text-green-700 border border-green-200 px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Connected
              {hasLocation && <span className="text-green-500">· Location set</span>}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">

        {/* ── NOT CONNECTED ── */}
        {!connected && (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-12 text-center">
            <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">🌐</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Connect Google Business Profile</h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
              Connect your Google account to publish AI posts, auto-reply to reviews, and boost your local SEO — all from one place.
            </p>
            <button onClick={handleConnect} className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-sm shadow transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24"><path d="M21.35 11.1H12v2.8h5.35C16.85 16.35 14.65 18 12 18c-3.3 0-6-2.7-6-6s2.7-6 6-6c1.55 0 2.95.6 4.05 1.55L18 5.6C16.35 4.05 14.3 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.14 0 8.75-3.6 8.75-8.9 0-.6-.06-1.15-.15-1.7l.75-.3z" fill="#4285F4"/></svg>
              Connect with Google
            </button>
          </div>
        )}

        {/* ── CONNECTED ── */}
        {connected && (
          <>
            {/* Location picker banner */}
            {!hasLocation && (
              <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <p className="text-sm font-semibold text-amber-800">Select your Google Business location</p>
                  <button onClick={() => loadGoogleLocations(teamId)} disabled={locationsLoading}
                    className="flex-shrink-0 text-xs text-amber-700 hover:text-amber-900 underline disabled:opacity-50">
                    {locationsLoading ? 'Loading…' : 'Retry'}
                  </button>
                </div>
                <p className="text-xs text-amber-600 mb-3">
                  Select your business location to enable publishing posts and syncing reviews from Google.
                </p>
                {locationsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-amber-600">
                    <span className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin inline-block" />
                    Loading locations from Google…
                  </div>
                ) : locationsError ? (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <p className="font-semibold mb-0.5">Could not load locations:</p>
                    <p className="font-mono break-all">{locationsError}</p>
                    <p className="mt-1 text-red-600">If your Google token expired, <button onClick={handleConnect} className="underline font-medium">reconnect with Google</button>.</p>
                  </div>
                ) : allLocations.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {allLocations.map((loc, i) => (
                      <button key={i} onClick={() => handleSelectLocation(loc.v4LocationName)}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium transition-colors">
                        {loc.title || loc.v4LocationName}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-amber-700">
                    No locations found on this Google account. Make sure your Google account is connected to a{' '}
                    <a href="https://business.google.com" target="_blank" rel="noreferrer" className="underline">Google Business Profile</a>.
                    You can still create draft posts without a location.
                  </p>
                )}
              </div>
            )}

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Total Posts', value: postStats.total, sub: `${postStats.live} live`, color: 'text-gray-900' },
                { label: 'Draft Posts', value: postStats.drafts, sub: 'Awaiting publish', color: 'text-yellow-600' },
                { label: 'Avg. Rating', value: reviewStats.avg, sub: 'out of 5 stars', color: 'text-gray-900' },
                { label: 'Pending Replies', value: reviewStats.pending, sub: 'Need response', color: 'text-orange-600' },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
                  <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
                  <p className="text-xs text-gray-400 mt-1">{sub}</p>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 mb-6 bg-white rounded-t-xl overflow-hidden">
              {(['posts', 'reviews', 'setup'] as Tab[]).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-6 py-3.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${tab === t ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                  {t === 'posts' ? '📝 ' : t === 'reviews' ? '⭐ ' : '⚙️ '}
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* ── POSTS TAB ── */}
            {tab === 'posts' && (
              <div>
                {/* AI automation bar */}
                <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-xl p-4 mb-5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-indigo-900">AI Post Generator</p>
                    <p className="text-xs text-indigo-600 mt-0.5">Enter keywords → AI writes an SEO-optimized GBP post in seconds</p>
                  </div>
                  <button onClick={() => setShowPostModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium shadow-sm transition-colors flex-shrink-0">
                    🤖 Generate AI Post
                  </button>
                </div>

                {postsLoading ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
                    <p className="text-sm text-gray-400 mt-3">Loading posts…</p>
                  </div>
                ) : posts.length === 0 ? (
                  <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
                    <span className="text-4xl block mb-3">📝</span>
                    <p className="font-medium text-gray-700 mb-1">No posts yet</p>
                    <p className="text-xs text-gray-400 mb-4">Create your first AI-powered GBP post to boost local SEO</p>
                    <button onClick={() => setShowPostModal(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
                      Generate First Post
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {posts.map(post => (
                      <div key={post.$id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge status={post.status} />
                            <span className="text-xs text-gray-400">{post.type === 'auto_generated' ? '🤖 AI' : '✍️ Manual'}</span>
                          </div>
                          <p className="text-sm font-medium text-gray-900 mb-1">{post.title}</p>
                          <p className="text-sm text-gray-500 line-clamp-2">{post.content}</p>
                          <p className="text-xs text-gray-400 mt-2">
                            {post.postedAt ? `Published ${new Date(post.postedAt).toLocaleDateString('en-IN')}` : `Draft · ${new Date(post.createdAt).toLocaleDateString('en-IN')}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {post.status === 'draft' && (
                            <button onClick={() => handlePublishDraft(post)}
                              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium transition-colors">
                              Publish
                            </button>
                          )}
                          <button onClick={() => handleDeletePost(post.$id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── REVIEWS TAB ── */}
            {tab === 'reviews' && (
              <div>
                <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                  <h2 className="text-base font-semibold text-gray-900">Customer Reviews</h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={handleSyncReviews} disabled={syncing || !hasLocation}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
                      title={!hasLocation ? 'Set a location first' : ''}>
                      {syncing ? <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin inline-block" /> : '🔄'} Sync from Google
                    </button>
                    <button onClick={handleAutoReplyAll} disabled={autoReplying || reviewStats.pending === 0}
                      className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium disabled:opacity-50 transition-colors">
                      {autoReplying ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> : '🤖'} Auto-Reply All ({reviewStats.pending})
                    </button>
                  </div>
                </div>

                {reviewsLoading ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
                    <p className="text-sm text-gray-400 mt-3">Loading reviews…</p>
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
                    <span className="text-4xl block mb-3">⭐</span>
                    <p className="font-medium text-gray-700 mb-1">No reviews synced yet</p>
                    <p className="text-xs text-gray-400 mb-4">{hasLocation ? 'Click "Sync from Google" to import reviews' : 'Set a business location first, then sync'}</p>
                    {hasLocation && (
                      <button onClick={handleSyncReviews} disabled={syncing} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-60">
                        Sync Reviews Now
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reviews.map((review, idx) => (
                      <div key={review.$id || review.reviewId || idx} className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                                {review.reviewer?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900">{review.reviewer || 'Anonymous'}</p>
                                <div className="flex items-center gap-2">
                                  <StarRating rating={review.rating || 0} />
                                  <span className="text-xs text-gray-400">{new Date(review.createdAt).toLocaleDateString('en-IN')}</span>
                                </div>
                              </div>
                            </div>
                            <p className="text-sm text-gray-600 ml-12">{review.reviewText || 'No text'}</p>
                            {review.reply && (
                              <div className="mt-3 ml-12 bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                                <p className="text-xs font-semibold text-indigo-600 mb-1">Your reply:</p>
                                <p className="text-sm text-gray-700">{review.reply}</p>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-2 flex-shrink-0">
                            <Badge status={review.replyStatus || 'pending'} />
                            {review.replyStatus === 'pending' && (
                              <button onClick={() => setReplyModal({ review, text: '', loading: false })}
                                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium">
                                Reply
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── SETUP TAB ── */}
            {tab === 'setup' && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-gray-900">Connection Settings</h2>

                {/* Location selector */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">Google Business Location</h3>
                  <p className="text-xs text-gray-400 mb-3">Select which location to use for publishing posts and syncing reviews.</p>
                  {locationsLoading ? (
                    <p className="text-sm text-gray-400">Loading locations from Google…</p>
                  ) : locationsError ? (
                    <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="font-medium mb-1">Error loading locations</p>
                      <p className="text-xs font-mono break-all mb-2">{locationsError}</p>
                      <button onClick={() => loadGoogleLocations(teamId)} className="text-xs underline mr-3">Retry</button>
                      <button onClick={handleConnect} className="text-xs underline">Reconnect with Google</button>
                    </div>
                  ) : allLocations.length === 0 ? (
                    <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      No locations found. Make sure your Google account is linked to a{' '}
                      <a href="https://business.google.com" target="_blank" rel="noreferrer" className="underline">Google Business Profile</a>.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {allLocations.map((loc, i) => (
                        <div key={i} className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${savedLocationId === loc.v4LocationName ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{loc.title || 'Unnamed Location'}</p>
                            <p className="text-xs text-gray-400 font-mono mt-0.5">{loc.v4LocationName}</p>
                          </div>
                          {savedLocationId === loc.v4LocationName ? (
                            <span className="flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Active
                            </span>
                          ) : (
                            <button onClick={() => handleSelectLocation(loc.v4LocationName)}
                              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium">
                              Select
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Reconnect */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">Reconnect Account</h3>
                  <p className="text-xs text-gray-400 mb-3">Reconnect if your token expired or you want to switch accounts.</p>
                  <button onClick={handleConnect} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-xl text-sm font-medium transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24"><path d="M21.35 11.1H12v2.8h5.35C16.85 16.35 14.65 18 12 18c-3.3 0-6-2.7-6-6s2.7-6 6-6c1.55 0 2.95.6 4.05 1.55L18 5.6C16.35 4.05 14.3 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.14 0 8.75-3.6 8.75-8.9 0-.6-.06-1.15-.15-1.7l.75-.3z" fill="#4285F4"/></svg>
                    Reconnect with Google
                  </button>
                </div>

                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                  <p className="text-xs text-blue-600">
                    TravAI uses the <code className="bg-blue-100 px-1 rounded">business.manage</code> scope to read locations, publish posts, and reply to reviews on your behalf. We never modify billing or account settings.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── CREATE POST MODAL ── */}
      {showPostModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200">
              <button onClick={() => { setShowPostModal(false); setAiPostPreview(''); }}
                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
                </svg>
              </button>
              <h2 className="text-base font-semibold text-gray-900 flex-1">Add post</h2>
              <button onClick={handleAiGeneratePreview} disabled={aiGenerating}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-60">
                {aiGenerating
                  ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
                  : '✨'}
                {aiGenerating ? 'Generating…' : 'Generate with AI'}
              </button>
              <button onClick={() => { setShowPostModal(false); setAiPostPreview(''); }}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors ml-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto">

              {/* Top split: description + image */}
              <div className="flex flex-col sm:flex-row gap-0 sm:divide-x sm:divide-gray-200">

                {/* Left: Description */}
                <div className="flex-1 p-5 flex flex-col">
                  <textarea
                    value={postForm.content}
                    onChange={e => setPostForm(p => ({ ...p, content: e.target.value, autoGenerate: false }))}
                    maxLength={1500}
                    rows={8}
                    placeholder="Description"
                    className={`flex-1 w-full border-0 outline-none text-sm text-gray-800 placeholder-gray-400 resize-none leading-relaxed ${aiPostPreview ? 'bg-purple-50/30' : ''}`}
                  />
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                    <span className="text-xs text-gray-400">{aiPostPreview ? '✨ AI generated — edit freely' : ''}</span>
                    <span className="text-xs text-gray-400">{postForm.content.length}/1,500</span>
                  </div>
                </div>

                {/* Right: Image upload */}
                <div className="sm:w-56 p-5 flex flex-col items-center justify-center bg-gray-50 min-h-[160px] sm:min-h-0">
                  <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center text-center w-full h-full justify-center gap-3">
                    <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                    </svg>
                    <p className="text-xs text-gray-500 leading-tight">Drag images and videos here</p>
                    <span className="text-xs text-gray-400">or</span>
                    <label className="cursor-pointer text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82V15.18a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
                      </svg>
                      Select images and videos
                      <input type="file" accept="image/*,video/*" multiple className="hidden" />
                    </label>
                  </div>
                </div>
              </div>

              {/* Schedule this post */}
              <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-sm text-gray-700">Schedule this post</span>
                <div onClick={() => setPostForm(p => ({ ...p, publishNow: !p.publishNow }))}
                  className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors ${postForm.publishNow ? 'bg-indigo-600' : 'bg-gray-300'}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${postForm.publishNow ? 'translate-x-5' : 'translate-x-1'}`} />
                </div>
              </div>

              {postForm.publishNow && !hasLocation && (
                <div className="mx-5 mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No location set — post will be saved as draft. Go to Setup tab to select a location.
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-gray-200" />

              {/* Add more details */}
              <div className="px-5 py-4 space-y-4">
                <p className="text-sm font-medium text-gray-700">Add more details</p>

                {/* CTA button selector */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Add a button (optional)</label>
                  <select
                    value={postForm.callToAction}
                    onChange={e => setPostForm(p => ({ ...p, callToAction: e.target.value, callToActionUrl: '', callToActionPhone: '' }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                    <option value="NONE">None</option>
                    <option value="BOOK">Book</option>
                    <option value="ORDER">Order online</option>
                    <option value="SHOP">Shop</option>
                    <option value="LEARN_MORE">Learn more</option>
                    <option value="SIGN_UP">Sign up</option>
                    <option value="CALL">Call now</option>
                  </select>

                  {postForm.callToAction !== 'NONE' && postForm.callToAction !== 'CALL' && (
                    <input
                      type="url"
                      value={postForm.callToActionUrl}
                      onChange={e => setPostForm(p => ({ ...p, callToActionUrl: e.target.value }))}
                      placeholder="https://your-website.com"
                      className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  )}
                  {postForm.callToAction === 'CALL' && (
                    <input
                      type="tel"
                      value={postForm.callToActionPhone}
                      onChange={e => setPostForm(p => ({ ...p, callToActionPhone: e.target.value }))}
                      placeholder="+91 98765 43210"
                      className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  )}
                </div>

                {/* SEO Keywords (AI hint) */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">SEO keywords for AI generation (optional)</label>
                  <input type="text" value={postForm.keywords}
                    onChange={e => setPostForm(p => ({ ...p, keywords: e.target.value }))}
                    placeholder="e.g. Dubai holiday, travel packages, family tour India"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-between gap-3 bg-white rounded-b-2xl">
              <button onClick={() => { setShowPostModal(false); setAiPostPreview(''); }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors">
                Cancel
              </button>
              <button onClick={handleCreatePost}
                disabled={postSubmitting || !postForm.content.trim()}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold disabled:opacity-60 transition-colors shadow-sm">
                {postSubmitting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />}
                {postForm.publishNow && hasLocation ? 'Post' : 'Save Draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REPLY MODAL ── */}
      {replyModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Reply to Review</h2>
              <button onClick={() => setReplyModal(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-gray-800">{replyModal.review.reviewer}</span>
                  <StarRating rating={replyModal.review.rating} />
                </div>
                <p className="text-sm text-gray-600">{replyModal.review.reviewText}</p>
              </div>
              <button onClick={handleGenerateAiReply} disabled={replyModal.loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 transition-colors">
                {replyModal.loading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> : '✨'} Generate AI Reply
              </button>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reply (AI generated or write your own)</label>
                <textarea value={replyModal.text} onChange={e => setReplyModal(p => p && ({ ...p, text: e.target.value }))}
                  rows={4} placeholder="Click Generate AI Reply or write your own…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setReplyModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={handleSubmitReply} disabled={!replyModal.text.trim() || replyModal.loading}
                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 transition-colors">
                {replyModal.loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />}
                Publish Reply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GbpPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    }>
      <GbpPageInner />
    </Suspense>
  );
}
