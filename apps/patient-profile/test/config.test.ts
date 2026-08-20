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
    });
  });

  it("requires a private service token", () => {
    expect(() => parseConfig({})).toThrow();
  });
});
