import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { createServer as createViteServer } from 'vite';
import path from 'path';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Proxy for Shopify
  app.post('/api/shopify/import', async (req, res) => {
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

  // Anthropic API Endpoint
  app.post('/api/claude/analyze', async (req, res) => {
    const { donneesAnalyse, dateSelectionnee } = req.body;
    
    if (!process.env.CLE_API_CLAUDE) {
      return res.status(401).json({ error: 'Clé API invalide, vérifiez vos Secrets' });
    }

    if (!donneesAnalyse || !dateSelectionnee) {
      return res.status(400).json({ error: 'Aucune donnée disponible pour cette date' });
    }

    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({
        apiKey: process.env.CLE_API_CLAUDE
      });

      const response = await client.messages.create({
        model: "claude-3-5-sonnet-20241022", // Using the latest available Claude 3.5 Sonnet model
        max_tokens: 2000,
        system: `Tu es un analyste commercial et financier expert spécialisé dans 
        le e-commerce et la livraison rapide en Afrique de l'Ouest, 
        particulièrement au Sénégal. Les montants sont en F CFA. 
        Tu connais le contexte local : coûts de livraison, habitudes 
        d'achat, publicité Meta/Facebook pour le marché sénégalais.
        Sois précis, concis et orienté action. 
        Utilise des emojis pour les indicateurs : ✅ bon, ⚠️ attention, 🔴 critique.
        Réponds toujours en français.`,
        
        messages: [{
          role: "user",
          content: `Voici les données de performance du ${dateSelectionnee} :
          
${JSON.stringify(donneesAnalyse, null, 2)}

Produis une analyse complète structurée ainsi :

## 1. 📊 RÉSUMÉ EXÉCUTIF
- Synthèse en 3 lignes maximum de la journée
- Verdict global : bonne journée ✅ / journée mitigée ⚠️ / mauvaise journée 🔴

## 2. 🏆 PERFORMANCE COMMERCIALE
- Classement des produits par rentabilité réelle (marge)
- Produits ayant atteint leur point mort
- Produits en dessous du point mort avec écart chiffré
- Taux d'atteinte des objectifs de livraison par produit

## 3. 💰 PERFORMANCE FINANCIÈRE
- Analyse du résultat net et du taux de marge
- Répartition des charges en % du CA (pub / appro / livraison)
- Ratio efficacité publicitaire : MER et ROI par produit
- Identification des charges disproportionnées

## 4. 🔴 POINTS D'ATTENTION URGENTS
- Produits avec ROI négatif → cause probable et action immédiate
- Objectifs très loin d'être atteints
- Alertes sur les marges anormalement basses ou négatives

## 5. 🎯 RECOMMANDATIONS ACTIONNABLES POUR DEMAIN
- 3 actions prioritaires classées par impact
- Ajustement des budgets pub suggérés par produit (augmenter / réduire / stopper)
- Produits à mettre en avant ou à ralentir

## 6. 📈 TENDANCE ET PROJECTION MENSUELLE
- Évolution par rapport aux jours précédents du mois
- Rythme actuel vs objectif mensuel
- Projection du résultat fin de mois si tendance maintenue
- Recommandation stratégique pour le reste du mois`
        }]
      });

      const analyse = (response.content[0] as any).text;
      res.json({ analyse });
    } catch (error: any) {
      console.error('Claude API Error:', error);
      res.status(500).json({ error: 'Analyse indisponible, réessayez dans quelques instants' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
