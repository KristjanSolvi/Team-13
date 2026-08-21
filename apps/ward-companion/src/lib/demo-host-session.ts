const sessionCookieName = "fluence_demo_host";
const sessionLifetimeMs = 4 * 60 * 60_000;
const encoder = new TextEncoder();

type SessionPayload = {
  csrfToken: string;
  expiresAt: number;
};

type DemoHostSession = SessionPayload & {
  token: string;
};

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message, retryable: false } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function equalSecrets(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index]! ^ rightDigest[index]!;
  }
  return difference === 0;
}

async function signature(payload: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

function cookieValue(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const item of header.split(";")) {
    const [name, ...value] = item.trim().split("=");
    if (name === sessionCookieName) return value.join("=") || null;
  }
  return null;
}

function sameOriginError(request: Request): Response | null {
  if (request.method !== "POST") {
    return errorResponse("DEMO_HOST_METHOD_REQUIRED", "Presenter actions require POST", 405);
  }
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const requestUrl = new URL(request.url);
  const expectedOrigin = `${request.headers.get("x-forwarded-proto") ?? requestUrl.protocol.replace(":", "")}://${request.headers.get("x-forwarded-host") ?? requestUrl.host}`;
  if (origin === null || origin !== expectedOrigin || fetchSite !== "same-origin") {
    return errorResponse(
      "DEMO_HOST_ORIGIN_REQUIRED",
      "Presenter actions require a same-origin browser request",
      403,
    );
  }
  return null;
}

async function readSession(
  token: string,
  signingSecret: string,
  now: number,
): Promise<SessionPayload | null> {
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra !== undefined) return null;
  const suppliedSignature = decodeBase64Url(encodedSignature);
  if (suppliedSignature === null) return null;
  const expectedSignature = await signature(encodedPayload, signingSecret);
  if (suppliedSignature.length !== expectedSignature.length) return null;
  let difference = 0;
  for (let index = 0; index < suppliedSignature.length; index += 1) {
    difference |= suppliedSignature[index]! ^ expectedSignature[index]!;
  }
  if (difference !== 0) return null;
  const payloadBytes = decodeBase64Url(encodedPayload);
  if (payloadBytes === null) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<SessionPayload>;
    if (
      typeof parsed.csrfToken !== "string" ||
      parsed.csrfToken.length < 20 ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.expiresAt <= now
    ) {
      return null;
    }
    return { csrfToken: parsed.csrfToken, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export async function demoHostAccessKeyMatches(
  candidate: string,
  expected: string,
): Promise<boolean> {
  if (candidate.length === 0 || expected.length < 12) return false;
  return equalSecrets(candidate, expected);
}

export async function authorizeDemoHostAccessRequest(
  request: Request,
  expectedAccessKey: string,
): Promise<Response | null> {
  const originError = sameOriginError(request);
  if (originError !== null) return originError;
  if (expectedAccessKey.length < 12) {
    return errorResponse("DEMO_HOST_NOT_CONFIGURED", "Presenter access is not configured", 503);
  }
  const candidate = request.headers.get("x-demo-host-key") ?? "";
  if (!(await demoHostAccessKeyMatches(candidate, expectedAccessKey))) {
    return errorResponse("DEMO_HOST_UNAUTHORIZED", "Presenter key was not accepted", 401);
  }
  return null;
}

export async function createDemoHostSession(
  signingSecret: string,
  now = Date.now(),
): Promise<DemoHostSession> {
  const payload: SessionPayload = {
    csrfToken: `${crypto.randomUUID()}${crypto.randomUUID()}`,
    expiresAt: now + sessionLifetimeMs,
  };
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const encodedSignature = encodeBase64Url(await signature(encodedPayload, signingSecret));
  return { ...payload, token: `${encodedPayload}.${encodedSignature}` };
}

export function demoHostCookieHeader(token: string, secure: boolean): string {
  return [
    `${sessionCookieName}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(sessionLifetimeMs / 1_000)}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export async function authorizeDemoHostMutation(
  request: Request,
  signingSecret: string,
  now = Date.now(),
): Promise<Response | null> {
  const originError = sameOriginError(request);
  if (originError !== null) return originError;
  const token = cookieValue(request);
  const session = token === null ? null : await readSession(token, signingSecret, now);
  if (session === null) {
    return errorResponse(
      "DEMO_HOST_SESSION_REQUIRED",
      "Unlock presenter controls before running this demo action",
      401,
    );
  }
  const csrfToken = request.headers.get("x-demo-csrf") ?? "";
  if (!(await equalSecrets(csrfToken, session.csrfToken))) {
    return errorResponse("DEMO_HOST_CSRF_REJECTED", "Presenter session check failed", 403);
  }
  return null;
}
