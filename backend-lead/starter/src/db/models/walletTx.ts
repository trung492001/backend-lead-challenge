import { DataTypes, Model, Sequelize } from 'sequelize';

export type WalletTxType = 'deposit' | 'wager' | 'withdrawal';

export class WalletTx extends Model {
  declare id: string;
  declare walletId: string;
  // Signed delta: positive = credit, negative = debit. See DECISIONS.md #1 -
  // wallets.balance must always equal SUM(amount) for the wallet.
  declare amount: string;
  declare type: WalletTxType;
  declare fundingTransactionId: string | null;
  declare wagerId: string | null;
}

export function initWalletTx(sequelize: Sequelize): void {
  WalletTx.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      walletId: { type: DataTypes.UUID, allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      type: { type: DataTypes.ENUM('deposit', 'wager', 'withdrawal'), allowNull: false },
      fundingTransactionId: { type: DataTypes.UUID, allowNull: true, unique: true },
      wagerId: { type: DataTypes.UUID, allowNull: true, unique: true },
    },
    { sequelize, tableName: 'wallet_txs', underscored: true, updatedAt: false },
  );
}
