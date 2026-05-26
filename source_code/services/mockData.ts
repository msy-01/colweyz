
import { Driver, Order, Zone, SystemUser, FundRequest } from '../types';

export const INITIAL_ZONES: Zone[] = [
  { id: 'z1', name: 'Centre', rate: 500, type: 'local' },
  { id: 'z2', name: 'Plateau', rate: 800, type: 'local' },
  { id: 'z3', name: 'Banlieue', rate: 1200, type: 'local' },
  { id: 'z4', name: 'Thies (Région)', rate: 0, type: 'regional' },
  { id: 'z5', name: 'Mbour (Région)', rate: 0, type: 'regional' },
];

export const INITIAL_DRIVERS: Driver[] = [
  { id: 'abdoulaye', name: 'Abdoulaye', phone: '770000001', initialBalance: 0, status: 'disponible', username: 'abdoulaye', password: '123' },
  { id: 'lune', name: 'Lune', phone: '770000002', initialBalance: 0, status: 'disponible', username: 'lune', password: '123' },
  { id: 'lahad', name: 'Lahad', phone: '770000003', initialBalance: 0, status: 'disponible', username: 'lahad', password: '123' },
  { id: 'mouhamed', name: 'Mouhamed', phone: '770000004', initialBalance: 0, status: 'disponible', username: 'mouhamed', password: '123' },
  { id: 'aliou', name: 'Aliou', phone: '770000005', initialBalance: 0, status: 'disponible', username: 'aliou', password: '123' },
  { id: 'cheikh_demo', name: 'Cheikh', phone: '777631356', initialBalance: 0, status: 'disponible', username: 'cheikh', password: '123' },
];

export const INITIAL_ORDERS: Order[] = [];

export const INITIAL_FUND_REQUESTS: FundRequest[] = [];

export const INITIAL_USERS: SystemUser[] = [
  { 
    id: 'admin1', 
    username: 'admin', 
    password: 'admin', 
    role: 'super_admin', 
    permissions: ['/', '/orders', '/drivers', '/zones', '/balances', '/users', '/regional', '/inventory'] 
  }
];
