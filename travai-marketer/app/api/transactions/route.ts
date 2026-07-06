import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { createDocument, listDocuments, updateDocument, deleteDocument } from '@/lib/appwrite';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get('teamId');
    const customerId = searchParams.get('customerId');
    const limit = parseInt(searchParams.get('limit') || '50');

    if (!teamId) {
      return NextResponse.json({ error: 'Missing teamId' }, { status: 400 });
    }

    const filters = [Query.equal('teamId', teamId), Query.orderDesc('createdAt'), Query.limit(limit)];
    if (customerId) {
      filters.push(Query.equal('customerId', customerId));
    }

    const result = await listDocuments('transactions', filters);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { teamId, customerId, customerName, amount, service, date, notes, status } = await request.json();

    if (!teamId || !amount) {
      return NextResponse.json({ error: 'Missing required fields: teamId, amount' }, { status: 400 });
    }

    const transaction = await createDocument('transactions', {
      teamId,
      customerId: customerId || null,
      customerName: customerName || null,
      amount: Number(amount),
      service: service || 'General',
      date: date || new Date().toISOString().split('T')[0],
      notes: notes || null,
      status: status || 'completed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json(transaction, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { transactionId, ...updates } = await request.json();
    if (!transactionId) {
      return NextResponse.json({ error: 'Missing transactionId' }, { status: 400 });
    }

    const updated = await updateDocument('transactions', transactionId, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const transactionId = searchParams.get('transactionId');
    if (!transactionId) {
      return NextResponse.json({ error: 'Missing transactionId' }, { status: 400 });
    }

    await deleteDocument('transactions', transactionId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
