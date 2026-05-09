const { stringify } = require('csv-stringify/sync');

function formatDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.split('T')[0];
}

/**
 * Format phone number to Playtomic's expected format: "+1 XXXXXXXXXX"
 * Arketa gives us "+1XXXXXXXXXX" (no space after country code).
 * Playtomic requires "+1 XXXXXXXXXX" with a space after the country code.
 * Matches exact format from Playtomic's customer export CSV.
 */
function formatPhone(phone) {
  if (!phone) return '';
  phone = phone.trim();
  // Already formatted with space — return as-is
  if (/^\+\d{1,3}\s/.test(phone)) return phone;
  // US/Canada numbers: +1 followed by 10 digits
  const usMatch = phone.match(/^\+1(\d{10})$/);
  if (usMatch) return `+1 ${usMatch[1]}`;
  // Other international: +CC followed by digits (2-3 digit country codes)
  const intlMatch = phone.match(/^\+(\d{2,3})(\d+)$/);
  if (intlMatch) return `+${intlMatch[1]} ${intlMatch[2]}`;
  return phone;
}

/**
 * Build a CSV matching Playtomic's customer import format.
 * Includes category_name to auto-assign membership benefits.
 */
function buildPlaytomicCSV(members) {
  // Playtomic's wizard displays Title Case labels, but the backend
  // (/api/v1/user_imports) requires snake_case lowercase headers and rejects
  // anything else as "extra_headers". The redesigned schema also requires the
  // two new columns benefit_price_id and next_due_date — empty values are OK
  // but the headers themselves must be present.
  const rows = members.map(m => ({
    name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
    email: m.email || '',
    phone_number: formatPhone(m.phone),
    gender: (m.gender || '').toUpperCase() || '',
    birthdate: formatDate(m.date_of_birth),
    category_name: m.membership_name || '',
    category_expires: formatDate(m.membership_expires),
    benefit_price_id: '',
    next_due_date: '',
  }));

  return stringify(rows, {
    header: true,
    columns: [
      'name',
      'email',
      'phone_number',
      'gender',
      'birthdate',
      'category_name',
      'category_expires',
      'benefit_price_id',
      'next_due_date',
    ],
  });
}

module.exports = { buildPlaytomicCSV };
