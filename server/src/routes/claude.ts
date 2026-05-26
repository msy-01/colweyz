import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// POST /api/claude/analyze
router.post('/analyze', async (req, res) => {
  const { donneesAnalyse, dateSelectionnee } = req.body;
  
  if (!process.env.CLE_API_CLAUDE) {
    res.status(401).json({ error: 'Clé API Claude non configurée côté serveur' });
    return;
  }

  if (!donneesAnalyse || !dateSelectionnee) {
    res.status(400).json({ error: 'Aucune donnée disponible pour cette date' });
    return;
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.CLE_API_CLAUDE });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
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
- Synthèse en 3 lignes maximum
- Verdict global

## 2. 🏆 PERFORMANCE COMMERCIALE
- Classement produits par rentabilité
- Taux d'atteinte des objectifs

## 3. 💰 PERFORMANCE FINANCIÈRE
- Analyse résultat net et taux de marge
- Ratio efficacité publicitaire

## 4. 🔴 POINTS D'ATTENTION URGENTS
- Produits avec ROI négatif
- Alertes marges

## 5. 🎯 RECOMMANDATIONS POUR DEMAIN
- 3 actions prioritaires
- Ajustements budgets pub

## 6. 📈 TENDANCE ET PROJECTION
- Évolution vs jours précédents
- Projection fin de mois`
      }]
    });

    const analyse = (response.content[0] as any).text;
    res.json({ analyse });
  } catch (error: any) {
    console.error('Claude API Error:', error);
    res.status(500).json({ error: 'Analyse indisponible, réessayez dans quelques instants' });
  }
});

export default router;
