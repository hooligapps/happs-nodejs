const crypto = require("crypto");

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
    const bodyHash = crypto
      .createHash("sha256")
      .update(body ? JSON.stringify(body) : "")
      .digest("hex");

    return crypto
      .createHmac("sha256", this.secret)
      .update(`${method}\n${path}\n${timestamp}\n${bodyHash}`)
      .digest("hex");
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

  async createCheckout(publicId, pid, name, price, currency, desc, options = {}) {
    this.assertNonEmptyString(publicId, "publicId");
    this.assertNonEmptyString(pid, "pid");
    this.assertNonEmptyString(name, "name");
    this.assertPositiveNumber(price, "price");
    this.assertNonEmptyString(currency, "currency");
    this.assertNonEmptyString(desc, "desc");

    const path = "/api/v1/bridge/checkout";
    return this._makeRequest("POST", path, {
      publicId,
      pid,
      name,
      price,
      currency,
      desc,
      ...(options.redirectUrl ? { redirectUrl: options.redirectUrl } : {}),
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
}

module.exports = {
  HAppsClient,
  HAppsClientError,
  HAppsTimeoutError,
  HAppsHttpError,
  HAppsNetworkError,
};
