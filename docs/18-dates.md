# Date Utilities

Svelar provides timezone-safe date formatting, parsing, and relative time helpers through `@beeblock/svelar/dates`. Built on [date-fns](https://date-fns.org), it prevents the classic "off by one day" bug and provides a Laravel Carbon-inspired API.

## Import

```typescript
import {
  formatDate,
  formatRelative,
  formatShortRelative,
  timeAgo,
  toDate,
  parseLocalDate,
  toLocal,
  castDates,
  dateCaster,
} from '@beeblock/svelar/dates';
```

## The Off-by-One-Day Problem

JavaScript's `new Date('2024-01-15')` parses date-only strings as UTC midnight. In negative UTC offset timezones (most of the Americas), this displays as January **14th** — one day behind.

Svelar's `toDate()` detects date-only strings and parses them as **local** midnight instead:

```typescript
// Native JS (BROKEN in UTC-3, UTC-5, etc.)
new Date('2024-01-15')  // Jan 14, 9:00 PM in UTC-3

// Svelar (CORRECT everywhere)
toDate('2024-01-15')    // Jan 15, 12:00 AM local time
```

All formatting functions in `@beeblock/svelar/dates` use `toDate()` internally, so you get correct results by default.

## Formatting

### formatDate(input, pattern?, options?)

Format a date with a date-fns pattern. Defaults to `'PP'` (locale-aware medium date).

```typescript
formatDate(user.createdAt)                 // "Mar 27, 2026"
formatDate(user.createdAt, 'PPP')          // "March 27th, 2026"
formatDate(user.createdAt, 'PPpp')         // "Mar 27, 2026, 2:30:00 PM"
formatDate(user.createdAt, 'p')            // "2:30 PM"
formatDate(user.createdAt, 'Pp')           // "Mar 27, 2026, 2:30 PM"
formatDate(user.createdAt, 'yyyy-MM-dd')   // "2026-03-27"

// With locale
import { pt } from 'date-fns/locale';
formatDate(user.createdAt, 'PP', { locale: pt })  // "27 de mar. de 2026"
```

Common patterns: `PP` (date), `p` (time), `Pp` (date + time), `PPP` (long date), `PPpp` (full).

### timeAgo(input, options?)

Human-readable relative time — Laravel Carbon's `diffForHumans()` equivalent.

```typescript
timeAgo(user.lastLoginAt)    // "about 2 hours ago"
timeAgo(post.publishedAt)    // "3 days ago"
timeAgo(event.startsAt)      // "in about 5 hours"
```

### formatRelative(input, options?)

Alias for `timeAgo()`. Use whichever name reads better in your code.

### formatShortRelative(input)

Compact relative time for tables, badges, and tight UI:

```typescript
formatShortRelative(Date.now() - 120_000)     // "2m"
formatShortRelative(Date.now() - 7_200_000)   // "2h"
formatShortRelative(Date.now() - 172_800_000) // "2d"
```

### formatBetween(start, end, options?)

Distance between two dates:

```typescript
formatBetween(startDate, endDate)  // "about 3 hours"
```

## Parsing

### toDate(input)

Normalize any input to a safe `Date` object. Handles timestamps, Date objects, ISO strings, and date-only strings.

```typescript
toDate(1711540200000)      // Date from timestamp (always correct)
toDate('2024-01-15')       // Jan 15 LOCAL midnight (not UTC!)
toDate('2024-01-15T10:30:00Z')  // Parsed via parseISO
toDate(new Date())         // Returned as-is
```

### parseLocalDate(dateString)

Parse a `YYYY-MM-DD` string as local midnight. Use when you explicitly need this behavior.

```typescript
parseLocalDate('2024-01-15')  // Jan 15, 00:00:00 local time
```

### toLocal(input)

Strip the time component — get local midnight for any date.

```typescript
toLocal(someTimestamp)  // Same day, 00:00:00 local time
```

## Model Date Casting

### castDates(obj, fields, options?)

Cast date fields on a model-like object. For each field, adds `_ago`, `_short`, and `_formatted` computed properties.

```typescript
// In a server load function
const user = await db.query.users.findFirst({ where: eq(users.id, id) });

return {
  user: castDates(user, ['createdAt', 'updatedAt', 'lastLoginAt'])
};
```

```svelte
<!-- In the template -->
<p>Joined {data.user.createdAt_formatted}</p>    <!-- "Mar 27, 2026" -->
<p>Last seen {data.user.lastLoginAt_ago}</p>      <!-- "about 2 hours ago" -->
<span>{data.user.updatedAt_short}</span>          <!-- "2h" -->
```

### dateCaster(fields)

Create a reusable caster for a specific set of fields:

```typescript
// Define once in your model or utility file
const castUserDates = dateCaster(['createdAt', 'updatedAt', 'lastLoginAt']);

// Use in every load function
export const load = async ({ locals }) => {
  const user = await db.query.users.findFirst({ ... });
  return { user: castUserDates(user) };
};
```

## Comparison Helpers

Re-exported from date-fns for convenience:

```typescript
import { isToday, isYesterday, isTomorrow, isValid } from '@beeblock/svelar/dates';
import { differenceInDays, differenceInHours, differenceInMinutes, differenceInSeconds } from '@beeblock/svelar/dates';

isToday(user.createdAt)                          // true/false
differenceInDays(new Date(), user.trialEndsAt)   // -5 (5 days remaining)
```

## Manipulation Helpers

Re-exported from date-fns:

```typescript
import { startOfDay, endOfDay, addDays, addHours, addMinutes, subDays, subHours, subMinutes } from '@beeblock/svelar/dates';

const tomorrow = addDays(new Date(), 1);
const dayStart = startOfDay(new Date());
```

## i18n Integration

See the [i18n guide](./15-i18n.md#locale-aware-dates) for wiring `@beeblock/svelar/dates` with paraglide to automatically follow the active locale.

## Next Steps

- Learn about [i18n](./15-i18n.md) for locale-aware date formatting
- Check [Models & ORM](./03-models-orm.md) for using dates with database models
- Explore [SaaS Guide](./17-saas-guide.md) for full application patterns

---

**Svelar Date Utilities** © 2026
