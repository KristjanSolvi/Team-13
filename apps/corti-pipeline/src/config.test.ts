import { describe, expect, it } from "vitest";

import { readRuntimeConfig } from "./config.js";

describe("readRuntimeConfig", () => {
  it("starts in contract-only mode when credentials are absent", () => {
    const config = readRuntimeConfig({});

    expect(config.corti).toBeNull();
    expect(config.port).toBe(8787);
    expect(config.missingCortiVariables).toEqual([
      "CORTI_TENANT_NAME",
      "CORTI_CLIENT_ID",
      "CORTI_CLIENT_SECRET",
    ]);
  });

  it("creates a credential configuration without exposing it elsewhere", () => {
    const config = readRuntimeConfig({
      CORTI_TENANT_NAME: "tenant",
      CORTI_CLIENT_ID: "client",
      CORTI_CLIENT_SECRET: "secret",
      CORTI_ENVIRONMENT: "eu",
      CORTI_PRIMARY_LANGUAGE: "en-GB",
      CORTI_OUTPUT_LANGUAGE: "en",
      CORTI_CODING_SYSTEM: "icd10int-outpatient",
      PIPELINE_ALLOWED_ORIGINS: "http://localhost:5173, http://localhost:3000",
    });

    expect(config.corti).toEqual({
      tenantName: "tenant",
      clientId: "client",
      clientSecret: "secret",
      environment: "eu",
      primaryLanguage: "en-GB",
      outputLanguage: "en",
      codingSystem: "icd10int-outpatient",
    });
    expect(config.allowedOrigins).toEqual([
      "http://localhost:5173",
      "http://localhost:3000",
    ]);
  });
});
