import { Product } from "../types";

export const trouverProduitShopify = (nomCommande: string, produitsShopify: Product[]): Product | null => {
  if (!nomCommande) return null;
  const nom = nomCommande.trim().toLowerCase();

  // Niveau 1 : correspondance exacte (insensible à la casse)
  let trouve = produitsShopify.find(p => 
    p.title.trim().toLowerCase() === nom
  );
  if (trouve) return trouve;

  // Niveau 2 : le nom Shopify contient le nom de la commande
  trouve = produitsShopify.find(p => 
    p.title.trim().toLowerCase().includes(nom)
  );
  if (trouve) return trouve;

  // Niveau 3 : le nom de la commande contient le nom Shopify
  trouve = produitsShopify.find(p => 
    nom.includes(p.title.trim().toLowerCase())
  );
  if (trouve) return trouve;

  // Niveau 4 : correspondance par mots-clés (tous les mots du nom trouvés)
  const mots = nom.split(/\s+/).filter(m => m.length > 2);
  if (mots.length > 0) {
    trouve = produitsShopify.find(p => {
      const nomShopify = p.title.trim().toLowerCase();
      return mots.every(mot => nomShopify.includes(mot));
    });
    if (trouve) return trouve;
  }

  // Aucune correspondance → retourner null
  return null;
};
