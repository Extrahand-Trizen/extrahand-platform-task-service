/**
 * One-off: list tasks with additionalQuoteRequests and count paid rows.
 * Usage: node scripts/checkAdditionalQuoteDb.js
 * Loads .env from project root (extrahand-platform-task-service/.env).
 */
require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'extrahand';

async function main() {
  if (!uri) {
    console.error('MONGODB_URI is not set in .env');
    process.exit(1);
  }

  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 10000,
  });

  const col = mongoose.connection.db.collection('tasks');

  const withQuotes = await col
    .find({ additionalQuoteRequests: { $exists: true, $ne: [] } })
    .project({
      _id: 1,
      title: 1,
      additionalQuoteRequests: 1,
      activeAdditionalQuoteRequestId: 1,
    })
    .limit(25)
    .toArray();

  console.log(`Database: ${dbName}`);
  console.log(`Sample tasks with additionalQuoteRequests (up to 25): ${withQuotes.length}\n`);

  for (const t of withQuotes) {
    const rows = (t.additionalQuoteRequests || []).map((r) => ({
      requestId: r.requestId,
      status: r.status,
      paidAt: r.paidAt || null,
    }));
    console.log(
      JSON.stringify(
        {
          taskId: String(t._id),
          title: (t.title || '').slice(0, 50),
          activeAdditionalQuoteRequestId: t.activeAdditionalQuoteRequestId || null,
          quotes: rows,
        },
        null,
        0,
      ),
    );
  }

  const paidTasks = await col.countDocuments({
    additionalQuoteRequests: { $elemMatch: { status: 'paid' } },
  });
  const acceptedTasks = await col.countDocuments({
    additionalQuoteRequests: { $elemMatch: { status: 'accepted' } },
  });
  const pendingTasks = await col.countDocuments({
    additionalQuoteRequests: { $elemMatch: { status: 'pending' } },
  });

  console.log('\n--- Counts (tasks with at least one matching row) ---');
  console.log(`paid: ${paidTasks}`);
  console.log(`accepted: ${acceptedTasks}`);
  console.log(`pending: ${pendingTasks}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
