import { DataTypes, Model, Sequelize } from 'sequelize';

export class Wager extends Model {
  declare id: string;
  declare walletId: string;
  declare memberId: string;
  // DECIMAL comes back from the pg driver as a string. Keep it that way; see src/lib/money.ts.
  declare amount: string;
}

export function initWager(sequelize: Sequelize): void {
  Wager.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      walletId: { type: DataTypes.UUID, allowNull: false },
      memberId: { type: DataTypes.UUID, allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
    },
    { sequelize, tableName: 'wagers', underscored: true, updatedAt: false },
  );
}
