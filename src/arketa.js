const axios = require('axios');

const BASE_URL = 'https://us-central1-sutra-prod.cloudfunctions.net/partnerApi/v0';

class ArketaClient {
  constructor(apiKey, partnerId) {
    this.partnerId = partnerId;
    this.http = axios.create({
      baseURL: `${BASE_URL}/${partnerId}`,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async getClients() {
    const res = await this.http.get('/clients');
    return res.data || [];
  }

  async getPurchases() {
    const res = await this.http.get('/purchases');
    return res.data || [];
  }

  async getActivePadelMembers(membershipNames) {
    const [clients, purchases] = await Promise.all([
      this.getClients(),
      this.getPurchases(),
    ]);

    const clientMap = {};
    for (const client of clients) {
      clientMap[client.id] = client;
    }

    const activePadelPurchases = purchases.filter(p => {
      if (p.status !== 'active') return false;
      if (!membershipNames || membershipNames.length === 0) return true;
      return membershipNames.some(name =>
        p.name?.toLowerCase().includes(name.toLowerCase())
      );
    });

    const members = [];
    for (const purchase of activePadelPurchases) {
      const client = clientMap[purchase.client_id];
      if (!client || client.removed) continue;

      members.push({
        first_name: client.first_name,
        last_name: client.last_name,
        email: client.email,
        phone: client.phone,
        gender: client.gender,
        date_of_birth: client.date_of_birth,
        membership_name: purchase.name,
        membership_expires: purchase.end_date,
      });
    }

    return members;
  }
}

module.exports = ArketaClient;
