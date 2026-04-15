const axios = require('axios');

const INTERNAL_API = 'https://apiv2-tkaeguucxq-uc.a.run.app';
const FIREBASE_API_KEY = 'AIzaSyCNSSHH1yTQ492d42qWOG_V_m2uQGdQF74';

class ArketaClient {
  constructor(refreshToken, partnerId) {
    this.refreshToken = refreshToken;
    this.partnerId = partnerId;
    this.token = null;
  }

  /**
   * Get a fresh Firebase ID token using the refresh token.
   */
  async authenticate() {
    const res = await axios.post(
      `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
      `grant_type=refresh_token&refresh_token=${this.refreshToken}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    this.token = res.data.id_token;
    console.log('[Arketa] Authenticated via Firebase.');
  }

  /**
   * Fetch all active subscriptions from Arketa's internal reports API.
   */
  async getSubscriptions() {
    if (!this.token) await this.authenticate();

    const startDate = new Date(new Date().getFullYear(), 0, 1).toISOString();
    const endDate = new Date().toISOString();

    const res = await axios.post(
      `${INTERNAL_API}/reports/subscriptionsAll/fetchReport`,
      {
        filters: [[
          { field: 'purchase_date', operator: '>=', value: startDate },
          { field: 'purchase_date', operator: '<=', value: endDate },
        ]],
        parameters: [],
        multiPartner: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'partner-id': this.partnerId,
          'Authorization': `Bearer ${this.token}`,
        },
      }
    );

    return res.data.data || [];
  }

  /**
   * Get active padel members filtered by membership name.
   */
  async getActivePadelMembers(membershipNames) {
    const subscriptions = await this.getSubscriptions();

    return subscriptions
      .filter(s => {
        if (s.canceled) return false;
        if (!membershipNames || membershipNames.length === 0) return true;
        return membershipNames.some(name =>
          s.product_name?.toLowerCase().includes(name.toLowerCase())
        );
      })
      .map(s => {
        // Map Arketa product names to Playtomic benefit names
        const arketaName = (s.product_name || '').toLowerCase();
        let playtomicBenefit = '';
        if (arketaName.includes('royal')) playtomicBenefit = 'Royal Membership';
        else if (arketaName.includes('iconic')) playtomicBenefit = 'Iconic Membership';
        else if (arketaName.includes('core')) playtomicBenefit = 'Core Membership';
        else if (arketaName.includes('rise')) playtomicBenefit = 'Rise Membership';

        return {
        first_name: s.client_name?.split(' ')[0] || '',
        last_name: s.client_name?.split(' ').slice(1).join(' ') || '',
        email: s.client_email || '',
        phone: s.phone_number || '',
        gender: null,
        date_of_birth: null,
        membership_name: playtomicBenefit || (s.product_name || '').trim(),
        membership_expires: s.renewal_date?.value || s.next_renewal_date?.value || null,
      };
      });
  }
}

module.exports = ArketaClient;
