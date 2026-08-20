import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";

describe("patient profile config", () => {
  it("parses safe local defaults", () => {
    expect(
      parseConfig({ PATIENT_PROFILE_BEARER_TOKEN: "private-profile-token" }),
    ).toEqual({
      port: 8791,
      host: "127.0.0.1",
      databasePath: "./data/patient-profiles.sqlite",
      bearerToken: "private-profile-token",
      seedSyntheticKaren: false,
    });
  });

  it("requires a private service token", () => {
    expect(() => parseConfig({})).toThrow();
  });

  it("enables the disclosed synthetic Karen fixture explicitly", () => {
    expect(
      parseConfig({
        PATIENT_PROFILE_BEARER_TOKEN: "private-profile-token",
        PATIENT_PROFILE_SEED_SYNTHETIC_KAREN: "true",
      }).seedSyntheticKaren,
    ).toBe(true);
  });
});
