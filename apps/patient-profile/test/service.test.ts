import { beforeEach, describe, expect, it } from "vitest";

import { openProfileDatabase } from "../src/database.js";
import { PatientProfileService } from "../src/service.js";
import { PatientProfileStore } from "../src/store.js";
import { profile } from "./helpers.js";

describe("patient profile service", () => {
  let service: PatientProfileService;
  let tick: number;

  beforeEach(() => {
    tick = 0;
    const store = new PatientProfileStore(openProfileDatabase(":memory:"));
    service = new PatientProfileService(
      store,
      () => new Date(`2026-08-20T12:00:0${tick++}.000Z`),
      () => "referral-1",
    );
  });

  it("creates a versioned patient profile and retains its initial audit entry", () => {
    const created = service.createProfile(
      "p1",
      { idempotencyKey: "create-p1-001", profile },
      "clinician-1",
    );

    expect(created).toMatchObject({
      schemaVersion: "1",
      patientId: "p1",
      profile: { displayName: "Arthur M. Pender" },
      version: 1,
      updatedBy: "clinician-1",
    });
    expect(service.getProfile("p1")).toEqual(created);
    expect(service.listHistory("p1")).toEqual([
      { ...created, changeReason: "Profile created" },
    ]);
  });

  it("patches nested manual details with optimistic versioning and audit history", () => {
    service.createProfile(
      "p1",
      { idempotencyKey: "create-p1-001", profile },
      "clinician-1",
    );
    const updated = service.updateProfile(
      "p1",
      {
        expectedVersion: 1,
        idempotencyKey: "update-p1-001",
        reason: "Patient confirmed transport arrangements",
        changes: {
          contact: { phone: "+44 7700 900099" },
          referralDetails: { transportNeeds: "Hospital transport required" },
        },
      },
      "clinician-2",
    );

    expect(updated).toMatchObject({
      version: 2,
      updatedBy: "clinician-2",
      profile: {
        contact: { phone: "+44 7700 900099" },
        referralDetails: { transportNeeds: "Hospital transport required" },
      },
    });
    expect(service.listHistory("p1").map((version) => version.version)).toEqual([
      2, 1,
    ]);
    expect(service.listHistory("p1")[0]?.changeReason).toBe(
      "Patient confirmed transport arrangements",
    );
  });

  it("clears optional details explicitly without erasing omitted fields", () => {
    service.createProfile(
      "p1",
      { idempotencyKey: "create-p1-001", profile },
      "clinician-1",
    );
    const updated = service.updateProfile(
      "p1",
      {
        expectedVersion: 1,
        idempotencyKey: "update-p1-clear",
        reason: "Patient no longer needs mobility support",
        changes: { referralDetails: { mobilityNeeds: null } },
      },
      "clinician-1",
    );

    expect(updated.profile.referralDetails.mobilityNeeds).toBeNull();
    expect(updated.profile.referralDetails.preferredLanguage).toBe("English");
    expect(updated.profile.contact).toEqual(profile.contact);
  });

  it("does not replace an existing profile through a second create command", () => {
    service.createProfile(
      "p1",
      { idempotencyKey: "create-p1-001", profile },
      "clinician-1",
    );

    expect(() =>
      service.createProfile(
        "p1",
        {
          idempotencyKey: "create-p1-002",
          profile: { ...profile, displayName: "Different Patient" },
        },
        "clinician-2",
      ),
    ).toThrow(/already exists/i);
    expect(service.getProfile("p1").profile.displayName).toBe(
      "Arthur M. Pender",
    );
  });

  it("rejects stale versions and idempotency-key reuse with different input", () => {
    service.createProfile(
      "p1",
      { idempotencyKey: "create-p1-001", profile },
      "clinician-1",
    );
    const input = {
      expectedVersion: 1,
      idempotencyKey: "update-p1-001",
      reason: "Referral detail corrected",
      changes: { referralDetails: { preferredLanguage: "Danish" } },
    } as const;
    const first = service.updateProfile("p1", input, "clinician-1");
    expect(service.updateProfile("p1", input, "clinician-1")).toEqual(first);

    expect(() =>
      service.updateProfile(
        "p1",
        {
          ...input,
          changes: { referralDetails: { preferredLanguage: "Swedish" } },
        },
        "clinician-1",
      ),
    ).toThrow(/different request/i);
    expect(() =>
      service.updateProfile(
        "p1",
        {
          ...input,
          idempotencyKey: "update-p1-002",
          changes: { referralDetails: { preferredLanguage: "Norwegian" } },
        },
        "clinician-1",
      ),
    ).toThrow(/changed before/i);
  });

  it("freezes a referral profile and reports when the live profile later changes", () => {
    service.createProfile(
      "p1",
      { idempotencyKey: "create-p1-001", profile },
      "clinician-1",
    );
    const snapshot = service.createReferralSnapshot(
      "p1",
      {
        idempotencyKey: "referral-p1-001",
        referralType: "physiotherapy",
        destination: "Community physiotherapy",
        clinicalReason: "Stairs assessment before discharge",
        additionalInstructions: null,
      },
      "clinician-1",
      "corr-referral-1",
    );
    service.updateProfile(
      "p1",
      {
        expectedVersion: 1,
        idempotencyKey: "update-p1-001",
        reason: "Address corrected",
        changes: { contact: { address: "9 Updated Road, Demo Town" } },
      },
      "clinician-2",
    );

    const current = service.getReferralSnapshot(snapshot.referralId);
    expect(snapshot).toMatchObject({
      profileVersion: 1,
      currentProfileVersion: 1,
      profileChanged: false,
    });
    expect(current).toMatchObject({
      profileVersion: 1,
      currentProfileVersion: 2,
      profileChanged: true,
      patientProfile: {
        contact: { address: "4 Synthetic Street, Demo Town" },
      },
    });
  });
});
