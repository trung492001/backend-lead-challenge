import { DataTypes, Model, Sequelize } from 'sequelize';

export type FundingTransactionType = 'deposit' | 'withdrawal';
export type FundingTransactionStatus = 'pending' | 'completed' | 'failed';

export class FundingTransaction extends Model {
  declare id: string;
  declare memberId: string;
  declare type: FundingTransactionType;
  declare status: FundingTransactionStatus;
  // DECIMAL comes back from the pg driver as a string. Keep it that way; see src/lib/money.ts.
  declare amount: string;
  declare turnoverMultiplier: number;
  declare pspRef: string | null;
}

export function initFundingTransaction(sequelize: Sequelize): void {
  FundingTransaction.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      memberId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.ENUM('deposit', 'withdrawal'), allowNull: false },
      status: {
        type: DataTypes.ENUM('pending', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      turnoverMultiplier: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      pspRef: { type: DataTypes.STRING, allowNull: true, unique: true },
    },
    { sequelize, tableName: 'funding_transactions', underscored: true },
  );
}
