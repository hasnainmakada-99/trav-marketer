import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { generateReviewReply } from '@/lib/openai';
import {
  getAccessTokenForTeam,
  getBusinessConfigByTeamId,
  listGoogleReviews,
  updateGoogleReviewReply,
} from '@/lib/gbp';
import {
  createDocument,
  listDocuments,
  updateDocument,
} from '@/lib/appwrite';

type StoredReview = {
  $id: string;
  teamId: string;
  googleReviewId: string;
  reviewer: string;
  rating: string | number;
  reviewText: string;
  reply?: string | null;
  replyStatus?: 'pending' | 'ready' | 'replied';
  repliedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
};

function starRatingToNumber(rating?: string): number {
  switch (rating) {
    case 'ONE':
      return 1;
    case 'TWO':
      return 2;
    case 'THREE':
      return 3;
    case 'FOUR':
      return 4;
    case 'FIVE':
      return 5;
    default:
      return 0;
  }
}

function normalizeStoredReview(review: StoredReview) {
  return {
    ...review,
    rating: Number(review.rating || 0),
    reply: review.reply || null,
    replyStatus: review.replyStatus || 'pending',
  };
}

async function syncGoogleReviewsToAppwrite(teamId: string) {
  const business = await getBusinessConfigByTeamId(teamId);

  if (!business?.googleLocationId) {
    throw new Error('No connected Google location found for team');
  }

  let googleReviews;
  try {
    const accessToken = await getAccessTokenForTeam(teamId);
    googleReviews = await listGoogleReviews(accessToken, business.googleLocationId);
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
    googleReviews = await listGoogleReviews(freshToken, business.googleLocationId);
  }
  const existing = await listDocuments('gbp_reviews', [
    Query.equal('teamId', teamId),
    Query.limit(200),
  ]);

  const existingByGoogleId = new Map<string, StoredReview>();
  for (const document of existing.documents) {
    const typed = document as unknown as StoredReview;
    if (typed.googleReviewId) {
      existingByGoogleId.set(typed.googleReviewId, typed);
    }
  }

  for (const review of googleReviews || []) {
    const googleReviewId = review.reviewId || review.name;
    if (!googleReviewId) {
      continue;
    }

    const payload = {
      teamId,
      googleReviewId,
      reviewer: review.reviewer?.displayName || 'Anonymous',
      rating: String(starRatingToNumber(review.starRating)),
      reviewText: review.comment || '',
      reply: review.reviewReply?.comment || null,
      replyStatus: review.reviewReply?.comment ? 'replied' : 'pending',
      repliedAt: review.reviewReply?.comment ? review.updateTime || new Date().toISOString() : null,
      createdAt: review.createTime || new Date().toISOString(),
      updatedAt: review.updateTime || new Date().toISOString(),
    };

    const existingReview = existingByGoogleId.get(googleReviewId);
    if (existingReview) {
      await updateDocument('gbp_reviews', existingReview.$id, payload);
    } else {
      const created = await createDocument('gbp_reviews', payload);
      existingByGoogleId.set(googleReviewId, created as unknown as StoredReview);
    }
  }

  const persisted = await listDocuments('gbp_reviews', [
    Query.equal('teamId', teamId),
    Query.orderDesc('updatedAt'),
    Query.limit(200),
  ]);

  return {
    synced: (googleReviews || []).length,
    documents: persisted.documents.map((document) =>
      normalizeStoredReview(document as unknown as StoredReview)
    ),
    total: persisted.total,
  };
}

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
      rating: String(rating),
      reviewText,
      reply: null,
      replyStatus: 'pending',
      repliedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json(normalizeStoredReview(review as unknown as StoredReview), { status: 201 });
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
      const synced = await syncGoogleReviewsToAppwrite(teamId);
      return NextResponse.json(
        {
          teamId,
          source: 'google',
          synced: synced.synced,
          total: synced.total,
          documents: synced.documents,
        },
        { status: 200 }
      );
    }

    const queries: string[] = [
      Query.equal('teamId', teamId),
    ];

    if (replyStatus) {
      queries.push(Query.equal('replyStatus', replyStatus));
    }

    queries.push(Query.orderDesc('updatedAt'), Query.limit(limit), Query.offset(offset));

    const reviews = await listDocuments('gbp_reviews', queries);

    return NextResponse.json(
      {
        ...reviews,
        documents: reviews.documents.map((document) =>
          normalizeStoredReview(document as unknown as StoredReview)
        ),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[GBP Reviews GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reviews' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/gbp/reviews
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
      publishNow,
    } = body;

    if (!reviewId || !teamId) {
      return NextResponse.json(
        { error: 'Missing reviewId or teamId' },
        { status: 400 }
      );
    }

    const reviews = await listDocuments('gbp_reviews', [
      Query.equal('teamId', teamId),
      Query.limit(200),
    ]);

    const review = reviews.documents.find((r) => r.$id === reviewId) as
      | StoredReview
      | undefined;

    if (!review) {
      return NextResponse.json(
        { error: 'Review not found' },
        { status: 404 }
      );
    }

    let replyText = customReply;

    if (autoGenerate && !customReply) {
      const business = businessContext || 'Business Name';
      replyText = await generateReviewReply(
        business,
        review.reviewText,
        Number(review.rating || 0)
      );
    }

    if (!replyText) {
      return NextResponse.json(
        { error: 'No reply provided' },
        { status: 400 }
      );
    }

    let replyStatusValue: 'ready' | 'replied' = 'ready';
    const updatePayload: Record<string, unknown> = {
      reply: replyText,
      updatedAt: new Date().toISOString(),
    };

    if (publishNow) {
      const accessToken = await getAccessTokenForTeam(teamId);
      const business = await getBusinessConfigByTeamId(teamId);
      const locationName = business?.googleLocationId;

      if (!locationName) {
        return NextResponse.json(
          { error: 'No connected Google location found for team' },
          { status: 400 }
        );
      }

      const reviewName = review.googleReviewId.startsWith('accounts/')
        ? review.googleReviewId
        : `${locationName}/reviews/${review.googleReviewId}`;

      await updateGoogleReviewReply(accessToken, reviewName, replyText);
      replyStatusValue = 'replied';
      updatePayload.repliedAt = new Date().toISOString();
    }

    updatePayload.replyStatus = replyStatusValue;
    const updated = await updateDocument('gbp_reviews', reviewId, updatePayload);

    return NextResponse.json(
      {
        success: true,
        review: normalizeStoredReview(updated as unknown as StoredReview),
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
 * PATCH /api/gbp/reviews
 * Dual-purpose:
 *   1. { autoReplyAll: true, teamId } - AI-generate and publish replies for all pending reviews
 *   2. { reviewId, ...updates }       - Update a single review field
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.autoReplyAll === true) {
      const { teamId } = body;
      if (!teamId) {
        return NextResponse.json({ error: 'Missing teamId' }, { status: 400 });
      }

      const business = await getBusinessConfigByTeamId(teamId);
      if (!business?.googleLocationId) {
        return NextResponse.json(
          { error: 'No connected Google location found for team' },
          { status: 400 }
        );
      }

      const pendingResult = await listDocuments('gbp_reviews', [
        Query.equal('teamId', teamId),
        Query.equal('replyStatus', 'pending'),
        Query.limit(50),
      ]);

      const pendingReviews = pendingResult.documents as unknown as StoredReview[];

      if (pendingReviews.length === 0) {
        return NextResponse.json({ replied: 0, message: 'No pending reviews' }, { status: 200 });
      }

      const accessToken = await getAccessTokenForTeam(teamId);
      const businessContext = `Business: ${business.businessName || 'Our Business'}`;
      let repliedCount = 0;
      const errors: string[] = [];

      for (const review of pendingReviews) {
        try {
          const replyText = await generateReviewReply(
            businessContext,
            review.reviewText || '',
            Number(review.rating || 0)
          );

          const reviewName = review.googleReviewId.startsWith('accounts/')
            ? review.googleReviewId
            : `${business.googleLocationId}/reviews/${review.googleReviewId}`;

          await updateGoogleReviewReply(accessToken, reviewName, replyText);

          await updateDocument('gbp_reviews', review.$id, {
            reply: replyText,
            replyStatus: 'replied',
            repliedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          repliedCount++;
        } catch (err) {
          errors.push(`Review ${review.$id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return NextResponse.json(
        {
          replied: repliedCount,
          total: pendingReviews.length,
          errors: errors.length > 0 ? errors : undefined,
        },
        { status: 200 }
      );
    }

    const { reviewId, ...updates } = body;

    if (!reviewId) {
      return NextResponse.json(
        { error: 'Missing reviewId or autoReplyAll flag' },
        { status: 400 }
      );
    }

    if (updates.rating !== undefined) {
      updates.rating = String(updates.rating);
    }
    updates.updatedAt = new Date().toISOString();

    if (updates.replyStatus === 'replied' && !updates.repliedAt) {
      updates.repliedAt = new Date().toISOString();
    }

    const updated = await updateDocument('gbp_reviews', reviewId, updates);

    return NextResponse.json(normalizeStoredReview(updated as unknown as StoredReview), { status: 200 });
  } catch (error) {
    console.error('[GBP Reviews PATCH] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update review' },
      { status: 500 }
    );
  }
}
