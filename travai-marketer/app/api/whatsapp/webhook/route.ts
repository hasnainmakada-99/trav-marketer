import { NextRequest, NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { parseWhatsAppWebhook, verifyWebhookToken, sendWhatsAppMessage } from '@/lib/whatsapp';
import { getChatResponse, classifyIntent, extractCustomerInfo } from '@/lib/openai';
import { createDocument, getDocument, listDocuments, updateDocument } from '@/lib/appwrite';

// Verify webhook token from Meta
const WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'travai_secure_token_2024';

/**
 * GET /api/whatsapp/webhook
 * Meta's webhook verification endpoint
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    if (mode !== 'subscribe' || !token || !challenge) {
      return NextResponse.json(
        { error: 'Invalid webhook parameters' },
        { status: 400 }
      );
    }

    // Verify the token
    if (!verifyWebhookToken(token, WEBHOOK_VERIFY_TOKEN)) {
      return NextResponse.json(
        { error: 'Invalid verification token' },
        { status: 403 }
      );
    }

    // Return the challenge to complete verification
    return new NextResponse(challenge, { status: 200 });
  } catch (error) {
    console.error('[WhatsApp Webhook] GET Error:', error);
    return NextResponse.json(
      { error: 'Webhook verification failed' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/whatsapp/webhook
 * Receive and process messages from Meta
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate webhook signature (implement X-Hub-Signature verification in production)
    // const signature = request.headers.get('X-Hub-Signature-256');

    // Parse the webhook payload
    const webhook = parseWhatsAppWebhook(body);

    if (!webhook) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const { messages, statuses } = webhook;

    // Process incoming messages
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        await processIncomingMessage(msg);
      }
    }

    // Process message statuses (delivered, read, failed)
    if (statuses && statuses.length > 0) {
      for (const status of statuses) {
        await processMessageStatus(status);
      }
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('[WhatsApp Webhook] POST Error:', error);
    return NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500 }
    );
  }
}

/**
 * Process an incoming message from WhatsApp
 */
async function processIncomingMessage(message: any) {
  try {
    const { phone, timestamp, type, text, messageId } = message;

    console.log(`📨 Incoming ${type} message from ${phone}:`, text || messageId);

    // Find or create customer record
    let customer = await findOrCreateCustomer(phone);

    // Extract customer info from message (name, email, etc.)
    const extractedInfo = await extractCustomerInfo(text || '');
    if (extractedInfo.name && !customer.name) {
      customer = await updateDocument('customers', customer.$id, {
        name: extractedInfo.name,
        email: extractedInfo.email,
        phone: extractedInfo.phone || phone,
      });
    }

    // Save the conversation message
    await createDocument('conversations', {
      teamId: customer.teamId,
      customerId: customer.$id,
      phone: phone,
      role: 'user',
      message: text || `[${type}]`,
      messageType: type,
      sentBy: 'customer',
      metaMessageId: messageId || null,
      deliveryStatus: 'received',
      createdAt: new Date().toISOString(),
    });

    // Classify the intent
    const businessContext = `Business: ${customer.businessName || 'Unknown'}, Type: ${customer.businessType || 'general'}, Services: ${customer.services?.join(', ') || 'general'}`;
    const intent = await classifyIntent(text || '', businessContext);

    // If it's an inquiry or greeting, generate an AI response
    if (['inquiry', 'greeting', 'booking'].includes(intent)) {
      await generateAndSendResponse(customer, text, phone, intent);
    } else if (intent === 'complaint') {
      // Route complaints to staff
      await createDocument('leads', {
        teamId: customer.teamId,
        phone: phone,
        name: customer.name,
        email: customer.email,
        source: 'whatsapp',
        status: 'complaint',
        notes: `Customer complaint: ${text}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('[WhatsApp] Error processing message:', error);
  }
}

/**
 * Process a message status update (delivery, read, failed)
 */
async function processMessageStatus(status: any) {
  try {
    const { phone, messageId, status: msgStatus, timestamp } = status;

    console.log(`📦 Message ${messageId} from ${phone}: ${msgStatus}`);

    // Find the conversation with this messageId
    const conversations = await listDocuments('conversations', [
      Query.equal('metaMessageId', messageId),
    ]);

    if (conversations.documents.length > 0) {
      const convo = conversations.documents[0];
      await updateDocument('conversations', convo.$id, {
        deliveryStatus: msgStatus,
      });
    }
  } catch (error) {
    console.error('[WhatsApp] Error processing status:', error);
  }
}

/**
 * Find or create a customer record
 */
async function findOrCreateCustomer(phone: string) {
  try {
    const result = await listDocuments('customers', [
      Query.equal('phone', phone),
    ]);

    if (result.documents.length > 0) {
      return result.documents[0];
    }

    // Create new customer
    return await createDocument('customers', {
      teamId: 'system', // Will be updated when assigned to a business
      phone: phone,
      name: null,
      email: null,
      businessName: null,
      businessType: null,
      services: [],
      totalSpent: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[WhatsApp] Error finding/creating customer:', error);
    throw error;
  }
}

/**
 * Generate an AI response and send it via WhatsApp
 */
async function generateAndSendResponse(
  customer: any,
  userMessage: string,
  phone: string,
  intent: string
) {
  try {
    // Get recent conversation history
    const convos = await listDocuments('conversations', [
      Query.equal('customerId', customer.$id),
    ]);

    const history = convos.documents
      .slice(-5)
      .map((c: any) => ({
        role: (c.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: c.message || '[media]',
      }));

    // Generate AI response
    const systemPrompt = `You are a helpful customer service assistant for ${customer.businessName}. 
    Business type: ${customer.businessType}
    Services: ${customer.services?.join(', ') || 'General services'}
    Keep responses concise (under 500 characters) and friendly.
    Current intent: ${intent}`;

    const response = await getChatResponse(userMessage, systemPrompt, history);

    // Send via WhatsApp Cloud API (Meta)
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const whatsappToken = process.env.WHATSAPP_TOKEN || '';
    const sendResult = await sendWhatsAppMessage({
      phoneNumberId,
      recipientPhone: phone,
      message: response,
      whatsappToken,
    });

    // Save the outgoing message with the actual Meta message ID
    await createDocument('conversations', {
      teamId: customer.teamId,
      customerId: customer.$id,
      phone: phone,
      role: 'assistant',
      message: response,
      messageType: 'text',
      sentBy: 'ai',
      metaMessageId: sendResult.messageId || null,
      deliveryStatus: sendResult.success ? 'sent' : 'failed',
      createdAt: new Date().toISOString(),
    });

    if (sendResult.success) {
      console.log(`✅ AI response sent to ${phone}`);
    } else {
      console.error(`❌ Failed to send AI response:`, sendResult.error);
    }
  } catch (error) {
    console.error('[WhatsApp] Error generating/sending response:', error);
  }
}
