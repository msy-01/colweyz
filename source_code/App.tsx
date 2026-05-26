
import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Drivers } from './pages/Drivers';
import { Zones } from './pages/Zones';
import { Balances } from './pages/Balances';
import { FundRequests } from './pages/FundRequests';
import { RegionalOrders } from './pages/RegionalOrders'; // New Import
import { Inventory } from './pages/Inventory'; // New Import
import { Profitability } from './pages/Profitability'; // New Import
import Finance from './pages/Finance'; // New Import
import Procurement from './pages/Procurement'; // New Import
import { Accounting } from './pages/Accounting';
import { DriverView } from './pages/DriverView';
import { DriverSimulation } from './pages/DriverSimulation';
import { Login } from './pages/Login';
import { OrderList } from './pages/OrderList';
import { Deliveries } from './pages/Deliveries';
import { Users } from './pages/Users';
import { Settings } from './pages/Settings';
import { Driver, SystemUser } from './types';
import { DataService } from './services/dataService';
import { authService } from './services/authService';
import { subscribeConnectionMode } from './services/connectionMode';
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

function App() {
  const [userRole, setUserRole] = useState<'admin' | 'driver' | null>(null);
  const [currentDriver, setCurrentDriver] = useState<Driver | undefined>(undefined);
  const [currentUser, setCurrentUser] = useState<SystemUser | undefined>(undefined);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          await DataService.migrateLocalStorageToFirebase();
        } catch (e) {
          console.error("Migration error:", e);
        }
      }
      setIsAuthReady(true);
    }, (error) => {
      console.error("Auth state change error:", error);
      setAuthError(error.message);
      setIsAuthReady(true); // Proceed even on error to allow local storage fallback
    });
    return () => unsubscribe();
  }, []);

  // Mode secours API : JWT obligatoire (sinon listes vides / 401)
  useEffect(() => {
    return subscribeConnectionMode(({ mode }) => {
      if (mode === 'api' && !localStorage.getItem('jwt_token')) {
        setAuthError(
          'Mode PostgreSQL (secours) : déconnectez-vous et reconnectez-vous avec le mot de passe base PG (ex. admin).'
        );
      } else if (mode === 'api') {
        setAuthError(null);
      }
    });
  }, []);

  // AUTOMATIC SHOPIFY IMPORT (Every 30 Minutes)
  useEffect(() => {
      if (!isAuthReady) return;

      const importProducts = async () => {
          console.log("Auto-importing Shopify products...");
          try {
              const products = await DataService.fetchShopifyProducts();
              await DataService.importProducts(products);
              console.log("Auto-import complete.");
          } catch (e) {
              console.error("Auto-import failed", e);
          }
      };

      // Run immediately on app load to ensure fresh data
      importProducts(); 
      
      const intervalId = setInterval(importProducts, 30 * 60 * 1000); // 30 Minutes

      return () => clearInterval(intervalId);
  }, [isAuthReady]);

  const handleLogin = (role: 'admin' | 'driver', data?: Driver | SystemUser) => {
    setUserRole(role);
    if (role === 'driver') {
        setCurrentDriver(data as Driver);
    } else {
        setCurrentUser(data as SystemUser);
    }
    setIsAuthReady(true);
  };

  const handleLogout = () => {
    authService.logout();
    setUserRole(null);
    setCurrentDriver(undefined);
    setCurrentUser(undefined);
    setAuthError(null);
  };

  if (!isAuthReady) {
      return <div className="min-h-screen flex items-center justify-center bg-gray-50">Chargement...</div>;
  }

  if (!userRole) {
    return <Login onLogin={handleLogin} />;
  }

  // Driver View (Restricted)
  if (userRole === 'driver' && currentDriver) {
    return (
      <div className="min-h-screen bg-gray-50">
         <div className="max-w-md mx-auto relative">
            <DriverView driver={currentDriver} onLogout={handleLogout} />
         </div>
      </div>
    );
  }

  // Admin View
  // Helper to check permission
  const hasAccess = (path: string) => {
      if (!currentUser) return false;
      if (currentUser.role === 'super_admin') return true;
      return currentUser.permissions.includes(path);
  };

  const ProtectedRoute = ({ path, element }: { path: string, element: React.ReactNode }) => {
      if (hasAccess(path)) {
          return <>{element}</>;
      }
      return <Navigate to="/" replace />;
  };

  return (
    <Router>
      <Layout userRole="admin" currentUser={currentUser} onLogout={handleLogout} authError={authError}>
        <Routes>
          <Route path="/" element={
              // Always allow dashboard if logged in, but ideally check permissions
              hasAccess('/') ? <Dashboard currentUser={currentUser} /> : <div className="p-8 text-center text-gray-500">Accès non autorisé. Contactez l'administrateur.</div>
          } />
          
          <Route path="/orders" element={<ProtectedRoute path="/orders" element={<OrderList currentUser={currentUser} />} />} />
          <Route path="/deliveries" element={<ProtectedRoute path="/deliveries" element={<Deliveries currentUser={currentUser} />} />} />
          <Route path="/drivers" element={<ProtectedRoute path="/drivers" element={<Drivers currentUser={currentUser} />} />} />
          <Route path="/zones" element={<ProtectedRoute path="/zones" element={<Zones currentUser={currentUser} />} />} />
          <Route path="/balances" element={<ProtectedRoute path="/balances" element={<Balances currentUser={currentUser} />} />} />
          
          {/* Inventory Route */}
          <Route path="/inventory" element={<ProtectedRoute path="/inventory" element={<Inventory currentUser={currentUser} />} />} />

          {/* Profitability Route */}
          <Route path="/profitability" element={<ProtectedRoute path="/profitability" element={<Profitability />} />} />

          {/* Finance Route */}
          <Route path="/finance" element={<ProtectedRoute path="/finance" element={<Finance />} />} />

          {/* Procurement Route */}
          <Route path="/procurement" element={<ProtectedRoute path="/procurement" element={<Procurement />} />} />

          {/* Accounting Route */}
          <Route path="/accounting" element={<ProtectedRoute path="/accounting" element={<Accounting />} />} />

          {/* New Delta/Regional Route */}
          <Route path="/regional" element={
              hasAccess('/regional') || currentUser?.role === 'super_admin' ? <RegionalOrders currentUser={currentUser} /> : <Navigate to="/" />
          } />

          {/* Only super_admin */}
          <Route path="/fund-requests" element={
              currentUser?.role === 'super_admin' ? <FundRequests /> : <Navigate to="/" />
          } />
          <Route path="/users" element={
              currentUser?.role === 'super_admin' ? <Users /> : <Navigate to="/" />
          } />
           <Route path="/settings" element={
              currentUser ? <Settings /> : <Navigate to="/" />
          } />

          <Route path="/simulation/:driverId" element={<DriverSimulation />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
