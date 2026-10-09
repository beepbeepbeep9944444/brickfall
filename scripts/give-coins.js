// Add (or remove, with a negative number) coins from a player's wallet.
//   npm run coins -- <username> <amount>
import { q, closeDb } from '../server/db.js';

const [name, amountArg] = process.argv.slice(2);
const amount = Math.trunc(Number(amountArg));
if (!name || !Number.isFinite(amount) || amount === 0) {
  console.log('Usage: npm run coins -- <username> <amount>');
  process.exit(1);
}
const user = q.userByName.get(name);
if (!user) {
  console.error(`No account named "${name}".`);
  process.exit(1);
}
// The wallet is "coins earned - coins spent", so giving coins lowers coins_spent.
q.spendCoins.run(-amount, user.id);
const p = q.progress.get(user.id), after = q.userById.get(user.id);
console.log(`${amount > 0 ? 'Gave' : 'Took'} ${Math.abs(amount)} coins ${amount > 0 ? 'to' : 'from'} ${user.name}. Balance: ${Math.max(0, p.coinsEarned - after.coins_spent)}`);
closeDb();
