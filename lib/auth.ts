import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE = "traceforge_admin";
const MAX_AGE_SECONDS = 60 * 60 * 8;

export type AdminSession = {
  email: string;
};

function configuredEmail() {
  return process.env.ADMIN_EMAIL?.trim() ?? "";
}

function configuredPasswordHash() {
  return process.env.ADMIN_PASSWORD_HASH?.trim() ?? "";
}

function secret() {
  return `${configuredPasswordHash()}:${process.env.DATABASE_URL ?? ""}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function passwordMatches(password: string) {
  const expected = configuredPasswordHash();
  if (!expected) return false;

  if (expected.startsWith("plain:")) {
    return safeEqual(password, expected.slice("plain:".length));
  }

  const digest = sha256(password);
  if (expected.startsWith("sha256:")) {
    return safeEqual(digest, expected.slice("sha256:".length).toLowerCase());
  }

  if (/^[a-f0-9]{64}$/i.test(expected)) {
    return safeEqual(digest, expected.toLowerCase());
  }

  return false;
}

export async function signIn(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!configuredEmail() || normalizedEmail !== configuredEmail().toLowerCase()) {
    return false;
  }
  if (!passwordMatches(password)) {
    return false;
  }

  const payload = Buffer.from(
    JSON.stringify({ email: configuredEmail(), exp: Date.now() + MAX_AGE_SECONDS * 1000 }),
  ).toString("base64url");
  const token = `${payload}.${hmac(payload)}`;
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return true;
}

export async function signOut() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(hmac(payload), signature)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      exp?: number;
    };
    if (!decoded.email || !decoded.exp || decoded.exp < Date.now()) {
      return null;
    }
    if (decoded.email.toLowerCase() !== configuredEmail().toLowerCase()) {
      return null;
    }
    return { email: decoded.email };
  } catch {
    return null;
  }
}

export async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
