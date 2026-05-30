
import React, { useState, useEffect, useMemo } from 'react';
import { Driver, Order, Zone, SystemUser, OrderStatus } from '../types';
import { DataService } from '../services/dataService';
import { formatFCFA } from '../utils/formatters';
import { 
  Truck, 
  Users, 
  Calendar, 
  Filter, 
  ChevronDown, 
  ChevronUp, 
  Package, 
  MapPin, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  PhoneOff,
  TrendingUp,
  Wallet,
  HandCoins,
  Search,
  DollarSign
} from 'lucide-react';
import { format, startOfDay, endOfDay, isSameDay } from 'date-fns';
import { usePersistedDateRange } from '../hooks/usePersistedDateRange';
import { usePersistedState } from '../hooks/usePersistedState';
import { DateRangePicker } from '../components/DateRangePicker';
import { isWithinInterval } from 'date-fns';

interface DeliveriesProps {
  currentUser?: SystemUser;
}

export const Deliveries: React.FC<DeliveriesProps> = ({ currentUser }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [dateRange, setDateRange] = usePersistedDateRange('deliveries_date_range', {
      startDate: new Date(),
      endDate: new Date()
  });

  const safeDateRange = useMemo(() => {
      if (!dateRange.startDate || !dateRange.endDate || isNaN(dateRange.startDate.getTime()) || isNaN(dateRange.endDate.getTime())) {
          return { startDate: new Date(), endDate: new Date() };
      }
      return dateRange;
  }, [dateRange]);
  const [selectedDriverId, setSelectedDriverId] = usePersistedState<string>('deliveries_driver_id', 'all');
  const [selectedStatus, setSelectedStatus] = usePersistedState<string>('deliveries_status', 'all');
  const [searchQuery, setSearchQuery] = usePersistedState<string>('deliveries_search', '');
  const [expandedGroups, setExpandedGroups] = usePersistedState<Record<string, boolean>>('deliveries_expanded_groups', { 'regions': true });

  useEffect(() => {
    const unsubscribeOrders = DataService.subscribeToOrders((newOrders) => {
      setOrders(newOrders);
    });
    const unsubscribeDrivers = DataService.subscribeToDrivers((newDrivers) => {
      setDrivers(newDrivers);
    });
    const unsubscribeZones = DataService.subscribeToZones((newZones) => {
      setZones(newZones);
    });
    return () => {
      unsubscribeOrders();
      unsubscribeDrivers();
      unsubscribeZones();
    };
  }, []);

  const loadData = async () => {
    const [d, z] = await Promise.all([
      DataService.getDrivers(),
      DataService.getZones()
    ]);
    setDrivers(d);
    setZones(z);
  };

  const estProgrammee = (o: Order) => {
    const dateProg = o.scheduledAt || (o as any).dateProgrammee || (o as any).scheduledDate || (o as any).scheduled_date;
    if (!dateProg) return false;
    const now = new Date();
    const schedDate = new Date(dateProg);
    return now.getTime() < (schedDate.getTime() + 60000);
  };

  // Filter Logic
  const filteredOrders = useMemo(() => {
    const start = startOfDay(safeDateRange.startDate);
    const end = endOfDay(safeDateRange.endDate);

    return orders.filter(o => {
      // Logic to identify Regional (Delta) orders - same as RegionalOrders.tsx
      const isRegionalStatus = [
          'regional_en_attente', 
          'expedition_en_cours', 'expedition_livree', 
          'regional_contacte', 'regional_relance', 'regional_prete', 'regional_injoignable', 
          'regional_injoignable_x2', 'regional_injoignable_x3',
          'regional_reporte', 'regional_annule'
      ].includes(o.status);
      const isRegionalZone = o.zoneId && zones.find(zo => zo.id === o.zoneId)?.type === 'regional';
      const isRegional = isRegionalStatus || (isRegionalZone && o.status === 'validé');
      
      let matchesDate = false;
      const orderDateStr = (isRegional ? (o.scheduledAt || o.assignedAt || o.date) : (o.deliveredAt || o.assignedAt || o.date)) || "";
      const orderDate = new Date(orderDateStr.split('T')[0]);
      matchesDate = isWithinInterval(orderDate, { start, end });
      
      // Filter by driver
      const matchesDriver = selectedDriverId === 'all' || o.driverId === selectedDriverId;
      
      // Filter by status
      const matchesStatus = selectedStatus === 'all' || o.status === selectedStatus;

      // Filter by search
      const matchesSearch = searchQuery === '' || 
        o.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.address.toLowerCase().includes(searchQuery.toLowerCase());
      
      return (isRegional ? (!estProgrammee(o) && matchesDate) : matchesDate) && matchesDriver && matchesStatus && matchesSearch;
    });
  }, [orders, safeDateRange, selectedDriverId, selectedStatus, searchQuery, zones]);

  // Indicators Calculation
  const stats = useMemo(() => {
    // Helper to identify regional orders (same logic as grouping)
    const isRegionalOrder = (o: Order) => {
        const isRegionalStatus = [
            'regional_en_attente', 
            'expedition_en_cours', 'expedition_livree', 
            'regional_contacte', 'regional_relance', 'regional_prete', 'regional_injoignable', 
            'regional_injoignable_x2', 'regional_injoignable_x3',
            'regional_reporte', 'regional_annule'
        ].includes(o.status);
        const isRegionalZone = o.zoneId && zones.find(zo => zo.id === o.zoneId)?.type === 'regional';
        return isRegionalStatus || (isRegionalZone && o.status === 'validé');
    };

    // 1. Daily stats (filtered by date)
    const deliveredOrders = filteredOrders.filter(o => ['livré', 'terminé', 'expedition_livree'].includes(o.status));
    const pendingOrders = filteredOrders.filter(o => ['attribué', 'en_cours', 'expedition_en_cours', 'regional_en_attente', 'regional_relance', 'regional_contacte', 'regional_injoignable', 'regional_injoignable_x2', 'regional_injoignable_x3', 'regional_prete'].includes(o.status));

    const totalCA = deliveredOrders.reduce((sum, o) => sum + (o.amount ?? 0), 0);
    const totalCommissions = deliveredOrders.reduce((sum, o) => {
        if (isRegionalOrder(o)) return sum; // Regional orders correspond to direct payment, no system commission
        return sum + (o.remuneration || 0);
    }, 0);
    const totalCourses = deliveredOrders.length;
    
    // Recettes Prévisionnelles: Orders assigned but not yet delivered
    const projectedRevenue = pendingOrders.reduce((sum, o) => {
        const remun = isRegionalOrder(o) ? 0 : (o.remuneration || 0);
        return sum + ((o.amount ?? 0) - remun);
    }, 0);

    // 2. Dû à Colweyz — même logique que Balances / source_code (global, avec initialBalance)
    const relevantOrders = orders.filter(
      (o) =>
        (selectedDriverId === 'all' || o.driverId === selectedDriverId) &&
        (o.status === 'livré' || o.status === 'terminé' || o.status === 'expedition_livree')
    );

    const totalCash = relevantOrders
      .filter(
        (o) =>
          o.modePaiement === 'Espèces' ||
          (!o.modePaiement && (o.paymentMethod === 'cash' || !o.paymentMethod))
      )
      .reduce((sum, o) => sum + (o.amount ?? 0), 0);

    const totalRemun = relevantOrders.reduce((sum, o) => {
      if (isRegionalOrder(o)) return sum;
      return sum + (o.remuneration || 0);
    }, 0);

    const initial =
      selectedDriverId !== 'all'
        ? drivers.find((d) => d.id === selectedDriverId)?.initialBalance || 0
        : drivers.reduce((sum, d) => sum + (d.initialBalance || 0), 0);

    const balance = initial + totalRemun - totalCash;
    const amountDueColweyz = balance < 0 ? Math.abs(balance) : 0;

    return { totalCA, totalCommissions, projectedRevenue, totalCourses, amountDueColweyz };
  }, [filteredOrders, orders, drivers, selectedDriverId]);

  // Grouping Logic
  const groupedOrders = useMemo(() => {
    const regions: Order[] = [];
    const driverGroups: Record<string, Order[]> = {};

    filteredOrders.forEach(o => {
      const isRegionalStatus = [
          'regional_en_attente', 
          'expedition_en_cours', 'expedition_livree', 
          'regional_contacte', 'regional_relance', 'regional_prete', 'regional_injoignable', 
          'regional_injoignable_x2', 'regional_injoignable_x3',
          'regional_reporte', 'regional_annule'
      ].includes(o.status);
      const isRegionalZone = o.zoneId && zones.find(zo => zo.id === o.zoneId)?.type === 'regional';
      const isRegional = isRegionalStatus || (isRegionalZone && o.status === 'validé');
      
      if (isRegional) {
        regions.push(o);
      } else if (o.driverId) {
        if (!driverGroups[o.driverId]) {
          driverGroups[o.driverId] = [];
        }
        driverGroups[o.driverId].push(o);
      }
    });

    // Sort driver groups by driver name
    const sortedDriverIds = Object.keys(driverGroups).sort((a, b) => {
      const nameA = drivers.find(d => d.id === a)?.name || '';
      const nameB = drivers.find(d => d.id === b)?.name || '';
      return nameA.localeCompare(nameB);
    });

    return { regions, driverGroups, sortedDriverIds };
  }, [filteredOrders, zones, drivers]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const getStatusIcon = (status: OrderStatus) => {
    switch (status) {
      case 'livré':
      case 'terminé':
      case 'expedition_livree':
        return <CheckCircle size={14} className="text-green-600" />;
      case 'en_cours':
      case 'expedition_en_cours':
        return <Clock size={14} className="text-blue-600" />;
      case 'annulé':
      case 'refusé':
      case 'regional_annule':
        return <AlertCircle size={14} className="text-red-600" />;
      case 'injoignable':
        return <PhoneOff size={14} className="text-orange-600" />;
      case 'reporté':
        return <Calendar size={14} className="text-orange-500" />;
      default:
        return <Package size={14} className="text-gray-400" />;
    }
  };

  const getStatusLabel = (status: OrderStatus) => {
    if (status === 'terminé') return 'Livré';
    return status.replace(/_/g, ' ').charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  };

  return (
    <div className="space-y-6">
      {/* Header & Indicators */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center">
          <Truck className="mr-2 text-green-700" />
          Livraisons
        </h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text"
              placeholder="Rechercher client, ID..."
              className="pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 bg-white shadow-sm w-64"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-row lg:flex-wrap gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4 min-w-[200px] flex-1">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <TrendingUp size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Total Courses (CA)</p>
            <p className="text-xl font-bold text-gray-800">{formatFCFA(stats.totalCA)}</p>
            <p className="text-[10px] text-gray-400">{stats.totalCourses} livraisons effectuées</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4 min-w-[200px] flex-1">
          <div className="p-3 bg-green-50 text-green-600 rounded-lg">
            <Wallet size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Recettes Prév.</p>
            <p className="text-xl font-bold text-gray-800">{formatFCFA(stats.projectedRevenue)}</p>
            <p className="text-[10px] text-gray-400">Commandes en cours/attribuées</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4 min-w-[200px] flex-1">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
            <HandCoins size={24} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Commissions</p>
            <p className="text-xl font-bold text-gray-800">{formatFCFA(stats.totalCommissions)}</p>
            <p className="text-[10px] text-gray-400">Total rémunération livreurs</p>
          </div>
        </div>

        <div className="bg-red-50 p-4 rounded-xl shadow-sm border border-red-100 flex items-center space-x-4 min-w-[200px] flex-1">
          <div className="p-3 bg-red-100 text-red-600 rounded-lg">
            <DollarSign size={24} />
          </div>
          <div>
            <p className="text-xs text-red-600 font-bold uppercase tracking-wider">Dû à Colweyz (solde global)</p>
            <p className="text-xl font-bold text-red-800">{formatFCFA(stats.amountDueColweyz)}</p>
            <p className="text-[10px] text-red-400">Toutes dates · hors filtre période</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3 min-w-[280px] flex-1">
          <div className="p-2 sm:p-3 bg-orange-50 text-orange-600 rounded-lg flex-shrink-0">
            <Calendar size={20} className="sm:w-6 sm:h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] sm:text-xs text-gray-500 font-medium uppercase tracking-wider mb-0.5 sm:mb-1">Date</p>
            <DateRangePicker 
                dateRange={safeDateRange}
                onUpdate={setDateRange}
                align="right"
                className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-600">Filtres:</span>
        </div>

        <select 
          className="text-sm border rounded-lg px-3 py-2 bg-gray-50 focus:ring-green-500 flex-1 min-w-[150px]"
          value={selectedDriverId}
          onChange={e => setSelectedDriverId(e.target.value)}
        >
          <option value="all">Tous les livreurs</option>
          {drivers.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        <select 
          className="text-sm border rounded-lg px-3 py-2 bg-gray-50 focus:ring-green-500 flex-1 min-w-[150px]"
          value={selectedStatus}
          onChange={e => setSelectedStatus(e.target.value)}
        >
          <option value="all">Tous les statuts</option>
          <option value="attribué">Attribué</option>
          <option value="en_cours">En cours</option>
          <option value="livré">Livré</option>
          <option value="terminé">Terminé</option>
          <option value="injoignable">Injoignable</option>
          <option value="reporté">Reporté</option>
          <option value="annulé">Annulé</option>
          <option value="expedition_en_cours">Expédition en cours</option>
          <option value="expedition_livree">Expédition livrée</option>
        </select>
      </div>

      {/* Deliveries List */}
      <div className="space-y-4">
        {/* Regions Group */}
        {(selectedDriverId === 'all') && groupedOrders.regions.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <button 
              onClick={() => toggleGroup('regions')}
              className="w-full px-6 py-4 flex items-center justify-between border-b transition-colors"
              style={{ backgroundColor: '#0000FF', color: 'white' }}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 text-white rounded-lg">
                  <MapPin size={20} />
                </div>
                <div className="text-left">
                  <h3 className="font-bold">Régions (Delta Transports)</h3>
                  <p className="text-xs opacity-80">{groupedOrders.regions.length} expéditions</p>
                </div>
              </div>
              {expandedGroups['regions'] ? <ChevronUp size={20} className="text-white/70" /> : <ChevronDown size={20} className="text-white/70" />}
            </button>
            
            {expandedGroups['regions'] && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse table-fixed">
                  <thead>
                    <tr className="bg-gray-50/50 text-xs uppercase text-gray-400 font-bold">
                      <th className="px-6 py-3 border-b w-[25%]">ID / Client</th>
                      <th className="px-6 py-3 border-b w-[40%]">Adresse / Zone</th>
                      <th className="px-6 py-3 border-b text-right w-[20%]">Montant</th>
                      <th className="px-6 py-3 border-b text-center w-[15%]">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {groupedOrders.regions.map(order => (
                      <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-gray-800">#{order.id}</div>
                          <div className="text-sm text-gray-500">{order.clientName}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-800">{order.address}</div>
                          <div className="text-xs text-blue-600 font-medium">{zones.find(z => z.id === order.zoneId)?.name || 'Région'}</div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="font-bold text-gray-900">{formatFCFA(order.amount)}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-1.5">
                            {getStatusIcon(order.status)}
                            <span className="text-xs font-medium text-gray-600">{getStatusLabel(order.status)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Driver Groups */}
        {groupedOrders.sortedDriverIds.map(driverId => {
          const driver = drivers.find(d => d.id === driverId);
          const orders = groupedOrders.driverGroups[driverId];
          const isExpanded = expandedGroups[driverId] !== false;
          const driverColor = driver?.color || '#3b82f6';

          return (
            <div key={driverId} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <button 
                onClick={() => toggleGroup(driverId)}
                className="w-full px-6 py-4 flex items-center justify-between border-b transition-colors"
                style={{ backgroundColor: driverColor, color: 'white' }}
              >
                <div className="flex items-center gap-3">
                  <div 
                    className="p-2 rounded-lg bg-white/20 text-white"
                  >
                    <Users size={20} />
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold">{driver?.name || 'Livreur inconnu'}</h3>
                    <p className="text-xs opacity-80">{orders.length} livraisons</p>
                  </div>
                </div>
                {isExpanded ? <ChevronUp size={20} className="text-white/70" /> : <ChevronDown size={20} className="text-white/70" />}
              </button>
              
              {isExpanded && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse table-fixed">
                    <thead>
                      <tr className="bg-gray-50/50 text-xs uppercase text-gray-400 font-bold">
                        <th className="px-6 py-3 border-b w-[25%]">ID / Client</th>
                        <th className="px-6 py-3 border-b w-[40%]">Adresse</th>
                        <th className="px-6 py-3 border-b text-right w-[20%]">Montant</th>
                        <th className="px-6 py-3 border-b text-center w-[15%]">Statut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {orders.map(order => (
                        <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 relative">
                            <div 
                              className="absolute left-0 top-0 bottom-0 w-1"
                              style={{ backgroundColor: driverColor }}
                            />
                            <div className="font-bold" style={{ color: driverColor }}>#{order.id}</div>
                            <div className="text-sm text-gray-500">{order.clientName}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm text-gray-800">{order.address}</div>
                            <div className="text-xs text-gray-400">{order.clientPhone}</div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="font-bold text-gray-900">{formatFCFA(order.amount)}</div>
                            <div className="text-[10px] text-gray-400">Com: {formatFCFA(order.remuneration || 0)}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-center gap-1.5">
                              {getStatusIcon(order.status)}
                              <span className="text-xs font-medium text-gray-600">{getStatusLabel(order.status)}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}

        {filteredOrders.length === 0 && (
          <div className="bg-white p-12 rounded-xl border border-dashed border-gray-200 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-50 text-gray-300 rounded-full mb-4">
              <Truck size={32} />
            </div>
            <h3 className="text-lg font-medium text-gray-900">Aucune livraison trouvée</h3>
            <p className="text-gray-500 mt-1">Essayez de modifier vos filtres ou la date sélectionnée.</p>
          </div>
        )}
      </div>
    </div>
  );
};
