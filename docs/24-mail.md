# Mail

Send emails from your application with swappable drivers.

### Drivers

| Driver | Dependency | Description |
|--------|-----------|-------------|
| **smtp** | `nodemailer` | Traditional SMTP relay |
| **postmark** | none (fetch) | Postmark transactional email API |
| **resend** | none (fetch) | Resend email API |
| **mailtrap** | none (fetch) | Mailtrap Email API |
| **log** | none | Logs to console (development) |
| **null** | none | Discards silently (testing) |

### Configuration

```typescript
import { Mailer } from '@beeblock/svelar/mail';

Mailer.configure({
  default: 'resend',
  mailers: {
    resend: {
      driver: 'resend',
      apiKey: process.env.RESEND_API_KEY,
    },
    postmark: {
      driver: 'postmark',
      apiToken: process.env.POSTMARK_API_TOKEN,
    },
    mailtrap: {
      driver: 'mailtrap',
      apiToken: process.env.MAILTRAP_API_TOKEN,
    },
    smtp: {
      driver: 'smtp',
      host: process.env.MAIL_HOST || 'live.smtp.mailtrap.io',
      port: parseInt(process.env.MAIL_PORT || '587'),
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASSWORD,
      },
    },
    log: { driver: 'log' },
  },
  from: { name: 'My App', address: 'noreply@example.com' },
});
```

### Sending Mail

```typescript
import { Mailer } from '@beeblock/svelar/mail';

// Simple mail (uses default driver)
await Mailer.send({
  to: 'user@example.com',
  subject: 'Welcome',
  html: '<h1>Welcome!</h1>',
});

// Send via a specific driver
await Mailer.mailer('postmark').send({
  to: 'user@example.com',
  subject: 'Invoice',
  html: '<h1>Your invoice</h1>',
});

// With attachments and tags
await Mailer.send({
  to: 'user@example.com',
  subject: 'Report',
  html: 'See attached report',
  attachments: [
    { filename: 'report.pdf', content: pdfBuffer, contentType: 'application/pdf' },
  ],
  tags: { category: 'reports' },
});
```

### Mailable Classes

Define reusable email templates:

```typescript
import { Mailable } from '@beeblock/svelar/mail';

export class WelcomeEmail extends Mailable {
  constructor(private user: User) {
    super();
  }

  build() {
    return this.to(this.user.email)
      .subject('Welcome to Svelar')
      .tag('category', 'onboarding')
      .html(`
        <h1>Welcome ${this.user.name}!</h1>
        <p>Thanks for signing up.</p>
      `);
  }
}

// Send
await Mailer.sendMailable(new WelcomeEmail(user));
```
