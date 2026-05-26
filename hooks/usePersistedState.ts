import { useState, useEffect } from 'react';
import { DataService } from '../services/dataService';

export function usePersistedState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(`pref_${key}`);
      if (stored !== null) {
        return JSON.parse(stored);
      }
      return defaultValue;
    } catch (error) {
      return defaultValue;
    }
  });

  useEffect(() => {
    const unsubscribe = DataService.subscribeToUserPreference(key, (val) => {
      if (val !== undefined && JSON.stringify(val) !== JSON.stringify(state)) {
        setState(val);
      }
    });
    return () => unsubscribe();
  }, [key]);

  useEffect(() => {
    DataService.saveUserPreference(key, state);
  }, [key, state]);

  return [state, setState];
}
