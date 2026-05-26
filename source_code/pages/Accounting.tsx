import React, { useState, useEffect, useMemo } from 'react';
import { 
    BookOpen, 
    FileText, 
    Scale, 
    BarChart3, 
    PlusCircle,
    Save,
    X,
    Lock,
    Edit2,
    Trash2,
    Download,
    Search
} from 'lucide-react';
import { AccountingEntry, AccountingEntryLine } from '../types';
import { DataService } from '../services/dataService';
import { formatFCFA } from '../utils/formatters';
import { AccountingService, SYSCOHADA_ACCOUNTS, ACCOUNTING_START_DATE } from '../services/accountingService';
import { format, isBefore, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

export const Accounting: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'new' | 'journal' | 'ledger' | 'balance' | 'income'>('journal');
    const [entries, setEntries] = useState<AccountingEntry[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [startDate, setStartDate] = useState(ACCOUNTING_START_DATE);
    const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [selectedAccount, setSelectedAccount] = useState<string>('all');

    // New Entry Form
    const [newEntryDate, setNewEntryDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [newEntryLabel, setNewEntryLabel] = useState('');
    const [newEntryLines, setNewEntryLines] = useState<AccountingEntryLine[]>([
        { accountId: '', label: '', debit: 0, credit: 0 },
        { accountId: '', label: '', debit: 0, credit: 0 }
    ]);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const allEntries = await AccountingService.getAllEntries();
            setEntries(allEntries);
        } catch (error) {
            console.error("Error loading accounting entries:", error);
        } finally {
            setLoading(false);
        }
    };

    const filteredEntries = useMemo(() => {
        return entries.filter(e => {
            const entryDate = e.date;
            if (entryDate < startDate || entryDate > endDate) return false;
            if (selectedAccount !== 'all') {
                return e.lines.some(l => l.accountId === selectedAccount || l.accountId.startsWith(selectedAccount));
            }
            return true;
        });
    }, [entries, startDate, endDate, selectedAccount]);

    // --- NEW ENTRY LOGIC ---
    const handleAddLine = () => {
        setNewEntryLines([...newEntryLines, { accountId: '', label: '', debit: 0, credit: 0 }]);
    };

    const handleRemoveLine = (index: number) => {
        setNewEntryLines(newEntryLines.filter((_, i) => i !== index));
    };

    const handleLineChange = (index: number, field: keyof AccountingEntryLine, value: any) => {
        const newLines = [...newEntryLines];
        newLines[index] = { ...newLines[index], [field]: value };
        setNewEntryLines(newLines);
    };

    const totalDebit = newEntryLines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
    const totalCredit = newEntryLines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
    const isBalanced = totalDebit === totalCredit && totalDebit > 0;
    const isValidDate = newEntryDate >= ACCOUNTING_START_DATE;

    const handleSaveEntry = async () => {
        if (!isBalanced || !isValidDate || !newEntryLabel.trim()) return;
        
        // Ensure all lines have an account
        if (newEntryLines.some(l => !l.accountId)) {
            alert("Veuillez sélectionner un compte pour chaque ligne.");
            return;
        }

        const newEntry: AccountingEntry = {
            id: `man-${Date.now()}`,
            date: newEntryDate,
            pieceNumber: `MN-${format(new Date(), 'yyyyMMddHHmmss')}`,
            label: newEntryLabel,
            lines: newEntryLines?.map(l => ({
                ...l,
                debit: Number(l.debit) || 0,
                credit: Number(l.credit) || 0
            })),
            isManual: true,
            origine: 'manuel',
            modifiable: true,
            createdAt: new Date().toISOString()
        };

        try {
            await DataService.saveAccountingEntry(newEntry);
            setEntries([newEntry, ...entries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
            
            // Reset form
            setNewEntryLabel('');
            setNewEntryLines([
                { accountId: '', label: '', debit: 0, credit: 0 },
                { accountId: '', label: '', debit: 0, credit: 0 }
            ]);
            setActiveTab('journal');
        } catch (error) {
            console.error("Error saving entry:", error);
            alert("Erreur lors de l'enregistrement de l'écriture.");
        }
    };

    const handleDeleteEntry = async (id: string) => {
        if (!window.confirm("Êtes-vous sûr de vouloir supprimer cette écriture ?")) return;
        try {
            await DataService.deleteAccountingEntry(id);
            setEntries(entries.filter(e => e.id !== id));
        } catch (error) {
            console.error("Error deleting entry:", error);
        }
    };

    // --- GRAND LIVRE LOGIC ---
    const ledgerData = useMemo(() => {
        const data: Record<string, { entries: any[], totalDebit: number, totalCredit: number, balance: number }> = {};
        
        filteredEntries.forEach(entry => {
            entry.lines.forEach(line => {
                if (!data[line.accountId]) {
                    data[line.accountId] = { entries: [], totalDebit: 0, totalCredit: 0, balance: 0 };
                }
                data[line.accountId].entries.push({
                    date: entry.date,
                    pieceNumber: entry.pieceNumber,
                    label: entry.label,
                    lineLabel: line.label,
                    debit: line.debit,
                    credit: line.credit
                });
                data[line.accountId].totalDebit += line.debit;
                data[line.accountId].totalCredit += line.credit;
            });
        });

        // Calculate balances
        Object.keys(data).forEach(accId => {
            // Sort entries by date ascending for ledger
            data[accId].entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            
            let currentBalance = 0;
            data[accId].entries.forEach(e => {
                currentBalance += (e.debit - e.credit);
                e.progressiveBalance = currentBalance;
            });
            data[accId].balance = currentBalance;
        });

        return data;
    }, [filteredEntries]);

    // --- BALANCE LOGIC ---
    const balanceData = useMemo(() => {
        const data = Object.keys(ledgerData)?.map(accId => {
            const acc = SYSCOHADA_ACCOUNTS.find(a => a.id === accId);
            const totalDebit = ledgerData[accId].totalDebit;
            const totalCredit = ledgerData[accId].totalCredit;
            const solde = totalDebit - totalCredit;
            
            return {
                id: accId,
                label: acc ? acc.label : 'Compte inconnu',
                debit: totalDebit,
                credit: totalCredit,
                soldeDebiteur: solde > 0 ? solde : 0,
                soldeCrediteur: solde < 0 ? Math.abs(solde) : 0
            };
        }).sort((a, b) => a.id.localeCompare(b.id));

        const totals = data.reduce((acc, row) => ({
            debit: acc.debit + row.debit,
            credit: acc.credit + row.credit,
            soldeDebiteur: acc.soldeDebiteur + row.soldeDebiteur,
            soldeCrediteur: acc.soldeCrediteur + row.soldeCrediteur
        }), { debit: 0, credit: 0, soldeDebiteur: 0, soldeCrediteur: 0 });

        return { rows: data, totals };
    }, [ledgerData]);

    // --- INCOME STATEMENT LOGIC ---
    const incomeStatement = useMemo(() => {
        let totalProduits = 0;
        let totalCharges = 0;
        const produits: any[] = [];
        const charges: any[] = [];

        Object.keys(ledgerData).forEach(accId => {
            const acc = SYSCOHADA_ACCOUNTS.find(a => a.id === accId);
            if (!acc) return;

            const solde = ledgerData[accId].totalCredit - ledgerData[accId].totalDebit; // For class 7, credit is positive. For class 6, debit is positive.
            
            if (acc.class === '7') {
                produits.push({ id: accId, label: acc.label, amount: solde });
                totalProduits += solde;
            } else if (acc.class === '6') {
                const chargeAmount = ledgerData[accId].totalDebit - ledgerData[accId].totalCredit;
                charges.push({ id: accId, label: acc.label, amount: chargeAmount });
                totalCharges += chargeAmount;
            }
        });

        return {
            produits: produits.sort((a, b) => a.id.localeCompare(b.id)),
            charges: charges.sort((a, b) => a.id.localeCompare(b.id)),
            totalProduits,
            totalCharges,
            resultatNet: totalProduits - totalCharges
        };
    }, [ledgerData]);

    if (loading) {
        return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div></div>;
    }

    return (
        <div className="space-y-6 pb-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Comptabilité (SYSCOHADA)</h1>
                    <p className="text-gray-500">Gestion comptable et financière</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex overflow-x-auto bg-white rounded-xl shadow-sm border p-1 gap-1">
                <button 
                    onClick={() => setActiveTab('new')}
                    className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeTab === 'new' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                    <PlusCircle size={18} className="mr-2" /> Nouvelle Écriture
                </button>
                <button 
                    onClick={() => setActiveTab('journal')}
                    className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeTab === 'journal' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                    <BookOpen size={18} className="mr-2" /> Journal
                </button>
                <button 
                    onClick={() => setActiveTab('ledger')}
                    className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeTab === 'ledger' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                    <FileText size={18} className="mr-2" /> Grand Livre
                </button>
                <button 
                    onClick={() => setActiveTab('balance')}
                    className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeTab === 'balance' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                    <Scale size={18} className="mr-2" /> Balance
                </button>
                <button 
                    onClick={() => setActiveTab('income')}
                    className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeTab === 'income' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                    <BarChart3 size={18} className="mr-2" /> Compte de Résultat
                </button>
            </div>

            {/* Global Filters (except for New Entry) */}
            {activeTab !== 'new' && (
                <div className="bg-white p-4 rounded-xl shadow-sm border flex flex-wrap gap-4 items-end justify-between">
                    <div className="flex flex-wrap gap-4 items-end">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Du</label>
                            <input 
                                type="date" 
                                value={startDate}
                                min={ACCOUNTING_START_DATE}
                                onChange={e => setStartDate(e.target.value)}
                                className="p-2 border rounded-lg text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Au</label>
                            <input 
                                type="date" 
                                value={endDate}
                                onChange={e => setEndDate(e.target.value)}
                                className="p-2 border rounded-lg text-sm"
                            />
                        </div>
                        {(activeTab === 'journal' || activeTab === 'ledger') && (
                            <div className="flex-1 min-w-[200px]">
                                <label className="block text-xs font-medium text-gray-500 mb-1">Compte</label>
                                <select 
                                    value={selectedAccount}
                                    onChange={e => setSelectedAccount(e.target.value)}
                                    className="w-full p-2 border rounded-lg text-sm"
                                >
                                    <option value="all">Tous les comptes</option>
                                    <optgroup label="Classe 1 - Capitaux">
                                        {SYSCOHADA_ACCOUNTS.filter(a => a.class === '1')?.map(a => <option key={a.id} value={a.id}>{a.id} - {a.label}</option>)}
                                    </optgroup>
                                    <optgroup label="Classe 4 - Tiers">
                                        {SYSCOHADA_ACCOUNTS.filter(a => a.class === '4')?.map(a => <option key={a.id} value={a.id}>{a.id} - {a.label}</option>)}
                                    </optgroup>
                                    <optgroup label="Classe 5 - Trésorerie">
                                        {SYSCOHADA_ACCOUNTS.filter(a => a.class === '5')?.map(a => <option key={a.id} value={a.id}>{a.id} - {a.label}</option>)}
                                    </optgroup>
                                    <optgroup label="Classe 6 - Charges">
                                        {SYSCOHADA_ACCOUNTS.filter(a => a.class === '6')?.map(a => <option key={a.id} value={a.id}>{a.id} - {a.label}</option>)}
                                    </optgroup>
                                    <optgroup label="Classe 7 - Produits">
                                        {SYSCOHADA_ACCOUNTS.filter(a => a.class === '7')?.map(a => <option key={a.id} value={a.id}>{a.id} - {a.label}</option>)}
                                    </optgroup>
                                </select>
                            </div>
                        )}
                    </div>
                    {activeTab === 'journal' && (
                        <div className="flex gap-2">
                            <button className="flex items-center px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
                                <Download size={16} className="mr-2" /> Excel
                            </button>
                            <button className="flex items-center px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
                                <Download size={16} className="mr-2" /> PDF
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* TAB CONTENT */}
            {activeTab === 'new' && (
                <div className="bg-white rounded-xl shadow-sm border overflow-hidden max-w-4xl mx-auto">
                    <div className="bg-indigo-50 px-6 py-4 border-b border-indigo-100">
                        <h2 className="text-lg font-bold text-indigo-900">Nouvelle Écriture Comptable</h2>
                    </div>
                    <div className="p-6 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                                <input 
                                    type="date" 
                                    value={newEntryDate}
                                    min={ACCOUNTING_START_DATE}
                                    onChange={e => setNewEntryDate(e.target.value)}
                                    className={`w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-indigo-500 ${!isValidDate ? 'border-red-300 bg-red-50' : ''}`}
                                />
                                {!isValidDate && <p className="text-xs text-red-600 mt-1">La date doit être supérieure ou égale au 05/03/2026.</p>}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Libellé de l'écriture</label>
                                <input 
                                    type="text" 
                                    value={newEntryLabel}
                                    onChange={e => setNewEntryLabel(e.target.value)}
                                    placeholder="Ex: Loyer Mars 2026"
                                    className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                        </div>

                        <div>
                            <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">Lignes d'écriture</h3>
                            <div className="border rounded-xl overflow-hidden">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-gray-50 text-gray-600 font-medium border-b">
                                        <tr>
                                            <th className="p-3 w-1/3">Compte</th>
                                            <th className="p-3">Libellé ligne</th>
                                            <th className="p-3 w-32 text-right">Débit</th>
                                            <th className="p-3 w-32 text-right">Crédit</th>
                                            <th className="p-3 w-12 text-center"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {newEntryLines?.map((line, index) => (
                                            <tr key={index} className="bg-white">
                                                <td className="p-2">
                                                    <select 
                                                        value={line.accountId}
                                                        onChange={e => handleLineChange(index, 'accountId', e.target.value)}
                                                        className="w-full p-2 border rounded bg-gray-50 focus:bg-white"
                                                    >
                                                        <option value="">Sélectionner...</option>
                                                        {SYSCOHADA_ACCOUNTS?.map(a => (
                                                            <option key={a.id} value={a.id}>{a.id} - {a.label}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="p-2">
                                                    <input 
                                                        type="text" 
                                                        value={line.label}
                                                        onChange={e => handleLineChange(index, 'label', e.target.value)}
                                                        placeholder="Libellé optionnel"
                                                        className="w-full p-2 border rounded bg-gray-50 focus:bg-white"
                                                    />
                                                </td>
                                                <td className="p-2">
                                                    <input 
                                                        type="number" 
                                                        value={line.debit || ''}
                                                        onChange={e => {
                                                            handleLineChange(index, 'debit', e.target.value);
                                                            if (e.target.value) handleLineChange(index, 'credit', 0);
                                                        }}
                                                        className="w-full p-2 border rounded text-right bg-gray-50 focus:bg-white"
                                                    />
                                                </td>
                                                <td className="p-2">
                                                    <input 
                                                        type="number" 
                                                        value={line.credit || ''}
                                                        onChange={e => {
                                                            handleLineChange(index, 'credit', e.target.value);
                                                            if (e.target.value) handleLineChange(index, 'debit', 0);
                                                        }}
                                                        className="w-full p-2 border rounded text-right bg-gray-50 focus:bg-white"
                                                    />
                                                </td>
                                                <td className="p-2 text-center">
                                                    {newEntryLines.length > 2 && (
                                                        <button onClick={() => handleRemoveLine(index)} className="text-red-400 hover:text-red-600 p-1">
                                                            <X size={16} />
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-gray-50 border-t font-bold">
                                        <tr>
                                            <td colSpan={2} className="p-3 text-right text-gray-600">TOTAUX</td>
                                            <td className={`p-3 text-right ${isBalanced ? 'text-green-600' : 'text-red-600'}`}>{formatFCFA(totalDebit)}</td>
                                            <td className={`p-3 text-right ${isBalanced ? 'text-green-600' : 'text-red-600'}`}>{formatFCFA(totalCredit)}</td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                            <button 
                                onClick={handleAddLine}
                                className="mt-3 text-sm text-indigo-600 font-medium hover:text-indigo-800 flex items-center"
                            >
                                <PlusCircle size={16} className="mr-1" /> Ajouter une ligne
                            </button>
                        </div>

                        {!isBalanced && totalDebit > 0 && totalCredit > 0 && (
                            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm border border-red-100 flex items-start">
                                <span className="mr-2">⚠️</span>
                                L'écriture ne peut être enregistrée que si le Total Débit est égal au Total Crédit.
                            </div>
                        )}

                        <div className="flex justify-end pt-4 border-t">
                            <button 
                                onClick={handleSaveEntry}
                                disabled={!isBalanced || !isValidDate || !newEntryLabel.trim()}
                                className={`px-6 py-2.5 rounded-lg text-sm font-bold flex items-center transition-colors ${
                                    !isBalanced || !isValidDate || !newEntryLabel.trim()
                                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                                }`}
                            >
                                <Save size={18} className="mr-2" /> Enregistrer l'écriture
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'journal' && (
                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 text-gray-600 font-medium border-b">
                                <tr>
                                    <th className="px-4 py-3 w-10"></th>
                                    <th className="px-4 py-3">Date</th>
                                    <th className="px-4 py-3">N° Pièce</th>
                                    <th className="px-4 py-3">Compte</th>
                                    <th className="px-4 py-3">Libellé</th>
                                    <th className="px-4 py-3 text-right">Débit</th>
                                    <th className="px-4 py-3 text-right">Crédit</th>
                                    <th className="px-4 py-3 w-16"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredEntries.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                                            Aucune écriture trouvée pour cette période.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredEntries?.map(entry => (
                                        <React.Fragment key={entry.id}>
                                            {entry.lines?.map((line, idx) => (
                                                <tr key={`${entry.id}-${idx}`} className={`hover:bg-gray-50 ${entry.origine === 'manuel' ? 'bg-indigo-50/20' : ''}`}>
                                                    {idx === 0 ? (
                                                        <>
                                                            <td className="px-4 py-3 text-center" rowSpan={entry.lines.length}>
                                                                {entry.origine === 'manuel' ? <span title="Écriture manuelle"><Edit2 size={14} className="text-indigo-400 mx-auto" /></span> : <span title="Écriture automatique"><Lock size={14} className="text-gray-400 mx-auto" /></span>}
                                                            </td>
                                                            <td className="px-4 py-3 font-medium text-gray-900" rowSpan={entry.lines.length}>
                                                                {format(parseISO(entry.date), 'dd/MM/yyyy')}
                                                            </td>
                                                            <td className="px-4 py-3 text-gray-500 text-xs" rowSpan={entry.lines.length}>
                                                                {entry.pieceNumber}
                                                            </td>
                                                        </>
                                                    ) : null}
                                                    
                                                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                                                        {line.accountId}
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-800">
                                                        {idx === 0 ? <span className="font-medium">{entry.label}</span> : <span className="text-gray-500">{line.label || entry.label}</span>}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                                                        {line.debit > 0 ? formatFCFA(line.debit) : ''}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                                                        {line.credit > 0 ? formatFCFA(line.credit) : ''}
                                                    </td>
                                                    
                                                    {idx === 0 ? (
                                                        <td className="px-4 py-3 text-center" rowSpan={entry.lines.length}>
                                                            {entry.origine === 'manuel' ? (
                                                                <div className="flex items-center justify-center gap-2">
                                                                    <button onClick={() => alert("Fonctionnalité de modification à venir")} className="text-indigo-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50" title="Modifier">
                                                                        <Edit2 size={14} />
                                                                    </button>
                                                                    <button onClick={() => handleDeleteEntry(entry.id)} className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50" title="Supprimer">
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <span title="Lecture seule"><Lock size={14} className="text-gray-400 mx-auto" /></span>
                                                            )}
                                                        </td>
                                                    ) : null}
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === 'ledger' && (
                <div className="space-y-8">
                    {Object.keys(ledgerData).length === 0 ? (
                        <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
                            Aucun mouvement sur la période sélectionnée.
                        </div>
                    ) : (
                        Object.keys(ledgerData).sort()?.map(accId => {
                            const acc = SYSCOHADA_ACCOUNTS.find(a => a.id === accId);
                            const data = ledgerData[accId];
                            if (selectedAccount !== 'all' && accId !== selectedAccount && !accId.startsWith(selectedAccount)) return null;

                            return (
                                <div key={accId} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                                    <div className="bg-gray-50 px-6 py-3 border-b flex justify-between items-center">
                                        <h3 className="font-bold text-gray-800">
                                            <span className="text-indigo-600 mr-2">{accId}</span>
                                            {acc ? acc.label : 'Compte inconnu'}
                                        </h3>
                                        <div className="text-sm font-medium text-gray-500">
                                            Solde: <span className={`font-bold ${data.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatFCFA(Math.abs(data.balance))} {data.balance >= 0 ? '(D)' : '(C)'}</span>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-white text-gray-500 text-xs uppercase border-b">
                                                <tr>
                                                    <th className="px-4 py-2">Date</th>
                                                    <th className="px-4 py-2">Pièce</th>
                                                    <th className="px-4 py-2">Libellé</th>
                                                    <th className="px-4 py-2 text-right">Débit</th>
                                                    <th className="px-4 py-2 text-right">Crédit</th>
                                                    <th className="px-4 py-2 text-right">Solde progressif</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {data.entries?.map((e, i) => (
                                                    <tr key={i} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 text-gray-600">{format(parseISO(e.date), 'dd/MM/yyyy')}</td>
                                                        <td className="px-4 py-2 text-xs text-gray-400">{e.pieceNumber}</td>
                                                        <td className="px-4 py-2 text-gray-800">{e.label} {e.lineLabel ? `- ${e.lineLabel}` : ''}</td>
                                                        <td className="px-4 py-2 text-right">{e.debit > 0 ? formatFCFA(e.debit) : ''}</td>
                                                        <td className="px-4 py-2 text-right">{e.credit > 0 ? formatFCFA(e.credit) : ''}</td>
                                                        <td className={`px-4 py-2 text-right font-medium ${e.progressiveBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                            {formatFCFA(Math.abs(e.progressiveBalance))} {e.progressiveBalance >= 0 ? 'D' : 'C'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot className="bg-gray-50 border-t font-bold text-gray-700">
                                                <tr>
                                                    <td colSpan={3} className="px-4 py-3 text-right">TOTAUX PÉRIODE</td>
                                                    <td className="px-4 py-3 text-right">{formatFCFA(data.totalDebit)}</td>
                                                    <td className="px-4 py-3 text-right">{formatFCFA(data.totalCredit)}</td>
                                                    <td className="px-4 py-3 text-right"></td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {activeTab === 'balance' && (
                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 text-gray-600 font-medium border-b">
                                <tr>
                                    <th className="px-6 py-4">Compte</th>
                                    <th className="px-6 py-4">Libellé</th>
                                    <th className="px-6 py-4 text-right">Débit</th>
                                    <th className="px-6 py-4 text-right">Crédit</th>
                                    <th className="px-6 py-4 text-right">Solde Débiteur</th>
                                    <th className="px-6 py-4 text-right">Solde Créditeur</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {balanceData.rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                                            Aucune donnée pour cette période.
                                        </td>
                                    </tr>
                                ) : (
                                    balanceData.rows?.map(row => (
                                        <tr key={row.id} className="hover:bg-gray-50">
                                            <td className="px-6 py-3 font-mono text-indigo-600 font-medium">{row.id}</td>
                                            <td className="px-6 py-3 text-gray-800">{row.label}</td>
                                            <td className="px-6 py-3 text-right">{row.debit > 0 ? formatFCFA(row.debit) : '-'}</td>
                                            <td className="px-6 py-3 text-right">{row.credit > 0 ? formatFCFA(row.credit) : '-'}</td>
                                            <td className="px-6 py-3 text-right font-medium text-green-600">{row.soldeDebiteur > 0 ? formatFCFA(row.soldeDebiteur) : '-'}</td>
                                            <td className="px-6 py-3 text-right font-medium text-red-600">{row.soldeCrediteur > 0 ? formatFCFA(row.soldeCrediteur) : '-'}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                            <tfoot className="bg-gray-100 border-t-2 border-gray-200 font-bold text-gray-900">
                                <tr>
                                    <td colSpan={2} className="px-6 py-4 text-right uppercase tracking-wider text-xs">TOTAUX GÉNÉRAUX</td>
                                    <td className="px-6 py-4 text-right">{formatFCFA(balanceData.totals.debit)}</td>
                                    <td className="px-6 py-4 text-right">{formatFCFA(balanceData.totals.credit)}</td>
                                    <td className="px-6 py-4 text-right text-green-700">{formatFCFA(balanceData.totals.soldeDebiteur)}</td>
                                    <td className="px-6 py-4 text-right text-red-700">{formatFCFA(balanceData.totals.soldeCrediteur)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === 'income' && (
                <div className="max-w-4xl mx-auto">
                    <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                        <div className="bg-gray-50 px-6 py-4 border-b text-center">
                            <h2 className="text-xl font-bold text-gray-900">Compte de Résultat Simplifié</h2>
                            <p className="text-sm text-gray-500 mt-1">Période du {format(parseISO(startDate), 'dd/MM/yyyy')} au {format(parseISO(endDate), 'dd/MM/yyyy')}</p>
                        </div>
                        
                        <div className="p-0">
                            {/* PRODUITS */}
                            <div className="px-6 py-4 bg-green-50/30 border-b">
                                <h3 className="text-sm font-bold text-green-800 uppercase tracking-wider mb-4">Produits d'exploitation</h3>
                                <div className="space-y-3">
                                    {incomeStatement.produits.length === 0 ? (
                                        <p className="text-sm text-gray-500 italic">Aucun produit enregistré.</p>
                                    ) : (
                                        incomeStatement.produits?.map(p => (
                                            <div key={p.id} className="flex justify-between text-sm">
                                                <span className="text-gray-700"><span className="font-mono text-gray-400 mr-2">{p.id}</span> {p.label}</span>
                                                <span className="font-medium text-gray-900">{formatFCFA(p.amount)}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div className="mt-4 pt-3 border-t border-green-200 flex justify-between items-center">
                                    <span className="font-bold text-green-900">TOTAL PRODUITS</span>
                                    <span className="font-bold text-green-700 text-lg">{formatFCFA(incomeStatement.totalProduits)}</span>
                                </div>
                            </div>

                            {/* CHARGES */}
                            <div className="px-6 py-4 bg-red-50/30 border-b">
                                <h3 className="text-sm font-bold text-red-800 uppercase tracking-wider mb-4">Charges d'exploitation</h3>
                                <div className="space-y-3">
                                    {incomeStatement.charges.length === 0 ? (
                                        <p className="text-sm text-gray-500 italic">Aucune charge enregistrée.</p>
                                    ) : (
                                        incomeStatement.charges?.map(c => (
                                            <div key={c.id} className="flex justify-between text-sm">
                                                <span className="text-gray-700"><span className="font-mono text-gray-400 mr-2">{c.id}</span> {c.label}</span>
                                                <span className="font-medium text-gray-900">{formatFCFA(c.amount)}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div className="mt-4 pt-3 border-t border-red-200 flex justify-between items-center">
                                    <span className="font-bold text-red-900">TOTAL CHARGES</span>
                                    <span className="font-bold text-red-700 text-lg">{formatFCFA(incomeStatement.totalCharges)}</span>
                                </div>
                            </div>

                            {/* RESULTAT NET */}
                            <div className={`px-6 py-6 ${incomeStatement.resultatNet >= 0 ? 'bg-indigo-50' : 'bg-orange-50'}`}>
                                <div className="flex justify-between items-center">
                                    <span className="text-xl font-black text-gray-900 uppercase">Résultat Net</span>
                                    <div className="flex items-center">
                                        <span className={`text-2xl font-black mr-3 ${incomeStatement.resultatNet >= 0 ? 'text-indigo-700' : 'text-orange-700'}`}>
                                            {formatFCFA(incomeStatement.resultatNet)}
                                        </span>
                                        {incomeStatement.resultatNet >= 0 ? (
                                            <span className="bg-indigo-100 text-indigo-800 text-xs font-bold px-2 py-1 rounded">BÉNÉFICE</span>
                                        ) : (
                                            <span className="bg-orange-100 text-orange-800 text-xs font-bold px-2 py-1 rounded">PERTE</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
