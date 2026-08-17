class HAppsOidcClient {
  constructor(options) {
    if (!options || typeof options !== "object") {
      throw new Error("OIDC client options are required");
    }

    const {
      issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      scope = "openid email",
    } = options;

    if (!issuerUrl) throw new Error("issuerUrl is required");
    if (!clientId) throw new Error("clientId is required");
    if (!clientSecret) throw new Error("clientSecret is required");
    if (!redirectUri) throw new Error("redirectUri is required");

    this.issuerUrl = this._requireUrl(issuerUrl, "issuerUrl", { allowPath: true }).toString();
    this.redirectUri = this._requireUrl(redirectUri, "redirectUri", { allowPath: true }).toString();
    this.clientId = clientId;
    this.scope = scope;
    Object.defineProperty(this, "clientSecret", {
      value: clientSecret,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  async _loadOpenIdClient() {
    if (!this._openidClientPromise) {
      // openid-client v6 is ESM-only; dynamic import keeps happs-nodejs compatible with CommonJS consumers.
      this._openidClientPromise = import("openid-client");
    }
    return this._openidClientPromise;
  }

  _requireUrl(value, fieldName, options = {}) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${fieldName} must be a non-empty URL`);
    }

    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${fieldName} must be a valid URL`);
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error(`${fieldName} must use http or https`);
    }
    if (url.username || url.password) {
      throw new Error(`${fieldName} must not contain credentials`);
    }
    if (url.hash) {
      throw new Error(`${fieldName} must not contain a hash`);
    }
    if (!options.allowPath && (url.pathname !== "/" || url.search)) {
      throw new Error(`${fieldName} must contain only an origin`);
    }

    return url;
  }

  async _getConfig() {
    if (!this._configPromise) {
      this._configPromise = this._discover().catch((error) => {
        this._configPromise = undefined;
        throw error;
      });
    }

    return this._configPromise;
  }

  async _discover() {
    const oidc = await this._loadOpenIdClient();
    const clientAuth = oidc.ClientSecretBasic(this.clientSecret);
    const metadata = {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uris: [this.redirectUri],
      response_types: ["code"],
    };

    return oidc.discovery(new URL(this.issuerUrl), this.clientId, metadata, clientAuth);
  }

  async createAuthorizationRequest(options = {}) {
    const {
      scope = this.scope,
      prompt,
      extraParams = {},
    } = options;
    const oidc = await this._loadOpenIdClient();
    const config = await this._getConfig();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

    const url = oidc.buildAuthorizationUrl(config, {
      ...extraParams,
      scope,
      redirect_uri: this.redirectUri,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      ...(prompt ? { prompt } : {}),
    });

    return { url: url.toString(), state, nonce, codeVerifier };
  }

  async exchangeAuthorizationCode(callbackUrl, expected) {
    if (!expected || typeof expected !== "object") {
      throw new Error("expected authorization state is required");
    }
    for (const fieldName of ["state", "nonce", "codeVerifier"]) {
      if (typeof expected[fieldName] !== "string" || expected[fieldName].trim().length === 0) {
        throw new Error(`expected.${fieldName} must be a non-empty string`);
      }
    }

    const callback = this._requireUrl(callbackUrl, "callbackUrl", { allowPath: true });
    const config = await this._getConfig();
    const oidc = await this._loadOpenIdClient();

    return oidc.authorizationCodeGrant(config, callback, {
      expectedState: expected.state,
      expectedNonce: expected.nonce,
      pkceCodeVerifier: expected.codeVerifier,
    });
  }

  async getUserInfo(tokens, options) {
    if (!tokens || typeof tokens !== "object") {
      throw new Error("tokens are required");
    }
    if (!tokens.access_token) {
      throw new Error("tokens.access_token is required");
    }

    const config = await this._getConfig();
    const oidc = await this._loadOpenIdClient();
    const subject = options?.subject || tokens.claims?.()?.sub;

    if (!subject) throw new Error("OIDC subject is required");
    return oidc.fetchUserInfo(config, tokens.access_token, subject);
  }
}

module.exports = { HAppsOidcClient };
