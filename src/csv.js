const { stringify } = require('csv-stringify/sync');

function formatDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.split('T')[0];
}

/**
 * Build a CSV matching Playtomic's customer import format.
 * Includes category_name to auto-assign membership benefits.
 */
function buildPlaytomicCSV(members) {
  const rows = members.map(m => ({
    name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
    email: m.email || '',
    phone_number: m.phone || '',
    gender: (m.gender || '').toUpperCase() || '',
    birthdate: formatDate(m.date_of_birth),
    commercial_communications: 'true',
    category_name: m.membership_name || '',
    category_expires: formatDate(m.membership_expires),
  }));

  return stringify(rows, {
    header: true,
    columns: [
      'name',
      'email',
      'phone_number',
      'gender',
      'birthdate',
      'commercial_communications',
      'category_name',
      'category_expires',
    ],
  });
}

module.exports = { buildPlaytomicCSV };
