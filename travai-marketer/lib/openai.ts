/**
 * OpenAI Helper Functions
 * 
 * Utilities for AI chatbot responses, content generation, and more
 */

import OpenAI from 'openai';

let _openai: OpenAI | null = null;

function getSanitizedOpenAIKey() {
  return (process.env.OPENAI_API_KEY || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
}

function getPreferredChatModel() {
  const raw = (process.env.OPENAI_MODEL || '').trim();
  return raw.length > 0 ? raw : 'gpt-4o';
}

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: getSanitizedOpenAIKey() });
  }
  return _openai;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

type WorkflowSlotKey =
  | 'destination'
  | 'from_city'
  | 'to_city'
  | 'travel_time'
  | 'travellers'
  | 'departure_city'
  | 'nights'
  | 'name'
  | 'phone'
  | 'email'
  | 'callback_time'
  | 'holiday_type'
  | 'hotel_preference'
  | 'post_package_action';

/**
 * Get AI chatbot response based on conversation history
 */
export async function getChatResponse(
  userMessage: string,
  systemPrompt: string,
  conversationHistory: Message[] = [],
  model: string = getPreferredChatModel()
): Promise<string> {
  try {
    const messages: Message[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      ...conversationHistory,
      {
        role: 'user',
        content: userMessage,
      },
    ];

    const response = await getOpenAI().chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 500,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('Error getting chat response from OpenAI:', error);
    throw error;
  }
}

/**
 * Generate marketing campaign message
 */
export async function generateCampaignMessage(
  businessContext: string,
  campaignType: string,
  targetAudience?: string
): Promise<string> {
  try {
    const systemPrompt = `You are a marketing expert. Generate a compelling WhatsApp marketing message.
Keep it brief (under 150 chars), engaging, and action-oriented.
Include emojis sparingly.
Don't use salesy language.`;

    const userPrompt = `Generate a ${campaignType} campaign message for this business:
${businessContext}
${targetAudience ? `Target audience: ${targetAudience}` : ''}`;

    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      temperature: 0.8,
      max_tokens: 200,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('Error generating campaign message:', error);
    throw error;
  }
}

/**
 * Generate Google Business Profile post
 */
export async function generateGBPPost(
  businessContext: string,
  keywords: string[] = [],
  options?: {
    title?: string;
    media?: Array<{
      publicUrl: string;
      mimeType?: string;
      fileName?: string;
      mediaFormat?: 'PHOTO' | 'VIDEO';
    }>;
  }
): Promise<string> {
  try {
    const systemPrompt = `You are an SEO expert and social media strategist.
Generate an engaging Google Business Profile post that:
- Includes relevant keywords for local SEO
- Is 150-300 characters
- Includes a clear call-to-action
- Is professional yet approachable
- Matches the exact offer, destination, or visual context from the uploaded media when media is provided
- Never invent details that are not visible or not mentioned in the business context`;

    const keywordsStr =
      keywords.length > 0 ? `Include these keywords: ${keywords.join(', ')}` : '';
    const media = options?.media || [];
    const imageMedia = media.filter(
      (item) => item.mediaFormat === 'PHOTO' && item.publicUrl
    );
    const nonImageMedia = media.filter(
      (item) => item.mediaFormat !== 'PHOTO' || !item.publicUrl
    );

    const mediaNotes =
      nonImageMedia.length > 0
        ? `Additional uploaded media metadata:\n${nonImageMedia
            .map((item) => `- ${item.fileName || 'Untitled media'} (${item.mimeType || item.mediaFormat || 'unknown'})`)
            .join('\n')}`
        : '';

    const userPrompt = `Generate a GBP post for this business:
${businessContext}
${options?.title ? `Post title/context: ${options.title}` : ''}
${keywordsStr}
${media.length > 0 ? 'Use the uploaded post media as the primary creative context for the caption.' : ''}
${mediaNotes}`.trim();

    const userContent: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: userPrompt,
      },
    ];

    for (const item of imageMedia.slice(0, 4)) {
      userContent.push({
        type: 'image_url',
        image_url: {
          url: item.publicUrl,
        },
      });
    }

    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userContent as never,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('Error generating GBP post:', error);
    throw error;
  }
}

