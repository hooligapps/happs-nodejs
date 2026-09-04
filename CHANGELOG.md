# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [1.1.1] - 2026-09-04

### Added
- `migrateAccount(params)` for importing verified bcrypt accounts and linking games.
- `initPaymentByUserId(params)` for creating a game link and payment URL for players without a portal `publicId`.
- `bindUserId(params)` for binding a portal/OIDC game link to the game's stable user ID.
- `submitGameSession(params)` for submitting the current game session user to a portal authentication attempt.

## [1.1.0] - 2026-08-12

### Added
- OIDC authorization-code flow with discovery, state, nonce and PKCE helpers.
- Authorization code exchange and UserInfo helpers.
- Short-lived, single-use portal session links for linked players.

### Changed
- The package root exports the Bridge client through `index.js`; OIDC is exposed only through the separate `happs-nodejs/oidc` entrypoint.
- OIDC authorization requests no longer force `prompt=login` by default.
- Platform URLs are validated and secrets are no longer enumerable object properties.
- Request timeouts now cover response body reads, path parameters are URL-encoded, and `jose` is loaded through ESM-compatible dynamic import.
- Automatic retries are limited to GET requests and reuse one request ID across attempts.
- `HAppsOidcClient` now accepts one configuration object containing the issuer, redirect URI, client credentials, and default scope.
- Payment status and postback types now include portal purchase/test fields; postback parsing validates `isTest`.
- OIDC code exchange validates the required state, nonce, and PKCE verifier before calling the provider.
- Local JWKS verification validates required launch-token claims and exposes `jti`; token audiences may be a string or string array.
- Node.js 20 is now the minimum supported runtime; `jose` and `openid-client` are installed as direct dependencies.

## [1.0.2] - 2026-06-17

### Added

### Changed
- `PaymentStatus` typings now include `pending` and nullable `transactionId`.

### Changed
- 

### Fixed
- 

## [1.0.0] - 2026-03-25

### Added
- Initial release of `happs-nodejs`.
- Bridge API methods:
  - `verifyToken(token)`
  - `getProfile(publicId)`
  - `initPayment(publicId, pid, name, price, currency, desc)`
  - `getPayment(orderId)`
- HMAC signing compatible with bridge guard format.
- `X-Request-Id` header for every request.
- Retry policy for timeout/network/HTTP 5xx.
- Input validation for required fields and `price > 0`.
- Typed errors for integration handling.
