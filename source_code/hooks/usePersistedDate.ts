import { useState, useEffect } from 'react';
import { DataService } from '../services/dataService';

export const usePersistedDate = (key: string, defaultDate: string) => {
  const [date, setDate] = useState(() => {
    try {
      const stored = localStorage.getItem(`pref_${key}`);
      if (stored !== null) {
          try { return JSON.parse(stored); } catch { return stored; }
      }
      return defaultDate;
    } catch (error) {
      return defaultDate;
    }
  });

  useEffect(() => {
    const unsubscribe = DataService.subscribeToUserPreference(key, (val) => {
      if (val !== undefined && val !== date) {
        setDate(val);
      }
    });
    return () => unsubscribe();
  }, [key]);

  useEffect(() => {
    DataService.saveUserPreference(key, date);
  }, [key, date]);

  return [date, setDate] as const;
};
