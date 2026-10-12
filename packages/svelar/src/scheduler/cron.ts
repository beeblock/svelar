import { CronDate, CronExpressionParser, type CronExpression, type CronField } from 'cron-parser';

export interface CronFields {
  minute: number[] | null;
  hour: number[] | null;
  dayOfMonth: number[] | null;
  month: number[] | null;
  dayOfWeek: number[] | null;
}

function expressionParts(expression: string): string[] {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: "${expression}". Expected 5 fields.`);
  }
  // Keep the fixed five-field contract; do not enable randomized or Quartz extensions.
  if (parts.some((part) => /[?#()]|(?<![a-z])[HL](?![a-z])/i.test(part))) {
    throw new Error('Unsupported cron extension; use fixed five-field schedules');
  }
  return parts;
}

export function validateTimezone(timezone: string): void {
  if (!timezone || timezone !== timezone.trim()) throw new Error('Invalid scheduler timezone');
  new Intl.DateTimeFormat('en', { timeZone: timezone });
}

function parseExpression(expression: string, date?: Date, timezone?: string, endDate?: Date): CronExpression {
  expressionParts(expression);
  if (date && !Number.isFinite(date.getTime())) throw new Error('Invalid scheduler date');
  if (timezone !== undefined) validateTimezone(timezone);
  return CronExpressionParser.parse(expression, { currentDate: date, endDate, tz: timezone });
}

function fieldValues(field: CronField, part: string, weekday = false): number[] | null {
  if (part === '*') return null;
  const values = field.values.filter((value) => typeof value === 'number');
  if (values.length !== field.values.length) throw new Error('Unsupported cron field values');
  return [...new Set(values.map((value) => weekday ? value % 7 : value))].sort((a, b) => a - b);
}

export function parseCron(expression: string): CronFields {
  const parts = expressionParts(expression);
  const { fields } = parseExpression(expression);
  return {
    minute: fieldValues(fields.minute, parts[0]),
    hour: fieldValues(fields.hour, parts[1]),
    dayOfMonth: fieldValues(fields.dayOfMonth, parts[2]),
    month: fieldValues(fields.month, parts[3]),
    dayOfWeek: fieldValues(fields.dayOfWeek, parts[4], true),
  };
}

export function cronMatches(expression: string, date: Date, timezone?: string): boolean {
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid scheduler date');
  const minute = new CronDate(date, timezone);
  minute.setSeconds(0);
  minute.setMilliseconds(0);
  // A bounded minute window shares the iterator's calendar/DST rules with previews.
  return parseExpression(expression, new Date(minute.getTime() - 1), timezone, minute.toDate()).hasNext();
}

export function nextCronDate(expression: string, date: Date, timezone?: string): Date {
  return parseExpression(expression, date, timezone).next().toDate();
}

export function scheduleTime(time: string): { hour: number; minute: number } {
  if (!/^\d{1,2}:\d{2}$/.test(time)) throw new Error('Invalid schedule time; expected HH:MM');
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}
