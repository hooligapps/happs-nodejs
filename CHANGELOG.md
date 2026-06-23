# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

### Added
- 

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
