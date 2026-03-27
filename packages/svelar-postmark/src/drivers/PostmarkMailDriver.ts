/**
 * PostmarkMailDriver
 *
 * Implements the Svelar MailTransport interface using Postmark's API.
 * Sends emails through Postmark's reliable email service.
 */

import type { MailMessage, SendResult } from 'svelar/mail';
import { ServerClient } from 'postmark';
import type { PostmarkConfig } from '../config/postmark.js';

interface MailTransport {
  send(message: MailMessage): Promise<SendResult>;
}

export class PostmarkMailDriver implements MailTransport {
  private client: ServerClient;
  private config: PostmarkConfig;

  constructor(config: PostmarkConfig) {
    this.config = config;
    this.client = new ServerClient(config.serverToken);
  }

  async send(message: MailMessage): Promise<SendResult> {
    try {
      // Normalize recipients to arrays
      const to = Array.isArray(message.to) ? message.to : [message.to];
      const cc = message.cc
        ? Array.isArray(message.cc)
          ? message.cc
          : [message.cc]
        : undefined;
      const bcc = message.bcc
        ? Array.isArray(message.bcc)
          ? message.bcc
          : [message.bcc]
        : undefined;

      // Determine from address
      const from =
        typeof message.from === 'object'
          ? `${message.from.name} <${message.from.address}>`
          : message.from || this.config.from;

      // Map attachments to Postmark format
      const attachments = message.attachments?.map((att) => ({
        Name: att.filename,
        Content:
          att.content instanceof Buffer
            ? att.content.toString('base64')
            : typeof att.content === 'string'
              ? Buffer.from(att.content).toString('base64')
              : att.content,
        ContentType: att.contentType || 'application/octet-stream',
      }));

      // Send via Postmark
      const result = await this.client.sendEmail({
        From: from,
        To: to.join(', '),
        Cc: cc?.join(', '),
        Bcc: bcc?.join(', '),
        ReplyTo: message.replyTo,
        Subject: message.subject,
        TextBody: message.text,
        HtmlBody: message.html,
        Attachments: attachments,
        MessageStream: this.config.messageStream,
      });

      return {
        accepted: to,
        rejected: [],
        messageId: result.MessageID,
      };
    } catch (error: any) {
      // Extract rejected emails from error if available
      const rejected = Array.isArray(message.to)
        ? message.to
        : [message.to];

      throw new Error(
        `Postmark delivery failed: ${error.message || 'Unknown error'}`,
      );
    }
  }
}
