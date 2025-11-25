const { buildPack } = require('../pack-builder');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await buildPack();
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(500).json(result);
    }
    
  } catch (error) {
    console.error('Pack build error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
}
