'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/appwrite-client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AppwriteUser {
  $id: string;
  name: string;
  email: string;
}

interface GbpPost {
  $id: string;
  teamId: string;
  title: string;
  content: string;
  status: 'draft' | 'posted' | 'failed';
  googlePostId: string | null;
  postedAt: string | null;
  type: string;
  createdBy: string;
  createdAt: string;
}

interface GbpReview {
  $id?: string;
  name?: string;
  reviewId?: string;
  googleReviewId?: string;
  reviewer: string;
  rating: number;
  reviewText: string;
  reply: string | null;
  replyStatus: 'pending' | 'replied';
  createdAt: string;
}

interface GbpLocation {
  accountName: string;
  accountDisplayName?: string;
  locations: Array<{
    resourceName: string;
    v4LocationName: string;
    title?: string;
  }>;
}

type ActiveTab = 'posts' | 'reviews' | 'setup';

// ─── Star Rating Component ────────────────────────────────────────────────────

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className={`w-4 h-4 ${star <= rating ? 'text-yellow-400' : 'text-gray-200'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    posted: 'bg-green-50 text-green-700 border-green-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
    pending: 'bg-orange-50 text-orange-700 border-orange-200',
    replied: 'bg-green-50 text-green-700 border-green-200',
  };
  const labels: Record<string, string> = {
    draft: 'Draft',
    posted: 'Posted',
    failed: 'Failed',
    pending: 'Needs Reply',
    replied: 'Replied',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
        styles[status] || 'bg-gray-50 text-gray-600 border-gray-200'
      }`}
    >
      {labels[status] || status}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function GbpPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Auth & team
  const [user, setUser] = useState<AppwriteUser | null>(null);
  const [teamId, setTeamId] = useState<string>('');

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [locations, setLocations] = useState<GbpLocation[]>([]);

  // UI state
  const [activeTab, setActiveTab] = useState<ActiveTab>('posts');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Posts state
  const [posts, setPosts] = useState<GbpPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [showPostModal, setShowPostModal] = useState(false);
  const [postForm, setPostForm] = useState({
    title: '',
    content: '',
    keywords: '',
    autoGenerate: true,
    publishNow: false,
  });
  const [postSubmitting, setPostSubmitting] = useState(false);

  // Reviews state
  const [reviews, setReviews] = useState<GbpReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [autoReplying, setAutoReplying] = useState(false);
  const [replyModal, setReplyModal] = useState<{
    review: GbpReview;
    mode: 'ai' | 'custom';
    text: string;
    loading: boolean;
  } | null>(null);

  // ─── Utilities ──────────────────────────────────────────────────────────────

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ─── Auth ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (!u) {
        router.push('/login');
        return;
      }
      const userData = u as AppwriteUser;
      setUser(userData);
      setTeamId(userData.$id);
    });
  }, [router]);

  // ─── Handle OAuth callback params ────────────────────────────────────────────

  useEffect(() => {
    const connected = searchParams.get('connected');
    if (connected === 'true') {
      showToast('Google Business Profile connected successfully!', 'success');
    } else if (connected === 'false') {
      const reason = searchParams.get('reason');
      showToast(`Connection failed: ${reason || 'Unknown error'}`, 'error');
    }
  }, [searchParams]);

  // ─── Check Connection ────────────────────────────────────────────────────────

  const checkConnection = useCallback(async (tid: string) => {
    setConnectionLoading(true);
    try {
      const res = await fetch(`/api/gbp/locations?teamId=${encodeURIComponent(tid)}`);
      if (res.ok) {
        const data = await res.json();
        const accounts: GbpLocation[] = data.accounts || [];
        const hasLocations = accounts.some((a) => a.locations.length > 0);
        setLocations(accounts);
        setIsConnected(hasLocations);
      } else {
        setIsConnected(false);
      }
    } catch {
      setIsConnected(false);
    } finally {
      setConnectionLoading(false);
    }
  }, []);

  useEffect(() => {
    if (teamId) {
      checkConnection(teamId);
    }
  }, [teamId, checkConnection]);

  // ─── Load Posts ───────────────────────────────────────────────────────────────

  const loadPosts = useCallback(async () => {
    if (!teamId) return;
    setPostsLoading(true);
    try {
      const res = await fetch(`/api/gbp/posts?teamId=${encodeURIComponent(teamId)}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setPosts(data.documents || []);
      }
    } catch (e) {
      console.error('Failed to load posts:', e);
    } finally {
      setPostsLoading(false);
    }
  }, [teamId]);

  // ─── Load Reviews ─────────────────────────────────────────────────────────────

  const loadReviews = useCallback(async () => {
    if (!teamId) return;
    setReviewsLoading(true);
    try {
      const res = await fetch(`/api/gbp/reviews?teamId=${encodeURIComponent(teamId)}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setReviews(data.documents || []);
      }
    } catch (e) {
      console.error('Failed to load reviews:', e);
    } finally {
      setReviewsLoading(false);
    }
  }, [teamId]);

  // Load data when tab changes
  useEffect(() => {
    if (!teamId || !isConnected) return;
    if (activeTab === 'posts') loadPosts();
    if (activeTab === 'reviews') loadReviews();
  }, [activeTab, teamId, isConnected, loadPosts, loadReviews]);

  // ─── Connect GBP ─────────────────────────────────────────────────────────────

  const handleConnect = () => {
    if (!teamId) return;
    const url = `/api/gbp/connect?teamId=${encodeURIComponent(teamId)}&redirectTo=/dashboard/gbp`;
    window.location.href = url;
  };

  // ─── Create Post ─────────────────────────────────────────────────────────────

  const handleCreatePost = async () => {
    if (!teamId || !user) return;
    if (!postForm.autoGenerate && !postForm.content.trim()) {
      showToast('Please enter post content or enable AI generation.', 'error');
      return;
    }

    setPostSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        teamId,
        title: postForm.title || 'GBP Post',
        content: postForm.content,
        type: postForm.autoGenerate ? 'auto_generated' : 'manual',
        createdBy: user.$id,
        autoGenerate: postForm.autoGenerate,
        keywords: postForm.keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
        publishNow: postForm.publishNow,
      };

      const res = await fetch('/api/gbp/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        showToast(
          postForm.publishNow
            ? 'Post published to Google Business Profile!'
            : 'Post saved as draft.',
          'success'
        );
        setShowPostModal(false);
        setPostForm({ title: '', content: '', keywords: '', autoGenerate: true, publishNow: false });
        setPosts((prev) => [data, ...prev]);
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to create post.', 'error');
      }
    } catch (e) {
      showToast('Network error while creating post.', 'error');
    } finally {
      setPostSubmitting(false);
    }
  };

  // ─── Publish Draft Post ───────────────────────────────────────────────────────

  const handlePublishDraft = async (post: GbpPost) => {
    if (!teamId) return;
    try {
      const res = await fetch('/api/gbp/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.$id, status: 'posted', publishNow: true }),
      });
      if (res.ok) {
        showToast('Post published successfully!', 'success');
        loadPosts();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to publish post.', 'error');
      }
    } catch {
      showToast('Network error.', 'error');
    }
  };

  // ─── Delete Post ─────────────────────────────────────────────────────────────

  const handleDeletePost = async (postId: string) => {
    if (!confirm('Delete this post? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/gbp/posts?postId=${encodeURIComponent(postId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        showToast('Post deleted.', 'success');
        setPosts((prev) => prev.filter((p) => p.$id !== postId));
      } else {
        showToast('Failed to delete post.', 'error');
      }
    } catch {
      showToast('Network error.', 'error');
    }
  };

  // ─── Sync Reviews from Google ─────────────────────────────────────────────────

  const handleSyncReviews = async () => {
    if (!teamId) return;
    setSyncing(true);
    try {
      const res = await fetch(
        `/api/gbp/reviews?teamId=${encodeURIComponent(teamId)}&syncFromGoogle=true`
      );
      if (res.ok) {
        const data = await res.json();
        showToast(`Synced ${data.reviews?.length || 0} reviews from Google.`, 'success');
        loadReviews();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to sync reviews.', 'error');
      }
    } catch {
      showToast('Network error.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  // ─── Auto-Reply All Pending Reviews ───────────────────────────────────────────

  const handleAutoReplyAll = async () => {
    const pending = reviews.filter((r) => r.replyStatus === 'pending');
    if (pending.length === 0) {
      showToast('No pending reviews to reply to.', 'error');
      return;
    }
    if (!confirm(`Auto-generate and publish AI replies for ${pending.length} pending review(s)?`)) {
      return;
    }
    setAutoReplying(true);
    try {
      const res = await fetch('/api/gbp/reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, autoReplyAll: true }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`AI replies sent to ${data.replied || 0} reviews!`, 'success');
        loadReviews();
      } else {
        const err = await res.json();
        showToast(err.error || 'Auto-reply failed.', 'error');
      }
    } catch {
      showToast('Network error.', 'error');
    } finally {
      setAutoReplying(false);
    }
  };

  // ─── Open Reply Modal ─────────────────────────────────────────────────────────

  const openReplyModal = (review: GbpReview) => {
    setReplyModal({
      review,
      mode: 'ai',
      text: '',
      loading: false,
    });
  };

  // ─── Generate AI Reply ────────────────────────────────────────────────────────

  const handleGenerateAiReply = async () => {
    if (!replyModal || !teamId) return;
    setReplyModal((prev) => prev && { ...prev, loading: true });
    try {
      const res = await fetch('/api/gbp/reviews', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewId: replyModal.review.$id || replyModal.review.reviewId,
          teamId,
          autoGenerate: true,
          publishNow: false,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setReplyModal((prev) => prev && { ...prev, text: data.reply || '', loading: false });
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to generate reply.', 'error');
        setReplyModal((prev) => prev && { ...prev, loading: false });
      }
    } catch {
      showToast('Network error.', 'error');
      setReplyModal((prev) => prev && { ...prev, loading: false });
    }
  };

  // ─── Submit Reply ─────────────────────────────────────────────────────────────

  const handleSubmitReply = async () => {
    if (!replyModal || !replyModal.text.trim() || !teamId) return;
    setReplyModal((prev) => prev && { ...prev, loading: true });
    try {
      const res = await fetch('/api/gbp/reviews', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewId: replyModal.review.$id || replyModal.review.reviewId,
          teamId,
          autoGenerate: false,
          customReply: replyModal.text,
          publishNow: true,
        }),
      });
      if (res.ok) {
        showToast('Reply published to Google!', 'success');
        setReplyModal(null);
        loadReviews();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to publish reply.', 'error');
        setReplyModal((prev) => prev && { ...prev, loading: false });
      }
    } catch {
      showToast('Network error.', 'error');
      setReplyModal((prev) => prev && { ...prev, loading: false });
    }
  };

  // ─── Derived stats ────────────────────────────────────────────────────────────

  const postStats = {
    total: posts.length,
    posted: posts.filter((p) => p.status === 'posted').length,
    drafts: posts.filter((p) => p.status === 'draft').length,
  };

  const reviewStats = {
    total: reviews.length,
    pending: reviews.filter((r) => r.replyStatus === 'pending').length,
    avgRating:
      reviews.length > 0
        ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
        : '—',
  };

  const connectedLocation =
    locations.flatMap((a) => a.locations)[0];

  // ─── Loading skeleton ─────────────────────────────────────────────────────────

  if (!user || connectionLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4" />
          <p className="text-sm text-gray-500">Loading Google Business Profile...</p>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          <span>{toast.type === 'success' ? '✓' : '✕'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <span>🌐</span> Google Business Profile
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Manage posts, reviews, and SEO for your Google listing
              </p>
            </div>
            {isConnected && connectedLocation && (
              <div className="hidden sm:flex items-center gap-2 text-sm bg-green-50 text-green-700 border border-green-200 px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                <span className="truncate max-w-xs">{connectedLocation.title || connectedLocation.v4LocationName}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* ── Not Connected Banner ── */}
        {!isConnected && (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-10 text-center mb-6">
            <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🌐</span>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Connect your Google Business Profile
            </h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
              Connect your Google account to start managing posts, replying to reviews, and
              boosting your local SEO — all from one place.
            </p>
            <button
              onClick={handleConnect}
              className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-sm shadow transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                <path d="M21.35 11.1H12v2.8h5.35C16.85 16.35 14.65 18 12 18c-3.3 0-6-2.7-6-6s2.7-6 6-6c1.55 0 2.95.6 4.05 1.55L18 5.6C16.35 4.05 14.3 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.14 0 8.75-3.6 8.75-8.9 0-.6-.06-1.15-.15-1.7l.75-.3z" fill="#4285F4"/>
              </svg>
              Connect with Google
            </button>
          </div>
        )}

        {/* ── Connected View ── */}
        {isConnected && (
          <>
            {/* Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Total Posts</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{postStats.total}</p>
                <p className="text-xs text-gray-400 mt-1">{postStats.posted} live</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Draft Posts</p>
                <p className="text-2xl font-bold text-yellow-600 mt-1">{postStats.drafts}</p>
                <p className="text-xs text-gray-400 mt-1">Awaiting publish</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Avg. Rating</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{reviewStats.avgRating}</p>
                <p className="text-xs text-gray-400 mt-1">out of 5 stars</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Pending Replies</p>
                <p className="text-2xl font-bold text-orange-600 mt-1">{reviewStats.pending}</p>
                <p className="text-xs text-gray-400 mt-1">Need response</p>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-gray-200 mb-6 bg-white rounded-t-xl overflow-hidden">
              {(['posts', 'reviews', 'setup'] as ActiveTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-6 py-3.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                    activeTab === tab
                      ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab === 'posts' && '📝 '}
                  {tab === 'reviews' && '⭐ '}
                  {tab === 'setup' && '⚙️ '}
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* ─────────────────── POSTS TAB ─────────────────── */}
            {activeTab === 'posts' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-gray-900">GBP Posts</h2>
                  <button
                    onClick={() => setShowPostModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium shadow-sm transition-colors"
                  >
                    <span>+</span> New Post
                  </button>
                </div>

                {postsLoading ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
                    <p className="text-sm text-gray-400 mt-3">Loading posts...</p>
                  </div>
                ) : posts.length === 0 ? (
                  <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
                    <span className="text-4xl block mb-3">📝</span>
                    <p className="text-gray-500 text-sm font-medium mb-1">No posts yet</p>
                    <p className="text-gray-400 text-xs mb-4">
                      Create your first AI-powered GBP post to boost local SEO
                    </p>
                    <button
                      onClick={() => setShowPostModal(true)}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Create First Post
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {posts.map((post) => (
                      <div
                        key={post.$id}
                        className="bg-white rounded-xl border border-gray-200 p-4 flex items-start justify-between gap-4"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <StatusBadge status={post.status} />
                            <span className="text-xs text-gray-400">
                              {post.type === 'auto_generated' ? '🤖 AI Generated' : '✍️ Manual'}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-gray-900 mb-1">
                            {post.title}
                          </p>
                          <p className="text-sm text-gray-500 line-clamp-2">
                            {post.content}
                          </p>
                          <p className="text-xs text-gray-400 mt-2">
                            {post.postedAt
                              ? `Posted ${new Date(post.postedAt).toLocaleDateString()}`
                              : `Created ${new Date(post.createdAt).toLocaleDateString()}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {post.status === 'draft' && (
                            <button
                              onClick={() => handlePublishDraft(post)}
                              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium transition-colors"
                            >
                              Publish
                            </button>
                          )}
                          <button
                            onClick={() => handleDeletePost(post.$id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete post"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ─────────────────── REVIEWS TAB ─────────────────── */}
            {activeTab === 'reviews' && (
              <div>
                <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                  <h2 className="text-base font-semibold text-gray-900">Customer Reviews</h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSyncReviews}
                      disabled={syncing}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
                    >
                      {syncing ? (
                        <span className="inline-block w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <span>🔄</span>
                      )}
                      Sync from Google
                    </button>
                    <button
                      onClick={handleAutoReplyAll}
                      disabled={autoReplying || reviewStats.pending === 0}
                      className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
                    >
                      {autoReplying ? (
                        <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <span>🤖</span>
                      )}
                      Auto-Reply Pending ({reviewStats.pending})
                    </button>
                  </div>
                </div>

                {reviewsLoading ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
                    <p className="text-sm text-gray-400 mt-3">Loading reviews...</p>
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
                    <span className="text-4xl block mb-3">⭐</span>
                    <p className="text-gray-500 text-sm font-medium mb-1">No reviews synced yet</p>
                    <p className="text-gray-400 text-xs mb-4">
                      Click &ldquo;Sync from Google&rdquo; to import your latest reviews
                    </p>
                    <button
                      onClick={handleSyncReviews}
                      disabled={syncing}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
                    >
                      Sync Reviews Now
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reviews.map((review, idx) => (
                      <div
                        key={review.$id || review.reviewId || idx}
                        className="bg-white rounded-xl border border-gray-200 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-1">
                              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 flex-shrink-0">
                                {review.reviewer?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {review.reviewer || 'Anonymous'}
                                </p>
                                <div className="flex items-center gap-2">
                                  <StarRating rating={review.rating || 0} />
                                  <span className="text-xs text-gray-400">
                                    {new Date(review.createdAt).toLocaleDateString()}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <p className="text-sm text-gray-600 mt-2 ml-11">
                              {review.reviewText || 'No review text'}
                            </p>

                            {/* Reply if exists */}
                            {review.reply && (
                              <div className="mt-3 ml-11 bg-gray-50 border border-gray-200 rounded-lg p-3">
                                <p className="text-xs font-semibold text-gray-500 mb-1">
                                  Your reply:
                                </p>
                                <p className="text-sm text-gray-700">{review.reply}</p>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <StatusBadge status={review.replyStatus || 'pending'} />
                            {review.replyStatus === 'pending' && (
                              <button
                                onClick={() => openReplyModal(review)}
                                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors"
                              >
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

            {/* ─────────────────── SETUP TAB ─────────────────── */}
            {activeTab === 'setup' && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-gray-900">GBP Connection Settings</h2>

                {/* Connected account info */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Connected Accounts</h3>
                  {locations.length === 0 ? (
                    <p className="text-sm text-gray-400">No accounts connected.</p>
                  ) : (
                    <div className="space-y-4">
                      {locations.map((account, ai) => (
                        <div key={ai}>
                          <p className="text-sm font-medium text-gray-800 mb-2">
                            {account.accountDisplayName || account.accountName}
                          </p>
                          <div className="space-y-2 pl-4 border-l-2 border-indigo-100">
                            {account.locations.map((loc, li) => (
                              <div
                                key={li}
                                className="flex items-center justify-between text-sm py-1.5"
                              >
                                <div>
                                  <p className="font-medium text-gray-700">{loc.title || 'Unnamed Location'}</p>
                                  <p className="text-xs text-gray-400 font-mono">{loc.v4LocationName}</p>
                                </div>
                                <span className="flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                  Active
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Reconnect */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">Reconnect Account</h3>
                  <p className="text-xs text-gray-400 mb-3">
                    If your Google token has expired or you want to connect a different account,
                    reconnect here.
                  </p>
                  <button
                    onClick={handleConnect}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-xl text-sm font-medium transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <path d="M21.35 11.1H12v2.8h5.35C16.85 16.35 14.65 18 12 18c-3.3 0-6-2.7-6-6s2.7-6 6-6c1.55 0 2.95.6 4.05 1.55L18 5.6C16.35 4.05 14.3 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.14 0 8.75-3.6 8.75-8.9 0-.6-.06-1.15-.15-1.7l.75-.3z" fill="#4285F4"/>
                    </svg>
                    Reconnect with Google
                  </button>
                </div>

                {/* Webhook / Integration info */}
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-blue-800 mb-1">About Google Permissions</h3>
                  <p className="text-xs text-blue-600">
                    TravAI uses the{' '}
                    <code className="bg-blue-100 px-1 rounded">business.manage</code> scope to read
                    locations, publish posts, list and reply to reviews on your behalf. We never
                    modify your business settings or billing information.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─────────────── CREATE POST MODAL ─────────────── */}
      {showPostModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Create GBP Post</h2>
              <button
                onClick={() => setShowPostModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Post title */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Post Title (optional)
                </label>
                <input
                  type="text"
                  value={postForm.title}
                  onChange={(e) => setPostForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Special Weekend Offer"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* AI vs Manual toggle */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPostForm((p) => ({ ...p, autoGenerate: true }))}
                  className={`flex-1 py-2 text-sm rounded-lg font-medium border transition-colors ${
                    postForm.autoGenerate
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  🤖 AI Generate
                </button>
                <button
                  onClick={() => setPostForm((p) => ({ ...p, autoGenerate: false }))}
                  className={`flex-1 py-2 text-sm rounded-lg font-medium border transition-colors ${
                    !postForm.autoGenerate
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  ✍️ Write Manually
                </button>
              </div>

              {/* AI keywords */}
              {postForm.autoGenerate && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    SEO Keywords (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={postForm.keywords}
                    onChange={(e) => setPostForm((p) => ({ ...p, keywords: e.target.value }))}
                    placeholder="e.g. travel, Goa, beach, family holiday"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    AI will craft an SEO-optimized post using these keywords.
                  </p>
                </div>
              )}

              {/* Manual content */}
              {!postForm.autoGenerate && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Post Content <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={postForm.content}
                    onChange={(e) => setPostForm((p) => ({ ...p, content: e.target.value }))}
                    rows={5}
                    maxLength={1500}
                    placeholder="Write your Google Business post here... (150-300 chars recommended)"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  />
                  <p className="text-xs text-gray-400 mt-1 text-right">
                    {postForm.content.length}/1500
                  </p>
                </div>
              )}

              {/* Publish now toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => setPostForm((p) => ({ ...p, publishNow: !p.publishNow }))}
                  className={`relative w-10 h-6 rounded-full transition-colors ${
                    postForm.publishNow ? 'bg-indigo-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      postForm.publishNow ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </div>
                <span className="text-sm text-gray-700">
                  {postForm.publishNow
                    ? 'Publish immediately to Google'
                    : 'Save as draft (publish later)'}
                </span>
              </label>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowPostModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePost}
                disabled={postSubmitting}
                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
              >
                {postSubmitting && (
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {postForm.autoGenerate ? 'Generate & Save' : postForm.publishNow ? 'Publish Now' : 'Save Draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────── REPLY MODAL ─────────────── */}
      {replyModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Reply to Review</h2>
              <button
                onClick={() => setReplyModal(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Original review */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-gray-800">
                    {replyModal.review.reviewer}
                  </span>
                  <StarRating rating={replyModal.review.rating} />
                </div>
                <p className="text-sm text-gray-600">{replyModal.review.reviewText}</p>
              </div>

              {/* Reply mode toggle */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setReplyModal((prev) => prev && { ...prev, mode: 'ai' })}
                  className={`flex-1 py-2 text-sm rounded-lg font-medium border transition-colors ${
                    replyModal.mode === 'ai'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  🤖 AI Reply
                </button>
                <button
                  onClick={() => setReplyModal((prev) => prev && { ...prev, mode: 'custom' })}
                  className={`flex-1 py-2 text-sm rounded-lg font-medium border transition-colors ${
                    replyModal.mode === 'custom'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  ✍️ Custom Reply
                </button>
              </div>

              {/* AI generate button */}
              {replyModal.mode === 'ai' && (
                <button
                  onClick={handleGenerateAiReply}
                  disabled={replyModal.loading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
                >
                  {replyModal.loading ? (
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    '✨'
                  )}
                  Generate AI Reply
                </button>
              )}

              {/* Reply textarea */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {replyModal.mode === 'ai' ? 'Generated Reply (you can edit)' : 'Your Reply'}
                </label>
                <textarea
                  value={replyModal.text}
                  onChange={(e) =>
                    setReplyModal((prev) => prev && { ...prev, text: e.target.value })
                  }
                  rows={4}
                  placeholder={
                    replyModal.mode === 'ai'
                      ? 'Click "Generate AI Reply" above...'
                      : 'Write your reply to the customer...'
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setReplyModal(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitReply}
                disabled={!replyModal.text.trim() || replyModal.loading}
                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
              >
                {replyModal.loading && (
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                Publish Reply to Google
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
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4" />
            <p className="text-sm text-gray-500">Loading Google Business Profile...</p>
          </div>
        </div>
      }
    >
      <GbpPageInner />
    </Suspense>
  );
}
