import { openProfileDatabase } from "../src/database.js";
import {
  seedSyntheticKarenProfile,
  syntheticKarenProfile,
} from "../src/demo.js";
import { PatientProfileService } from "../src/service.js";
import { PatientProfileStore } from "../src/store.js";
import { describe, expect, it } from "vitest";

describe("synthetic Karen fixture", () => {
  it("creates the canonical demo profile once without overwriting edits", () => {
    const store = new PatientProfileStore(openProfileDatabase(":memory:"));
    const service = new PatientProfileService(
      store,
      () => new Date("2026-08-21T12:00:00.000Z"),
      () => "referral-1",
    );
    try {
      seedSyntheticKarenProfile(service, store);
      const created = service.getProfile("synthetic-karen");
      expect(created.profile).toEqual(syntheticKarenProfile);

      service.updateProfile(
        "synthetic-karen",
        {
          expectedVersion: 1,
          idempotencyKey: "edit-karen-profile-001",
          reason: "Karen confirmed discharge support",
          changes: { flow: { homeTomorrow: true } },
        },
        "clinician:evelyn",
      );
      seedSyntheticKarenProfile(service, store);

      expect(service.getProfile("synthetic-karen")).toMatchObject({
        version: 2,
        profile: { flow: { homeTomorrow: true } },
      });
    } finally {
      store.close();
    }
  });
});
