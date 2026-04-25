import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'appwrite';
import {
  createDocument,
  listDocuments,
  getDocument,
  updateDocument,
  deleteDocument,
} from '@/lib/appwrite';

/**
 * POST /api/campaigns
 * Create a new campaign
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      teamId,
      title,
      type,
      templateName,
      message,
      segment,
      segmentValue,
      scheduledAt,
      createdBy,
    } = body;

    if (!teamId || !title || !message || !createdBy) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const campaign = await createDocument('campaigns', {
      teamId,
      title,
      type: type || 'promotional',
      templateName: templateName || null,
      message,
      segment: segment || 'all',
      segmentValue: segmentValue || null,
      status: 'draft',
      scheduledAt: scheduledAt || null,
      sentAt: null,
      totalSent: 0,
      totalDelivered: 0,
      totalRead: 0,
      totalReplied: 0,
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    console.error('[Campaigns POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create campaign' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/campaigns
 * List campaigns for a team
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

    const campaigns = await listDocuments('campaigns', queries as any);

    return NextResponse.json(campaigns, { status: 200 });
  } catch (error) {
    console.error('[Campaigns GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch campaigns' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/campaigns/:id
 * Get a specific campaign
 */
export async function GET_ONE(request: NextRequest) {
  try {
    const { pathname } = new URL(request.url);
    const id = pathname.split('/').pop();

    if (!id) {
      return NextResponse.json(
        { error: 'Missing campaign ID' },
        { status: 400 }
      );
    }

    const campaign = await getDocument('campaigns', id);

    return NextResponse.json(campaign, { status: 200 });
  } catch (error) {
    console.error('[Campaigns GET_ONE] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch campaign' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/campaigns/:id
 * Update a campaign
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Missing campaign ID' },
        { status: 400 }
      );
    }

    updates.updatedAt = new Date().toISOString();
    const campaign = await updateDocument('campaigns', id, updates);

    return NextResponse.json(campaign, { status: 200 });
  } catch (error) {
    console.error('[Campaigns PATCH] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update campaign' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/campaigns/:id
 * Delete a campaign
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Missing campaign ID' },
        { status: 400 }
      );
    }

    await deleteDocument('campaigns', id);

    return NextResponse.json(
      { success: true, message: 'Campaign deleted' },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Campaigns DELETE] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete campaign' },
      { status: 500 }
    );
  }
}
