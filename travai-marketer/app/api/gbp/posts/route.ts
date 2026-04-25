import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'appwrite';
import { generateGBPPost } from '@/lib/openai';
import {
  createDocument,
  listDocuments,
  getDocument,
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
      const business = await getDocument('business_configs', teamId);
      const businessContext = `Business: ${business.businessName}
Type: ${business.businessType}
Services: ${business.services?.join(', ') || 'General services'}
Description: ${business.description || 'No description'}`;
      
      const generatedContent = await generateGBPPost(
        businessContext,
        keywords || []
      );
      finalContent = generatedContent;
    }

    const post = await createDocument('gbp_posts', {
      teamId,
      title: title || 'Auto-generated Post',
      content: finalContent,
      googlePostId: null,
      status: 'draft',
      postedAt: null,
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

    const queries = [
      Query.equal('teamId', teamId),
    ];

    if (status) {
      queries.push(Query.equal('status', status));
    }

    queries.push(Query.limit(limit), Query.offset(offset));

    const posts = await listDocuments('gbp_posts', queries as any);

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
 * Update a GBP post
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { postId, ...updates } = body;

    if (!postId) {
      return NextResponse.json(
        { error: 'Missing postId' },
        { status: 400 }
      );
    }

    updates.updatedAt = new Date().toISOString();
    const post = await updateDocument('gbp_posts', postId, updates);

    return NextResponse.json(post, { status: 200 });
  } catch (error) {
    console.error('[GBP PATCH] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update GBP post' },
      { status: 500 }
    );
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
