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
