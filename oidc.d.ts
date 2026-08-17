export interface HAppsOidcClientOptions {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope?: string;
}

export interface OidcAuthorizationOptions {
  scope?: string;
  prompt?: string | null;
  extraParams?: Record<string, string>;
}

export interface OidcAuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface OidcAuthorizationState {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface OidcTokenSet {
  access_token?: string;
  claims?: () => ({ sub?: string; [key: string]: unknown } | undefined);
  [key: string]: unknown;
}

export interface OidcUserInfoOptions {
  subject?: string;
}

export class HAppsOidcClient {
  constructor(options: HAppsOidcClientOptions);
  createAuthorizationRequest(options?: OidcAuthorizationOptions): Promise<OidcAuthorizationRequest>;
  exchangeAuthorizationCode(callbackUrl: string, expected: OidcAuthorizationState): Promise<OidcTokenSet>;
  getUserInfo(tokens: OidcTokenSet, options?: OidcUserInfoOptions): Promise<Record<string, unknown>>;
}
