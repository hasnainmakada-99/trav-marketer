import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { getDocument, listDocuments, updateDocument } from '@/lib/appwrite';

interface SegmentedCustomer {
  customerId: string;
  phone: string;
  name?: string;
}

/**
 * POST /api/campaigns/[id]/send
 * Send a campaign to all recipients
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { campaignId, teamId } = body;

    if (!campaignId) {
      return NextResponse.json(
        { error: 'Missing campaignId' },
        { status: 400 }
      );
    }

    // Get campaign details
    const campaign = await getDocument('campaigns', campaignId).catch(() => null) as
      | {
          title?: string;
          teamId?: string;
          segment?: string;
          segmentValue?: string;
          message?: string;
          templateName?: string | null;
        }
      | null;

    if (!campaign?.title) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    }

    // Get customers based on segment
    const recipients = await getSegmentedCustomers(
      teamId || campaign.teamId,
      campaign.segment,
      campaign.segmentValue
    );

    // Send bulk message via WhatsApp API
    const sendResponse = await fetch(
      `${request.nextUrl.origin}/api/whatsapp/send`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          campaignId,
          recipients,
          message: campaign.message,
          templateName: campaign.templateName,
          teamId: campaign.teamId,
        }),
      }
    );

    const sendResult = await sendResponse.json();

    if (!sendResult.success) {
      return NextResponse.json(
        { error: 'Failed to send campaign' },
        { status: 400 }
      );
    }

    // Update campaign status
    await updateDocument('campaigns', campaignId, {
      status: 'sent',
      sentAt: new Date().toISOString(),
      totalSent: sendResult.sent,
    });

    return NextResponse.json(
      {
        success: true,
        campaignId,
        totalRecipients: recipients.length,
        sent: sendResult.sent,
        failed: sendResult.failed,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Campaign Send] Error:', error);
    return NextResponse.json(
      { error: 'Failed to send campaign' },
      { status: 500 }
    );
  }
}

/**
 * Get customers based on segment criteria
 */
async function getSegmentedCustomers(
  teamId: string,
  segment: string,
  segmentValue?: string
): Promise<SegmentedCustomer[]> {
  try {
    const queries: string[] = [
      Query.equal('teamId', teamId),
    ];

    // Filter by segment type
    switch (segment) {
      case 'high-value':
        queries.push(Query.greaterThan('totalSpent', 5000));
        break;

      case 'inactive':
        // Last contact > 30 days ago
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        queries.push(Query.lessThan('lastContactedAt', thirtyDaysAgo.toISOString()));
        break;

      case 'service':
        if (segmentValue) {
          // Note: Appwrite doesn't have array contains, this is a workaround
          // In production, you'd filter this on the client side
          // queries.push(Query.search('services', segmentValue));
        }
        break;

      // 'all' or default - no additional filters
    }

    queries.push(Query.limit(1000), Query.offset(0));

    const result = await listDocuments('customers', queries);
    return (result.documents as Array<{ $id: string; phone?: string; name?: string }>).map((doc) => ({
      customerId: doc.$id,
      phone: doc.phone || '',
      name: doc.name,
    }));
  } catch (error) {
    console.error('Error getting segmented customers:', error);
    return [];
  }
}
