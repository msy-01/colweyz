import { useState, useEffect } from 'react';
import { DataService } from '../services/dataService';

interface DateRange {
  startDate: Date;
  endDate: Date;
}

export const usePersistedDateRange = (key: string, defaultRange: DateRange) => {
  const [range, setRange] = useState<DateRange>(() => {
    try {
      const stored = localStorage.getItem(`pref_${key}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        const start = new Date(parsed.startDate);
        const end = new Date(parsed.endDate);
        
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            return {
                startDate: start,
                endDate: end
            };
        }
      }
      return defaultRange;
    } catch (error) {
      return defaultRange;
    }
  });

  useEffect(() => {
    const unsubscribe = DataService.subscribeToUserPreference(key, (val) => {
      if (val && val.startDate && val.endDate) {
        const start = new Date(val.startDate);
        const end = new Date(val.endDate);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          // Check if different to avoid infinite loops
          if (start.getTime() !== range.startDate.getTime() || end.getTime() !== range.endDate.getTime()) {
            setRange({ startDate: start, endDate: end });
          }
        }
      }
    });
    return () => unsubscribe();
  }, [key]);

  useEffect(() => {
    DataService.saveUserPreference(key, range);
  }, [key, range]);

  return [range, setRange] as const;
};
