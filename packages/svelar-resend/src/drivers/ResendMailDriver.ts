/**
 * ResendMailDriver
 *
 * Implements the Svelar MailTransport interface using Resend's API.
 * Sends emails through Resend's transactional email service.
 */

import type { MailMessage, SendResult } from 'svelar/mail';
import { Resend } from 'resend';
import type { ResendConfig } from '../config/resend.js';

interface MailTransport {
  send(message: MailMessage): Promise<SendResult>;
}

export class ResendMailDriver implements MailTransport {
  private client: Resend;
  private config: ResendConfig;

  constructor(config: ResendConfig) {
    this.config = config;
    this.client = new Resend(config.apiKey);
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

      // Map attachments to Resend format
      const attachments = message.attachments?.map((att) => ({
        filename: att.filename,
        content:
          att.content instanceof Buffer
            ? att.content
            : typeof att.content === 'string'
              ? Buffer.from(att.content)
              : att.content,
      }));

      // Send via Resend
      const result = await this.client.emails.send({
        from,
        to: to[0], // Resend accepts single 'to', use cc/bcc for multiple
        cc,
        bcc,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments,
      });

      // Check for errors
      if (result.error) {
        throw new Error(
          `Resend delivery failed: ${result.error.message || 'Unknown error'}`,
        );
      }

      return {
        accepted: to,
        rejected: [],
        messageId: result.data?.id,
      };
    } catch (error: any) {
      // Extract rejected emails from error if available
      const rejected = Array.isArray(message.to)
        ? message.to
        : [message.to];

      throw new Error(
        `Resend delivery failed: ${error.message || 'Unknown error'}`,
      );
    }
  }
}
