# TradeShark — Authentication Contract

> Status: implemented foundation contract
> Scope: API identity and session boundary

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/auth/register` | Create a user and authenticated session |
| POST | `/api/v1/auth/login` | Authenticate an existing user and create a session |
| GET | `/api/v1/auth/session` | Resolve the current authenticated session |
| POST | `/api/v1/auth/logout` | Revoke the current session and clear the cookie |

## Request rules

Authentication JSON endpoints accept `application/json` requests only. JSON request bodies are capped at 32 KiB.

Registration requires:

```json
{
  "email": "user@example.com",
  "username": "trader",
  "password": "a-password-at-least-12-characters"
}
```

Login requires:

```json
{
  "email": "user@example.com",
  "password": "a-password-at-least-12-characters"
}
```

Invalid or malformed input returns `400 INVALID_REQUEST`.

## Session model

Successful registration and login issue an opaque `tradeshark_session` cookie.

The cookie is:

- `HttpOnly`;
- `SameSite=Lax`;
- `Path=/`;
- expiry-bound to the server session;
- marked `Secure` in production.

The server stores only a hash of the session token. Clients must never receive or persist the server-side session hash.

Logout revokes the session and expires the browser cookie.

## Abuse protection

The current API foundation applies per-client-IP, in-memory rate limits:

- registration: 5 attempts per 5 minutes;
- login: 10 attempts per 5 minutes.

A blocked request returns `429` with:

```json
{
  "error": "RATE_LIMITED"
}
```

and a `Retry-After` response header in seconds.

This in-memory limiter is an application-level baseline. A horizontally scaled deployment must move the limiter state to shared infrastructure such as Redis before production traffic is enabled.

## Security boundary

Authentication is not authorization. Protected endpoints must still perform explicit authorization checks using the authenticated identity, account status, roles, permissions, and applicable risk/security controls.

Financial operations must never trust client-provided balances, fees, settlement state, or authorization decisions.

## Error contract

Stable API errors currently include:

- `400 INVALID_REQUEST`
- `401 UNAUTHENTICATED`
- `401 Invalid email or password`
- `429 RATE_LIMITED`
- `503 DATABASE_UNAVAILABLE`
- `500 INTERNAL_SERVER_ERROR`
- `404 NOT_FOUND`

Future public API documentation should promote machine-readable error codes rather than relying on human-readable error strings.

## Production gates

Before production authentication is enabled, the system still requires review and implementation of the broader security baseline, including session lifecycle controls, MFA where required, suspicious-activity detection, distributed rate limiting, auditability, secret management, dependency security, and operational monitoring.
