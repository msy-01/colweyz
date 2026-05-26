export const parseProductCommand = (rawLine: string) => {
  if (!rawLine) return { quantity: 1, productName: '' };
  
  // Take the first line if there are multiple lines
  const firstLine = rawLine.split('\n')[0].trim();
  
  // Formats possibles : "1 X Protège Perruque", "2x Sony WH-1000XM4", 
  //                     "1X Magic Brosse", "(3 x) Bose QC Ultra", "3xBose"
  const match = firstLine.match(/^(?:\(?(\d+)\s*[xX]\s*\)?)\s*(.+)$/);
  
  if (match) {
    return {
      quantity: parseInt(match[1], 10),   
      productName: match[2].trim()     
    };
  }
  
  // Si pas de quantité détectée → quantité = 1, nom = ligne entière
  return {
    quantity: 1,
    productName: firstLine
  };
};
