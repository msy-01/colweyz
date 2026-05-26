import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
    const orders = await p.order.findMany();
    const drivers = await p.driver.findMany();
    const zones = await p.zone.findMany();
    
    // Helper to identify regional
    const isRegionalOrder = (o: any) => {
        const isRegionalStatus = ['regional_en_attente', 'expedition_en_cours', 'expedition_livree', 'regional_contacte', 'regional_relance', 'regional_prete', 'regional_injoignable', 'regional_injoignable_x2', 'regional_injoignable_x3', 'regional_reporte', 'regional_annule'].includes(o.status);
        const isRegionalZone = o.zoneId && zones.find((zo: any) => zo.id === o.zoneId)?.type === 'regional';
        return isRegionalStatus || (isRegionalZone && o.status === 'validé');
    };

    // Deliveries.tsx logic
    const relevantOrders = orders.filter(o => o.status === 'livré' || o.status === 'terminé' || o.status === 'expedition_livree');
    const totalCash = relevantOrders.filter(o => {
        // Mocking the frontend `modePaiement` matching:
        // Frontend receives o.paymentMethod from DB, but doesn't receive modePaiement
        const paymentMethod = o.paymentMethod;
        const modePaiement = (o as any).modePaiement; // undefined
        return modePaiement === 'Espèces' || (!modePaiement && (paymentMethod === 'cash' || !paymentMethod));
    }).reduce((sum, o) => sum + (o.amount || 0), 0);
    
    const totalRemun = relevantOrders.reduce((sum, o) => {
        // Balances.tsx logic uses isRegionalOrder for remuneration!
        // Wait, Deliveries.tsx just does sum + (o.remuneration || 0)
        return sum + (o.remuneration || 0);
    }, 0);
    
    const initial = drivers.reduce((sum, d) => sum + (d.initialBalance || 0), 0);
    const balance = (initial + totalRemun) - totalCash;
    console.log('--- Deliveries.tsx Output ---');
    console.log({ totalCash, totalRemun, initial, balance });
    console.log('Dû à Colweyz:', balance < 0 ? Math.abs(balance) : 0);
})();
