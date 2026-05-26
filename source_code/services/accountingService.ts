import { AccountingEntry, DailyFinanceData, DailyFinancialEntry, Order, ProductFinancialConfig, PurchaseOrder, Zone } from '../types';
import { DataService } from './dataService';
import { isBefore, parseISO, format, eachDayOfInterval } from 'date-fns';

export const SYSCOHADA_ACCOUNTS = [
    { id: '101', label: 'Capital social', class: '1' },
    { id: '12', label: 'Résultat de l\'exercice', class: '1' },
    { id: '401', label: 'Fournisseurs', class: '4' },
    { id: '521', label: 'Banque', class: '5' },
    { id: '571', label: 'Caisse', class: '5' },
    { id: '601', label: 'Achats de marchandises', class: '6' },
    { id: '604', label: 'Achats d\'études et prestations de services', class: '6' },
    { id: '623', label: 'Publicité, publications, relations publiques', class: '6' },
    { id: '624', label: 'Frais de transport sur achats', class: '6' },
    { id: '641', label: 'Rémunérations du personnel', class: '6' },
    { id: '658', label: 'Autres charges diverses', class: '6' },
    { id: '671', label: 'Charges exceptionnelles', class: '6' },
    { id: '701', label: 'Ventes de marchandises', class: '7' },
    { id: '706', label: 'Services vendus', class: '7' },
];

export const ACCOUNTING_START_DATE = '2026-03-05';

