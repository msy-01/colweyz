import React from 'react';
import { Modal } from './Modal';
import { X, Download, Loader2 } from 'lucide-react';
import Markdown from 'react-markdown';
import jsPDF from 'jspdf';

interface ClaudeAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysis: string | null;
  isAnalyzing: boolean;
  dateStr: string;
}

export const ClaudeAnalysisModal: React.FC<ClaudeAnalysisModalProps> = ({
  isOpen,
  onClose,
  analysis,
  isAnalyzing,
  dateStr
}) => {
  const handleExportPDF = () => {
    if (!analysis) return;
    
    const doc = new jsPDF();
    
    // Set font size and add title
    doc.setFontSize(16);
    doc.text(`Analyse Claude - ${dateStr}`, 14, 20);
    
    // Add content
    doc.setFontSize(11);
    
    // Simple text split for PDF
    const splitText = doc.splitTextToSize(analysis.replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, ''), 180);
    
    let y = 30;
    for (let i = 0; i < splitText.length; i++) {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(splitText[i], 14, y);
      y += 6;
    }
    
    doc.save(`Analyse_Claude_${dateStr}.pdf`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span className="text-purple-600">✨</span> Analyse Intelligente Claude
          </h2>
          <div className="flex items-center gap-2">
            {!isAnalyzing && analysis && (
              <button
                onClick={handleExportPDF}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
              >
                <Download size={16} />
                Exporter en PDF
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {isAnalyzing ? (
            <div className="flex flex-col items-center justify-center h-64 text-purple-600">
              <Loader2 className="animate-spin mb-4" size={40} />
              <p className="font-medium text-lg">Claude analyse vos données...</p>
              <p className="text-sm text-gray-500 mt-2">Cela peut prendre quelques secondes</p>
            </div>
          ) : analysis ? (
            <div className="prose prose-purple max-w-none prose-headings:text-gray-800 prose-p:text-gray-600 prose-li:text-gray-600">
              <Markdown>{analysis}</Markdown>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <p>Aucune analyse disponible.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
