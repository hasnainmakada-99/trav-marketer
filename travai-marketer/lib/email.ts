import nodemailer from 'nodemailer';

function buildTransport() {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || process.env.GMAIL_APP_EMAIL || '').trim();
  const pass = (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').trim();
  const port = Number(process.env.SMTP_PORT || '465');

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port: Number.isFinite(port) ? port : 465,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  if (user && pass) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  }

  return null;
}

export async function sendCallbackEmails(params: {
  customerEmail?: string | null;
  customerName?: string | null;
  phone: string;
  callbackTime: string;
  businessName?: string | null;
  serviceSummary?: string | null;
}) {
  const transporter = buildTransport();
  const from = (process.env.SMTP_FROM || process.env.SMTP_USER || process.env.GMAIL_APP_EMAIL || '').trim();
  const internalTo = (process.env.CALLBACK_NOTIFY_TO || process.env.SMTP_USER || process.env.GMAIL_APP_EMAIL || '').trim();

  if (!transporter || !from) {
    return { sent: false, reason: 'missing_config' as const };
  }

  const businessName = params.businessName?.trim() || 'Traventions';
  const customerName = params.customerName?.trim() || 'there';
  const customerEmail = (params.customerEmail || '').trim();
  const summaryLine = params.serviceSummary?.trim()
    ? `Service: ${params.serviceSummary.trim()}`
    : 'Service: Travel callback enquiry';

  if (customerEmail) {
    await transporter.sendMail({
      from,
      to: customerEmail,
      subject: `${businessName} — Callback Scheduled`,
      text: [
        `Hi ${customerName},`,
        '',
        `Your callback with ${businessName} has been requested successfully.`,
        '',
        `Preferred time: ${params.callbackTime}`,
        `Phone: ${params.phone}`,
        summaryLine,
        '',
        `Our team will reach out to you at the requested time.`,
        '',
        `Thanks,`,
        businessName,
      ].join('\n'),
    });
  }

  if (internalTo) {
    await transporter.sendMail({
      from,
      to: internalTo,
      subject: `New WhatsApp Callback: ${params.phone}`,
      text: [
        `A WhatsApp callback has been requested.`,
        '',
        `Customer: ${params.customerName || 'Unknown'}`,
        `Phone: ${params.phone}`,
        `Email: ${customerEmail || 'Not provided'}`,
        `Preferred time: ${params.callbackTime}`,
        summaryLine,
        '',
        `---`,
        `Please contact the customer at the scheduled time.`,
      ].join('\n'),
    });
  }

  return { sent: true as const };
}

/**
 * Decides whether a lead is "substantially captured" and worth notifying about.
 * A bare greeting ("Hi") or a phone number alone should NOT trigger an email.
 * We only notify once the lead has a real identity or a concrete service intent.
 */
export function isLeadCaptured(lead: {
  name?: string | null;
  notes?: string | null;
  intent?: string | null;
  email?: string | null;
}): boolean {
  const name = (lead.name || '').trim();
  const email = (lead.email || '').trim();
  const notes = (lead.notes || '').trim();
  const intent = (lead.intent || '').trim();

  // Has a real name or email pulled from the conversation
  if (name || email) return true;

  // Has a concrete service intent (not just a greeting)
  if (intent && intent !== 'greeting' && intent !== 'complaint') return true;

  // Has meaningful notes beyond a placeholder greeting line
  if (notes && notes.length > 15 && !/^whatsapp greeting received$/i.test(notes)) return true;

  return false;
}

export async function sendLeadNotificationEmail(params: {
  name?: string | null;
  phone: string;
  source: string;
  notes?: string | null;
  email?: string | null;
  serviceInterest?: string | null;
}) {
  const transporter = buildTransport();
  const from = (process.env.SMTP_FROM || process.env.SMTP_USER || process.env.GMAIL_APP_EMAIL || '').trim();
  const notifyTo = (process.env.CALLBACK_NOTIFY_TO || process.env.GMAIL_APP_EMAIL || '').trim();

  if (!transporter || !from || !notifyTo) {
    console.warn('[LeadEmail] Missing SMTP config, cannot send lead notification');
    return;
  }

  const name = params.name?.trim() || 'Unknown';
  const phone = params.phone;
  const source = params.source || 'unknown';
  const serviceLine = params.serviceInterest?.trim()
    ? `Service Interest: ${params.serviceInterest.trim()}`
    : null;
  const emailLine = params.email?.trim()
    ? `Email: ${params.email.trim()}`
    : null;
  const notesLine = params.notes?.trim()
    ? `Notes: ${params.notes.trim()}`
    : null;
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  try {
    await transporter.sendMail({
      from,
      to: notifyTo,
      subject: `New Lead: ${name} — ${source}`,
      text: [
        `A new lead has been captured.`,
        '',
        `Name: ${name}`,
        `Phone: ${phone}`,
        `Source: ${source}`,
        emailLine,
        serviceLine,
        notesLine,
        '',
        `Time: ${timestamp} IST`,
        '',
        `---`,
        `TravAI Notification`,
      ].filter(Boolean).join('\n'),
    });
    console.log(`[LeadEmail] Notification sent to ${notifyTo} for ${phone} (${source})`);
  } catch (err) {
    console.error('[LeadEmail] Failed to send notification:', err instanceof Error ? err.message : err);
  }
}
