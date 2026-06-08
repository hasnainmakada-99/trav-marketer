'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCurrentUser } from '@/lib/appwrite-client';

interface AppwriteUser {
  $id: string;
  name: string;
  email: string;
}

interface GbpPostMedia {
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  mediaFormat: 'PHOTO' | 'VIDEO';
  publicUrl: string;
  thumbnailUrl?: string;
}

interface GbpCallToAction {
  actionType: 'BOOK' | 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'SIGN_UP' | 'CALL';
  url?: string;
  phoneNumber?: string;
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
  media?: GbpPostMedia[];
  callToAction?: GbpCallToAction | null;
  googleSearchUrl?: string | null;
}

interface GbpReview {
  $id?: string;
  reviewId?: string;
  googleReviewId?: string;
  reviewer: string;
  rating: number;
  reviewText: string;
  reply: string | null;
  replyStatus: 'pending' | 'ready' | 'replied';
  createdAt: string;
}

interface GbpAccountLocation {
  resourceName: string;
  v4LocationName: string;
  title?: string;
}

interface GbpAccount {
  accountName: string;
  accountDisplayName?: string;
  locations: GbpAccountLocation[];
}

type Tab = 'posts' | 'reviews' | 'setup';

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((step) => (
        <svg
          key={step}
          className={`h-4 w-4 ${step <= rating ? 'text-yellow-400' : 'text-gray-200'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

function Badge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    draft: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    posted: 'bg-green-50 text-green-700 border-green-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
    pending: 'bg-orange-50 text-orange-700 border-orange-200',
    ready: 'bg-blue-50 text-blue-700 border-blue-200',
    replied: 'bg-green-50 text-green-700 border-green-200',
  };
  const label: Record<string, string> = {
    draft: 'Draft',
    posted: 'Live',
    failed: 'Failed',
    pending: 'Needs Reply',
    ready: 'Ready',
    replied: 'Replied',
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone[status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
      {label[status] || status}
    </span>
  );
}

function MediaTile({ media, alt }: { media: GbpPostMedia; alt: string }) {
  if (media.mediaFormat === 'VIDEO') {
    return (
      <div className="flex h-20 w-24 items-center justify-center rounded-lg border border-gray-200 bg-slate-950 text-xs font-semibold text-white">
        VIDEO
      </div>
    );
  }

  return (
    <img
      src={media.thumbnailUrl || media.publicUrl}
      alt={alt}
      className="h-20 w-24 rounded-lg border border-gray-200 object-cover"
    />
  );
}

function GbpPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<AppwriteUser | null>(null);
  const [teamId, setTeamId] = useState('');
  const [tab, setTab] = useState<Tab>('posts');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const [connected, setConnected] = useState(false);
  const [hasLocation, setHasLocation] = useState(false);
  const [savedLocationId, setSavedLocationId] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [accounts, setAccounts] = useState<GbpAccount[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [manualLocationId, setManualLocationId] = useState('');

  const [posts, setPosts] = useState<GbpPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsSyncing, setPostsSyncing] = useState(false);

  const [reviews, setReviews] = useState<GbpReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsSyncing, setReviewsSyncing] = useState(false);
  const [autoReplying, setAutoReplying] = useState(false);

  const [showPostModal, setShowPostModal] = useState(false);
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<GbpPostMedia[]>([]);
  const [replyModal, setReplyModal] = useState<{ review: GbpReview; text: string; loading: boolean } | null>(null);
  const [postForm, setPostForm] = useState({
    title: '',
    content: '',
    keywords: '',
    autoGenerate: true,
    publishNow: false,
    callToAction: 'NONE',
    callToActionUrl: '',
    callToActionPhone: '',
  });

  const flash = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const resetPostComposer = useCallback(() => {
    setPostForm({
      title: '',
      content: '',
      keywords: '',
      autoGenerate: true,
      publishNow: false,
      callToAction: 'NONE',
      callToActionUrl: '',
      callToActionPhone: '',
    });
    setSelectedMedia([]);
  }, []);

  useEffect(() => {
    getCurrentUser().then((currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }
      const typed = currentUser as AppwriteUser;
      setUser(typed);
      setTeamId(process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || typed.$id);
    });
  }, [router]);

  useEffect(() => {
    const connectedParam = searchParams.get('connected');
    if (connectedParam === 'true') {
      flash('Google Business Profile connected.');
    } else if (connectedParam === 'false') {
      flash(`Connection failed: ${searchParams.get('reason') || 'Unknown error'}`, false);
    }
  }, [flash, searchParams]);

  const checkStatus = useCallback(async (resolvedTeamId: string) => {
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/gbp/status?teamId=${encodeURIComponent(resolvedTeamId)}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!data.connected) {
        await fetch('/api/gbp/migrate', { method: 'POST' });
        const retry = await fetch(`/api/gbp/status?teamId=${encodeURIComponent(resolvedTeamId)}&_=${Date.now()}`, {
          cache: 'no-store',
        });
        const nextData = await retry.json();
        setConnected(!!nextData.connected);
        setHasLocation(!!nextData.hasLocation);
        setSavedLocationId(nextData.googleLocationId || null);
        return;
      }
      setConnected(!!data.connected);
      setHasLocation(!!data.hasLocation);
      setSavedLocationId(data.googleLocationId || null);
    } catch {
      setConnected(false);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (teamId) {
      checkStatus(teamId);
    }
  }, [checkStatus, teamId]);

  const loadGoogleLocations = useCallback(async (resolvedTeamId: string, refresh = false) => {
    setLocationsLoading(true);
    setLocationsError(null);
    try {
      const res = await fetch(
        `/api/gbp/locations?teamId=${encodeURIComponent(resolvedTeamId)}${refresh ? '&refresh=true' : ''}`
      );
      const data = await res.json();
      setAccounts(data.accounts || []);
      setLocationsLoaded(true);
      if (data.error) {
        setLocationsError(data.reason || data.error);
      }
    } catch (error) {
      setLocationsError(error instanceof Error ? error.message : 'Failed to load locations');
    } finally {
      setLocationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (teamId && connected) {
      loadGoogleLocations(teamId);
    }
  }, [connected, loadGoogleLocations, teamId]);

  const loadPosts = useCallback(async (syncFromGoogle = false) => {
    if (!teamId) return;
    setPostsLoading(true);
    try {
      const res = await fetch(
        `/api/gbp/posts?teamId=${encodeURIComponent(teamId)}&limit=50${syncFromGoogle ? '&syncFromGoogle=true' : ''}`
      );
      if (res.ok) {
        const data = await res.json();
        setPosts(data.documents || []);
      }
    } finally {
      setPostsLoading(false);
    }
  }, [teamId]);

  const loadReviews = useCallback(async () => {
    if (!teamId) return;
    setReviewsLoading(true);
    try {
      const res = await fetch(`/api/gbp/reviews?teamId=${encodeURIComponent(teamId)}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setReviews(data.documents || []);
      }
    } finally {
      setReviewsLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (!connected || !teamId) return;
    if (tab === 'posts') {
      loadPosts();
    }
    if (tab === 'reviews') {
      loadReviews();
    }
  }, [connected, loadPosts, loadReviews, tab, teamId]);

  const allLocations = useMemo(
    () => accounts.flatMap((account) => account.locations.map((location) => ({ ...location, accountName: account.accountName }))),
    [accounts]
  );

  const postStats = useMemo(
    () => ({
      total: posts.length,
      live: posts.filter((post) => post.status === 'posted').length,
      drafts: posts.filter((post) => post.status === 'draft').length,
    }),
    [posts]
  );

  const reviewStats = useMemo(
    () => ({
      total: reviews.length,
      pending: reviews.filter((review) => review.replyStatus === 'pending').length,
      avg: reviews.length
        ? (reviews.reduce((sum, review) => sum + (review.rating || 0), 0) / reviews.length).toFixed(1)
        : '-',
    }),
    [reviews]
  );

  const hashtagCount = useMemo(
    () => (postForm.content.match(/#[A-Za-z0-9_]+/g) || []).length,
    [postForm.content]
  );

  const canPublishImmediately = postForm.publishNow && hasLocation;

  const handleConnect = () => {
    if (!teamId) return;
    window.location.href = `/api/gbp/connect?teamId=${encodeURIComponent(teamId)}&redirectTo=/dashboard/gbp`;
  };

  const handleSelectLocation = async (googleLocationId: string) => {
    try {
      const res = await fetch('/api/gbp/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, googleLocationId }),
      });
      if (!res.ok) {
        throw new Error('Failed to save location');
      }
      setSavedLocationId(googleLocationId);
      setHasLocation(true);
      flash('Location saved. Posts and reviews will now use this location.');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to save location', false);
    }
  };

  const handleUploadMedia = async (files: FileList | File[]) => {
    if (!teamId || files.length === 0) return;
    setMediaUploading(true);
    try {
      const formData = new FormData();
      formData.set('teamId', teamId);
      Array.from(files).forEach((file) => formData.append('files', file));

      const res = await fetch('/api/gbp/media', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setSelectedMedia((current) => [...current, ...(data.files || [])]);
      flash(`${data.files?.length || 0} media item(s) uploaded.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to upload media', false);
    } finally {
      setMediaUploading(false);
    }
  };

  const handleSyncPosts = async () => {
    if (!hasLocation) {
      flash('Set a Google Business location first.', false);
      return;
    }
    setPostsSyncing(true);
    try {
      const res = await fetch(`/api/gbp/posts?teamId=${encodeURIComponent(teamId)}&syncFromGoogle=true`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sync posts');
      }
      setPosts(data.documents || []);
      flash(`Synced ${data.synced || 0} post(s) from Google.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to sync posts', false);
    } finally {
      setPostsSyncing(false);
    }
  };

  const handleSyncReviews = async () => {
    if (!hasLocation) {
      flash('Set a Google Business location first.', false);
      return;
    }
    setReviewsSyncing(true);
    try {
      const res = await fetch(`/api/gbp/reviews?teamId=${encodeURIComponent(teamId)}&syncFromGoogle=true`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sync reviews');
      }
      setReviews(data.documents || []);
      flash(`Synced ${data.synced || 0} review(s) from Google.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to sync reviews', false);
    } finally {
      setReviewsSyncing(false);
    }
  };

  const handleAiGeneratePreview = async () => {
    if (!user) return;
    setAiGenerating(true);
    try {
      const res = await fetch('/api/gbp/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          createdBy: user.$id,
          title: postForm.title || 'AI Travel Post',
          content: '',
          type: 'auto_generated',
          autoGenerate: true,
          previewOnly: true,
          publishNow: false,
          keywords: postForm.keywords.split(',').map((item) => item.trim()).filter(Boolean),
          media: selectedMedia,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate post');
      }
      setPostForm((current) => ({
        ...current,
        content: data.content || '',
        keywords: Array.isArray(data.keywords) ? data.keywords.join(', ') : current.keywords,
        autoGenerate: false,
      }));
      flash('AI content and SEO keywords generated. Review it, then save or publish.');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to generate post', false);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleCreatePost = async () => {
    if (!user) return;
    if (!postForm.content.trim()) {
      flash('Enter content or generate it with AI first.', false);
      return;
    }

    setPostSubmitting(true);
    try {
      const callToAction =
        postForm.callToAction !== 'NONE'
          ? {
              actionType: postForm.callToAction,
              ...(postForm.callToAction === 'CALL'
                ? { phoneNumber: postForm.callToActionPhone }
                : { url: postForm.callToActionUrl }),
            }
          : undefined;

      const res = await fetch('/api/gbp/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          createdBy: user.$id,
          title: postForm.title || 'GBP Post',
          content: postForm.content,
          type: postForm.autoGenerate ? 'auto_generated' : 'manual',
          autoGenerate: false,
          publishNow: postForm.publishNow && hasLocation,
          googleLocationName: savedLocationId,
          keywords: postForm.keywords.split(',').map((item) => item.trim()).filter(Boolean),
          media: selectedMedia,
          callToAction,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create post');
      }
      setShowPostModal(false);
      resetPostComposer();
      await loadPosts();
      flash(postForm.publishNow && hasLocation ? 'Post published to Google.' : 'Post saved as draft.');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to create post', false);
    } finally {
      setPostSubmitting(false);
    }
  };

  const handlePublishDraft = async (post: GbpPost) => {
    try {
      const res = await fetch('/api/gbp/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: post.$id,
          publishNow: true,
          teamId: post.teamId || teamId,
          content: post.content,
          media: post.media || [],
          callToAction: post.callToAction || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to publish post');
      }
      await loadPosts();
      flash('Draft published to Google.');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to publish post', false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm('Delete this post?')) return;
    try {
      const res = await fetch(`/api/gbp/posts?postId=${encodeURIComponent(postId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete post');
      }
      setPosts((current) => current.filter((post) => post.$id !== postId));
      flash('Post deleted.');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to delete post', false);
    }
  };

  const handleAutoReplyAll = async () => {
    if (!reviewStats.pending) {
      flash('No pending reviews to reply to.', false);
      return;
    }
    if (!confirm(`Generate and publish AI replies for ${reviewStats.pending} review(s)?`)) {
      return;
    }
    setAutoReplying(true);
    try {
      const res = await fetch('/api/gbp/reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, autoReplyAll: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to auto-reply');
      }
      await loadReviews();
      flash(`AI replied to ${data.replied || 0} review(s).`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to auto-reply', false);
    } finally {
      setAutoReplying(false);
    }
  };

  const handleGenerateAiReply = async () => {
    if (!replyModal) return;
    setReplyModal((current) => current && ({ ...current, loading: true }));
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
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate reply');
      }
      setReplyModal((current) => current && ({ ...current, text: data.reply || '', loading: false }));
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to generate reply', false);
      setReplyModal((current) => current && ({ ...current, loading: false }));
    }
  };

  const handleSubmitReply = async () => {
    if (!replyModal?.text.trim()) return;
    setReplyModal((current) => current && ({ ...current, loading: true }));
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
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to publish reply');
      }
      setReplyModal(null);
      await loadReviews();
      flash('Reply published to Google.');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to publish reply', false);
      setReplyModal((current) => current && ({ ...current, loading: false }));
    }
  };

  if (!user || statusLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="text-center">
          <div className="inline-block h-10 w-10 animate-spin rounded-full border-b-2 border-indigo-600" />
          <p className="mt-3 text-sm text-gray-500">Loading Google Business Profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full px-4 py-4 sm:px-6 sm:py-6 xl:px-8">
      {toast && (
        <div className={`fixed right-4 top-4 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <div className="overflow-hidden rounded-[34px] border border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.16),_transparent_28%),linear-gradient(135deg,#f8fbff_0%,#eef6ff_42%,#f8fffc_100%)] px-5 py-5 shadow-xl shadow-slate-200/60 sm:px-6 sm:py-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Google Presence Studio</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              Publish sharper GBP posts and keep reviews in sync
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              This workspace now handles live Google sync, media-aware AI captions, stronger local-search hashtags,
              and cleaner publishing controls so the team can work faster without fighting the form.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[26rem]">
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Connection</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">{connected ? 'Google account connected' : 'Needs Google connection'}</p>
              <p className="mt-1 text-xs text-slate-500">{hasLocation ? 'A live business location is selected.' : 'Pick a location before you publish.'}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Search Lift</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">AI captions now bias toward local SEO</p>
              <p className="mt-1 text-xs text-slate-500">Destination-led copy, CTA, and 3-5 focused hashtags at the end.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl py-5">
        {!connected && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center sm:p-12">
            <h2 className="text-xl font-semibold text-gray-900">Connect Google Business Profile</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
              Connect the Google account that manages the live business listing so TravAI can sync posts, reviews, and replies directly.
            </p>
            <button
              onClick={handleConnect}
              className="mt-6 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Connect with Google
            </button>
          </div>
        )}

        {connected && (
          <>
            {!hasLocation && (
              <div className="mb-5 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Select your Google Business location</p>
                    <p className="text-xs text-amber-600">Required before publishing posts or syncing reviews.</p>
                  </div>
                  <button
                    onClick={() => loadGoogleLocations(teamId, true)}
                    disabled={locationsLoading}
                    className="text-xs font-medium text-amber-800 underline disabled:opacity-50"
                  >
                    {locationsLoading ? 'Loading...' : 'Refresh from Google'}
                  </button>
                </div>

                {locationsError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {locationsError}
                  </div>
                )}

                {!locationsError && allLocations.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {allLocations.map((location) => (
                      <button
                        key={location.v4LocationName}
                        onClick={() => handleSelectLocation(location.v4LocationName)}
                        className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700"
                      >
                        {location.title || location.v4LocationName}
                      </button>
                    ))}
                  </div>
                )}

                {!locationsError && locationsLoaded && allLocations.length === 0 && (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                    No business locations were found for this Google account. Reconnect with the owner or manager account for the live listing.
                  </div>
                )}

                <div className="border-t border-amber-200 pt-3">
                  <p className="mb-2 text-xs font-medium text-amber-700">Enter location ID manually</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={manualLocationId}
                      onChange={(event) => setManualLocationId(event.target.value)}
                      placeholder="accounts/123456789/locations/987654321"
                      className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <button
                      onClick={() => manualLocationId.trim() && handleSelectLocation(manualLocationId.trim())}
                      disabled={!manualLocationId.trim()}
                      className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                    >
                      Use this location
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Total Posts', value: postStats.total, sub: `${postStats.live} live` },
                { label: 'Draft Posts', value: postStats.drafts, sub: 'Awaiting publish' },
                { label: 'Avg. Rating', value: reviewStats.avg, sub: 'out of 5 stars' },
                { label: 'Pending Replies', value: reviewStats.pending, sub: 'Need response' },
              ].map((card) => (
                <div key={card.label} className="rounded-[26px] border border-slate-200 bg-white/90 p-4 shadow-sm shadow-slate-200/60">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{card.value}</p>
                  <p className="mt-1 text-xs text-slate-400">{card.sub}</p>
                </div>
              ))}
            </div>

            <div className="mb-5 overflow-x-auto rounded-[24px] border border-slate-200 bg-white/90 p-1 shadow-sm shadow-slate-200/50">
              {(['posts', 'reviews', 'setup'] as Tab[]).map((value) => (
                <button
                  key={value}
                  onClick={() => setTab(value)}
                  className={`rounded-2xl px-5 py-3 text-sm font-medium capitalize transition-colors ${tab === value ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
                >
                  {value}
                </button>
              ))}
            </div>

            {tab === 'posts' && (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 rounded-[28px] border border-sky-100 bg-[linear-gradient(135deg,#f7fbff_0%,#eef4ff_58%,#f9f5ff_100%)] p-4 sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">GBP Post Studio</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Generate destination-aware captions, cleaner hashtags, and post copy that actually matches the media your customer uploads.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleSyncPosts}
                      disabled={postsSyncing || !hasLocation}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      {postsSyncing ? 'Syncing...' : 'Sync from Google'}
                    </button>
                    <button
                      onClick={() => setShowPostModal(true)}
                      className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                    >
                      Create AI Post
                    </button>
                  </div>
                </div>

                {postsLoading ? (
                  <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
                    <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
                    <p className="mt-3 text-sm text-gray-400">Loading posts...</p>
                  </div>
                ) : posts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
                    <p className="font-medium text-gray-700">No posts in the workspace yet</p>
                    <p className="mt-1 text-xs text-gray-400">Sync existing Google posts or create your first media-aware GBP post.</p>
                  </div>
                ) : (
                    <div className="space-y-3">
                      {posts.map((post) => (
                      <div key={post.$id} className="flex flex-col gap-4 rounded-[26px] border border-slate-200 bg-white/95 p-4 shadow-sm shadow-slate-200/60 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge status={post.status} />
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">{post.type === 'auto_generated' ? 'AI Draft' : 'Manual Post'}</span>
                          </div>
                          <div className="space-y-1">
                            <p className="text-base font-semibold tracking-tight text-slate-950">{post.title}</p>
                            <p className="max-w-4xl text-sm leading-6 text-slate-600">{post.content}</p>
                          </div>
                          {!!post.media?.length && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {post.media.slice(0, 4).map((media, index) => (
                                <MediaTile key={`${post.$id}-${index}`} media={media} alt={post.title} />
                              ))}
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                            {post.postedAt
                              ? `Published ${new Date(post.postedAt).toLocaleDateString('en-IN')}`
                              : `Draft | ${new Date(post.createdAt).toLocaleDateString('en-IN')}`}
                            {!!post.media?.length && <span>{post.media.length} media item(s)</span>}
                          </div>
                          {post.googleSearchUrl && (
                            <a
                              href={post.googleSearchUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex text-xs font-semibold text-sky-700 hover:text-sky-800"
                            >
                              View on Google
                            </a>
                          )}
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          {post.status === 'draft' && (
                            <button
                              onClick={() => handlePublishDraft(post)}
                              className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700"
                            >
                              Publish
                            </button>
                          )}
                          <button
                            onClick={() => handleDeletePost(post.$id)}
                            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

            {tab === 'reviews' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-gray-900">Customer Reviews</h2>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleSyncReviews}
                      disabled={reviewsSyncing || !hasLocation}
                      className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                    >
                      {reviewsSyncing ? 'Syncing...' : 'Sync from Google'}
                    </button>
                    <button
                      onClick={handleAutoReplyAll}
                      disabled={autoReplying || reviewStats.pending === 0}
                      className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {autoReplying ? 'Replying...' : `Auto-Reply All (${reviewStats.pending})`}
                    </button>
                  </div>
                </div>

                {reviewsLoading ? (
                  <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
                    <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
                    <p className="mt-3 text-sm text-gray-400">Loading reviews...</p>
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
                    <p className="font-medium text-gray-700">No reviews synced yet</p>
                    <p className="mt-1 text-xs text-gray-400">{hasLocation ? 'Sync reviews from Google to bring the live listing into Appwrite.' : 'Set a business location first, then sync reviews.'}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reviews.map((review, index) => (
                      <div key={review.$id || review.googleReviewId || review.reviewId || index} className="rounded-xl border border-gray-200 bg-white p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-sm font-bold text-white">
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
                            <p className="ml-12 text-sm text-gray-600">{review.reviewText || 'No review text'}</p>
                            {review.reply && (
                              <div className="ml-12 mt-3 rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-600">Your reply</p>
                                <p className="text-sm text-gray-700">{review.reply}</p>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <Badge status={review.replyStatus || 'pending'} />
                            {review.replyStatus === 'pending' && (
                              <button
                                onClick={() => setReplyModal({ review, text: '', loading: false })}
                                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
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

            {tab === 'setup' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-gray-200 bg-white p-5">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700">Google Business Location</h3>
                      <p className="text-xs text-gray-400">Choose the location used for live post publishing and review sync.</p>
                    </div>
                    <button
                      onClick={() => loadGoogleLocations(teamId, true)}
                      disabled={locationsLoading}
                      className="text-xs font-medium text-indigo-600 underline disabled:opacity-50"
                    >
                      {locationsLoading ? 'Loading...' : 'Refresh from Google'}
                    </button>
                  </div>

                  {allLocations.length === 0 ? (
                    <p className="text-sm text-gray-400">No locations cached yet. Refresh from Google or reconnect the correct account.</p>
                  ) : (
                    <div className="space-y-2">
                      {allLocations.map((location) => (
                        <div
                          key={location.v4LocationName}
                          className={`flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${savedLocationId === location.v4LocationName ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'}`}
                        >
                          <div>
                            <p className="text-sm font-medium text-gray-900">{location.title || 'Unnamed Location'}</p>
                            <p className="mt-0.5 text-xs font-mono text-gray-400">{location.v4LocationName}</p>
                          </div>
                          {savedLocationId === location.v4LocationName ? (
                            <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-700">Active</span>
                          ) : (
                            <button
                              onClick={() => handleSelectLocation(location.v4LocationName)}
                              className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
                            >
                              Select
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-5">
                  <h3 className="text-sm font-semibold text-gray-700">Reconnect Account</h3>
                  <p className="mt-1 text-xs text-gray-400">Reconnect if the token expires or you need to switch Google accounts.</p>
                  <button
                    onClick={handleConnect}
                    className="mt-4 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Reconnect with Google
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showPostModal && (
        <div className="fixed inset-0 z-50 bg-black/62 p-3 sm:p-5">
          <div className="mx-auto flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-white/20 bg-white shadow-2xl shadow-slate-950/30">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
              <button
                onClick={() => {
                  setShowPostModal(false);
                  resetPostComposer();
                }}
                className="rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              >
                Back
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold tracking-tight text-slate-950">Create Google post</h2>
                <p className="text-xs text-slate-500">Build a tighter caption, stronger hashtags, and a cleaner publish flow.</p>
              </div>
              <button
                onClick={handleAiGeneratePreview}
                disabled={aiGenerating}
                className="rounded-xl bg-[linear-gradient(135deg,#7c3aed_0%,#9333ea_52%,#3b82f6_100%)] px-4 py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.01] disabled:opacity-60"
              >
                {aiGenerating ? 'Generating...' : 'Generate with AI'}
              </button>
              <button
                onClick={() => {
                  setShowPostModal(false);
                  resetPostComposer();
                }}
                className="rounded-xl px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                Close
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(0,1.45fr)_340px]">
              <div className="min-h-0 overflow-y-auto bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] px-5 py-5">
                <div className="space-y-4">
                  <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Post Headline
                    </label>
                    <input
                      type="text"
                      value={postForm.title}
                      onChange={(event) => setPostForm((current) => ({ ...current, title: event.target.value }))}
                      placeholder="Travel South Goa"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                    />
                  </div>

                  <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Caption</p>
                        <p className="mt-1 text-xs text-slate-500">Keep it sharp, local, and visually connected to the uploaded creative.</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-500">{postForm.content.length}/1500 chars</span>
                        <span className={`rounded-full px-2.5 py-1 font-medium ${hashtagCount >= 3 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          {hashtagCount} hashtag{hashtagCount === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>

                    <textarea
                      value={postForm.content}
                      onChange={(event) => setPostForm((current) => ({ ...current, content: event.target.value, autoGenerate: false }))}
                      rows={9}
                      maxLength={1500}
                      placeholder="Write the post copy or generate it with AI"
                      className="min-h-[280px] w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-base leading-8 text-slate-800 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                    />

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>{selectedMedia.length ? `${selectedMedia.length} media item(s) attached` : 'Attach media before generating for the best result'}</span>
                      <span>Best practice: end with 3-5 location-driven hashtags</span>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        SEO Keywords
                      </label>
                      <input
                        type="text"
                        value={postForm.keywords}
                        onChange={(event) => setPostForm((current) => ({ ...current, keywords: event.target.value }))}
                        placeholder="e.g. South Goa holiday, Palolem beach, luxury trip"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                      />
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        AI fills this after generation using destination, business context, and uploaded media. You can fine-tune it manually any time.
                      </p>
                    </div>

                    <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Call To Action
                      </label>
                      <select
                        value={postForm.callToAction}
                        onChange={(event) =>
                          setPostForm((current) => ({
                            ...current,
                            callToAction: event.target.value,
                            callToActionUrl: '',
                            callToActionPhone: '',
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                      >
                        <option value="NONE">None</option>
                        <option value="BOOK">Book</option>
                        <option value="ORDER">Order online</option>
                        <option value="SHOP">Shop</option>
                        <option value="LEARN_MORE">Learn more</option>
                        <option value="SIGN_UP">Sign up</option>
                        <option value="CALL">Call now</option>
                      </select>
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        Choose one strong action so the post feels focused instead of crowded.
                      </p>
                    </div>
                  </div>

                  {postForm.callToAction !== 'NONE' && postForm.callToAction !== 'CALL' && (
                    <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Destination URL
                      </label>
                      <input
                        type="url"
                        value={postForm.callToActionUrl}
                        onChange={(event) => setPostForm((current) => ({ ...current, callToActionUrl: event.target.value }))}
                        placeholder="https://your-website.com"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                      />
                    </div>
                  )}

                  {postForm.callToAction === 'CALL' && (
                    <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={postForm.callToActionPhone}
                        onChange={(event) => setPostForm((current) => ({ ...current, callToActionPhone: event.target.value }))}
                        placeholder="+91 98765 43210"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                      />
                    </div>
                  )}
                </div>
              </div>

              <aside className="min-h-0 overflow-y-auto border-t border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#f6f9ff_58%,#fbfffd_100%)] px-5 py-5 xl:border-l xl:border-t-0">
                <div className="space-y-4">
                  <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Media Panel</p>
                    <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">Upload the creative first</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      The AI now reads the actual uploaded post context before building the caption.
                    </p>

                    <label className="mt-4 flex cursor-pointer items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50">
                      {mediaUploading ? 'Uploading...' : 'Select images and videos'}
                      <input
                        type="file"
                        accept="image/*,video/*"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          if (event.target.files?.length) {
                            handleUploadMedia(event.target.files);
                            event.target.value = '';
                          }
                        }}
                      />
                    </label>

                    {selectedMedia.length > 0 ? (
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        {selectedMedia.map((media, index) => (
                          <div key={`${media.fileId || media.publicUrl}-${index}`} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-950/95 p-2">
                            <MediaTile media={media} alt={media.fileName || 'Media'} />
                            <button
                              onClick={() => setSelectedMedia((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                              className="absolute right-2 top-2 rounded-full bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-slate-900 shadow"
                            >
                              x
                            </button>
                            <p className="mt-2 truncate text-[11px] font-medium text-white/90">{media.fileName || media.mediaFormat}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-xs leading-6 text-slate-500">
                        Add at least one image or video to help the AI stay aligned with the exact destination or offer.
                      </div>
                    )}
                  </div>

                  <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Publishing</p>
                    <div className="mt-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-slate-900">Publish immediately</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          If no location is selected, the post will still save safely as a draft.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={postForm.publishNow}
                        onClick={() => setPostForm((current) => ({ ...current, publishNow: !current.publishNow }))}
                        className={`inline-flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors ${
                          postForm.publishNow ? 'bg-slate-950' : 'bg-slate-200'
                        }`}
                      >
                        <span
                          className={`h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                            postForm.publishNow ? 'translate-x-6' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600">
                      {canPublishImmediately
                        ? 'This post is ready to publish to the live Google Business location as soon as you click publish.'
                        : 'This post will save as a draft until a GBP location is selected or publish is toggled back on later.'}
                    </div>
                  </div>

                  <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Caption Checklist</p>
                    <div className="mt-3 space-y-2 text-sm text-slate-600">
                      <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                        <span>Media attached</span>
                        <span className={selectedMedia.length ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                          {selectedMedia.length ? 'Yes' : 'Add one'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                        <span>SEO keywords</span>
                        <span className={postForm.keywords.trim() ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                          {postForm.keywords.trim() ? 'Ready' : 'Optional'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                        <span>Hashtag strength</span>
                        <span className={hashtagCount >= 3 ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                          {hashtagCount >= 3 ? 'Strong' : 'Needs 3+'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </aside>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                onClick={() => {
                  setShowPostModal(false);
                  resetPostComposer();
                }}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePost}
                disabled={postSubmitting || !postForm.content.trim()}
                className="rounded-2xl bg-[linear-gradient(135deg,#2563eb_0%,#1d4ed8_58%,#3b82f6_100%)] px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition-transform hover:scale-[1.01] disabled:opacity-60"
              >
                {postSubmitting ? 'Saving...' : canPublishImmediately ? 'Publish Post' : 'Save Draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {replyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-base font-semibold text-gray-900">Reply to Review</h2>
              <button onClick={() => setReplyModal(null)} className="rounded p-1 text-gray-400 hover:text-gray-600">
                Close
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800">{replyModal.review.reviewer}</span>
                  <StarRating rating={replyModal.review.rating} />
                </div>
                <p className="text-sm text-gray-600">{replyModal.review.reviewText}</p>
              </div>
              <button
                onClick={handleGenerateAiReply}
                disabled={replyModal.loading}
                className="w-full rounded-xl bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-60"
              >
                {replyModal.loading ? 'Generating...' : 'Generate AI Reply'}
              </button>
              <textarea
                value={replyModal.text}
                onChange={(event) => setReplyModal((current) => current && ({ ...current, text: event.target.value }))}
                rows={5}
                placeholder="Write or generate the reply"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-gray-200 px-6 py-4 sm:flex-row sm:justify-end">
              <button onClick={() => setReplyModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Cancel
              </button>
              <button
                onClick={handleSubmitReply}
                disabled={!replyModal.text.trim() || replyModal.loading}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
              >
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
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center px-4">
          <div className="inline-block h-10 w-10 animate-spin rounded-full border-b-2 border-indigo-600" />
        </div>
      }
    >
      <GbpPageInner />
    </Suspense>
  );
}
