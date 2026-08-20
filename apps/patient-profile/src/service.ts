import { createHash, randomUUID } from "node:crypto";

import {
  patientProfileDataSchema,
  type CreateProfileInput,
  type CreateReferralSnapshotInput,
  type PatientProfile,
  type PatientProfileData,
  type PatientProfileVersion,
  type ReferralSnapshot,
  type ReferralSnapshotStatus,
  type UpdateProfileInput,
} from "./contracts.js";
import { ProfileError } from "./errors.js";
import type { PatientProfileStore } from "./store.js";

export class PatientProfileService {
  constructor(
    private readonly store: PatientProfileStore,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  createProfile(
    patientId: string,
    input: CreateProfileInput,
    actorId: string,
  ): PatientProfile {
    const occurredAt = this.now().toISOString();
    return this.store.runIdempotent(
      `profile:create:${patientId}`,
      input.idempotencyKey,
      requestHash(input),
      occurredAt,
      () => {
        const profile: PatientProfile = {
          schemaVersion: "1",
          patientId,
          profile: input.profile,
          version: 1,
          createdAt: occurredAt,
          updatedAt: occurredAt,
          updatedBy: actorId,
        };
        this.store.createProfile(profile, "Profile created");
        return profile;
      },
    );
  }

  getProfile(patientId: string): PatientProfile {
    return this.requireProfile(patientId);
  }

  updateProfile(
    patientId: string,
    input: UpdateProfileInput,
    actorId: string,
  ): PatientProfile {
    const occurredAt = this.now().toISOString();
    return this.store.runIdempotent(
      `profile:update:${patientId}`,
      input.idempotencyKey,
      requestHash(input),
      occurredAt,
      () => {
        const current = this.requireProfile(patientId);
        if (current.version !== input.expectedVersion) {
          throw new ProfileError(
            "VERSION_CONFLICT",
            "Patient profile changed before this update was applied",
            409,
          );
        }
        const nextData = patientProfileDataSchema.parse(
          mergeProfile(current.profile, input.changes),
        );
        if (JSON.stringify(nextData) === JSON.stringify(current.profile)) {
          throw new ProfileError(
            "NO_PROFILE_CHANGES",
            "Profile update does not change any values",
          );
        }
        const updated: PatientProfile = {
          ...current,
          profile: nextData,
          version: current.version + 1,
          updatedAt: occurredAt,
          updatedBy: actorId,
        };
        this.store.replaceProfile(current.version, updated, input.reason);
        return updated;
      },
    );
  }

  listHistory(patientId: string): PatientProfileVersion[] {
    this.requireProfile(patientId);
    return this.store.listVersions(patientId);
  }

  createReferralSnapshot(
    patientId: string,
    input: CreateReferralSnapshotInput,
    actorId: string,
    correlationId: string,
  ): ReferralSnapshotStatus {
    const occurredAt = this.now().toISOString();
    return this.store.runIdempotent(
      `referral-snapshot:create:${patientId}`,
      input.idempotencyKey,
      requestHash(input),
      occurredAt,
      () => {
        const profile = this.requireProfile(patientId);
        const snapshot: ReferralSnapshot = {
          schemaVersion: "1",
          referralId: this.newId(),
          patientId,
          referralType: input.referralType,
          destination: input.destination,
          clinicalReason: input.clinicalReason,
          additionalInstructions: input.additionalInstructions,
          profileVersion: profile.version,
          patientProfile: structuredClone(profile.profile),
          createdAt: occurredAt,
          createdBy: actorId,
          correlationId,
        };
        this.store.insertReferralSnapshot(snapshot);
        return withProfileStatus(snapshot, profile.version);
      },
    );
  }

  getReferralSnapshot(referralId: string): ReferralSnapshotStatus {
    const snapshot = this.store.getReferralSnapshot(referralId);
    if (!snapshot) {
      throw new ProfileError(
        "REFERRAL_SNAPSHOT_NOT_FOUND",
        "Referral snapshot not found",
        404,
      );
    }
    return withProfileStatus(
      snapshot,
      this.requireProfile(snapshot.patientId).version,
    );
  }

  listReferralSnapshots(patientId: string): ReferralSnapshotStatus[] {
    const currentVersion = this.requireProfile(patientId).version;
    return this.store
      .listReferralSnapshots(patientId)
      .map((snapshot) => withProfileStatus(snapshot, currentVersion));
  }

  private requireProfile(patientId: string): PatientProfile {
    const profile = this.store.getProfile(patientId);
    if (!profile) {
      throw new ProfileError(
        "PROFILE_NOT_FOUND",
        "Patient profile not found",
        404,
      );
    }
    return profile;
  }
}

function mergeProfile(
  current: PatientProfileData,
  changes: UpdateProfileInput["changes"],
): PatientProfileData {
  return {
    displayName: changes.displayName ?? current.displayName,
    identifiers: mergeDefined(current.identifiers, changes.identifiers),
    demographics: mergeDefined(current.demographics, changes.demographics),
    location: mergeDefined(current.location, changes.location),
    flow: mergeDefined(current.flow, changes.flow),
    contact: mergeDefined(current.contact, changes.contact),
    referralDetails: mergeDefined(
      current.referralDetails,
      changes.referralDetails,
    ),
  };
}

function mergeDefined<T extends object>(
  current: T,
  changes?: { [K in keyof T]?: T[K] | undefined },
): T {
  if (changes === undefined) return { ...current };
  const merged = { ...current };
  for (const key of Object.keys(changes) as Array<keyof T>) {
    const value = changes[key];
    if (value !== undefined) merged[key] = value as T[keyof T];
  }
  return merged;
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function withProfileStatus(
  snapshot: ReferralSnapshot,
  currentProfileVersion: number,
): ReferralSnapshotStatus {
  return {
    ...snapshot,
    currentProfileVersion,
    profileChanged: snapshot.profileVersion !== currentProfileVersion,
  };
}
