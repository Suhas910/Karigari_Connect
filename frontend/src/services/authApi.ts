/**
 * authApi.ts
 *
 * Dedicated auth service communicating with FastAPI endpoints (/api/v1/auth/login and /api/v1/auth/register).
 * Supports phone number and username authentication.
 */

import { api } from "./api";
import { UserRole } from "../types/contracts";

export interface AuthResult {
  token: string;
  role: UserRole;
  userId: string;
  username?: string;
  phoneNumber?: string | null;
}

export interface SignupParams {
  username: string;
  phoneNumber: string;
  password: string;
  role: UserRole;
  email?: string;
}

export async function signup(params: SignupParams): Promise<AuthResult> {
  const { data } = await api.post("/auth/register", {
    username: params.username.trim(),
    phone_number: params.phoneNumber.trim(),
    password: params.password,
    role: params.role,
    email: params.email ? params.email.trim() : undefined,
  });

  return {
    token: data.access_token ?? data.token,
    role: data.role as UserRole,
    userId: String(data.user_id ?? data.userId),
    username: data.username,
    phoneNumber: data.phone_number,
  };
}

export async function login(identifier: string, password: string): Promise<AuthResult> {
  const { data } = await api.post("/auth/login", {
    username: identifier.trim(),
    password,
  });

  return {
    token: data.access_token ?? data.token,
    role: data.role as UserRole,
    userId: String(data.user_id ?? data.userId),
    username: data.username,
    phoneNumber: data.phone_number,
  };
}
