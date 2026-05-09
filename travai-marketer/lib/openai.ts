/**
 * OpenAI Helper Functions
 * 
 * Utilities for AI chatbot responses, content generation, and more
 */

import OpenAI from 'openai';

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Get AI chatbot response based on conversation history
 */
export async function getChatResponse(
  userMessage: string,
  systemPrompt: string,
  conversationHistory: Message[] = [],
  model: string = 'gpt-4o'
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
      model: 'gpt-4o-mini',
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
  keywords: string[] = []
): Promise<string> {
  try {
    const systemPrompt = `You are an SEO expert and social media strategist.
Generate an engaging Google Business Profile post that:
- Includes relevant keywords for local SEO
- Is 150-300 characters
- Includes a call-to-action
- Is professional yet approachable`;

    const keywordsStr =
      keywords.length > 0 ? `Include these keywords: ${keywords.join(', ')}` : '';

    const userPrompt = `Generate a GBP post for this business:
${businessContext}
${keywordsStr}`;

    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
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
      model: 'gpt-4o-mini',
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
      model: 'gpt-4o-mini',
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
      model: 'gpt-4o-mini',
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
