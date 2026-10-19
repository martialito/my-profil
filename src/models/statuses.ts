/** Application lifecycle (section 15). SUBMITTED only after a confirmed submission (section 30). */
export const ApplicationStatuses = [
  'FOUND',
  'ANALYZED',
  'SHORTLISTED',
  'CV_CREATED',
  'COVER_LETTER_CREATED',
  'READY_TO_APPLY',
  'APPLIED',
  'REJECTED',
  'INTERVIEW',
  'OFFER',
  'WITHDRAWN',
] as const;
export type ApplicationStatus = (typeof ApplicationStatuses)[number];

export const DateCompatibilityStatuses = ['COMPATIBLE', 'INCOMPATIBLE', 'UNKNOWN'] as const;
export type DateCompatibilityStatus = (typeof DateCompatibilityStatuses)[number];
