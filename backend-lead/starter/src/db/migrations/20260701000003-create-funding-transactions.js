'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('funding_transactions', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      member_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'members', key: 'id' },
      },
      type: { type: Sequelize.ENUM('deposit', 'withdrawal'), allowNull: false },
      status: {
        type: Sequelize.ENUM('pending', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      // Only meaningful for type=deposit; see DECISIONS.md #6 for how it's used.
      turnover_multiplier: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      // Only present for type=deposit. Unique so a callback can look up its transaction
      // and so two deposits can never collide on the same ref (idempotency anchor, see DECISIONS.md #2).
      psp_ref: { type: Sequelize.STRING, allowNull: true, unique: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.addIndex('funding_transactions', ['member_id', 'type', 'status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('funding_transactions');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_funding_transactions_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_funding_transactions_status";');
  },
};
