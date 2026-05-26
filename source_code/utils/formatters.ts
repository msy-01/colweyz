
/**
 * Formats a number as FCFA with space as thousands separator.
 * Uses a regular space instead of a non-breaking space to avoid rendering issues in PDFs (slashes).
 */
export const formatFCFA = (amount: number): string => {
  if (amount === undefined || amount === null || isNaN(amount)) return "0 F CFA";
  
  // Use a regular space " " as thousands separator
  const formatted = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    
  return `${formatted} F CFA`;
};

/**
 * Formats a number with space as thousands separator without currency.
 */
export const formatNumber = (amount: number): string => {
  if (amount === undefined || amount === null || isNaN(amount)) return "0";
  
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};
