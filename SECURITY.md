# TradeShark Security

## Project status

TradeShark is under active development and is not a production trading venue yet. Prototype web pages must not be treated as live trading functionality.

## Reporting a vulnerability

Please do not publish sensitive vulnerability details in a public issue.

For a security report, contact the project maintainer privately through the contact method configured on the repository owner account. Include:

- affected component or file;
- reproducible steps;
- expected and observed behavior;
- potential impact;
- any safe mitigation you identified.

Do not include passwords, API tokens, private keys, seed phrases, session cookies, or other credentials in a report.

## Security principles

- Secrets belong in deployment/runtime configuration, never in source control.
- Private keys, seed phrases, session secrets, and credentials must never be collected as public intelligence data.
- Financial state must be enforced server-side and settled through the double-entry ledger.
- Engine-generated activity must remain distinguishable from organic user activity.
- Production publication requires passing the project's release gates and security review.
