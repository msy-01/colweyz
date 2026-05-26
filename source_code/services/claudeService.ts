import { DataService } from './dataService';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isBefore, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { parseProductCommand } from '../utils/productParser';
import { trouverProduitShopify } from '../utils/productMatcher';
import { DailyFinanceData } from '../types';

const FINANCE_START_DATE = new Date('2026-03-05');

export const ClaudeService = {
  async analyze(dateStr: string, exchangeRate: number): Promise<string> {
    try {
      // 1. Fetch all required data
      const [products, configs, dailyEntries, orders, zones, allFinanceData] = await Promise.all([
        DataService.getProducts(),
        DataService.getFinancialConfigs(),
        DataService.getDailyEntries(),
        DataService.getOrders(),
        DataService.getZones(),
        DataService.getAllDailyFinanceData()
      ]);

      // 2. Calculate Rentabilité Data
      const activeProducts = products.filter(p => {
        const endOfDayStr = `${dateStr}T23:59:59`;
        const productConfigs = configs.filter(c => c.productId === p.id && c.updatedAt <= endOfDayStr);
        productConfigs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        const config = productConfigs[0];
        return config?.isCampaignActive === true;
      });

      const rentabiliteProduits = [];
      let totalQtes = 0, totalCA = 0, totalAppro = 0, totalPubCfa = 0, totalMarge = 0;
      let aLivrerTotal = 0, realiseTotal = 0, objectifTotal = 0, resteTotal = 0;

      const dailyEntry = dailyEntries.find(e => e.date === dateStr);
      const rate = dailyEntry ? dailyEntry.exchangeRate : exchangeRate;

      for (const p of activeProducts) {
        // Config
        const endOfDayStr = `${dateStr}T23:59:59`;
        const productConfigs = configs.filter(c => c.productId === p.id && c.updatedAt <= endOfDayStr);
        productConfigs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        const config = productConfigs[0];

        const soldQty = dailyEntry?.entries[p.id]?.soldQty || 0;
        const spendUsd = dailyEntry?.entries[p.id]?.spendUsd || 0;

        const CAU = config?.cau || 0;
        const APPRO_U = config?.appro || 0;
        
        const ca = soldQty * CAU;
        const appro = soldQty * APPRO_U;
        const pubCfa = spendUsd * 1.18 * rate;
        const marge = ca - appro - pubCfa;
        const tauxMarge = (appro + pubCfa) > 0 ? (marge / (appro + pubCfa)) * 100 : 0;
        const roi = pubCfa > 0 ? marge / pubCfa : 0;
        const mer = pubCfa > 0 ? ca / pubCfa : 0;
        const cpau = soldQty > 0 ? pubCfa / soldQty : 0;

        const dailyAllocatedBudgetUsd = config?.dailyBudgetUsd || 0;
        const dailyAllocatedPubCfa = dailyAllocatedBudgetUsd * 1.18 * rate;
        const marginUnit = CAU - APPRO_U;
        const pointMort = marginUnit > 0 ? Math.ceil(dailyAllocatedPubCfa / marginUnit) : 0;

        // Calculate a_livrer, realise
        const productOrders = orders.filter(o => {
            if (o.products && o.products.length > 0) {
                return o.products.some(prod => prod.sku === p.id || prod.name === p.title || trouverProduitShopify(prod.name, [p]));
            }
            const isIdMatch = o.productId === p.id;
            const { productName } = parseProductCommand(o.productDetails || '');
            const match = trouverProduitShopify(productName, [p]);
            const isNameMatch = !o.productId && !!match;
            return isIdMatch || isNameMatch;
        });

        const rangeOrders = productOrders.filter(o => {
            const d = o.scheduledAt || o.assignedAt;
            if (!d) return false;
            return d.startsWith(dateStr);
        });

        const getQty = (o: any) => {
            if (o.products && o.products.length > 0) {
                return o.products
                    .filter((prod: any) => prod.sku === p.id || prod.name === p.title || trouverProduitShopify(prod.name, [p]))
                    .reduce((acc: number, prod: any) => acc + (prod.quantity || 1), 0);
            }
            const { quantity } = parseProductCommand(o.productDetails || '');
            return quantity;
        };

        let realise = 0;
        let aLivrer = 0;

        rangeOrders.forEach(o => {
            const qty = getQty(o);
            const regionalStatuses = [
                'regional_en_attente', 'regional_contacte', 'regional_relance', 'regional_injoignable', 
                'regional_injoignable_x2', 'regional_injoignable_x3',
                'expedition_en_cours', 'expedition_livree', 'regional_annule', 'regional_reporte'
            ];
            let isRegional = regionalStatuses.includes(o.status);
            if (!isRegional && o.status === 'validé' && o.zoneId) {
                const zone = zones.find(z => z.id === o.zoneId);
                if (zone && zone.type === 'regional') isRegional = true;
            }

            if (isRegional) {
                const isPaid = o.regionalPaymentStatus === 'paid' || (!o.regionalPaymentStatus && o.isPrePaid);
                if (isPaid) realise += qty;
                if (isPaid) aLivrer += qty;
            } else {
                if (o.status === 'livré') realise += qty;
                if (o.driverId && o.status !== 'annulé' && o.status !== 'injoignable') aLivrer += qty;
            }
        });

        const reste = Math.max(0, pointMort - realise);
        const statut = marge > 0 ? '✅' : (marge < 0 ? '🔴' : '⚠️');

        rentabiliteProduits.push({
          nom: p.title,
          qtes_vendues: soldQty,
          ca,
          appro,
          pub_usd: spendUsd,
          pub_cfa: pubCfa,
          marge,
          taux_marge: tauxMarge,
          roi,
          mer,
          cpau,
          point_mort: pointMort,
          a_livrer: aLivrer,
          realise,
          objectif: pointMort,
          reste,
          statut
        });

        totalQtes += soldQty;
        totalCA += ca;
        totalAppro += appro;
        totalPubCfa += pubCfa;
        totalMarge += marge;
        aLivrerTotal += aLivrer;
        realiseTotal += realise;
        objectifTotal += pointMort;
        resteTotal += reste;
      }

      // 3. Calculate Finance Data
      const dayFinance = allFinanceData.find(d => d.date === dateStr) || ({ otherRevenues: [], otherExpenses: [] } as unknown as DailyFinanceData);
      
      let caLivraisonsDakar = 0;
      let caExpeditionsRegions = 0;
      let fraisLivraison = 0;

      orders.forEach(o => {
          if (o.status === 'livré' && o.deliveredAt?.startsWith(dateStr)) {
              const CAU = configs.find(c => c.productId === o.productId)?.cau || 0;
              caLivraisonsDakar += CAU;
              fraisLivraison += (o.deliveryCost || 0);
          }
          const isPaid = o.regionalPaymentStatus === 'paid' || (!o.regionalPaymentStatus && o.isPrePaid);
          if (isPaid && o.assignedAt?.startsWith(dateStr)) {
              const CAU = configs.find(c => c.productId === o.productId)?.cau || 0;
              caExpeditionsRegions += CAU;
              fraisLivraison += (o.deliveryCost || 0);
          }
      });

      const autresProduits = dayFinance.otherRevenues?.reduce((sum: number, r) => sum + r.amount, 0) || 0;
      const totalProduits = caLivraisonsDakar + caExpeditionsRegions + autresProduits;

      const autresCharges = dayFinance.otherExpenses?.reduce((sum: number, e) => sum + e.amount, 0) || 0;
      const totalCharges = totalPubCfa + totalAppro + fraisLivraison + autresCharges;
      const resultatNet = totalProduits - totalCharges;
      const tauxMargeFinance = totalProduits > 0 ? (resultatNet / totalProduits) * 100 : 0;

      // 4. Calculate Cumul Mois
      const targetDate = parseISO(dateStr);
      const start = startOfMonth(targetDate);
      const end = endOfMonth(targetDate);
      const daysInMonth = eachDayOfInterval({ start, end });
      
      let totalCAMois = 0;
      let totalChargesMois = 0;
      let nombreJoursActifs = 0;

      daysInMonth.forEach(day => {
          if (isBefore(day, FINANCE_START_DATE) || day > targetDate) return;
          nombreJoursActifs++;
          
          const dStr = format(day, 'yyyy-MM-dd');
          const dEntry = dailyEntries.find(e => e.date === dStr);
          const dRate = dEntry ? dEntry.exchangeRate : 600;
          
          let dCa = 0;
          let dAppro = 0;
          let dPub = 0;

          activeProducts.forEach(p => {
              const c = configs.find(c => c.productId === p.id);
              const sq = dEntry?.entries[p.id]?.soldQty || 0;
              const su = dEntry?.entries[p.id]?.spendUsd || 0;
              dCa += sq * (c?.cau || 0);
              dAppro += sq * (c?.appro || 0);
              dPub += su * 1.18 * dRate;
          });

          totalCAMois += dCa;
          totalChargesMois += (dAppro + dPub); // Simplified for cumul
      });

      const margeCumulee = totalCAMois - totalChargesMois;
      const tauxMargeMoyen = totalCAMois > 0 ? (margeCumulee / totalCAMois) * 100 : 0;

      const donneesAnalyse = {
        date: dateStr,
        taux_usd_cfa: rate,
        rentabilite: {
          produits: rentabiliteProduits,
          totaux: {
            total_qtes: totalQtes,
            total_ca: totalCA,
            total_appro: totalAppro,
            total_pub_cfa: totalPubCfa,
            total_marge: totalMarge,
            taux_marge_global: (totalAppro + totalPubCfa) > 0 ? (totalMarge / (totalAppro + totalPubCfa)) * 100 : 0,
            roi_global: totalPubCfa > 0 ? totalMarge / totalPubCfa : 0,
            mer_global: totalPubCfa > 0 ? totalCA / totalPubCfa : 0
          }
        },
        objectifs: {
          a_livrer_total: aLivrerTotal,
          realise_total: realiseTotal,
          objectif_total: objectifTotal,
          reste_total: resteTotal,
          taux_realisation: objectifTotal > 0 ? (realiseTotal / objectifTotal * 100).toFixed(1) + '%' : '0%'
        },
        finance: {
          produits: {
            ca_livraisons_dakar: caLivraisonsDakar,
            ca_expeditions_regions: caExpeditionsRegions,
            autres_produits: autresProduits,
            total_produits: totalProduits
          },
          charges: {
            frais_pub: totalPubCfa,
            cout_appro: totalAppro,
            frais_livraison: fraisLivraison,
            autres_charges: autresCharges,
            total_charges: totalCharges
          },
          resultats: {
            resultat_net: resultatNet,
            taux_marge: tauxMargeFinance
          }
        },
        cumul_mois: {
          total_ca_mois: totalCAMois,
          total_charges_mois: totalChargesMois,
          marge_cumulee: margeCumulee,
          taux_marge_moyen: tauxMargeMoyen,
          nombre_jours_actifs: nombreJoursActifs
        }
      };

      const response = await fetch('/api/claude/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ donneesAnalyse, dateSelectionnee: dateStr })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erreur lors de l\'analyse');

      // Save to Firebase
      await DataService.saveClaudeAnalysis(dateStr, data.analyse);

      return data.analyse;
    } catch (error: any) {
      console.error("ClaudeService Error:", error);
      throw error;
    }
  }
};
