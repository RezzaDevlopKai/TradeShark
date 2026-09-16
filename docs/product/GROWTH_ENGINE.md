# TradeShark Creator Growth Engine

> Status: Product/architecture specification — Phase 0/1.

## 1. Purpose

TradeShark's free coin creation is designed as a product-led acquisition loop, not merely a free giveaway.

Each eligible account receives one initial free coin-creation entitlement. For a free **Mayhem** creation, the product can require the creator to initiate and complete a transparent social-sharing step before the entitlement becomes available.

The objective is to create a natural loop:

```text
Discover TradeShark
      ↓
Create Coin
      ↓
Share / unlock requirement
      ↓
Free Mayhem entitlement
      ↓
Launch Coin
      ↓
Public Coin Page
      ↓
Creator shares the launch
      ↓
Visitors discover TradeShark
      ↓
New users become creators/traders
```

The system must optimize for genuine distribution and product value, not fabricated engagement.

## 2. Core Product Promise

Suggested UX concept:

> **Your first Mayhem coin is on us.**
>
> Share your launch to unlock your one-time free creation.

The interface must explain what is required, what is granted, and what can/cannot be verified.

## 3. Entitlement Rules

Default configuration:

- one free coin-creation entitlement per account;
- one redemption only;
- entitlement is consumed atomically with successful coin creation;
- retries cannot create additional free coins;
- the entitlement is not presented as guaranteed financial value;
- Mayhem duration remains governed by the platform's configured one-minute free Mayhem rule;
- paid/standard creation paths can exist separately from the free entitlement.

The entitlement service is the authority for whether a user may consume the free creation.

## 4. Share-to-Unlock Flow

### Step A — Intent

User selects **Create Mayhem Coin**.

The backend creates a versioned unlock campaign and a share intent.

### Step B — Share

User selects an available channel such as X, Telegram, Discord, Facebook, WhatsApp, or copy-link.

The platform launches the relevant share mechanism where technically supported.

### Step C — Completion

The platform records what actually happened:

- `started`
- `completed_by_user`
- `verified`
- `rejected`
- `expired`

A social post is **not** considered verified merely because a share button was clicked.

### Step D — Unlock

When campaign rules are satisfied, the entitlement service grants the free Mayhem creation entitlement.

### Step E — Create

The user creates the coin. Redemption is idempotent and race-safe.

### Step F — Distribution

The newly created coin receives a public, shareable page containing accurate project information and measurable discovery signals.

## 5. Social Sharing Principles

TradeShark should make sharing easy without turning the product into a spam machine.

### Allowed growth mechanics

- one-click share composition;
- copyable public coin URL;
- automatically generated Open Graph image;
- concise creator-provided description;
- optional platform-branded share copy;
- referral attribution where transparently disclosed;
- creator analytics showing visits originating from their share link.

### Prohibited mechanics

- automatic creation of social accounts;
- automatic posting without user action;
- fake likes, followers, holders, views, trades, or volume;
- misleading claims about expected returns;
- pretending an unverified social action was verified;
- collecting private keys, seed phrases, or authentication secrets.

## 6. Public Coin Page

Every public creator coin should have a canonical page suitable for both humans and search engines.

Suggested sections:

- project identity
- ticker/token information
- chain and contract address where applicable
- creator profile reference
- launch status
- chart/market data when a market exists
- real trading/activity statistics
- holder statistics where actually available
- creator description
- community links
- safety/risk notices
- share controls
- related TradeShark discovery content

Public pages must use canonical URLs and structured metadata. Claims must be derived from actual stored data.

## 7. Discovery Surface

TradeShark can expose:

- New Coins
- Recently Launched
- Most Viewed
- Most Shared
- Most Watched
- Most Active
- Trending
- Creator Spotlight

These are product discovery surfaces, not promises of investment performance.

Ranking inputs should be transparent internally and based on real signals. Engine-generated promotional activity must not be mixed into user trading volume or represented as organic user demand.

## 8. Attribution

The growth system should answer:

- Which creator generated a visit?
- Which share channel generated it?
- Did the visitor create an account?
- Did the visitor create a coin?
- Did the visitor trade?
- Which campaign/version produced the acquisition?

Recommended attribution identifiers:

- `campaign_id`
- `share_intent_id`
- `coin_project_id`
- `creator_user_id`
- anonymous visitor/session reference where privacy policy permits
- acquisition timestamp
- channel

Attribution must respect privacy requirements and avoid unnecessary collection of personal information.

