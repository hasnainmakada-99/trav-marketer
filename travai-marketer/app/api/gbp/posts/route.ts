import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { generateGBPPost } from '@/lib/openai';
import {
  createGoogleLocalPost,
  deleteGoogleLocalPost,
  getAccessTokenForTeam,
  getBusinessConfigByTeamId,
  listGoogleLocalPosts,
  type GbpCallToAction,
  type GoogleLocalPost,
  type GoogleLocalPostMedia,
} from '@/lib/gbp';
import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
  deleteDocument,
} from '@/lib/appwrite';

type StoredPost = {
  $id: string;
  teamId: string;
  title: string;
  content: string;
  googlePostId?: string | null;
  status: 'draft' | 'posted' | 'failed';
  postedAt?: string | null;
  type: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  mediaJson?: string;
  callToActionJson?: string;
  languageCode?: string;
  googleState?: string;
  googleSearchUrl?: string;
  syncSource?: string;
};

type PostMediaPayload = {
  mediaFormat: 'PHOTO' | 'VIDEO';
  publicUrl: string;
  fileName?: string;
  mimeType?: string;
  thumbnailUrl?: string;
};

function safeJsonParse<T>(value?: string | null): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function serializePost(document: StoredPost) {
  return {
    ...document,
    media: safeJsonParse<PostMediaPayload[]>(document.mediaJson) || [],
    callToAction:
      safeJsonParse<GbpCallToAction>(document.callToActionJson) || null,
  };
}

function inferPostTitle(content: string, title?: string | null) {
  if (title && title.trim()) {
    return title.trim();
  }
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'GBP Post';
  }
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
}

function toGoogleMedia(media: PostMediaPayload[] = []): GoogleLocalPostMedia[] {
  return media
    .filter((item) => item.publicUrl && item.mediaFormat)
    .map((item) => ({
      mediaFormat: item.mediaFormat,
      sourceUrl: item.publicUrl,
    }));
}

function mapGoogleStateToStatus(state?: string): 'draft' | 'posted' | 'failed' {
  if (!state) {
    return 'posted';
  }
  if (state === 'LIVE') {
    return 'posted';
  }
  if (state === 'PROCESSING') {
    return 'draft';
  }
  return 'failed';
}

function mapGooglePostToPayload(teamId: string, post: GoogleLocalPost): Omit<StoredPost, '$id'> {
  const media = (post.media || []).map((item) => ({
    mediaFormat: item.mediaFormat || 'PHOTO',
    publicUrl: item.googleUrl || item.sourceUrl || item.thumbnailUrl || '',
    thumbnailUrl: item.thumbnailUrl,
  }));
  const summary = String(post.summary || '').trim();

  return {
    teamId,
    title: inferPostTitle(summary),
    content: summary,
    googlePostId: post.name || null,
    status: mapGoogleStateToStatus(post.state),
    postedAt: post.createTime || post.updateTime || new Date().toISOString(),
    type: post.topicType ? post.topicType.toLowerCase() : 'google_sync',
    createdBy: 'google_sync',
    createdAt: post.createTime || new Date().toISOString(),
    updatedAt: post.updateTime || new Date().toISOString(),
    mediaJson: JSON.stringify(media.slice(0, 6)),
    callToActionJson: post.callToAction ? JSON.stringify(post.callToAction) : '',
    languageCode: post.languageCode || 'en',
    googleState: post.state || 'LIVE',
    googleSearchUrl: post.searchUrl || '',
    syncSource: 'google',
  };
}

