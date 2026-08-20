export const mockEhrOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Follow-Through Synthetic Mock EHR",
    version: "0.1.0",
    description:
      "Private synthetic clinical-document store used by the Nervecentre demo surface.",
  },
  paths: {
    "/healthz": { get: { summary: "Process liveness" } },
    "/api/patients/{patientId}/documents": {
      get: { summary: "List a synthetic patient's clinical documents" },
      post: { summary: "Create an attributed clinical-document draft" },
    },
    "/api/documents/{documentId}": {
      get: { summary: "Read the current clinical document" },
      patch: { summary: "Create a new draft version" },
    },
    "/api/documents/{documentId}/file": {
      post: { summary: "File the reviewed version to the synthetic record" },
    },
    "/api/documents/{documentId}/history": {
      get: { summary: "Read immutable document version history" },
    },
  },
} as const;
