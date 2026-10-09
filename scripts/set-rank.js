// Grant or remove a rank.
//   npm run rank -- <username> <MOD|ADMIN|OWNER>     staff rank (overrides everything)
//   npm run rank -- <username> <ACE|HERO|TITAN>      purchasable rank, granted for free
//   npm run rank -- <username> none                  remove both
// Uses the same DATA_DIR as the server, so run it on the machine (or volume) that holds the database.
import { q, closeDb } from '../server/db.js';
import { STAFF_RANKS, RANKS } from '../public/js/shared/cosmetics.js';

const [name, rankArg] = process.argv.slice(2);
const staff = STAFF_RANKS.map((r) => r.id), paid = RANKS.filter((r) => r.tier > 0).map((r) => r.id);

if (!name || !rankArg) {
  console.log(`Usage: npm run rank -- <username> <${[...staff, ...paid].join('|')}|none>`);
  process.exit(1);
}
const rank = rankArg.toUpperCase();
if (rank !== 'NONE' && !staff.includes(rank) && !paid.includes(rank)) {
  console.error(`Unknown rank "${rankArg}". Choose one of: ${[...staff, ...paid].join(', ')}, none`);
  process.exit(1);
}
const user = q.userByName.get(name);
if (!user) {
  console.error(`No account named "${name}".`);
  process.exit(1);
}

if (rank === 'NONE') {
  q.setStaffRank.run(null, user.id);
  q.setPaidRank.run(null, user.id);
  console.log(`Removed all ranks from ${user.name}.`);
} else if (staff.includes(rank)) {
  q.setStaffRank.run(rank, user.id);
  console.log(`${user.name} is now ${rank} (staff).`);
} else {
  q.setPaidRank.run(rank, user.id);
  console.log(`${user.name} now has the ${rank} rank.`);
}
closeDb();
