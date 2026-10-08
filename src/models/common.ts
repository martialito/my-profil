import { z } from 'zod';

/** Partial ISO date: "2027", "2027-03" or "2027-03-01". Never invented — empty when unknown. */
export const PartialDate = z
  .string()
  .trim()
  .regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, 'Use YYYY, YYYY-MM or YYYY-MM-DD');

/** Empty / whitespace-only strings and null become undefined. */
const emptyToUndefined = (v: unknown) => {
  if (v === null) return undefined;
  if (typeof v === 'string') return v.trim() === '' ? undefined : v.trim();
  return v;
};

export const OptionalPartialDate = z.preprocess(emptyToUndefined, PartialDate.optional());

export const OptionalText = z.preprocess(emptyToUndefined, z.string().optional());

export const StringList = z.array(z.string().trim().min(1)).default([]);

export const ApplicationModes = ['FULL_AUTO', 'SEMI_AUTO', 'MANUAL'] as const;
export const ApplicationMode = z.enum(ApplicationModes);
export type ApplicationMode = z.infer<typeof ApplicationMode>;

export const WorkModes = ['on-site', 'hybrid', 'remote'] as const;
export const WorkMode = z.enum(WorkModes);
export type WorkMode = z.infer<typeof WorkMode>;
