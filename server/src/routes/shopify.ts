import { Router } from 'express';

const router = Router();

router.post('/import', async (req, res) => {
  const { shopDomain, accessToken } = req.body;

  if (!shopDomain || !accessToken) {
    return res.status(400).json({ error: 'Missing shopDomain or accessToken' });
  }

  let domain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!domain.includes('.')) {
    domain = `${domain}.myshopify.com`;
  }
  const url = `https://${domain}/admin/api/2024-01/products.json?limit=250&status=active`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error('Shopify Proxy Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
