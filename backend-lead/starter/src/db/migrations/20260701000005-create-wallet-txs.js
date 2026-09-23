'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('wallet_txs', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      wallet_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'wallets', key: 'id' },
      },
      // Signed delta: positive = credit, negative = debit.
      // wallets.balance must always equal SUM(amount) for the wallet (see DECISIONS.md #1).
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      type: { type: Sequelize.ENUM('deposit', 'wager', 'withdrawal'), allowNull: false },
      // Exactly one of these two is set, enforced by the CHECK constraint below.
      funding_transaction_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'funding_transactions', key: 'id' },
        // Unique when set: guarantees a funding transaction can only ever produce
        // one ledger entry, the core defense against double-crediting (DECISIONS.md #2).
        unique: true,
      },
      wager_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'wagers', key: 'id' },
        unique: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.addIndex('wallet_txs', ['wallet_id']);

    await queryInterface.sequelize.query(`
      ALTER TABLE wallet_txs
      ADD CONSTRAINT wallet_txs_exactly_one_source CHECK (
        (funding_transaction_id IS NOT NULL)::int + (wager_id IS NOT NULL)::int = 1
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('wallet_txs');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_wallet_txs_type";');
  },
};
