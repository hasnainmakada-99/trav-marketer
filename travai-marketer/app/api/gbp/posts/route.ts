import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { generateGBPPost } from '@/lib/openai';
import {
  createGoogleLocalPost,
  getAccessTokenForTeam,
  getBusinessConfigByTeamId,
  type GbpCallToAction,
} from '@/lib/gbp';
import {
  createDocument,
  listDocuments,
  updateDocument,
  deleteDocument,
} from '@/lib/appwrite';

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
    } = body;

    if (!teamId || !createdBy) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    let finalContent = content;

    // Auto-generate content if requested
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
      
      const generatedContent = await generateGBPPost(
        businessContext,
        keywords || []
      );
      finalContent = generatedContent;
    }

    if (!finalContent || String(finalContent).trim().length === 0) {
      return NextResponse.json(
        { error: 'Post content is required (or enable autoGenerate)' },
        { status: 400 }
      );
    }

    let googlePostId: string | null = null;
    let status = 'draft';
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

      const createdPost = await createGoogleLocalPost(
        accessToken,
        locationName,
        String(finalContent || ''),
        typeof languageCode === 'string' ? languageCode : 'en',
        resolvedCta
      );

      googlePostId = createdPost.name || null;
      status = 'posted';
      postedAt = new Date().toISOString();
    }

    const post = await createDocument('gbp_posts', {
      teamId,
      title: title || 'Auto-generated Post',
      content: finalContent,
      googlePostId,
      status,
      postedAt,
      type: type || 'auto_generated',
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json(post, { status: 201 });
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
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!teamId) {
      return NextResponse.json(
        { error: 'Missing teamId parameter' },
        { status: 400 }
      );
    }

    const queries: string[] = [
      Query.equal('teamId', teamId),
    ];

    if (status) {
      queries.push(Query.equal('status', status));
    }

    queries.push(Query.limit(limit), Query.offset(offset));

    const posts = await listDocuments('gbp_posts', queries);

    return NextResponse.json(posts, { status: 200 });
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
    const { postId, publishNow, teamId, googleLocationName, languageCode, callToAction, ...updates } = body;

    if (!postId) {
      return NextResponse.json({ error: 'Missing postId' }, { status: 400 });
    }

    // If publishNow, call the Google API to actually publish the post
    if (publishNow) {
      const resolvedTeamId = teamId || process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || '';
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

      const content = updates.content || '';
      if (!content.trim()) {
        return NextResponse.json({ error: 'Post content is empty' }, { status: 400 });
      }

      const resolvedCta: GbpCallToAction | undefined =
        callToAction?.actionType && callToAction.actionType !== 'NONE'
          ? (callToAction as GbpCallToAction)
          : undefined;

      const createdPost = await createGoogleLocalPost(
        accessToken,
        locationName,
        content,
        typeof languageCode === 'string' ? languageCode : 'en',
        resolvedCta
      );

      updates.googlePostId = createdPost.name || null;
      updates.status = 'posted';
      updates.postedAt = new Date().toISOString();
    }

    updates.updatedAt = new Date().toISOString();
    const post = await updateDocument('gbp_posts', postId, updates);

    return NextResponse.json(post, { status: 200 });
  } catch (error) {
    console.error('[GBP PATCH] Error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to update GBP post';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/gbp/posts
 * Delete a GBP post
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { postId } = body;

    if (!postId) {
      return NextResponse.json(
        { error: 'Missing postId' },
        { status: 400 }
      );
    }

    await deleteDocument('gbp_posts', postId);

    return NextResponse.json(
      { success: true, message: 'Post deleted' },
      { status: 200 }
    );
  } catch (error) {
    console.error('[GBP DELETE] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete post' },
      { status: 500 }
    );
  }
}
