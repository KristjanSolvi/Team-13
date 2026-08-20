import type { AmbientSession, ScopedToken } from "../contracts.js";

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Pipeline request failed with status ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export async function startAmbientSession(
  pipelineBaseUrl: string,
  encounterIdentifier?: string,
): Promise<AmbientSession> {
  const body =
    encounterIdentifier === undefined ? {} : { encounterIdentifier };
  const response = await fetch(
    new URL("/api/corti/ambient/session", pipelineBaseUrl),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return responseJson<AmbientSession>(response);
}

export async function refreshAmbientToken(
  pipelineBaseUrl: string,
): Promise<ScopedToken> {
  const response = await fetch(
    new URL("/api/corti/ambient/token", pipelineBaseUrl),
    { method: "POST" },
  );
  return responseJson<ScopedToken>(response);
}

export async function getDictationToken(
  pipelineBaseUrl: string,
): Promise<ScopedToken> {
  const response = await fetch(
    new URL("/api/corti/dictation/token", pipelineBaseUrl),
    { method: "POST" },
  );
  return responseJson<ScopedToken>(response);
}
