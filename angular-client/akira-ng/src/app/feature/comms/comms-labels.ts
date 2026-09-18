import {
  MessageProduct,
  ReportCategory,
  ReportStatus,
} from '../../model/response/comms-response.model';

/*
 * The enums, in words.
 *
 * Kept here rather than in a pipe because they are read in two places and a
 * missing case should be a compile error rather than a blank cell. The wording
 * matches the form the reporter filled in — if the two drift, the person at the
 * desk is reading a different sentence from the one that was answered.
 */

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  CHILD_SEXUAL: 'Sexual content involving a child',
  THREAT: 'A threat of violence',
  SELF_HARM: 'Somebody describing harm to themselves',
  HARASSMENT: 'Harassment or stalking',
  INTIMATE_IMAGES: 'Intimate images shared without consent',
  FRAUD: 'Fraud or a scam',
  HATE: 'Hate directed at who somebody is',
  OTHER: 'Something else',
};

/** The one category whose copy outlives its handling, and the reason it does. */
export const HELD_BY_LAW: ReportCategory = 'CHILD_SEXUAL';

export const STATUS_LABELS: Record<ReportStatus, string> = {
  NEW: 'Waiting',
  FILED: 'Referred',
  CLOSED: 'Closed',
};

export const PRODUCT_LABELS: Record<MessageProduct, string> = {
  OUTPOST: 'Outpost',
  BULLET: 'bullet',
  SITE: 'The website',
};

export function whenever(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** How long something has been waiting, in the units a queue is actually read in. */
export function waiting(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}
