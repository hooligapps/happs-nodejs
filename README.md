# happs-nodejs

Node.js client for the Hooligapps Bridge API.

## Installation

From the Git repository:

```bash
npm i git+https://github.com/hooligapps/happs-nodejs.git#nodejs-v1.0.0
```

Local install from the project folder:

```bash
npm i .
```

## Requirements

- Node.js 18+

## Usage

```js
const {
  HAppsClient,
  HAppsHttpError,
  HAppsTimeoutError,
  HAppsNetworkError,
} = require("happs-nodejs");
```

If you use it locally from the library folder:

```js
const { HAppsClient } = require("./client");
```

## Methods

- `verifyToken(token)`
- `getProfile(publicId)`
- `initPayment(publicId, pid, name, price, currency, desc)`
- `getPayment(orderId)`

## Interaction Flows

### Auth Flow

```mermaid
sequenceDiagram
    participant GS as Game Server
    participant HP as Hooligapps Platform

    GS->>HP: verifyToken(token)
    HP-->>GS: { sub, exp, ... }
    GS->>HP: getProfile(sub)
    HP-->>GS: profile data
```

### Payment Flow

```mermaid
sequenceDiagram
    participant GS as Game Server
    participant HP as Hooligapps Platform
    participant U as User

    GS->>HP: initPayment(publicId, pid, ...)
    HP-->>GS: { orderId, checkoutUrl }
    U->>HP: complete checkout
    GS->>HP: getPayment(orderId)
    HP-->>GS: { status, ... }
```

## Example

```js
const client = new HAppsClient("https://hooli.games", "CLIENT_ID", "SECRET");

async function run(token) {
  try {
    const tokenData = await client.verifyToken(token);
    const profile = await client.getProfile(tokenData.sub);
    const payment = await client.initPayment(
      tokenData.sub,
      "pack-150",
      "150 crystals",
      9.99,
      "USD",
      "Starter pack",
    );

    console.log(profile.publicId, payment.orderId);
  } catch (e) {
    if (e instanceof HAppsHttpError) {
      console.error("HTTP", e.status, e.errorCode, e.bodyText);
      return;
    }
    if (e instanceof HAppsTimeoutError) {
      console.error("Timeout");
      return;
    }
    if (e instanceof HAppsNetworkError) {
      console.error("Network error");
      return;
    }
    console.error(e);
  }
}
```

## Client Features

- HMAC request signing compatible with bridge guard format
- `X-Request-Id` for every request
- retries for timeout/network/HTTP 5xx
- input validation (`price > 0`, required strings must be non-empty)
- typed errors for easier integration handling

## Versions

Changelog: `CHANGELOG.md`.
