import { sequelize } from '../sequelize';
import { Member, initMember } from './member';
import { Wallet, initWallet } from './wallet';
import { FundingTransaction, initFundingTransaction } from './fundingTransaction';
import { Wager, initWager } from './wager';
import { WalletTx, initWalletTx } from './walletTx';

initMember(sequelize);
initWallet(sequelize);
initFundingTransaction(sequelize);
initWager(sequelize);
initWalletTx(sequelize);

Member.hasOne(Wallet, { foreignKey: 'memberId', as: 'wallet' });
Wallet.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });

Member.hasMany(FundingTransaction, { foreignKey: 'memberId', as: 'fundingTransactions' });
FundingTransaction.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });

Wallet.hasMany(Wager, { foreignKey: 'walletId', as: 'wagers' });
Wager.belongsTo(Wallet, { foreignKey: 'walletId', as: 'wallet' });
Member.hasMany(Wager, { foreignKey: 'memberId', as: 'wagers' });
Wager.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });

Wallet.hasMany(WalletTx, { foreignKey: 'walletId', as: 'walletTxs' });
WalletTx.belongsTo(Wallet, { foreignKey: 'walletId', as: 'wallet' });
FundingTransaction.hasOne(WalletTx, { foreignKey: 'fundingTransactionId', as: 'walletTx' });
WalletTx.belongsTo(FundingTransaction, { foreignKey: 'fundingTransactionId', as: 'fundingTransaction' });
Wager.hasOne(WalletTx, { foreignKey: 'wagerId', as: 'walletTx' });
WalletTx.belongsTo(Wager, { foreignKey: 'wagerId', as: 'wager' });

export { Member, Wallet, FundingTransaction, Wager, WalletTx };
