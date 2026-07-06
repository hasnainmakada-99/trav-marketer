import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { listDocuments } from '@/lib/appwrite';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

interface FieldMap {
  header: string;
  key: string;
}

const TYPE_CONFIG: Record<string, { collection: string; fields: FieldMap[] }> = {
  leads: {
    collection: 'leads',
    fields: [
      { header: 'ID', key: '$id' },
      { header: 'Name', key: 'name' },
      { header: 'Phone', key: 'phone' },
      { header: 'Email', key: 'email' },
      { header: 'Source', key: 'source' },
      { header: 'Status', key: 'status' },
      { header: 'Notes', key: 'notes' },
      { header: 'Created At', key: '$createdAt' },
      { header: 'Last Contacted', key: 'lastContactedAt' },
    ],
  },
  transactions: {
    collection: 'transactions',
    fields: [
      { header: 'ID', key: '$id' },
      { header: 'Customer Name', key: 'customerName' },
      { header: 'Service', key: 'service' },
      { header: 'Amount', key: 'amount' },
      { header: 'Date', key: 'date' },
      { header: 'Status', key: 'status' },
      { header: 'Notes', key: 'notes' },
      { header: 'Created At', key: '$createdAt' },
    ],
  },
  conversations: {
    collection: 'conversations',
    fields: [
      { header: 'ID', key: '$id' },
      { header: 'Phone', key: 'phone' },
      { header: 'Role', key: 'role' },
      { header: 'Message', key: 'message' },
      { header: 'Type', key: 'messageType' },
      { header: 'Sent By', key: 'sentBy' },
      { header: 'Created At', key: '$createdAt' },
    ],
  },
};

function extractField(doc: Record<string, any>, key: string): unknown {
  const val = doc[key];
  if (val !== undefined && val !== null) return val;
  if (key === '$id') return doc.id || doc.appwriteId || '';
  if (key === '$createdAt') return doc.created || doc.createdAt || '';
  if (key === '$updatedAt') return doc.updated || doc.updatedAt || '';
  return '';
}

function escapeCsv(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'leads';
    const format = searchParams.get('format') || 'csv';
    const teamId = searchParams.get('teamId') || TEAM_ID;

    const config = TYPE_CONFIG[type];
    if (!config) {
      return NextResponse.json(
        { error: 'Invalid export type. Use: leads, transactions, conversations' },
        { status: 400 }
      );
    }

    const result = await listDocuments(config.collection, [
      Query.equal('teamId', teamId),
      Query.limit(1000),
    ]);
    const documents = (result.documents || []) as Record<string, any>[];
    const fields = config.fields;

    if (format === 'json') {
      const data = documents.map((doc) => {
        const obj: Record<string, unknown> = {};
        for (const { header, key } of fields) {
          obj[header] = extractField(doc, key);
        }
        return obj;
      });
      return NextResponse.json({ data, total: documents.length, type, format });
    }

    const headers = fields.map((f) => f.header);
    const csvRows = [headers.join(',')];

    for (const doc of documents) {
      const row = fields.map(({ key }) => escapeCsv(extractField(doc, key)));
      csvRows.push(row.join(','));
    }

    const csv = csvRows.join('\n');
    const filename = `${type}-${new Date().toISOString().split('T')[0]}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
