import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users, 
  Map as MapIcon, 
  Wallet, 
  Package, 
  Menu, 
  X,
  LogOut,
  Truck,
  ShieldCheck,
  Settings,
  HandCoins,
  Plane,
  ClipboardList,
  TrendingUp,
  DollarSign,
  ShoppingCart,
  Calculator,
  CheckCircle
} from 'lucide-react';
import { Logo } from './Logo';
import { ConnectionModeBanner } from './ConnectionModeBanner';
import { SystemUser } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  userRole: 'admin' | 'driver';
  currentUser?: SystemUser; // Add current user prop for detailed permissions
  onLogout: () => void;
  authError?: string | null;
}

export const Layout: React.FC<LayoutProps> = ({ children, userRole, currentUser, onLogout, authError }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const allAdminLinks = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/regional', label: 'Expéditions (Delta)', icon: Truck }, // Changed to Truck for Berlingo/Van look
    { path: '/deliveries', label: 'Livraisons', icon: CheckCircle },
    { path: '/orders', label: 'Commandes', icon: Package },
    { path: '/profitability', label: 'Rentabilité', icon: TrendingUp },
    { path: '/finance', label: 'Finance', icon: DollarSign },
    { path: '/accounting', label: 'Comptabilité', icon: Calculator },
    { path: '/procurement', label: 'Approvisionnement', icon: ShoppingCart },
    { path: '/inventory', label: 'Stock', icon: ClipboardList },
    { path: '/drivers', label: 'Livreurs', icon: Users },
    { path: '/zones', label: 'Zones', icon: MapIcon },
    { path: '/balances', label: 'Balances', icon: Wallet },
    { path: '/fund-requests', label: 'Appels de fonds', icon: HandCoins, restricted: true }, 
    // Only for super_admin
    { path: '/users', label: 'Utilisateurs', icon: ShieldCheck, restricted: true }, 
    { path: '/settings', label: 'Paramètres', icon: Settings, restricted: false }, 
  ];

  const driverLinks = [
    { path: '/', label: 'Mes Courses', icon: Truck },
  ];

  let links = [];

  if (userRole === 'driver') {
    links = driverLinks;
  } else {
    // Filter admin links based on permissions
    if (currentUser?.role === 'super_admin') {
      links = allAdminLinks;
    } else {
      // For standard staff, filter by what's in their permissions array
      // AND exclude restricted pages like 'Utilisateurs' if they are not allowed
      links = allAdminLinks.filter(link => {
        if (link.restricted) return false;
        // Always allow settings for admins
        if (link.path === '/settings') return true;
        return currentUser?.permissions.includes(link.path);
      });
    }
  }

  return (
    <div className="flex h-[100dvh] bg-gray-100 overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out flex flex-col ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center justify-center py-1 border-b min-h-[4rem]">
            <Logo />
            <button onClick={toggleSidebar} className="lg:hidden absolute right-4 text-gray-500">
                <X size={24} />
            </button>
        </div>

        <div className="px-6 py-4 border-b border-gray-50 flex-shrink-0">
             <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Connecté en tant que</div>
             <div className="text-sm font-semibold text-gray-800 truncate">
                {currentUser?.username || "Livreur"}
             </div>
             {currentUser?.role && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${currentUser.role === 'super_admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                    {currentUser.role === 'super_admin' ? 'Super Admin' : 'Staff'}
                </span>
             )}
        </div>

        <nav className="p-4 space-y-2 overflow-y-auto flex-1 min-h-0">
          {links?.map((link) => {
            const Icon = link.icon;
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setIsSidebarOpen(false)}
                className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive 
                    ? 'bg-green-50 text-green-700 font-bold border-r-4 border-green-600' 
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon size={20} className={isActive ? "text-green-600" : "text-gray-400"} />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t bg-gray-50 flex-shrink-0">
          <button 
            onClick={onLogout}
            className="flex items-center space-x-3 w-full px-4 py-3 text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium"
          >
            <LogOut size={20} />
            <span>Déconnexion</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden w-full">
        {/* Mobile Header */}
        <header className="lg:hidden bg-white shadow-sm p-4 flex items-center justify-between z-30 relative">
          <button onClick={toggleSidebar} className="text-gray-600 p-1">
            <Menu size={24} />
          </button>
          <div className="transform scale-75 origin-center">
             <Logo variant="color" showText={true} />
          </div>
          <div className="w-8" /> {/* Spacer for centering */}
        </header>

        <ConnectionModeBanner />
        {authError && (
          <div className="px-4 py-3 bg-red-50 text-red-900 border-b border-red-200 text-sm text-center font-medium">
            {authError}
          </div>
        )}
        {/* Page Content */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-8 bg-gray-50 scrollbar-hide">
          {children}
        </main>
      </div>
    </div>
  );
};