import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";

describe("downstream gateway config", () => {
  it("keeps simulation disabled unless explicitly enabled", () => {
    expect(
      parseConfig({ DOWNSTREAM_BEARER_TOKEN: "private-gateway-token" }),
    ).toEqual({
      port: 8792,
      host: "127.0.0.1",
      databasePath: "./data/downstream.sqlite",
      bearerToken: "private-gateway-token",
      simulationEnabled: false,
    });
  });

  it("parses the demo simulation flag", () => {
    expect(
      parseConfig({
        DOWNSTREAM_BEARER_TOKEN: "private-gateway-token",
        DOWNSTREAM_SIMULATION_ENABLED: "true",
      }).simulationEnabled,
    ).toBe(true);
  });

  it("requires a private bearer token", () => {
    expect(() => parseConfig({})).toThrow();
  });
});