async function syncGooglePostsToAppwrite(teamId: string) {
  const business = await getBusinessConfigByTeamId(teamId);

  if (!business?.googleLocationId) {
    throw new Error('No connected Google location found. Connect GBP first.');
  }

  let googlePosts: GoogleLocalPost[];
  try {
    const accessToken = await getAccessTokenForTeam(teamId);
    googlePosts = await listGoogleLocalPosts(accessToken, business.googleLocationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const shouldRefresh =
      message.includes('invalid authentication') ||
      message.includes('UNAUTHENTICATED') ||
      message.includes('401');
    if (!shouldRefresh) {
      throw error;
    }
    const freshToken = await getAccessTokenForTeam(teamId, { forceRefresh: true });
    googlePosts = await listGoogleLocalPosts(freshToken, business.googleLocationId);
  }
  const existing = await listDocuments('gbp_posts', [
    Query.equal('teamId', teamId),
    Query.limit(200),
  ]);

  const existingByGoogleId = new Map<string, StoredPost>();
  for (const document of existing.documents) {
    const typed = document as unknown as StoredPost;
    if (typed.googlePostId) {
      existingByGoogleId.set(typed.googlePostId, typed);
    }
  }

  for (const post of googlePosts) {
    if (!post.name) {
      continue;
    }

    const payload = mapGooglePostToPayload(teamId, post);
    const existingPost = existingByGoogleId.get(post.name);
    if (existingPost) {
      await updateDocument('gbp_posts', existingPost.$id, payload);
    } else {
      const created = await createDocument('gbp_posts', payload);
      existingByGoogleId.set(post.name, created as unknown as StoredPost);
    }
  }

  const liveGoogleIds = new Set(
    googlePosts
      .map((post) => post.name)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  );

  let pruned = 0;
  for (const document of existing.documents) {
    const typed = document as unknown as StoredPost;
    if (!typed.googlePostId) {
      continue;
    }
    if (liveGoogleIds.has(typed.googlePostId)) {
      continue;
    }

    // Mirror Google as the source of truth for published posts while leaving local drafts alone.
    await deleteDocument('gbp_posts', typed.$id);
    pruned += 1;
  }

  const persisted = await listDocuments('gbp_posts', [
    Query.equal('teamId', teamId),
    Query.orderDesc('updatedAt'),
    Query.limit(200),
  ]);

  return {
    synced: googlePosts.length,
    pruned,
    total: persisted.total,
    documents: persisted.documents.map((document) =>
      serializePost(document as unknown as StoredPost)
    ),
  };
}

/**
 * POST /api/gbp/posts
 * Create a new GBP post (AI-generated or manual)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      teamId,
      title,
      content,
      type,
      createdBy,
      autoGenerate,
      keywords,
      publishNow,
      googleLocationName,
      languageCode,
      callToAction,
      media,
      previewOnly,
    } = body;

    if (!teamId || !createdBy) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const normalizedMedia = Array.isArray(media) ? (media as PostMediaPayload[]) : [];
    let finalContent = content;

    if (autoGenerate) {
      const business = await getBusinessConfigByTeamId(teamId);
      if (!business) {
        return NextResponse.json(
          { error: 'Business configuration not found for team' },
          { status: 404 }
        );
      }
      const businessContext = `Business: ${business.businessName}
Description: ${String((business as unknown as Record<string, unknown>).businessDescription || 'No description')}`;

      finalContent = await generateGBPPost(businessContext, keywords || [], {
        title,
        media: normalizedMedia.map((item) => ({
          publicUrl: item.publicUrl,
          mimeType: item.mimeType,
          fileName: item.fileName,
          mediaFormat: item.mediaFormat,
        })),
      });
    }

    if (!finalContent || String(finalContent).trim().length === 0) {
      return NextResponse.json(
        { error: 'Post content is required (or enable autoGenerate)' },
        { status: 400 }
      );
    }

    if (previewOnly) {
      return NextResponse.json(
        {
          title: inferPostTitle(finalContent, title),
          content: finalContent,
          media: normalizedMedia,
          callToAction: callToAction || null,
        },
        { status: 200 }
      );
    }

    let googlePostId: string | null = null;
    let googleState = '';
    let googleSearchUrl = '';
    let status: 'draft' | 'posted' | 'failed' = 'draft';
    let postedAt: string | null = null;

    if (publishNow) {
      const accessToken = await getAccessTokenForTeam(teamId);
      const business = await getBusinessConfigByTeamId(teamId);
      const connectedLocation =
        typeof business?.googleLocationId === 'string' ? business.googleLocationId : null;
      const locationName =
        typeof googleLocationName === 'string' && googleLocationName.length > 0
          ? googleLocationName
          : connectedLocation;

      if (!locationName) {
        return NextResponse.json(
          { error: 'No connected Google location found. Connect GBP first.' },
          { status: 400 }
        );
      }

      const resolvedCta: GbpCallToAction | undefined =
        callToAction && callToAction.actionType && callToAction.actionType !== 'NONE'
          ? (callToAction as GbpCallToAction)
          : undefined;

      const postLang = typeof languageCode === 'string' ? languageCode : 'en';
      const postContent = String(finalContent || '');
      let createdPost: GoogleLocalPost;
      try {
        createdPost = await createGoogleLocalPost(
          accessToken,
          locationName,
          postContent,
          postLang,
          resolvedCta,
          toGoogleMedia(normalizedMedia)
        );
      } catch (googleErr) {
        const errMsg = googleErr instanceof Error ? googleErr.message : '';
        const isAuthError =
          errMsg.includes('invalid authentication') ||
          errMsg.includes('UNAUTHENTICATED') ||
          errMsg.includes('401');
        if (!isAuthError) {
          throw googleErr;
        }
        const freshToken = await getAccessTokenForTeam(teamId, { forceRefresh: true });
        createdPost = await createGoogleLocalPost(
          freshToken,
          locationName,
          postContent,
          postLang,
          resolvedCta,
          toGoogleMedia(normalizedMedia)
        );
      }

      googlePostId = createdPost.name || null;
      googleState = createdPost.state || 'LIVE';
      googleSearchUrl = createdPost.searchUrl || '';
      status = 'posted';
      postedAt = createdPost.createTime || new Date().toISOString();
    }

    const post = await createDocument('gbp_posts', {
      teamId,
      title: inferPostTitle(String(finalContent), title || 'Auto-generated Post'),
      content: finalContent,
      googlePostId,
      status,
      postedAt,
      type: type || (autoGenerate ? 'auto_generated' : 'manual'),
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mediaJson: JSON.stringify(normalizedMedia.slice(0, 6)),
      callToActionJson: callToAction ? JSON.stringify(callToAction) : '',
      languageCode: typeof languageCode === 'string' ? languageCode : 'en',
      googleState,
      googleSearchUrl,
      syncSource: publishNow ? 'app' : 'draft',
    });

    return NextResponse.json(serializePost(post as unknown as StoredPost), { status: 201 });
  } catch (error) {
    console.error('[GBP POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create GBP post' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/gbp/posts
 * List GBP posts for a team
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId');
    const status = searchParams.get('status');
    const syncFromGoogle = searchParams.get('syncFromGoogle') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!teamId) {
      return NextResponse.json(
        { error: 'Missing teamId parameter' },
        { status: 400 }
      );
    }

    if (syncFromGoogle) {
      const synced = await syncGooglePostsToAppwrite(teamId);
      return NextResponse.json(
        {
          teamId,
          source: 'google',
          synced: synced.synced,
          pruned: synced.pruned,
          total: synced.total,
          documents: synced.documents,
        },
        { status: 200 }
      );
    }

    const queries: string[] = [
      Query.equal('teamId', teamId),
    ];

    if (status) {
      queries.push(Query.equal('status', status));
    }

    queries.push(Query.orderDesc('updatedAt'), Query.limit(limit), Query.offset(offset));

    const posts = await listDocuments('gbp_posts', queries);

    return NextResponse.json(
      {
        ...posts,
        documents: posts.documents.map((document) =>
          serializePost(document as unknown as StoredPost)
        ),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[GBP GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch GBP posts' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/gbp/posts
 * Update or publish a GBP post
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { postId, publishNow, teamId, googleLocationName, languageCode, callToAction, media, ...updates } = body;

    if (!postId) {
      return NextResponse.json({ error: 'Missing postId' }, { status: 400 });
    }

    const existingPost = await getDocument('gbp_posts', postId) as unknown as StoredPost;
    const resolvedMedia =
      Array.isArray(media)
        ? (media as PostMediaPayload[])
        : safeJsonParse<PostMediaPayload[]>(existingPost.mediaJson) || [];
    const resolvedCallToAction =
      callToAction ||
      safeJsonParse<GbpCallToAction>(existingPost.callToActionJson) ||
      undefined;
    const resolvedLanguageCode =
      typeof languageCode === 'string'
        ? languageCode
        : existingPost.languageCode || 'en';

    if (publishNow) {
      const resolvedTeamId = teamId || existingPost.teamId || process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || '';
      if (!resolvedTeamId) {
        return NextResponse.json({ error: 'Missing teamId for publish' }, { status: 400 });
      }

      const accessToken = await getAccessTokenForTeam(resolvedTeamId);
      const business = await getBusinessConfigByTeamId(resolvedTeamId);
      const connectedLocation =
        typeof business?.googleLocationId === 'string' ? business.googleLocationId : null;
      const locationName =
        typeof googleLocationName === 'string' && googleLocationName.length > 0
          ? googleLocationName
          : connectedLocation;

      if (!locationName) {
        return NextResponse.json(
          { error: 'No Google location selected. Click your business name in the Setup tab first.' },
          { status: 400 }
        );
      }

      const content = String(updates.content || existingPost.content || '');
      if (!content.trim()) {
        return NextResponse.json({ error: 'Post content is empty' }, { status: 400 });
      }

      const resolvedCta: GbpCallToAction | undefined =
        resolvedCallToAction?.actionType && resolvedCallToAction.actionType !== 'NONE'
          ? resolvedCallToAction
          : undefined;

      let createdPost: GoogleLocalPost;
      try {
        createdPost = await createGoogleLocalPost(
          accessToken,
          locationName,
          content,
          resolvedLanguageCode,
          resolvedCta,
          toGoogleMedia(resolvedMedia)
        );
      } catch (googleErr) {
        const errMsg = googleErr instanceof Error ? googleErr.message : '';
        const isAuthError =
          errMsg.includes('invalid authentication') ||
          errMsg.includes('UNAUTHENTICATED') ||
          errMsg.includes('401');
        if (!isAuthError) {
          throw googleErr;
        }
        const freshToken = await getAccessTokenForTeam(resolvedTeamId, { forceRefresh: true });
        createdPost = await createGoogleLocalPost(
          freshToken,
          locationName,
          content,
          resolvedLanguageCode,
          resolvedCta,
          toGoogleMedia(resolvedMedia)
        );
      }

      updates.googlePostId = createdPost.name || null;
      updates.status = 'posted';
      updates.postedAt = createdPost.createTime || new Date().toISOString();
      updates.googleState = createdPost.state || 'LIVE';
      updates.googleSearchUrl = createdPost.searchUrl || '';
      updates.syncSource = 'app';
    }

    updates.mediaJson = JSON.stringify(resolvedMedia.slice(0, 6));
    updates.callToActionJson = resolvedCallToAction ? JSON.stringify(resolvedCallToAction) : '';
    updates.languageCode = resolvedLanguageCode;
    updates.updatedAt = new Date().toISOString();

    const post = await updateDocument('gbp_posts', postId, updates);

    return NextResponse.json(serializePost(post as unknown as StoredPost), { status: 200 });
  } catch (error) {
    console.error('[GBP PATCH] Error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to update GBP post';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/gbp/posts?postId=...
 * Delete a post from Appwrite and, if it was published, from Google too.
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const postId = searchParams.get('postId');

    if (!postId) {
      return NextResponse.json({ error: 'Missing postId' }, { status: 400 });
    }

    const doc = await getDocument('gbp_posts', postId) as unknown as StoredPost;

    if (doc.status === 'posted' && doc.googlePostId) {
      const teamId = doc.teamId || process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || '';
      if (teamId) {
        try {
          const accessToken = await getAccessTokenForTeam(teamId);
          try {
            await deleteGoogleLocalPost(accessToken, doc.googlePostId);
          } catch (googleErr) {
            const msg = googleErr instanceof Error ? googleErr.message : '';
            const isAuth =
              msg.includes('invalid authentication') ||
              msg.includes('UNAUTHENTICATED') ||
              msg.includes('401');
            if (isAuth) {
              const freshToken = await getAccessTokenForTeam(teamId, { forceRefresh: true });
              await deleteGoogleLocalPost(freshToken, doc.googlePostId);
            } else if (!msg.includes('NOT_FOUND') && !msg.includes('404')) {
              throw googleErr;
            }
          }
        } catch (tokenErr) {
          console.warn('[GBP DELETE] Could not delete from Google (token issue):', tokenErr);
        }
      }
    }

    await deleteDocument('gbp_posts', postId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[GBP DELETE] Error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to delete post';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