/**
 * Generate reply to Google review
 */
export async function generateReviewReply(
  businessContext: string,
  review: string,
  rating: number
): Promise<string> {
  try {
    const systemPrompt = `You are a customer service expert.
Generate a professional, warm reply to a Google Business Profile review.
- Keep it under 200 characters
- Address the reviewer by name if mentioned
- Be genuine and empathetic
- Include relevant keywords for SEO
- If positive review, thank them and encourage return
- If negative review, apologize and offer solution`;

    const userPrompt = `Generate a reply to this ${rating}-star review for our business:
Business: ${businessContext}
Review: "${review}"`;

    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 250,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('Error generating review reply:', error);
    throw error;
  }
}

/**
 * Generate business system prompt for AI training
 * This is the foundational prompt that trains the AI on business-specific info
 */
export async function generateSystemPrompt(
  businessName: string,
  businessType: string,
  services: string[],
  pricing: Record<string, string>,
  faq: Record<string, string>,
  tone: string = 'professional and friendly'
): Promise<string> {
  try {
    const servicesStr = services.join(', ');
    const pricingStr = Object.entries(pricing)
      .map(([service, price]) => `${service}: ${price}`)
      .join('\n');
    const faqStr = Object.entries(faq)
      .map(([question, answer]) => `Q: ${question}\nA: ${answer}`)
      .join('\n\n');

    const systemPrompt = `You are a customer service AI for ${businessName}, a ${businessType}.

ABOUT THE BUSINESS:
- Name: ${businessName}
- Type: ${businessType}
- Services offered: ${servicesStr}
- Tone: ${tone}

PRICING:
${pricingStr}

FREQUENTLY ASKED QUESTIONS:
${faqStr}

INSTRUCTIONS:
1. Answer customer questions based on the information above
2. Be helpful, honest, and maintain the business tone
3. If you don't know something, say so and offer to connect them with a team member
4. Always be professional and courteous
5. Suggest relevant services when appropriate
6. Never make up information about services, pricing, or policies
7. If customer seems interested in booking/purchasing, guide them appropriately`;

    return systemPrompt;
  } catch (error) {
    console.error('Error generating system prompt:', error);
    throw error;
  }
}

/**
 * Classify customer intent
 */
export async function classifyIntent(
  message: string,
  businessContext: string
): Promise<string> {
  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an intent classifier. Classify the customer's message into ONE category:
- inquiry: Asking about products/services
- complaint: Expressing dissatisfaction
- booking: Wanting to book/purchase
- followup: Following up on previous conversation
- spam: Not relevant to business
- other: Doesn't fit above

Respond with ONLY the category name.`,
        },
        {
          role: 'user',
          content: `Business context: ${businessContext}\n\nMessage: "${message}"`,
        },
      ],
      temperature: 0,
      max_tokens: 10,
    });

    return (response.choices[0]?.message?.content || 'other').trim().toLowerCase();
  } catch (error) {
    console.error('Error classifying intent:', error);
    return 'other';
  }
}

/**
 * Fix typos AND classify intent in a single GPT-4o-mini call.
 * Returns the corrected message text and the intent category.
 * Falls back to original text + 'other' on any error.
 */
export async function preprocessMessage(
  message: string,
  businessContext: string
): Promise<{ correctedText: string; intent: string }> {
  const fallback = { correctedText: message, intent: 'other' };
  if (!message?.trim()) return fallback;
  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a travel-assistant pre-processor. Do exactly two things:
1. SPELL-CHECK: Fix ONLY misspelled words, one word at a time. Do NOT add new words, do NOT reorder words, do NOT restructure the sentence, do NOT infer missing context or destinations. Only correct spelling. Examples: "fligths"→"flights", "exlcusive"→"exclusive", "Bangalroe"→"Bangalore", "Banglore"→"Bangalore", "persomalized"→"personalized", "Elusive"→"Exclusive". If a word is correct, leave it unchanged. If no errors, return as-is.
2. CLASSIFY INTENT into one of: inquiry | complaint | booking | followup | spam | other

Reply with ONLY valid JSON on a single line:
{"corrected":"<fixed message>","intent":"<category>"}`,
        },
        {
          role: 'user',
          content: `Context: ${businessContext}\nMessage: "${message}"`,
        },
      ],
      temperature: 0,
      max_tokens: 200,
    });

    const raw = (response.choices[0]?.message?.content || '').trim();
    const parsed = JSON.parse(raw);
    return {
      correctedText: (typeof parsed.corrected === 'string' && parsed.corrected.trim())
        ? parsed.corrected.trim()
        : message,
      intent: (typeof parsed.intent === 'string' ? parsed.intent : 'other')
        .toLowerCase()
        .trim(),
    };
  } catch {
    return fallback;
  }
}

