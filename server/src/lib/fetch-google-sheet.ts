/** Télécharge un export CSV Google Sheets (redirections 307 + User-Agent). */
export async function fetchGoogleSheetCsv(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; ColWeyz/1.0; +https://colweyz.local)',
      Accept: 'text/csv,text/plain,*/*',
    },
    signal: AbortSignal.timeout(30_000),
  });

  const finalUrl = response.url || url;
  if (finalUrl.includes('accounts.google.com')) {
    throw new Error('Accès refusé. Le Google Sheet doit être public (lecture pour toute personne avec le lien).');
  }

  if (!response.ok) {
    throw new Error(`Impossible de télécharger le Sheet (HTTP ${response.status}).`);
  }

  const csvText = await response.text();
  if (csvText.trim().startsWith('<!DOCTYPE html>') || csvText.includes('<html')) {
    throw new Error('Le lien ne renvoie pas un CSV. Vérifiez le partage du fichier.');
  }

  return csvText;
}
