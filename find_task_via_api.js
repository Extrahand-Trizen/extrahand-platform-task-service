const axios = require('axios');

const url = 'http://localhost:4002/api/v1/tasks/6a54cfa90c9356c0cc649874';
const token = 'ExtraHand_Secure_Token_2024_MinLength32Chars_ChangeInProduction';

(async () => {
  try {
    const res = await axios.get(url, {
      headers: {
        'X-Service-Auth': token,
        'X-Service-Name': 'api-gateway'
      }
    });

    console.log('Task Details:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
})();
