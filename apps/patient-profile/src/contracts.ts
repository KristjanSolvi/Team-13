import { z } from "zod";

const nullableText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable();

export const patientIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9:._-]+$/);

const identifiersSchema = z
  .object({
    medicalRecordNumber: nullableText(120),
    nationalHealthId: nullableText(120),
  })
  .strict();

const demographicsSchema = z
  .object({
    dateOfBirth: z.iso.date().nullable(),
    pronouns: nullableText(80),
  })
  .strict();

const locationSchema = z
  .object({
    bed: nullableText(40),
    bay: nullableText(120),
  })
  .strict();

const flowSchema = z
  .object({
    todaySchedule: nullableText(500),
    waitingFor: nullableText(500),
    homeTomorrow: z.boolean(),
  })
  .strict();

const contactSchema = z
  .object({
    phone: nullableText(80),
    email: z.email().max(320).nullable(),
    address: nullableText(1_000),
  })
  .strict();

const referralDetailsSchema = z
  .object({
    preferredLanguage: nullableText(120),
    interpreterRequired: z.boolean(),
    mobilityNeeds: nullableText(1_000),
    transportNeeds: nullableText(1_000),
    homeSupport: nullableText(1_000),
    additionalDetails: nullableText(4_000),
  })
  .strict();

export const patientProfileDataSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160),
    identifiers: identifiersSchema,
    demographics: demographicsSchema,
    location: locationSchema,
    flow: flowSchema,
    contact: contactSchema,
    referralDetails: referralDetailsSchema,
  })
  .strict();

const profileChangesSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160).optional(),
    identifiers: identifiersSchema.partial().strict().optional(),
    demographics: demographicsSchema.partial().strict().optional(),
    location: locationSchema.partial().strict().optional(),
    flow: flowSchema.partial().strict().optional(),
    contact: contactSchema.partial().strict().optional(),
    referralDetails: referralDetailsSchema.partial().strict().optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: "At least one profile field must change",
  });

export const createProfileSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    profile: patientProfileDataSchema,
  })
  .strict();

export const updateProfileSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(200),
    reason: z.string().trim().min(3).max(500),
    changes: profileChangesSchema,
  })
  .strict();

export const createReferralSnapshotSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    referralType: z.string().trim().min(2).max(160),
    destination: z.string().trim().min(2).max(240),
    clinicalReason: z.string().trim().min(5).max(4_000),
    additionalInstructions: nullableText(2_000),
  })
  .strict();

export type PatientProfileData = z.infer<typeof patientProfileDataSchema>;
export type CreateProfileInput = z.infer<typeof createProfileSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateReferralSnapshotInput = z.infer<
  typeof createReferralSnapshotSchema
>;

export interface PatientProfile {
  schemaVersion: "1";
  patientId: string;
  profile: PatientProfileData;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface PatientProfileVersion extends PatientProfile {
  changeReason: string;
}

export interface ReferralSnapshot {
  schemaVersion: "1";
  referralId: string;
  patientId: string;
  referralType: string;
  destination: string;
  clinicalReason: string;
  additionalInstructions: string | null;
  profileVersion: number;
  patientProfile: PatientProfileData;
  createdAt: string;
  createdBy: string;
  correlationId: string;
}

export interface ReferralSnapshotStatus extends ReferralSnapshot {
  currentProfileVersion: number;
  profileChanged: boolean;
}
