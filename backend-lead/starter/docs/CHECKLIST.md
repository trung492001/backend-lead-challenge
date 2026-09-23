# CHECKLIST — by feature

> This file is organized by **independent feature** so you can pick your own implementation order. Tick each item off when done. For technical detail/reasoning see `architecture.md` (shared) + each feature's `<feature>-plan.md` / `<feature>-code-plan.md`, and `../DECISIONS.md`.

## 0. Foundation — before any feature

- [x] Migration `create-funding-transactions` (columns: `member_id`, `type`, `status`, `amount`, `turnover_multiplier`, nullable unique `psp_ref`, `created_at`, `updated_at`)
- [x] Migration `create-wagers` (columns: `wallet_id`, `member_id`, `amount`, `created_at`) — created before `wallet_txs` since `wallet_txs` FKs to both `wagers` and `funding_transactions`
- [x] Migration `create-wallet-txs` (columns: `wallet_id`, signed-delta `amount`, `type`, nullable-unique `funding_transaction_id`, nullable-unique `wager_id`, `created_at`) — added a CHECK constraint requiring exactly one of the two FKs to be set
- [x] Models `FundingTransaction`, `Wager`, `WalletTx` + registered in `src/db/models/index.ts` + associations
- [x] `pspRef` generator helper (`src/lib/pspRef.ts`, `psp_<uuid>`)

## Feature A1 — Create Deposit (`POST /deposits`)

- [x] Zod schema: `memberId` (uuid), `amount` (positive decimal string), `turnoverMultiplier` (int ≥ 0, default 1)
- [x] Service: creates a `funding_transactions` row `type=deposit, status=Pending`, generates `pspRef`
- [x] Route returns `201 { id, pspRef }`
- [x] Mounted in `src/app.ts`
- [x] Test: successful creation returns the right shape
- [x] Test: rejects an invalid amount (negative, not a number) + rejects an unknown `memberId`

## Feature A2 — PSP Callback (`POST /psp/callbacks`) — the core of the assignment

- [x] Zod schema: `pspRef`, `status` (`completed|failed`), `amount`
- [x] Service: `SELECT funding_transactions WHERE psp_ref FOR UPDATE` inside one transaction
- [x] Unknown `pspRef` → `404`, not a thrown `500`
- [x] Status guard: only applies when `status == Pending`; otherwise no-op, returns `200`
- [x] `completed`: update `status=Completed`, insert `wallet_txs` (+**original** amount, not the callback's amount), `UPDATE wallets.balance` (also locks the `wallets` row)
- [x] `failed`: update `status=Failed`, balance unchanged
- [x] Warning log if `callback.amount != funding_transactions.amount` (per `DECISIONS.md` #5)
- [x] Mounted in `src/app.ts`
- [x] Test: `completed` callback credits exactly once + exactly one ledger entry
- [x] Test: **sequential** duplicate callback doesn't double-credit
- [x] Test: **concurrent** duplicate callback (`Promise.all`) doesn't double-credit ⚠️ required
- [x] Test: unknown `pspRef` → `404`, no crash
- [x] Test: `failed` callback transitions correctly, balance unchanged (+ bonus test: `Failed → Completed` is blocked)

## Feature A3 — Wager (`POST /wallets/:walletId/wagers`)

- [ ] Zod schema: `amount` (positive decimal string)
- [ ] Service: `SELECT wallets FOR UPDATE`, check `balance >= amount`
- [ ] Sufficient funds: `UPDATE balance -= amount`, insert `wallet_txs` (negative), insert `wagers`
- [ ] Insufficient funds: reject `422`, no record created
- [ ] Mounted in `src/app.ts`
- [ ] Test: successful wager debits the right balance + writes a ledger entry
- [ ] Test: rejects on insufficient balance
- [ ] Test: 2 **concurrent** wagers don't overdraw the wallet ⚠️ required

## Feature A4 — Withdrawal + turnover lock (`POST /withdrawals`)

- [ ] Zod schema: `memberId` (uuid), `amount` (positive decimal string)
- [ ] Service: `SELECT wallets FOR UPDATE`
- [ ] Compute `required = Σ(amount × turnoverMultiplier)` from `Completed` deposits
- [ ] Compute `accrued = Σ(amount)` from all wagers
- [ ] `accrued < required` → `422 { outstandingTurnover }`
- [ ] `accrued >= required` and sufficient balance → debit, insert `wallet_txs` (negative), insert `funding_transactions` (`type=withdrawal, status=Pending`)
- [ ] Mounted in `src/app.ts`
- [ ] Test: blocks withdrawal when turnover is insufficient, body reports the correct outstanding amount
- [ ] Test: allows withdrawal once turnover is sufficient (after enough wagering)
- [ ] Test: rejects if balance is insufficient even when turnover is sufficient

## Wrap-up (do last, not tied to any single feature)

- [ ] Run the full `npm test` suite green
- [ ] Verify the invariant: `SUM(wallet_txs.amount) == wallets.balance` (a test or a manual check script)
- [ ] Finish `DECISIONS.md` #8 (known gaps) and #9 (AI disclosure for the code)
- [ ] Write `DESIGN-PSP.md` (Part B)
