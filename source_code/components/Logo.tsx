import React, { useEffect, useState } from 'react';
import { DataService } from '../services/dataService';

interface LogoProps {
  className?: string;
  variant?: 'light' | 'dark' | 'color'; // light = for dark backgrounds
  showText?: boolean; 
}

export const Logo: React.FC<LogoProps> = ({ className = "", variant = "color" }) => {
  const [logoUrl, setLogoUrl] = useState<string>('/logo.png');

  useEffect(() => {
    const unsubscribe = DataService.subscribeToSettings((settings) => {
        if (settings.logoUrl) {
          setLogoUrl(settings.logoUrl);
        } else {
          setLogoUrl('/logo.png');
        }
    });
    return () => unsubscribe();
  }, []);

  return (
    <div className={`flex flex-col items-center select-none ${className}`}>
      <img 
        src={logoUrl} 
        alt="Colweyz Logo" 
        className="h-32 w-auto object-contain" // Increased size again
        referrerPolicy="no-referrer"
        onError={(e) => {
            // Fallback if image fails to load
            const target = e.target as HTMLImageElement;
            if (target.src !== '/logo.png') {
                target.src = '/logo.png';
            }
        }}
      />
    </div>
  );
};