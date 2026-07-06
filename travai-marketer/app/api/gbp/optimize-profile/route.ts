import { NextRequest, NextResponse } from 'next/server';
import { listDocuments } from '@/lib/appwrite';
import { Query } from 'node-appwrite';

const TEAM_ID = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID || 'traventions-client-2026-gbp';

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await request.json();
    const tid = teamId || TEAM_ID;

    const configs = await listDocuments('business_configs', [
      Query.equal('teamId', tid),
      Query.limit(1),
    ]);

    if (!configs.documents.length) {
      return NextResponse.json({ error: 'No business config found' }, { status: 404 });
    }

    const config = configs.documents[0] as any;
    const businessName = config.businessName || 'Your Business';
    const businessDescription = config.businessDescription || '';
    const services = config.services || '';
    const location = config.location || '';

    const prompt = `You are an SEO expert for Google Business Profile. Based on this business information:

Business Name: ${businessName}
Current Description: ${businessDescription}
Services: ${services}
Location: ${location}

Generate an optimized Google Business Profile description (max 750 characters) that:
1. Starts with the business name and main service
2. Includes location-specific keywords (city, area, landmarks)
3. Lists top 3-5 services with relevant keywords
4. Ends with a call to action (call, visit, WhatsApp)
5. Uses natural language, NOT keyword stuffing
6. Is unique and compelling

Return ONLY the optimized description text, nothing else.`;

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${(process.env.OPENAI_API_KEY || '').trim()}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an SEO expert for Google Business Profile optimization. Return only the requested text, no explanations.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    const data = await openaiResponse.json();
    const optimizedDescription = (data.choices?.[0]?.message?.content || '').trim();

    const keywordPrompt = `For a ${businessName} in ${location} offering: ${services}, list 10 high-value SEO keywords/phrases (comma-separated) that would help the Google Business Profile rank higher in local search. Return only the comma-separated list.`;

    const keywordResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${(process.env.OPENAI_API_KEY || '').trim()}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an SEO keyword researcher. Return only the comma-separated list, nothing else.' },
          { role: 'user', content: keywordPrompt },
        ],
        max_tokens: 200,
        temperature: 0.5,
      }),
    });

    const keywordData = await keywordResponse.json();
    const keywords = (keywordData.choices?.[0]?.message?.content || '').trim();

    return NextResponse.json({
      success: true,
      businessName,
      optimizedDescription,
      keywords: keywords.split(',').map((k: string) => k.trim()).filter(Boolean),
    });
  } catch (error) {
    console.error('[GBP Optimize Profile]', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
