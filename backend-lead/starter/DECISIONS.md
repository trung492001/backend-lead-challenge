# DECISIONS

> Living document — updated as soon as a new decision is made while coding, not saved up for the end. Each entry follows: the problem I noticed while designing → how I solved it → the trade-off.

## 1. Balance is a number that can be `UPDATE`d — nothing proves it's correct

If the only source of truth were a `wallets.balance` column updated in place (`UPDATE balance = balance + x` on every credit/debit), then after an incident (double-credit, a calculation bug, a user dispute) there would be no way to trace back why the balance ended up at that number — it would just be a floating figure with nothing to verify it against.

**Solution:** add a `wallet_txs` table as an **append-only ledger** — every balance change writes a new row, and existing rows are never updated or deleted. The `amount` column stores a **signed delta** (positive = credit, negative = debit) rather than a post-transaction balance snapshot, so `balance = SUM(wallet_txs.amount)` can be proven at any time and used for reconciliation whenever something looks off.

**Trade-off:** `wallets.balance` is kept as a cache column (fast to read, no need to `SUM` on every request), accepting the risk that it could drift if a bug slips through — the ledger, not the `balance` column, is treated as the source of truth.

## 2. A PSP callback can arrive late, arrive twice, or arrive twice at the same instant — how do I credit exactly once?

This is the biggest risk in the whole system: if the handler simply checks `if status == pending then credit`, two requests running in parallel could both read `pending` before either one manages to write `Completed`, crediting the same amount twice.

**Solution:** lock the `funding_transactions` row by `psp_ref` with `SELECT ... FOR UPDATE` inside one DB transaction, before reading `status`. A second delivery — whether concurrent or arriving later — is forced to **wait** until the first transaction commits before it can read the row; by then it sees `status = Completed` and no-ops, still returning `200` without writing anything further. A **unique index on `wallet_txs.funding_transaction_id`** is the second line of defense: even if the logic above had a bug, a duplicate ledger insert for the same funding transaction would still be rejected by the database as a unique violation instead of silently going through.

**Why pessimistic row locking instead of optimistic locking (version column + retry):** contention on the same `psp_ref` is rare, but the consequence of getting it wrong (double-crediting real money) is severe — a short block is an acceptable price for absolute correctness, versus a more complex retry loop that could still leave a race window if the logic is wrong.

## 3. Two concurrent wagers could both read the same old balance and both debit — overdrawing the wallet

Similar to problem 2 but on the debit side: without locking, two 10.00 wagers running in parallel on a wallet holding 15.00 could both read `balance = 15.00`, both see sufficient funds, and both debit — leaving the balance at -5.00.

**Solution:** the same pattern — `SELECT wallets ... FOR UPDATE` before checking and debiting the balance, inside the same transaction as writing the ledger entry. The second request has to wait for the first to commit before it can read the latest balance and check it again.

## 4. Deposit and withdrawal both need a "pending" state — is splitting them into two tables worth it?

I initially planned separate tables for deposits and withdrawals, but both need exactly the same state machine (`Pending → Completed / Failed`) and the same set of operations (create, wait, resolve). Splitting them would only duplicate the state-machine handling in two places for no clear benefit.

**Solution:** merge both into a single `funding_transactions` table, with a `type` column (`deposit | withdrawal`) to distinguish direction. `psp_ref` is only required for deposits — withdrawals don't go through the PSP in this exercise's scope. This is already reflected in the schema/migrations that ship with Foundation, even though the withdrawal endpoint itself isn't built yet.

## 5. The PSP reports an `amount` that differs from what I recorded when the deposit was created — which one do I trust?

Trusting the callback's `amount` would let a misbehaving PSP (wrong unit, e.g. minor units) or a forged callback credit the wrong amount into a wallet — exactly the class of bug the assignment describes as "not a bug, an incident."

**Solution:** credit the `amount` recorded at deposit creation time (data the system itself controls); the callback's `amount` is only used for reconciliation and a warning log if it disagrees, never to decide how much money enters the wallet.

## 6. What should turnover be calculated from — does it need to pair specific deposits with specific wagers?

While designing this I first thought I'd need to "pair" each deposit with the wagers that unlock it, to know which deposit had become eligible. That turned out to be unnecessary complexity: the business rule only compares two totals, it doesn't care which wager "pays off" which deposit.

**Solution:** compute two running totals **per member, over their lifetime**, not tied to any specific withdrawal:

```
required_turnover(member) = Σ (amount × turnoverMultiplier)  -- every Completed deposit
accrued_turnover(member)  = Σ amount                          -- every wager
```

There's no "consumption" mechanism after a withdrawal — if `accrued ≥ required`, the withdrawal gate stays open until a new deposit raises `required` again.

**How it's computed:** on the fly with `SUM` on every withdrawal request, instead of maintaining a separate running-total table updated transactionally on every deposit/wager. Reason: avoids having two data sources that must stay in sync (risk of drift if one code path forgets to update the counter), and `SUM` only runs on withdrawal — not a hot path like deposit/wager — so the cost is acceptable.

## 7. Does a wager need its own Pending state like deposit/withdrawal?

I initially planned to reuse one state machine across all three transaction types for "consistency." But a wager has no external waiting step (no PSP, no human approval) — the whole thing fits inside one request, one DB transaction: sufficient funds → debit + write the ledger immediately, insufficient → reject and create no record.

**Solution:** no `status` column on `wager` — a state machine for an operation that's always synchronous is just an unnecessary abstraction.

## 9. AI tool disclosure

I used **Claude Code (Claude Sonnet 5, via CLI)** for the following, scoped to what's covered by this document (Foundation, A1, A2):

- Discussed architecture & schema: reviewed the `schema.dbml` I drafted myself, and it pointed out gaps (missing `amount`/`type` columns on the transaction table, no ledger entry for wagers, etc.) — I made the final call on every decision above after being asked directly about each ambiguous point.
- Drew sequence diagrams / a state diagram / an ERD illustrating the business flow, split per feature: `docs/architecture.md` (shared schema/ERD/state machine), `docs/create-deposit-plan.md`, `docs/psp-callback-plan.md`, `docs/wager-plan.md`, `docs/withdrawal-plan.md`.
- Wrote a feature checklist (`docs/CHECKLIST.md`).
- Wrote a code plan with the actual code for A1/A2 to review before creating the files (`docs/create-deposit-code-plan.md`, `docs/psp-callback-code-plan.md`) — the same process applies to A3/A4 when I get to them.