export const AccountingService = {
    getAccountLabel: (id: string) => {
        const acc = SYSCOHADA_ACCOUNTS.find(a => a.id === id);
        return acc ? `${acc.id} - ${acc.label}` : id;
    },

    generateAutomaticEntries: async (): Promise<AccountingEntry[]> => {
        const [orders, zones, purchaseOrders, dailyFinanceData, dailyEntries] = await Promise.all([
            DataService.getOrders(),
            DataService.getZones(),
            DataService.getPurchaseOrders(),
            DataService.getAllDailyFinanceData(),
            DataService.getDailyEntries()
        ]);

        const entries: AccountingEntry[] = [];
        const zoneMap = new Map(zones.map(z => [z.id, z]));

        // 1. Generate entries from Orders (CA Dakar, CA Régions, Rémunérations)
        // Group by date
        const ordersByDate = new Map<string, Order[]>();
        orders.forEach(o => {
            if (o.status === 'livré' || o.status === 'terminé' || o.status === 'expedition_livree') {
                const dateStr = o.deliveredAt ? o.deliveredAt.substring(0, 10) : o.date.substring(0, 10);
                if (dateStr >= ACCOUNTING_START_DATE) {
                    if (!ordersByDate.has(dateStr)) ordersByDate.set(dateStr, []);
                    ordersByDate.get(dateStr)!.push(o);
                }
            }
        });

        ordersByDate.forEach((dayOrders, dateStr) => {
            let caDakar = 0;
            let caRegions = 0;
            let remunLivreurs = 0;

            dayOrders.forEach(o => {
                const zone = o.zoneId ? zoneMap.get(o.zoneId) : null;
                const isRegional = o.status === 'expedition_livree' || (zone && zone.type === 'regional');
                
                if (isRegional) {
                    caRegions += o.amount;
                } else {
                    caDakar += o.amount;
                    remunLivreurs += (o.remuneration || 0);
                }
            });

            if (caDakar > 0) {
                entries.push({
                    id: `auto-ca-dakar-${dateStr}`,
                    date: dateStr,
                    pieceNumber: `CA-DKR-${dateStr.replace(/-/g, '')}`,
                    label: `CA Livraisons Dakar`,
                    isManual: false,
                    origine: 'finance',
                    modifiable: false,
                    createdAt: new Date().toISOString(),
                    lines: [
                        { accountId: '571', label: 'Caisse', debit: caDakar, credit: 0 },
                        { accountId: '701', label: 'Ventes de marchandises (Dakar)', debit: 0, credit: caDakar }
                    ]
                });
            }

            if (caRegions > 0) {
                entries.push({
                    id: `auto-ca-reg-${dateStr}`,
                    date: dateStr,
                    pieceNumber: `CA-REG-${dateStr.replace(/-/g, '')}`,
                    label: `CA Expéditions Régions`,
                    isManual: false,
                    origine: 'finance',
                    modifiable: false,
                    createdAt: new Date().toISOString(),
                    lines: [
                        { accountId: '571', label: 'Caisse', debit: caRegions, credit: 0 },
                        { accountId: '701', label: 'Ventes de marchandises (Régions)', debit: 0, credit: caRegions }
                    ]
                });
            }

            if (remunLivreurs > 0) {
                entries.push({
                    id: `auto-remun-${dateStr}`,
                    date: dateStr,
                    pieceNumber: `REM-${dateStr.replace(/-/g, '')}`,
                    label: `Rémunérations livreurs`,
                    isManual: false,
                    origine: 'finance',
                    modifiable: false,
                    createdAt: new Date().toISOString(),
                    lines: [
                        { accountId: '641', label: 'Rémunérations du personnel', debit: remunLivreurs, credit: 0 },
                        { accountId: '571', label: 'Caisse', debit: 0, credit: remunLivreurs }
                    ]
                });
            }
        });

        // 2. Generate entries from Daily Finance Data (Autres produits, Autres charges)
        dailyFinanceData.forEach(df => {
            if (df.date < ACCOUNTING_START_DATE) return;

            let totalOtherRev = 0;
            df.otherRevenues.forEach(r => totalOtherRev += r.amount);
            if (totalOtherRev > 0) {
                entries.push({
                    id: `auto-oth-rev-${df.date}`,
                    date: df.date,
                    pieceNumber: `OREV-${df.date.replace(/-/g, '')}`,
                    label: `Autres produits`,
                    isManual: false,
                    origine: 'finance',
                    modifiable: false,
                    createdAt: new Date().toISOString(),
                    lines: [
                        { accountId: '571', label: 'Caisse', debit: totalOtherRev, credit: 0 },
                        { accountId: '706', label: 'Services vendus', debit: 0, credit: totalOtherRev }
                    ]
                });
            }

            let totalOtherExp = 0;
            df.otherExpenses.forEach(e => totalOtherExp += e.amount);
            if (totalOtherExp > 0) {
                entries.push({
                    id: `auto-oth-exp-${df.date}`,
                    date: df.date,
                    pieceNumber: `OEXP-${df.date.replace(/-/g, '')}`,
                    label: `Autres charges diverses`,
                    isManual: false,
                    origine: 'finance',
                    modifiable: false,
                    createdAt: new Date().toISOString(),
                    lines: [
                        { accountId: '658', label: 'Autres charges diverses', debit: totalOtherExp, credit: 0 },
                        { accountId: '571', label: 'Caisse', debit: 0, credit: totalOtherExp }
                    ]
                });
            }
        });

        // 3. Generate entries from Daily Entries (Publicité)
        dailyEntries.forEach(de => {
            if (de.date < ACCOUNTING_START_DATE) return;

            let totalPubCfa = 0;
            Object.values(de.entries).forEach(p => {
                totalPubCfa += (p.spendUsd * 1.18 * de.exchangeRate);
            });

            if (totalPubCfa > 0) {
                const roundedPub = Math.round(totalPubCfa);
                entries.push({
                    id: `auto-pub-${de.date}`,
                    date: de.date,
                    pieceNumber: `PUB-${de.date.replace(/-/g, '')}`,
                    label: `Frais de publicité`,
                    isManual: false,
                    origine: 'finance',
                    modifiable: false,
                    createdAt: new Date().toISOString(),
                    lines: [
                        { accountId: '623', label: 'Publicité, publications', debit: roundedPub, credit: 0 },
                        { accountId: '571', label: 'Caisse', debit: 0, credit: roundedPub }
                    ]
                });
            }
        });

        // 4. Generate entries from Purchase Orders (Approvisionnement)
        purchaseOrders.forEach(po => {
            if (po.status !== 'paid' && po.status !== 'delivered') return;
            const dateStr = po.paidAt ? po.paidAt.substring(0, 10) : po.date.substring(0, 10);
            if (dateStr < ACCOUNTING_START_DATE) return;

            const montantHT = po.items.reduce((sum, item) => sum + item.total, 0);
            const transport = po.transportFees || 0;
            const totalBon = po.totalAmount;

            if (totalBon > 0) {
                entries.push({
                    id: `auto-po-${po.id}`,
                    date: dateStr,
                    pieceNumber: `PO-${po.number}`,
                    label: `Bon de commande ${po.number}`,
                    isManual: false,
                    origine: 'approvisionnement',
                    modifiable: false,
                    createdAt: po.createdAt,
                    lines: [
                        { accountId: '601', label: 'Achats de marchandises', debit: montantHT, credit: 0 },
                        { accountId: '401', label: 'Fournisseurs', debit: 0, credit: montantHT },
                        ...(transport > 0 ? [
                            { accountId: '624', label: 'Frais de transport sur achats', debit: transport, credit: 0 },
                            { accountId: '401', label: 'Fournisseurs', debit: 0, credit: transport }
                        ] : []),
                        { accountId: '401', label: 'Fournisseurs', debit: totalBon, credit: 0 },
                        { accountId: '571', label: 'Caisse', debit: 0, credit: totalBon }
                    ]
                });
            }
        });

        return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    },

    getAllEntries: async (): Promise<AccountingEntry[]> => {
        const [manualEntries, autoEntries] = await Promise.all([
            DataService.getAccountingEntries(),
            AccountingService.generateAutomaticEntries()
        ]);
        return [...manualEntries, ...autoEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
};
