import nodemailer from 'nodemailer';
import type { SmtpConfig } from './config.js';
import type { Format } from './converter.js';

export async function submitEmail(smtp: SmtpConfig, name: string, bytes: Buffer, format: Format): Promise<{ state: 'submitted'; messageId: string }> {
  if (!smtp.enabled) throw new Error('Email delivery is disabled.');
  if (bytes.length > smtp.maxAttachmentBytes) throw new Error('Attachment is too large for the email limit. Download it and use Send to Kindle for web.');
  if (smtp.security === 'none' && !['127.0.0.1', 'localhost', '::1'].includes(smtp.host)) throw new Error('Unencrypted SMTP is limited to loopback development servers.');
  const password = smtp.user ? process.env[smtp.passwordEnv] : undefined;
  if (smtp.user && !password) throw new Error('The SMTP password environment variable is not set.');
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls', ignoreTLS: smtp.security === 'none',
    ...(smtp.user ? { auth: { user: smtp.user, pass: password } } : {}),
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000,
    tls: { rejectUnauthorized: true }, logger: false, debug: false,
  });
  const filename = name.replace(/[\\/\r\n\0]/g, '_').slice(0, 160);
  try {
    const result = await transport.sendMail({
      from: { name: 'Kindle Markdown Publisher', address: smtp.from }, to: smtp.to,
      subject: filename, text: 'A document published from your local Markdown library.',
      disableFileAccess: true, disableUrlAccess: true,
      attachments: [{ filename, content: bytes, contentType: format === 'epub' ? 'application/epub+zip' : 'application/pdf' }],
    });
    if (!result.accepted.length || result.rejected.length) throw new Error('SMTP did not accept the recipient.');
    return { state: 'submitted', messageId: result.messageId };
  } catch {
    throw new Error('Email submission failed or is unconfirmed. Check your email/Kindle library before retrying.');
  } finally { transport.close(); }
}
