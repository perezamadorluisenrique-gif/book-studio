// The accessibility report is part of Book Studio Pro (the accessible-EPUB pack).
// The free edition never calls it; the Pro overlay replaces this file.

import type { AuditResult } from "./a11y";
import type { Book } from "./model";

export interface ReportOptions {
  claimed: boolean;
  certifiedBy?: string;
  pageList: boolean;
  generated?: Date;
  generator?: string;
}

export function accessibilityReport(_book: Book, _audit: AuditResult, _opts: ReportOptions): string {
  return "";
}
