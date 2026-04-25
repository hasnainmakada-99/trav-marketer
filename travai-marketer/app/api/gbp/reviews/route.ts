import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'appwrite';
import { generateReviewReply } from '@/lib/openai';
import {
  createDocument,
  listDocuments,
  updateDocument,
} from '@/lib/appwrite';

/**
 * POST /api/gbp/reviews
 * Create/add a new Google review record
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      teamId,
      googleReviewId,
      reviewer,
      rating,
      reviewText,
    } = body;

    if (!teamId || !googleReviewId || !reviewer || !rating || !reviewText) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const review = await createDocument('gbp_reviews', {
      teamId,
      googleReviewId,
      reviewer,
      rating,
      reviewText,
      reply: null,
      replyStatus: 'pending',
      repliedAt: null,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json(review, { status: 201 });
  } catch (error) {
    console.error('[GBP Reviews POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create review record' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/gbp/reviews
 * List reviews for a team
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId');
    const replyStatus = searchParams.get('replyStatus');
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

    if (replyStatus) {
      queries.push(Query.equal('replyStatus', replyStatus));
    }

    queries.push(Query.limit(limit), Query.offset(offset));

    const reviews = await listDocuments('gbp_reviews', queries as any);

    return NextResponse.json(reviews, { status: 200 });
  } catch (error) {
    console.error('[GBP Reviews GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reviews' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/gbp/reviews/[id]/reply
 * Generate and save a reply to a review
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      reviewId,
      teamId,
      businessContext,
      autoGenerate,
      customReply,
    } = body;

    if (!reviewId) {
      return NextResponse.json(
        { error: 'Missing reviewId' },
        { status: 400 }
      );
    }

    // Get the review
    const reviews = await listDocuments('gbp_reviews', [
      Query.equal('teamId', teamId),
    ]);

    const review = reviews.documents.find((r: any) => r.$id === reviewId);

    if (!review) {
      return NextResponse.json(
        { error: 'Review not found' },
        { status: 404 }
      );
    }

    let replyText = customReply;

    // Auto-generate reply if requested
    if (autoGenerate && !customReply) {
      const business = businessContext || `Business Name`;
      replyText = await generateReviewReply(
        business,
        review.reviewText,
        review.rating
      );
    }

    if (!replyText) {
      return NextResponse.json(
        { error: 'No reply provided' },
        { status: 400 }
      );
    }

    // Update the review with the reply
    const updated = await updateDocument('gbp_reviews', reviewId, {
      reply: replyText,
      replyStatus: 'ready',
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        success: true,
        review: updated,
        reply: replyText,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[GBP Reviews Reply] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate reply' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/gbp/reviews/[id]
 * Update a review (mark as replied, etc.)
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { reviewId, ...updates } = body;

    if (!reviewId) {
      return NextResponse.json(
        { error: 'Missing reviewId' },
        { status: 400 }
      );
    }

    updates.updatedAt = new Date().toISOString();

    // If marking as replied, set repliedAt timestamp
    if (updates.replyStatus === 'replied' && !updates.repliedAt) {
      updates.repliedAt = new Date().toISOString();
    }

    const updated = await updateDocument('gbp_reviews', reviewId, updates);

    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    console.error('[GBP Reviews PATCH] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update review' },
      { status: 500 }
    );
  }
}
