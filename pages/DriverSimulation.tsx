import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Driver } from '../types';
import { DataService } from '../services/dataService';
import { DriverView } from './DriverView';
import { ArrowLeft, Smartphone } from 'lucide-react';

export const DriverSimulation: React.FC = () => {
  const { driverId } = useParams<{ driverId: string }>();
  const navigate = useNavigate();
  const [driver, setDriver] = useState<Driver | null>(null);

  useEffect(() => {
    if (driverId) {
      DataService.getDrivers().then(drivers => {
        const found = drivers.find(d => d.id === driverId);
        setDriver(found || null);
      });
    }
  }, [driverId]);

  if (!driver) {
    return <div className="p-8 text-center">Chargement du profil livreur...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center space-x-4 mb-6">
        <button 
          onClick={() => navigate('/drivers')}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600"
        >
          <ArrowLeft size={24} />
        </button>
        <div>
           <h2 className="text-2xl font-bold text-gray-800 flex items-center">
             <Smartphone className="mr-2 text-indigo-600" />
             Simulation: {driver.name}
           </h2>
           <p className="text-gray-500 text-sm">Vue telle qu'elle apparait sur le téléphone du livreur</p>
        </div>
      </div>

      <div className="flex-1 flex justify-center items-start overflow-auto pb-10">
        <div className="mockup-phone border-8 border-gray-800 rounded-[3rem] overflow-hidden shadow-2xl h-[800px] w-[400px] bg-gray-50 relative z-0">
            <div className="absolute top-0 left-0 right-0 h-7 bg-gray-800 z-50 flex justify-center">
                <div className="w-32 h-4 bg-black rounded-b-xl"></div>
            </div>
            {/* Main content with pointer-events-auto to ensure clickability */}
            <div className="h-full overflow-y-auto pt-8 scrollbar-hide relative z-10 pointer-events-auto">
                <DriverView driver={driver} />
            </div>
            {/* Home Bar */}
            <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2 w-32 h-1 bg-gray-400 rounded-full z-50"></div>
        </div>
      </div>
    </div>
  );
};