import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";

describe("integration API config", () => {
  it("parses defaults and multiple UI origins", () => {
    const config = parseConfig({
      INTEGRATION_API_BEARER_TOKEN: "public-secret",
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
      handoverUpstreamTimeoutMs: 600_000,
      integrationApiBearerToken: "public-secret",
    });
  });

  it("requires the dedicated inbound and server-only upstream tokens", () => {
    expect(() => parseConfig({})).toThrow();
    expect(() =>
      parseConfig({
        INTEGRATION_API_BEARER_TOKEN: "short",
        AGENTIC_APP_BEARER_TOKEN: "app-secret",
        PATIENT_PROFILE_BEARER_TOKEN: "profile-secret",
        MOCK_EHR_BEARER_TOKEN: "mock-ehr-secret",
      }),
    ).toThrow();
  });

  it.each([
    ["Agentic", "AGENTIC_APP_BEARER_TOKEN"],
    ["patient profile", "PATIENT_PROFILE_BEARER_TOKEN"],
    ["mock EHR", "MOCK_EHR_BEARER_TOKEN"],
  ] as const)(
    "rejects reuse of the inbound bearer for the %s trust domain",
    (_label, reusedVariable) => {
      const environment = {
        INTEGRATION_API_BEARER_TOKEN: "integration-secret",
        AGENTIC_APP_BEARER_TOKEN: "agentic-secret",
        PATIENT_PROFILE_BEARER_TOKEN: "profile-secret",
        MOCK_EHR_BEARER_TOKEN: "mock-ehr-secret",
      };
      environment[reusedVariable] = environment.INTEGRATION_API_BEARER_TOKEN;

      expect(() => parseConfig(environment)).toThrow();
    },
  );

  it("allows both common local Vite hostnames by default", () => {
    const config = parseConfig({
      INTEGRATION_API_BEARER_TOKEN: "public-secret",
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
      INTEGRATION_API_BEARER_TOKEN: "public-secret",
      AGENTIC_APP_BEARER_TOKEN: "app-secret",
      PATIENT_PROFILE_BEARER_TOKEN: "profile-secret",
      MOCK_EHR_BEARER_TOKEN: "mock-ehr-secret",
      HOST: "0.0.0.0",
      PORT: "8080",
    });

    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(8080);
  });

  it("accepts a dedicated live handover timeout up to fifteen minutes", () => {
    const config = parseConfig({
      INTEGRATION_API_BEARER_TOKEN: "public-secret",
      AGENTIC_APP_BEARER_TOKEN: "app-secret",
      PATIENT_PROFILE_BEARER_TOKEN: "profile-secret",
      MOCK_EHR_BEARER_TOKEN: "mock-ehr-secret",
      HANDOVER_UPSTREAM_TIMEOUT_MS: "900000",
    });

    expect(config.handoverUpstreamTimeoutMs).toBe(900_000);
    expect(() =>
      parseConfig({
        INTEGRATION_API_BEARER_TOKEN: "public-secret",
        AGENTIC_APP_BEARER_TOKEN: "app-secret",
        PATIENT_PROFILE_BEARER_TOKEN: "profile-secret",
        MOCK_EHR_BEARER_TOKEN: "mock-ehr-secret",
        HANDOVER_UPSTREAM_TIMEOUT_MS: "479999",
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        INTEGRATION_API_BEARER_TOKEN: "public-secret",
        AGENTIC_APP_BEARER_TOKEN: "app-secret",
        PATIENT_PROFILE_BEARER_TOKEN: "profile-secret",
        MOCK_EHR_BEARER_TOKEN: "mock-ehr-secret",
        HANDOVER_UPSTREAM_TIMEOUT_MS: "900001",
      }),
    ).toThrow();
  });
});
