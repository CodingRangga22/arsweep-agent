import type { NextFunction, Request, Response } from "express";
import { PrivyClient } from "@privy-io/node";

type VerifiedAccessTokenClaims = {
  appId: string;
  userId: string; // Privy DID
  issuer: string;
  issuedAt: number;
  expiration: number;
  sessionId: string;
};

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function extractPrivyAccessToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice("bearer ".length).trim();

  // If using Privy HTTP-only cookies, token is in `privy-token`.
  const cookies = parseCookies(req.headers.cookie);
  if (cookies["privy-token"]) return cookies["privy-token"];

  return undefined;
}

let privyClient: PrivyClient | null = null;
function getPrivyClient(): PrivyClient {
  if (privyClient) return privyClient;

  const appId = process.env.PRIVY_APP_ID?.trim();
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new Error("Missing PRIVY_APP_ID/PRIVY_APP_SECRET env vars");
  }

  const jwtVerificationKey = process.env.PRIVY_JWT_VERIFICATION_KEY?.trim();
  privyClient = new PrivyClient({
    appId,
    appSecret,
    ...(jwtVerificationKey ? { jwtVerificationKey } : {}),
  });
  return privyClient;
}

export async function verifyPrivyAccessToken(accessToken: string): Promise<VerifiedAccessTokenClaims> {
  const privy = getPrivyClient();
  const verifiedClaims = (await privy.utils().auth().verifyAccessToken({
    access_token: accessToken,
  })) as VerifiedAccessTokenClaims;
  return verifiedClaims;
}

export async function requirePrivyAuth(req: Request, res: Response, next: NextFunction) {
  // If REQUIRE_PRIVY_AUTH !== "true", this middleware is a no-op.
  if (process.env.REQUIRE_PRIVY_AUTH !== "true") return next();

  const token = extractPrivyAccessToken(req);
  if (!token) return res.status(401).json({ error: "Missing Privy access token" });

  try {
    const verifiedClaims = await verifyPrivyAccessToken(token);

    (req as any).privy = verifiedClaims;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid Privy access token" });
  }
}

export function getPrivyClaims(req: Request): VerifiedAccessTokenClaims | undefined {
  return (req as any).privy as VerifiedAccessTokenClaims | undefined;
}

