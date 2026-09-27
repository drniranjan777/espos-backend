import { env } from '../config/env.js';

const isoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: env.APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date ('YYYY-MM-DD') in the business timezone. */
export function todayIso() {
  return isoFormatter.format(new Date());
}
