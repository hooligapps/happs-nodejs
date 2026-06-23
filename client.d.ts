export interface TokenPayload {
  sub: string;
  verified: boolean;
  aud: string;
  exp: number;
}

export interface Profile {
  publicId: string;
  verified: boolean;
  registeredAt: string;
}

export interface PaymentInitParams {
  publicId: string;
  pid: string;
  name: string;
  price: number;
  currency: string;
  desc: string;
}

export interface PaymentInitResult {
  orderId: string;
}

export interface PaymentStatus {
  orderId: string;
  status: "approved" | "denied" | "pending";
  transactionId: string | null;
}

export interface VerifyHAppsRequestParams {
  secret: string;
  method: string;
  path: string;
  timestamp: string;
  signature: string;
  body?: any;
  clientId?: string;
  expectedClientId?: string;
  maxAgeSeconds?: number;
  now?: number;
}

export interface PortalPaymentValidationRequest {
  publicId: string;
  requestId: string;
  productId: string;
  price: number;
  currency: string;
  desc: string;
}

export interface PortalPaymentValidationProduct {
  productId: string;
  price: number;
  currency: string;
  desc: string;
  name?: string;
}

export type PortalPaymentValidationResponse =
  | { ok: true; product: PortalPaymentValidationProduct }
  | { ok: false; error: string };

export interface PortalPaymentPostback {
  publicId: string;
  orderId: string;
  requestId: string;
  status: "approved" | "denied";
  transactionId: string | null;
  price: string;
  currency: string;
}

export class HAppsClient {
  constructor(platformUrl: string, clientId: string, secret: string, timeout?: number);
  maxRetries: number;
  retryDelayMs: number;

  createSignature(method: string, path: string, timestamp: string, body?: any): string;
  createHeaders(method: string, path: string, body?: any): Record<string, string>;

  verifyToken(token: string): Promise<TokenPayload>;
  getProfile(publicId: string): Promise<Profile>;

  initPayment(
    publicId: string,
    pid: string,
    name: string,
    price: number,
    currency: string,
    desc: string,
  ): Promise<PaymentInitResult>;
  getPayment(orderId: string): Promise<PaymentStatus>;

  verifyTokenJWKS(token: string): Promise<TokenPayload>;

  static requirePayloadString(payload: any, fieldName: string): string;
  static requirePayloadPositiveNumber(payload: any, fieldName: string): number;
  static assertServerString(value: unknown, fieldName: string): void;
  static createHAppsSignature(
    secret: string,
    method: string,
    path: string,
    timestamp: string,
    body?: any,
  ): string;
  static verifyHAppsRequest(params: VerifyHAppsRequestParams): true;
  static parsePaymentValidationRequest(payload: any): PortalPaymentValidationRequest;
  static parsePaymentPostback(payload: any): PortalPaymentPostback;
}

export class HAppsClientError extends Error {}

export class HAppsTimeoutError extends HAppsClientError {
  method: string;
  path: string;
}

export class HAppsHttpError extends HAppsClientError {
  status: number;
  method: string;
  path: string;
  bodyText: string;
  errorCode?: string;
}

export class HAppsNetworkError extends HAppsClientError {
  method: string;
  path: string;
  cause: unknown;
}

export class HAppsSignatureError extends HAppsClientError {}
