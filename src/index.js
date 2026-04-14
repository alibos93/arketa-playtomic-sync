require('dotenv').config();

const ArketaClient = require('./arketa');
const { buildPlaytomicCSV } = require('./csv');
const { uploadCSVToPlaytomic } = require('./playtomic');

async function run() {
  const {
    ARKETA_REFRESH_TOKEN,
    ARKETA_PARTNER_ID,
    PLAYTOMIC_EMAIL,
    PLAYTOMIC_PASSWORD,
    MEMBERSHIP_NAMES,
  } = process.env;

  if (!ARKETA_REFRESH_TOKEN || !ARKETA_PARTNER_ID) {
    throw new Error('Missing ARKETA_REFRESH_TOKEN or ARKETA_PARTNER_ID');
  }
  if (!PLAYTOMIC_EMAIL || !PLAYTOMIC_PASSWORD) {
    throw new Error('Missing PLAYTOMIC_EMAIL or PLAYTOMIC_PASSWORD');
  }

  const membershipNames = MEMBERSHIP_NAMES
    ? MEMBERSHIP_NAMES.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  console.log(`Starting sync — ${new Date().toISOString()}`);
  console.log(`Filtering memberships: ${membershipNames.length > 0 ? membershipNames.join(', ') : '(all)'}`);

  const arketa = new ArketaClient(ARKETA_REFRESH_TOKEN, ARKETA_PARTNER_ID);
  const members = await arketa.getActivePadelMembers(membershipNames);
  console.log(`Found ${members.length} active members in Arketa`);

  if (members.length === 0) {
    console.log('No members to import. Exiting.');
    return;
  }

  const csv = buildPlaytomicCSV(members);
  console.log('CSV generated successfully');
  console.log('Preview:\n' + csv);

  await uploadCSVToPlaytomic(csv, PLAYTOMIC_EMAIL, PLAYTOMIC_PASSWORD);

  console.log(`Sync complete — ${members.length} members imported to Playtomic`);
}

run().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
