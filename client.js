const crypto = require("crypto");

class HAppsClient {
  constructor(platformUrl, clientId, secret, timeout = 5000) {
    if (!platformUrl) throw new Error("platformUrl is required");
    if (!clientId) throw new Error("clientId is required");
    if (!secret) throw new Error("secret is required");

    this.platformUrl = platformUrl.replace(/\/+$/, "");
    this.clientId = clientId;
    this.secret = secret;
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

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const requestId = this.createRequestId();
      try {
        return await this._makeRequestOnce(method, path, body, requestId);
      } catch (err) {
        lastError = err;
        if (!this.isRetryableError(err) || attempt === this.maxRetries) {
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
      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
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

      return response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new HAppsTimeoutError(method, path);
      }
      if (err instanceof HAppsClientError) {
        throw err;
      }
      throw new HAppsNetworkError(method, path, err);
    }
  }

  async verifyToken(token) {
    this.assertNonEmptyString(token, "token");
    const path = "/api/v1/bridge/verify-token";
    return this._makeRequest("POST", path, { token });
  }

  async getProfile(publicId) {
    this.assertNonEmptyString(publicId, "publicId");
    const path = `/api/v1/bridge/profile/${publicId}`;
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
    const path = `/api/v1/bridge/payment/${orderId}`;
    return this._makeRequest("GET", path);
  }

  async verifyTokenJWKS(token) {
    let jose;
    try {
      jose = require("jose");
    } catch {
      throw new Error(
        'jose is required for verifyTokenJWKS. Install it: npm install jose'
      );
    }

    if (!this._jwks) {
      const jwksUrl = new URL(`${this.platformUrl}/idp/oidc/jwks`);
      this._jwks = jose.createRemoteJWKSet(jwksUrl);
    }

    const issuer = `${this.platformUrl}/idp/oidc`;

    const { payload } = await jose.jwtVerify(token, this._jwks, {
      issuer,
      audience: this.clientId,
    });

    return {
      sub: payload.sub,
      verified: payload.verified,
      aud: payload.aud,
      exp: payload.exp,
    };
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
