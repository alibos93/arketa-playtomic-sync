const { stringify } = require('csv-stringify/sync');

function formatDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.split('T')[0];
}

/**
 * Format phone number to Playtomic's expected format: "+1 XXXXXXXXXX"
 * Arketa gives us "+1XXXXXXXXXX" (no space after country code).
 * Playtomic requires a space after the country code.
 */
function formatPhone(phone) {
  if (!phone) return '';
  phone = phone.trim();
  // If already has a space after +N or +NN, return as-is
  if (/^\+\d{1,3}\s/.test(phone)) return phone;
  // Match country code (1-3 digits after +) and insert space
  const match = phone.match(/^\+(\d{1,3})(\d+)$/);
  if (match) return `+${match[1]} ${match[2]}`;
  return phone;
}

/**
 * Build a CSV matching Playtomic's customer import format.
 * Includes category_name to auto-assign membership benefits.
 */
function buildPlaytomicCSV(members) {
  const rows = members.map(m => ({
    name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
    email: m.email || '',
    phone_number: formatPhone(m.phone),
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
