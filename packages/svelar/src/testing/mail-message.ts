import type { MailMessage } from '../mail/index.js';

export function cloneMailMessage(message: MailMessage): MailMessage {
  return {
    ...message,
    to: Array.isArray(message.to) ? [...message.to] : message.to,
    cc: Array.isArray(message.cc) ? [...message.cc] : message.cc,
    bcc: Array.isArray(message.bcc) ? [...message.bcc] : message.bcc,
    from: typeof message.from === 'object' && message.from ? { ...message.from } : message.from,
    attachments: message.attachments?.map((attachment) => ({
      ...attachment,
      content: Buffer.isBuffer(attachment.content) ? Buffer.from(attachment.content) : attachment.content,
    })),
    tags: message.tags ? { ...message.tags } : undefined,
  };
}
