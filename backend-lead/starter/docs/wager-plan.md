# Plan — A3: Wager (`POST /wallets/:walletId/wagers`)

> Design written before coding. Not implemented yet — `wager-code-plan.md` will be written before creating the code files, pending review. Shared schema/ERD/state machine: see `architecture.md`.

## Requirement (summarized from `TASK.md`)

`POST /wallets/:walletId/wagers` takes `{ amount }`. Debits the wallet (reject if insufficient balance), accrues turnover (used in A4). Must write a ledger entry, same concurrency requirement as A2: **two concurrent wagers must not overdraw the wallet**.

## Related decisions

| Topic | Decision | Why |
|---|---|---|
| Wager state | **No Pending/Completed/Failed state.** A request is a synchronous debit inside one DB transaction: sufficient funds → debit immediately + write the ledger; insufficient → reject, no record created. | There's no async step for a wager (unlike deposit/withdrawal, which wait on the PSP/a human). Detail: `../DECISIONS.md` #7. |

## Locking strategy (step by step)

1. `BEGIN`
2. `SELECT * FROM wallets WHERE id = :walletId FOR UPDATE` — a second request must wait for the first to finish before it can read the latest balance.
3. If `balance < amount` → rollback, return `422`.
4. Otherwise: `UPDATE wallets SET balance = balance - amount`, insert `wallet_txs` (negative amount, `wager_id` pointing to the wager about to be created), insert `wagers`.
5. `COMMIT`.

## Sequence diagram (concurrent wagers, overdraw protection)

```mermaid
sequenceDiagram
    participant CA as Client A
    participant CB as Client B
    participant API as POST /wallets/:id/wagers
    participant DB as wallets

    Note over CA,CB: Wallet balance starts at 15.00, both wager 10.00

    CA->>API: amount = 10.00
    API->>DB: BEGIN, SELECT balance FOR UPDATE
    DB-->>API: balance = 15.00

    CB->>API: amount = 10.00, arrives around the same time
    API->>DB: BEGIN, SELECT balance FOR UPDATE
    Note over DB: Client B is blocked here
    Note over DB: must wait for Client A to COMMIT

    API->>DB: balance is sufficient, UPDATE balance = 5.00
    API->>DB: INSERT wallet_txs, amount -10.00
    API->>DB: INSERT wagers
    API->>DB: COMMIT
    API-->>CA: 201 OK

    Note over DB: only now can Client B read the row
    DB-->>API: balance = 5.00, already updated
    API->>DB: balance insufficient for 10.00, ROLLBACK
    API-->>CB: 422 insufficient balance
```