/**
 * Extract key information from customer message
 */
export async function extractCustomerInfo(
  message: string
): Promise<{
  name?: string;
  email?: string;
  phone?: string;
  intendedService?: string;
}> {
  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Extract customer information from the message.
Return a JSON object with fields: name, email, phone, intendedService.
Only include fields that are clearly present in the message.`,
        },
        {
          role: 'user',
          content: message,
        },
      ],
      temperature: 0,
      max_tokens: 200,
    });

    const content = response.choices[0]?.message?.content || '{}';
    try {
      return JSON.parse(content);
    } catch {
      return {};
    }
  } catch (error) {
    console.error('Error extracting customer info:', error);
    return {};
  }
}

/**
 * AI-assisted workflow slot extraction.
 * Used as a fallback to fill missing slots when deterministic parsing misses
 * natural or comma-separated user phrasing.
 */
export async function extractWorkflowSlots(
  message: string,
  intentHint?: string
): Promise<Partial<Record<WorkflowSlotKey, string>>> {
  const fallback: Partial<Record<WorkflowSlotKey, string>> = {};
  if (!message?.trim()) return fallback;
  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Extract only explicitly stated workflow slots from the user's message.
Allowed keys only:
destination, from_city, to_city, travel_time, travellers, departure_city, nights, name, phone, email, callback_time, holiday_type, hotel_preference, post_package_action

Rules:
- Return ONLY valid JSON object. No markdown, no explanation.
- If a field is missing, omit it.
- Do not infer values not present in text.
- Keep values short plain strings.
- holiday_type can only be: "exclusive" or "personalized".
- post_package_action can only be: "get_details", "get_itinerary", "customize", "arrange_callback".`,
        },
        {
          role: 'user',
          content: `Intent hint: ${intentHint || 'unknown'}\nMessage: "${message}"`,
        },
      ],
      temperature: 0,
      max_tokens: 260,
    });

    const raw = (response.choices[0]?.message?.content || '').trim();
    const jsonText = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start < 0 || end <= start) return fallback;
    const parsed = JSON.parse(jsonText.slice(start, end + 1)) as Record<string, unknown>;

    const allowedKeys: WorkflowSlotKey[] = [
      'destination',
      'from_city',
      'to_city',
      'travel_time',
      'travellers',
      'departure_city',
      'nights',
      'name',
      'phone',
      'email',
      'callback_time',
      'holiday_type',
      'hotel_preference',
      'post_package_action',
    ];

    const out: Partial<Record<WorkflowSlotKey, string>> = {};
    for (const key of allowedKeys) {
      const value = parsed[key];
      if (typeof value !== 'string') continue;
      const cleaned = value.trim();
      if (!cleaned) continue;
      out[key] = cleaned;
    }

    if (out.holiday_type) {
      const normalized = out.holiday_type.toLowerCase();
      if (normalized !== 'exclusive' && normalized !== 'personalized') {
        delete out.holiday_type;
      } else {
        out.holiday_type = normalized;
      }
    }

    if (out.post_package_action) {
      const normalized = out.post_package_action.toLowerCase();
      if (!['get_details', 'get_itinerary', 'customize', 'arrange_callback'].includes(normalized)) {
        delete out.post_package_action;
      } else {
        out.post_package_action = normalized;
      }
    }

    if (out.phone) out.phone = out.phone.replace(/\s+/g, '');
    if (out.email) out.email = out.email.toLowerCase();
    if (out.nights) {
      const match = out.nights.match(/\d+/);
      if (match) out.nights = match[0];
    }

    return out;
  } catch (error) {
    console.error('Error extracting workflow slots:', error);
    return fallback;
  }
}
