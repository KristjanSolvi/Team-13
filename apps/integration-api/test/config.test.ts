import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";

describe("integration API config", () => {
  it("parses defaults and multiple UI origins", () => {
    const config = parseConfig({
      AGENTIC_APP_BEARER_TOKEN: "app-secret",
      PATIENT_PROFILE_BEARER_TOKEN: "profile-secret",
      MOCK_EHR_BEARER_TOKEN: "mock-ehr-secret",
      UI_ORIGINS:
        "http://127.0.0.1:5173, https://ui-preview.example.test ",
    });

    expect(config).toMatchObject({
      port: 8790,
      host: "127.0.0.1",
      agenticBaseUrl: "http://127.0.0.1:3000",
      pipelineBaseUrl: "http://127.0.0.1:8787",
      patientProfileBaseUrl: "http://127.0.0.1:8791",
      mockEhrBaseUrl: "http://127.0.0.1:8793",
      allowedOrigins: [
        "http://127.0.0.1:5173",
        "https://ui-preview.example.test",
      ],
      upstreamTimeoutMs: 8_000,
    });
  });

  it("requires the server-only agentic application token", () => {
    expect(() => parseConfig({})).toThrow();
  });

  it("allows both common local Vite hostnames by default", () => {
    const config = parseConfig({
      AGENTIC_APP_BEARER_TOKEN: "app-secret",
      PATIENT_PROFILE_BEARER_TOKEN: "profile-secret",
      MOCK_EHR_BEARER_TOKEN: "mock-ehr-secret",
    });

    expect(config.allowedOrigins).toEqual([
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ]);
  });

  it("accepts generic platform host and port variables", () => {
    const config = parseConfig({
      AGENTIC_APP_BEARER_TOKEN: "app-secret",
      PATIENT_PROFILE_BEARER_TOKEN: "profile-secret",
      MOCK_EHR_BEARER_TOKEN: "mock-ehr-secret",
      HOST: "0.0.0.0",
      PORT: "8080",
    });

    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(8080);
  });
});
