/*
 * The desk's shapes, mirroring com.gpt.comms.desk.dto.DeskDtos.
 *
 * The slugs are a contract with a service in another repository and no compiler
 * joins the two — the same seam the report format already crosses. CategoryTest
 * on the Java side pins the same lists.
 */

export type ReportCategory =
  | 'CHILD_SEXUAL'
  | 'THREAT'
  | 'SELF_HARM'
  | 'HARASSMENT'
  | 'INTIMATE_IMAGES'
  | 'FRAUD'
  | 'HATE'
  | 'OTHER';

export type ReportStatus = 'NEW' | 'CLOSED' | 'FILED';
export type ReportKind = 'TEXT' | 'PHOTO';
export type Outcome = 'REFERRED' | 'NO_ACTION';

export type MessageProduct = 'OUTPOST' | 'BULLET' | 'SITE';
export type MessageStatus = 'NEW' | 'ANSWERED' | 'CLOSED';

export interface ReportRow {
  readonly id: string;
  readonly category: ReportCategory;
  readonly status: ReportStatus;
  readonly kind: ReportKind;
  readonly receivedAt: string;
  readonly senderShortCode: string;
  readonly hasContact: boolean;
  readonly wantsReply: boolean;
  readonly holdUntil: string | null;
  readonly releasable: boolean;
}

export interface ReportDetail extends ReportRow {
  readonly description: string;
  readonly senderFingerprint: string;
  readonly senderDisplayName: string | null;
  readonly messageId: string;
  readonly sentAt: string;
  readonly reportedAt: string;
  readonly appVersion: string;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly contactAddress: string | null;
  readonly filedAt: string | null;
  readonly referredTo: string | null;
  readonly repliedAt: string | null;
  readonly notifiedAt: string | null;
  readonly raw: string;
}

export interface HandlingResult {
  readonly id: string;
  readonly status: ReportStatus;
  readonly copyDeleted: boolean;
  readonly reporterTold: boolean;
  readonly holdUntil: string | null;
  readonly whatHappened: string;
}

export interface MessageRow {
  readonly id: string;
  readonly product: MessageProduct;
  readonly category: string;
  readonly status: MessageStatus;
  readonly title: string;
  readonly receivedAt: string;
  readonly canReply: boolean;
}

export interface MessageDetail extends MessageRow {
  readonly description: string;
  readonly contactEmail: string | null;
  readonly notifiedAt: string | null;
}

export interface GuideStep {
  readonly name: string;
  readonly href: string;
  readonly note: string;
}

export interface CategoryGuide {
  readonly slug: string;
  readonly label: string;
  readonly heldByLaw: boolean;
  readonly retention: string;
  readonly steps: readonly GuideStep[];
}

export type BlogTag = 'release-notes' | 'roadmap' | 'articles' | 'security' | 'outpost' | 'bullet';

export interface DeskPostRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly byline: string;
  readonly tags: readonly BlogTag[];
  readonly publishedAt: string | null;
  readonly updatedAt: string;
}

export interface DeskPost extends DeskPostRow {
  readonly summary: string | null;
  readonly body: string;
  readonly version: number;
}

export interface PostDraft {
  readonly title: string;
  readonly byline: string;
  readonly summary: string | null;
  readonly tags: readonly BlogTag[];
  readonly slug: string | null;
  readonly body: string;
}
