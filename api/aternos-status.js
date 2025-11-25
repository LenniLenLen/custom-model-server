import { AternosAPI } from './aternos-helper.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const ATERNOS_USERNAME = process.env.ATERNOS_USERNAME;
    const ATERNOS_PASSWORD = process.env.ATERNOS_PASSWORD;
    const ATERNOS_SERVER = process.env.ATERNOS_SERVER_ID;

    if (!ATERNOS_USERNAME || !ATERNOS_PASSWORD || !ATERNOS_SERVER) {
      return res.status(500).json({ 
        error: 'Aternos configuration missing',
        message: 'Please set ATERNOS_USERNAME, ATERNOS_PASSWORD, and ATERNOS_SERVER_ID environment variables'
      });
    }

    const aternos = new AternosAPI(ATERNOS_USERNAME, ATERNOS_PASSWORD, ATERNOS_SERVER);
    
    // Login and get status
    const loginSuccess = await aternos.login();
    if (!loginSuccess) {
      return res.status(500).json({ error: 'Failed to login to Aternos' });
    }

    const status = await aternos.getServerStatus();
    
    res.status(200).json({
      success: true,
      status: status ? (status.status || 'Unknown') : 'Offline',
      online: status ? (status.online || false) : false,
      players: status ? (status.players || {}) : {},
      message: 'Aternos server status retrieved successfully'
    });

  } catch (error) {
    console.error('Aternos status error:', error);
    res.status(500).json({ 
      error: 'Failed to get Aternos server status', 
      message: error.message 
    });
  }
}
