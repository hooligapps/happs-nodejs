const { createHmac, timingSafeEqual } = require("node:crypto");

class XOffersApiError extends Error {
  constructor(status, response) {
    super(
      response?.error?.message || response?.error?.code || `XOffers request failed (${status})`,
    );
    this.name = "XOffersApiError";
    this.status = status;
    this.response = response;
  }
}

function createIdentitySignature(gameId, userId, secret, external = null) {
  const fields = [gameId, userId, external?.provider ?? "", external?.external_id ?? ""].map(
    (value) => {
      const bytes = Buffer.from(value, "utf8");
      return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes, Buffer.from(",")]);
    },
  );
  const message = Buffer.concat([Buffer.from("xoffers.identity.v1\n"), ...fields]);
  return createHmac("sha256", secret).update(message).digest("hex");
}

function verifyRewardRequest(secret, request) {
  const { rawBody, path, timestamp, signature, method = "POST" } = request;
  if (
    method !== "POST" ||
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    !signature ||
    !/^[0-9a-f]{64}$/i.test(signature)
  ) {
    return false;
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`xoffers.reward.v1\n${timestamp}\nPOST\n${path}\n`)
    .update(rawBody)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

class XOffersClient {
  constructor({ baseUrl, gameId, secret, timeout = 10000 }) {
    this.baseUrl = baseUrl;
    this.gameId = gameId;
    Object.defineProperty(this, "secret", {
      value: secret,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    this.timeout = timeout;
  }

  signIdentity(userId, external = null) {
    return {
      game_id: this.gameId,
      user_id: userId,
      external,
      signature_version: 1,
      signature: createIdentitySignature(this.gameId, userId, this.secret, external),
    };
  }

  verifyReward(request) {
    return verifyRewardRequest(this.secret, request);
  }

  queryAssignments(userId, origin = null, states) {
    return this._post("/api/server/v2/assignments/query/", {
      game_id: this.gameId,
      user: { user_id: userId },
      origin,
      ...(states ? { states } : {}),
    });
  }

  completeOffer(userId, offerId) {
    return this._post(`/api/server/v2/offers/${encodeURIComponent(offerId)}/complete/`, {
      game_id: this.gameId,
      user_id: userId,
    });
  }

  async _post(path, body) {
    const rawBody = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", this.secret)
      .update(`xoffers.server.v1\n${timestamp}\nPOST\n${path}\n${rawBody}`)
      .digest("hex");
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-XOffers-Timestamp": timestamp,
        "X-XOffers-Signature": signature,
      },
      body: rawBody,
      redirect: "error",
      signal: AbortSignal.timeout(this.timeout),
    });
    const data = await response.json().catch(() => undefined);
    if (response.status !== 200 || !data || data.error) {
      throw new XOffersApiError(response.status, data);
    }
    return data;
  }
}

module.exports = { XOffersClient, XOffersApiError, createIdentitySignature, verifyRewardRequest };