## 9. Viral Loop Metrics

Primary metrics:

- creator activation rate
- free-entitlement redemption rate
- share initiation rate
- share completion rate
- verified-share rate where supported
- public coin launch rate
- coin page visitor rate
- share-to-visitor conversion
- visitor-to-signup conversion
- signup-to-creator conversion
- signup-to-trader conversion
- creator-to-referral conversion
- repeat creator activity

Guardrail metrics:

- abuse attempts
- duplicate entitlement attempts
- suspicious referral clusters
- bot traffic
- fake engagement signals
- moderation reports
- unsafe/malicious token reports

## 10. Anti-Abuse

The growth loop is inherently attractive to farming and sybil abuse, so controls belong in the architecture from day one.

Possible signals:

- account age
- device/session risk signals
- abnormal account creation velocity
- repeated identity/payment patterns where legally appropriate
- referral graph anomalies
- impossible or suspicious share behavior
- repeated failed redemption attempts
- coin creation velocity
- contract/address reuse patterns

Risk systems should flag or rate-limit suspicious activity rather than silently inventing successful events.

## 11. Creator Lifecycle

```text
DRAFT
  ↓
ELIGIBILITY_PENDING
  ↓
READY
  ↓
LAUNCHED
  ↓
ACTIVE
  ↓
PAUSED / RETIRED
```

A creator should be able to edit draft metadata before launch, subject to validation. Immutable blockchain/market facts cannot be rewritten in the database merely to change the displayed history.

## 12. Mayhem Relationship

Mayhem is a high-energy limited mode and should be clearly separated from ordinary trading.

The free Mayhem entitlement should explicitly state:

- one use per account;
- configured duration of one minute;
- eligibility conditions;
- relevant fees/risk disclosures;
- what happens when the session expires.

The UI should never imply that Mayhem guarantees price appreciation, liquidity, or profit.

## 13. Airdrop + Creator Cross-Surface

Later, the growth engine can connect creator discovery with Airdrop Intelligence without claiming that creating/trading a token guarantees an airdrop.

Possible surfaces:

- creator quests
- educational campaign pages
- community research hubs
- verified project updates
- task completion tracking
- ecosystem discovery

Any external campaign must preserve source provenance and clearly distinguish official requirements from TradeShark-generated recommendations or summaries.

## 14. SEO Growth Loop

The creator system can naturally generate indexable knowledge/product surfaces:

```text
Coin
 → Coin Page
 → Chain / Ecosystem Page
 → Creator Page
 → Market Page
 → Research / Knowledge Page
 → Internal Links
 → Search Discovery
 → New Visitor
```

SEO pages must be useful independently of search rankings. Thin autogenerated pages, duplicate pages, and misleading keyword stuffing should not be used as the growth strategy.

## 15. Analytics Events

Initial event vocabulary:

- `creator_create_started`
- `creator_share_started`
- `creator_share_completed`
- `creator_share_verified`
- `creator_unlock_granted`
- `creator_unlock_rejected`
- `coin_creation_started`
- `coin_creation_succeeded`
- `coin_creation_failed`
- `coin_launch_succeeded`
- `coin_page_viewed`
- `coin_shared`
- `creator_referral_attributed`
- `visitor_signup_attributed`
- `visitor_creator_activated`
- `visitor_trader_activated`

Event properties must include a versioned campaign key and avoid secrets.

## 16. Experimentation

Growth experiments should be safe to change independently of accounting invariants.

Examples:

- share screen copy
- number/order of channels
- share-card design
- public coin page layout
- discovery modules
- referral attribution window

Critical financial/entitlement safety rules should not depend solely on an analytics experiment flag. The entitlement service must retain authoritative controls.

## 17. Launch Checklist

Before enabling the loop for real users:

- [ ] entitlement grant is race-safe
- [ ] entitlement redemption is idempotent
- [ ] campaign rules are versioned
- [ ] share state is accurately represented
- [ ] unsupported social verification is not faked
- [ ] public coin page has canonical metadata
- [ ] user/engine activity is separated
- [ ] abuse rate limits exist
- [ ] audit events exist for grants/redemptions
- [ ] analytics events are tested
- [ ] privacy review completed
- [ ] security review completed
- [ ] legal/regulatory review completed for the launch jurisdiction
- [ ] kill switch exists

## 18. North-Star Principle

**Make the product worth sharing first. Then make sharing easy.**

The growth engine should turn genuine creator enthusiasm into distribution while preserving accurate metrics, user control, security, and trust.
