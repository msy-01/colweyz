import React, { useState, useEffect, useRef } from 'react';
import { format, subDays, startOfMonth, endOfMonth, subMonths, isSameDay, parseISO, isValid, startOfWeek, endOfWeek, subWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Calendar, ChevronDown, Check } from 'lucide-react';

interface DateRange {
  startDate: Date;
  endDate: Date;
}

interface DateRangePickerProps {
  dateRange: DateRange;
  onUpdate: (range: DateRange) => void;
  singleDateOnly?: boolean;
  align?: 'left' | 'right';
  className?: string;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({ 
  dateRange, 
  onUpdate, 
  singleDateOnly = false, 
  align = 'left',
  className = ""
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange>(dateRange);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sync temp range when opening
  useEffect(() => {
    if (isOpen) {
      setTempRange(dateRange);
      determinePreset(dateRange);
    }
  }, [isOpen, dateRange]);

  const determinePreset = (range: DateRange) => {
    const today = new Date();
    const yesterday = subDays(today, 1);
    
    if (isSameDay(range.startDate, today) && isSameDay(range.endDate, today)) setSelectedPreset('today');
    else if (isSameDay(range.startDate, yesterday) && isSameDay(range.endDate, yesterday)) setSelectedPreset('yesterday');
    else if (!singleDateOnly) {
        if (isSameDay(range.startDate, yesterday) && isSameDay(range.endDate, today)) setSelectedPreset('todayYesterday');
        else if (isSameDay(range.startDate, subDays(today, 6)) && isSameDay(range.endDate, today)) setSelectedPreset('last7');
        else if (isSameDay(range.startDate, subDays(today, 13)) && isSameDay(range.endDate, today)) setSelectedPreset('last14');
        else if (isSameDay(range.startDate, subDays(today, 27)) && isSameDay(range.endDate, today)) setSelectedPreset('last28');
        else if (isSameDay(range.startDate, subDays(today, 29)) && isSameDay(range.endDate, today)) setSelectedPreset('last30');
        else if (isSameDay(range.startDate, startOfWeek(today, { weekStartsOn: 1 })) && isSameDay(range.endDate, today)) setSelectedPreset('thisWeek');
        else if (isSameDay(range.startDate, startOfWeek(subWeeks(today, 1), { weekStartsOn: 1 })) && isSameDay(range.endDate, endOfWeek(subWeeks(today, 1), { weekStartsOn: 1 }))) setSelectedPreset('lastWeek');
        else if (isSameDay(range.startDate, startOfMonth(today)) && isSameDay(range.endDate, endOfMonth(today))) setSelectedPreset('thisMonth');
        else if (isSameDay(range.startDate, startOfMonth(subMonths(today, 1))) && isSameDay(range.endDate, endOfMonth(subMonths(today, 1)))) setSelectedPreset('lastMonth');
        else if (isSameDay(range.startDate, new Date('2024-01-01')) && isSameDay(range.endDate, today)) setSelectedPreset('max');
        else setSelectedPreset('custom');
    } else {
        setSelectedPreset('custom');
    }
  };

  const handlePresetClick = (preset: string) => {
    const today = new Date();
    let newRange: DateRange = { startDate: today, endDate: today };

    switch (preset) {
      case 'today':
        newRange = { startDate: today, endDate: today };
        break;
      case 'yesterday':
        const y = subDays(today, 1);
        newRange = { startDate: y, endDate: y };
        break;
      case 'todayYesterday':
        newRange = { startDate: subDays(today, 1), endDate: today };
        break;
      case 'last7':
        newRange = { startDate: subDays(today, 6), endDate: today };
        break;
      case 'last14':
        newRange = { startDate: subDays(today, 13), endDate: today };
        break;
      case 'last28':
        newRange = { startDate: subDays(today, 27), endDate: today };
        break;
      case 'last30':
        newRange = { startDate: subDays(today, 29), endDate: today };
        break;
      case 'thisWeek':
        newRange = { startDate: startOfWeek(today, { weekStartsOn: 1 }), endDate: today };
        break;
      case 'lastWeek':
        const lastW = subWeeks(today, 1);
        newRange = { startDate: startOfWeek(lastW, { weekStartsOn: 1 }), endDate: endOfWeek(lastW, { weekStartsOn: 1 }) };
        break;
      case 'thisMonth':
        newRange = { startDate: startOfMonth(today), endDate: endOfMonth(today) };
        break;
      case 'lastMonth':
        const lastM = subMonths(today, 1);
        newRange = { startDate: startOfMonth(lastM), endDate: endOfMonth(lastM) };
        break;
      case 'max':
        newRange = { startDate: new Date('2024-01-01'), endDate: today };
        break;
    }
    setTempRange(newRange);
    setSelectedPreset(preset);
  };

  const handleApply = () => {
    onUpdate(tempRange);
    setIsOpen(false);
  };

  const formatDateDisplay = (range: DateRange) => {
    if (isSameDay(range.startDate, range.endDate)) {
      return format(range.startDate, 'd MMM yyyy', { locale: fr });
    }
    return `${format(range.startDate, 'd MMM yyyy', { locale: fr })} - ${format(range.endDate, 'd MMM yyyy', { locale: fr })}`;
  };

  const presets = [
    { id: 'today', label: "Aujourd'hui" },
    { id: 'yesterday', label: "Hier" },
    ...(!singleDateOnly ? [
      { id: 'todayYesterday', label: "Aujourd'hui et hier" },
      { id: 'last7', label: "7 derniers jours" },
      { id: 'last14', label: "14 derniers jours" },
      { id: 'last28', label: "28 derniers jours" },
      { id: 'last30', label: "30 derniers jours" },
      { id: 'thisWeek', label: "Cette semaine" },
      { id: 'lastWeek', label: "Dernière semaine" },
      { id: 'thisMonth', label: "Ce mois-ci" },
      { id: 'lastMonth', label: "Dernier mois" },
      { id: 'max', label: "Maximum" }
    ] : [])
  ];

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full gap-2 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm transition-colors min-w-0"
      >
        <div className="flex items-center gap-2 truncate min-w-0">
          <Calendar size={16} className="text-gray-500 flex-shrink-0" />
          <span className="truncate">{formatDateDisplay(dateRange)}</span>
        </div>
        <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
      </button>

      {isOpen && (
        <div className={`absolute top-full mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 flex flex-col md:flex-row overflow-hidden w-[280px] sm:w-[320px] md:w-[600px] max-w-[95vw] md:max-w-none ${align === 'right' ? 'left-0 md:left-auto md:right-0' : 'left-0'}`}>
          {/* Sidebar Presets */}
          <div className="w-full md:w-56 bg-gray-50 border-b md:border-b-0 md:border-r border-gray-200 p-2 flex flex-col gap-1 overflow-y-auto max-h-[400px]">
            <div className="px-3 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
              Période
            </div>
            {presets?.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetClick(preset.id)}
                className={`flex items-center justify-between w-full px-3 py-2 text-sm rounded-lg transition-colors text-left ${
                  selectedPreset === preset.id
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {preset.label}
                {selectedPreset === preset.id && <Check size={14} className="text-blue-600" />}
              </button>
            ))}
          </div>

          {/* Main Content */}
          <div className="flex-1 p-4 flex flex-col">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                    {singleDateOnly ? "Date" : "Début"}
                </label>
                <input
                  type="date"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={isValid(tempRange.startDate) ? format(tempRange.startDate, 'yyyy-MM-dd') : ''}
                  onChange={(e) => {
                    const d = parseISO(e.target.value);
                    if (isValid(d)) {
                        setTempRange(prev => ({ 
                            ...prev, 
                            startDate: d,
                            endDate: singleDateOnly ? d : prev.endDate 
                        }));
                        setSelectedPreset('custom');
                    }
                  }}
                />
              </div>
              {!singleDateOnly && (
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Fin</label>
                    <input
                    type="date"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    value={isValid(tempRange.endDate) ? format(tempRange.endDate, 'yyyy-MM-dd') : ''}
                    onChange={(e) => {
                        const d = parseISO(e.target.value);
                        if (isValid(d)) {
                            setTempRange(prev => ({ ...prev, endDate: d }));
                            setSelectedPreset('custom');
                        }
                    }}
                    min={isValid(tempRange.startDate) ? format(tempRange.startDate, 'yyyy-MM-dd') : undefined}
                    />
                </div>
              )}
            </div>

            <div className="mt-auto flex justify-end gap-3 pt-4 border-t border-gray-100">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleApply}
                className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
              >
                Mettre à jour
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
