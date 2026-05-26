
import { jsPDF } from "jspdf";
import { formatFCFA } from "../utils/formatters";
import { Order } from "../types";
import { parseProductCommand } from "../utils/productParser";
import { DataService } from "./dataService";

export const InvoiceService = {
  generateAndDownload: async (order: Order) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // --- COLORS ---
    const greenColor = "#2E8B57"; 
    const redColor = "#E54B3B";   
    const orangeColor = "#F59E3D";
    const darkColor = "#1F2937"; 

    // --- LOGO ---
    try {
        const settings = await DataService.getSettings();
        if (settings.logoUrl) {
            // Add image logo
            doc.addImage(settings.logoUrl, 'PNG', 14, 15, 40, 15);
        } else {
            // Fallback text logo if no image uploaded
            doc.setFont("helvetica", "bold");
            
            doc.setTextColor(redColor);
            doc.setFontSize(32);
            doc.text("col", 14, 25);
            
            doc.setTextColor(greenColor);
            doc.text("wey", 30, 25);
            
            doc.setTextColor(orangeColor);
            doc.text("z", 52, 25);
        }
    } catch (e) {
        // Fallback text logo if error
        doc.setFont("helvetica", "bold");
        
        doc.setTextColor(redColor);
        doc.setFontSize(32);
        doc.text("col", 14, 25);
        
        doc.setTextColor(greenColor);
        doc.text("wey", 30, 25);
        
        doc.setTextColor(orangeColor);
        doc.text("z", 52, 25);
    }

    // --- TITLE ---
    doc.setTextColor(greenColor);
    doc.setFontSize(16);
    doc.text("Facture", 14, 45);

    // --- HEADER INFO ---
    doc.setTextColor(darkColor);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    
    // Col 1
    doc.setTextColor(greenColor);
    doc.text("Numéro de facture", 14, 55);
    doc.setTextColor(darkColor);
    doc.text(`#${order.id}`, 14, 60);

    // Col 2
    const dateStr = order.deliveredAt 
        ? new Date(order.deliveredAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) 
        : new Date().toLocaleDateString('fr-FR');
        
    doc.setTextColor(greenColor);
    doc.text("Date d'émission", 60, 55);
    doc.setTextColor(darkColor);
    doc.text(dateStr, 60, 60);

    // --- SENDER & RECEIVER ---
    const yStartAddr = 75;
    
    // Expéditeur
    doc.setTextColor(greenColor);
    doc.text("Expéditeur", 14, yStartAddr);
    doc.setTextColor(darkColor);
    doc.setFont("helvetica", "bold");
    doc.text("Colweyz", 14, yStartAddr + 5);
    doc.setFont("helvetica", "normal");
    doc.text("Dakar, Sénégal", 14, yStartAddr + 10);
    doc.text("Livraison Rapide E-Commerce", 14, yStartAddr + 15);
    doc.text("contact@colweyz.sn", 14, yStartAddr + 20);

    // Destinataire
    doc.setTextColor(greenColor);
    doc.text("Adresse de facturation", 100, yStartAddr);
    doc.setTextColor(darkColor);
    doc.setFont("helvetica", "bold");
    doc.text(order.clientName, 100, yStartAddr + 5);
    doc.setFont("helvetica", "normal");
    // Split address if too long
    const splitAddress = doc.splitTextToSize(order.address, 90);
    doc.text(splitAddress, 100, yStartAddr + 10);
    
    if (order.clientPhone) {
        doc.text(`+221 ${order.clientPhone}`, 100, yStartAddr + 10 + (splitAddress.length * 5));
    }

    // --- TABLE HEADER ---
    const yTableStart = 115;
    doc.setDrawColor(229, 231, 235); // Gray-200
    doc.setLineWidth(0.5);
    doc.line(14, yTableStart, pageWidth - 14, yTableStart); // Top line

    doc.setTextColor(greenColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    
    doc.text("Article", 14, yTableStart + 5);
    doc.text("Prix unitaire", 100, yTableStart + 5, { align: 'right' });
    doc.text("Quantité", 130, yTableStart + 5, { align: 'center' });
    doc.text("Total", pageWidth - 14, yTableStart + 5, { align: 'right' });

    doc.line(14, yTableStart + 8, pageWidth - 14, yTableStart + 8); // Header bottom line

    // --- TABLE ROWS ---
    let yRow = yTableStart + 15;
    doc.setTextColor(darkColor);
    doc.setFont("helvetica", "bold");
    
    if (order.products && order.products.length > 0) {
        order.products.forEach(p => {
            doc.text(p.name, 14, yRow);
            const priceStr = formatFCFA(p.prixUnitaire || 0);
            doc.setFontSize(9);
            doc.text(priceStr, 100, yRow, { align: 'right' });
            doc.text((p.quantity || 1).toString(), 130, yRow, { align: 'center' });
            doc.text(formatFCFA((p.prixUnitaire || 0) * (p.quantity || 1)), pageWidth - 14, yRow, { align: 'right' });
            yRow += 10;
        });
    } else {
        // Product Name (Default or from order)
        const { quantity, productName } = parseProductCommand(order.productDetails || "Article divers");
        const productText = productName;
        doc.text(productText, 14, yRow);
        
        // Price
        const price = order.amount / (quantity > 0 ? quantity : 1); // Assuming amount is total, but acting as unit for 1 qty for simplicity
        const priceStr = formatFCFA(price);
        
        doc.setFontSize(9);
        doc.text(priceStr, 100, yRow, { align: 'right' });
        
        // Qty
        doc.text(quantity.toString(), 130, yRow, { align: 'center' });
        
        // Total Line
        doc.text(formatFCFA(order.amount), pageWidth - 14, yRow, { align: 'right' });
        yRow += 10;
    }

    doc.line(14, yRow - 2, pageWidth - 14, yRow - 2); // Row bottom line

    // --- TOTALS ---
    const yTotals = yRow + 10;
    
    // TOTAL ROW
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("TOTAL", 130, yTotals + 10);
    doc.text(formatFCFA(order.amount), pageWidth - 14, yTotals + 10, { align: 'right' });

    doc.line(130, yTotals + 15, pageWidth - 14, yTotals + 15);

    // --- PAYMENT BOX ---
    const yPayBox = yTotals + 30;
    doc.roundedRect(14, yPayBox, pageWidth - 28, 15, 2, 2, 'S');
    
    doc.text("Total payé", 20, yPayBox + 10);
    doc.setTextColor(greenColor);
    doc.text(formatFCFA(order.amount), 60, yPayBox + 10);
    
    doc.setTextColor(darkColor);
    doc.text("Montant à payer", 130, yPayBox + 10);
    doc.setTextColor(greenColor);
    doc.text("0 F CFA", pageWidth - 20, yPayBox + 10, { align: 'right' });

    // --- FOOTER ---
    const yFooter = 260;
    doc.setTextColor(darkColor);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Colweyz - Livraison Rapide", 14, yFooter);
    
    doc.setFont("helvetica", "normal");
    doc.text("Merci pour votre confiance !", 14, yFooter + 5);

    // Save
    doc.save(`Facture_Colweyz_${order.id}.pdf`);
  },

  sendViaWhatsApp: async (order: Order, driver: boolean = false) => {
     // Generate and download first
     await InvoiceService.generateAndDownload(order);

     // Wait a moment for download to start, then open WhatsApp
     setTimeout(() => {
         const phone = order.clientPhone;
         if (!phone) {
             alert("Pas de numéro de téléphone client disponible.");
             return;
         }
         
         // Standardized phone format
         const cleanPhone = phone.replace(/\D/g, '');
         const formattedPhone = cleanPhone.startsWith('221') ? cleanPhone : `221${cleanPhone}`;
         
         const msg = `Bonjour ${order.clientName}, merci pour votre confiance !\n\nVeuillez trouver ci-joint votre facture pour la commande #${order.id}.\n\nCordialement,\nColweyz`;
         
         const url = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`;
         window.open(url, '_blank');
         
         alert("La facture a été téléchargée.\n\nWhatsApp va s'ouvrir : veuillez joindre le fichier PDF téléchargé à la conversation.");
     }, 1000);
  }
};