import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";

describe("mock EHR config", () => {
  it("uses private local defaults", () => {
    expect(
      parseConfig({ MOCK_EHR_BEARER_TOKEN: "private-ehr-token" }),
    ).toEqual({
      port: 8793,
      host: "127.0.0.1",
      databasePath: "data/mock-ehr.sqlite",
      bearerToken: "private-ehr-token",
    });
  });

  it("requires a server-only bearer token", () => {
    expect(() => parseConfig({})).toThrow();
  });

  it("accepts generic platform host and port variables", () => {
    const config = parseConfig({
      MOCK_EHR_BEARER_TOKEN: "private-ehr-token",
      HOST: "0.0.0.0",
      PORT: "8080",
      MOCK_EHR_DATABASE_PATH: "/app/data/mock-ehr.sqlite",
    });

    expect(config).toMatchObject({
      port: 8080,
      host: "0.0.0.0",
      databasePath: "/app/data/mock-ehr.sqlite",
    });
  });
});
