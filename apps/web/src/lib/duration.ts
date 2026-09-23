/**
 * How long something took, in words a practice bills by.
 *
 * One module, because the rule below is easy to get subtly wrong in each place
 * separately: a span shorter than a minute must not read as 0:00. Rows of
 * 0:00 above a non-zero total look like broken arithmetic to the one
 * profession least willing to overlook it.
 */

/** A running timer: h:mm:ss, because the seconds are the point. */
export function clockFace(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** A recorded span: h:mm, the form that reaches a statement. */
export function hoursAndMinutes(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  return `${hours}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`;
}

/**
 * h:mm, except at the two ends.
 *
 * Nothing recorded is an em dash, the way every other empty cell in the
 * system reads. It is not "less than a minute": a directory row saying a
 * colleague worked under a minute this month, when they have booked nothing
 * at all, is a different and worse claim than saying nothing.
 *
 * Anything between one second and a minute does say so rather than rounding
 * away, because a row of 0:00 above a non-zero total looks like broken
 * arithmetic to the one profession least willing to overlook it.
 */
export function duration(seconds: number, t: (key: string) => string): string {
  if (seconds === 0) return '—';
  return seconds < 60 ? t('timer.underAMinute') : hoursAndMinutes(seconds);
}
