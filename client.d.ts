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

export interface CheckoutInitResult {
  orderId: string;
  paymentUrl: string;
}

export interface CheckoutOptions {
  redirectUrl?: string;
}

export interface PaymentStatus {
  orderId: string;
  status: "approved" | "denied" | "pending";
  transactionId: string | null;
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
  createCheckout(
    publicId: string,
    pid: string,
    name: string,
    price: number,
    currency: string,
    desc: string,
    options?: CheckoutOptions,
  ): Promise<CheckoutInitResult>;
  getPayment(orderId: string): Promise<PaymentStatus>;

  verifyTokenJWKS(token: string): Promise<TokenPayload>;
}
