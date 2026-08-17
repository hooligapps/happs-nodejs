const crypto = require("crypto");

class HAppsClient {
  constructor(platformUrl, clientId, secret, timeout = 5000) {
    if (!platformUrl) throw new Error("platformUrl is required");
    if (!clientId) throw new Error("clientId is required");
    if (!secret) throw new Error("secret is required");

    this.platformUrl = HAppsClient.normalizePlatformUrl(platformUrl);
    this.clientId = clientId;
    Object.defineProperty(this, "secret", {
      value: secret,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    this.timeout = timeout;
    this.maxRetries = 2;
    this.retryDelayMs = 200;
  }

  createSignature(method, path, timestamp, body) {
    return HAppsClient.createHAppsSignature(this.secret, method, path, timestamp, body);
  }

  createHeaders(method, path, body) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.createSignature(method, path, timestamp, body);
    return {
      "X-Game-Id": this.clientId,
      "X-Timestamp": timestamp,
      "X-Signature": signature,
    };
  }

  createRequestId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString("hex");
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  isRetryableError(err) {
    if (err instanceof HAppsTimeoutError) return true;
    if (err instanceof HAppsNetworkError) return true;
    if (err instanceof HAppsHttpError && err.status >= 500) return true;
    return false;
  }

  assertNonEmptyString(value, fieldName) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new HAppsClientError(`${fieldName} must be a non-empty string`);
    }
  }

  assertPositiveNumber(value, fieldName) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new HAppsClientError(`${fieldName} must be a positive number`);
    }
  }

  async _makeRequest(method, path, body) {
    let lastError;
    const requestId = this.createRequestId();
    const maxRetries = method === "GET" ? this.maxRetries : 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._makeRequestOnce(method, path, body, requestId);
      } catch (err) {
        lastError = err;
        if (!this.isRetryableError(err) || attempt === maxRetries) {
          throw err;
        }
        await this.sleep(this.retryDelayMs * (attempt + 1));
      }
    }

    throw lastError;
  }

  async _makeRequestOnce(method, path, body, requestId) {
    const url = `${this.platformUrl}${path}`;
    const headers = {
      ...this.createHeaders(method, path, body),
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const options = { method, headers, signal: controller.signal };
    if (body && method !== "GET") {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const text = await response.text();
        let errorCode;
        try {
          const parsed = text ? JSON.parse(text) : null;
          if (parsed && typeof parsed === "object") {
            if (typeof parsed.error === "string") errorCode = parsed.error;
            else if (typeof parsed.message === "string") errorCode = parsed.message;
          }
        } catch {
          // ignore non-json body
        }

        throw new HAppsHttpError({
          status: response.status,
          method,
          path,
          bodyText: text,
          errorCode,
        });
      }

      const data = await response.json();
      return data;
    } catch (err) {
      if (err.name === "AbortError") {
        throw new HAppsTimeoutError(method, path);
      }
      if (err instanceof HAppsClientError) {
        throw err;
      }
      throw new HAppsNetworkError(method, path, err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async verifyToken(token) {
    this.assertNonEmptyString(token, "token");
    const path = "/api/v1/bridge/verify-token";
    return this._makeRequest("POST", path, { token });
  }

  async getProfile(publicId) {
    this.assertNonEmptyString(publicId, "publicId");
    const path = `/api/v1/bridge/profile/${encodeURIComponent(publicId)}`;
    return this._makeRequest("GET", path);
  }

  async initPayment(publicId, pid, name, price, currency, desc) {
    this.assertNonEmptyString(publicId, "publicId");
    this.assertNonEmptyString(pid, "pid");
    this.assertNonEmptyString(name, "name");
    this.assertPositiveNumber(price, "price");
    this.assertNonEmptyString(currency, "currency");
    this.assertNonEmptyString(desc, "desc");

    const path = "/api/v1/bridge/payment";
    return this._makeRequest("POST", path, {
      publicId,
      pid,
      name,
      price,
      currency,
      desc,
    });
  }

  async getPayment(orderId) {
    this.assertNonEmptyString(orderId, "orderId");
    const path = `/api/v1/bridge/payment/${encodeURIComponent(orderId)}`;
    return this._makeRequest("GET", path);
  }

  async createSessionLink(publicId) {
    this.assertNonEmptyString(publicId, "publicId");

    const path = "/api/v1/bridge/session-link";
    return this._makeRequest("POST", path, { publicId });
  }

  async verifyTokenJWKS(token) {
    this.assertNonEmptyString(token, "token");
    const jose = await this._loadJose();

    if (!this._jwks) {
      const jwksUrl = new URL(`${this.platformUrl}/idp/oidc/jwks`);
      this._jwks = jose.createRemoteJWKSet(jwksUrl);
    }

    const issuer = `${this.platformUrl}/idp/oidc`;

    const { payload } = await jose.jwtVerify(token, this._jwks, {
      issuer,
      audience: this.clientId,
    });

    if (typeof payload.sub !== "string" || payload.sub.trim().length === 0) {
      throw new HAppsClientError("JWT sub claim must be a non-empty string");
    }
    if (
      typeof payload.aud !== "string" &&
      !(
        Array.isArray(payload.aud) &&
        payload.aud.length > 0 &&
        payload.aud.every((value) => typeof value === "string" && value.trim().length > 0)
      )
    ) {
      throw new HAppsClientError("JWT aud claim must be a string or a non-empty string array");
    }
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      throw new HAppsClientError("JWT exp claim must be a finite number");
    }
    if (typeof payload.verified !== "boolean") {
      throw new HAppsClientError("JWT verified claim must be a boolean");
    }
    if (typeof payload.jti !== "string" || payload.jti.trim().length === 0) {
      throw new HAppsClientError("JWT jti claim must be a non-empty string");
    }

    return {
      sub: payload.sub,
      verified: payload.verified,
      aud: payload.aud,
      exp: payload.exp,
      jti: payload.jti,
    };
  }

  async _loadJose() {
    if (!this._josePromise) {
      this._josePromise = import("jose").catch((error) => {
        this._josePromise = undefined;
        if (error && error.code === "ERR_MODULE_NOT_FOUND") {
          throw new HAppsClientError(
            "jose is required for verifyTokenJWKS. Install it: npm install jose",
          );
        }
        throw error;
      });
    }
    return this._josePromise;
  }

  static requirePayloadString(payload, fieldName) {
    const value = payload && payload[fieldName];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new HAppsClientError(`${fieldName} must be a non-empty string`);
    }
    return value.trim();
  }

  static requirePayloadPositiveNumber(payload, fieldName) {
    const value = Number(payload && payload[fieldName]);
    if (!Number.isFinite(value) || value <= 0) {
      throw new HAppsClientError(`${fieldName} must be a positive number`);
    }
    return value;
  }

  static assertServerString(value, fieldName) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new HAppsClientError(`${fieldName} must be a non-empty string`);
    }
  }

  static normalizePlatformUrl(value) {
    HAppsClient.assertServerString(value, "platformUrl");

    let url;
    try {
      url = new URL(value);
    } catch {
      throw new HAppsClientError("platformUrl must be a valid absolute URL");
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new HAppsClientError("platformUrl must use http or https");
    }
    if (url.username || url.password) {
      throw new HAppsClientError("platformUrl must not contain credentials");
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      throw new HAppsClientError("platformUrl must contain only an origin");
    }

    return url.origin;
  }

  static createHAppsSignature(secret, method, path, timestamp, body) {
    HAppsClient.assertServerString(secret, "secret");
    HAppsClient.assertServerString(method, "method");
    HAppsClient.assertServerString(path, "path");
    HAppsClient.assertServerString(timestamp, "timestamp");

    const bodyHash = crypto
      .createHash("sha256")
      .update(body ? JSON.stringify(body) : "")
      .digest("hex");

    return crypto
      .createHmac("sha256", secret)
      .update(`${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`)
      .digest("hex");
  }

  static verifyHAppsRequest(params) {
    const {
      secret,
      method,
      path,
      timestamp,
      signature,
      body,
      clientId,
      expectedClientId,
      maxAgeSeconds = 300,
      now = Date.now(),
    } = params || {};

    HAppsClient.assertServerString(signature, "signature");

    if (expectedClientId !== undefined) {
      HAppsClient.assertServerString(clientId, "clientId");
      HAppsClient.assertServerString(expectedClientId, "expectedClientId");
      if (clientId !== expectedClientId) {
        throw new HAppsSignatureError("Invalid client id");
      }
    }

    const ts = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(ts)) {
      throw new HAppsSignatureError("Invalid timestamp");
    }

    const nowSeconds = Math.floor(now / 1000);
    if (Math.abs(nowSeconds - ts) > maxAgeSeconds) {
      throw new HAppsSignatureError("Timestamp expired");
    }

    const expected = HAppsClient.createHAppsSignature(secret, method, path, String(timestamp), body);
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);

    if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
      throw new HAppsSignatureError("Invalid signature");
    }

    return true;
  }

  static parsePaymentValidationRequest(payload) {
    return {
      publicId: HAppsClient.requirePayloadString(payload, "publicId"),
      requestId: HAppsClient.requirePayloadString(payload, "requestId"),
      productId: HAppsClient.requirePayloadString(payload, "productId"),
      price: HAppsClient.requirePayloadPositiveNumber(payload, "price"),
      currency: HAppsClient.requirePayloadString(payload, "currency"),
      desc: HAppsClient.requirePayloadString(payload, "desc"),
    };
  }

  static parsePaymentPostback(payload) {
    const status = HAppsClient.requirePayloadString(payload, "status");
    if (status !== "approved" && status !== "denied") {
      throw new HAppsClientError("status must be approved or denied");
    }
    if (typeof payload?.isTest !== "boolean") {
      throw new HAppsClientError("isTest must be a boolean");
    }

    return {
      publicId: HAppsClient.requirePayloadString(payload, "publicId"),
      orderId: HAppsClient.requirePayloadString(payload, "orderId"),
      requestId: HAppsClient.requirePayloadString(payload, "requestId"),
      status,
      transactionId: typeof payload?.transactionId === "string" && payload.transactionId.trim()
        ? payload.transactionId.trim()
        : null,
      price: HAppsClient.requirePayloadString(payload, "price"),
      currency: HAppsClient.requirePayloadString(payload, "currency"),
      isTest: payload.isTest,
    };
  }
}

class HAppsClientError extends Error {
  constructor(message) {
    super(message);
    this.name = "HAppsClientError";
  }
}

class HAppsTimeoutError extends HAppsClientError {
  constructor(method, path) {
    super(`Request timed out: ${method} ${path}`);
    this.name = "HAppsTimeoutError";
    this.method = method;
    this.path = path;
  }
}

class HAppsHttpError extends HAppsClientError {
  constructor({ status, method, path, bodyText, errorCode }) {
    super(`HTTP ${status}: ${errorCode || bodyText || "request_failed"}`);
    this.name = "HAppsHttpError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.bodyText = bodyText;
    this.errorCode = errorCode;
  }
}

class HAppsNetworkError extends HAppsClientError {
  constructor(method, path, cause) {
    super(`Network error: ${method} ${path}`);
    this.name = "HAppsNetworkError";
    this.method = method;
    this.path = path;
    this.cause = cause;
  }
}

class HAppsSignatureError extends HAppsClientError {
  constructor(message) {
    super(message);
    this.name = "HAppsSignatureError";
  }
}

module.exports = {
  HAppsClient,
  HAppsClientError,
  HAppsTimeoutError,
  HAppsHttpError,
  HAppsNetworkError,
  HAppsSignatureError,
};
