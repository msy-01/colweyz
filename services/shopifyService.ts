import { Product, ProductVariant, ProductImage } from '../types';

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  created_at: string;
  updated_at: string;
  tags: string;
  status: string;
  variants: {
    id: number;
    product_id: number;
    title: string;
    sku: string;
    price: string;
    inventory_quantity: number;
    weight: number;
    weight_unit: string;
  }[];
  images: {
    id: number;
    src: string;
    alt: string | null;
  }[];
}

interface ShopifyResponse {
  products: ShopifyProduct[];
}

export const ShopifyService = {
  fetchProducts: async (shopDomain: string, accessToken: string): Promise<Product[]> => {
    try {
      // Use local proxy to avoid CORS issues
      const response = await fetch('/api/shopify/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shopDomain, accessToken }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Shopify API Error: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const data: ShopifyResponse = await response.json();

      return data.products
        .filter(p => p.status === 'active' || p.status === 'actif') // Only active products
        .map(sp => ({
        id: sp.id.toString(),
        title: sp.title,
        description: sp.body_html,
        vendor: sp.vendor,
        productType: sp.product_type,
        createdAt: sp.created_at,
        updatedAt: sp.updated_at,
        tags: sp.tags ? sp.tags.split(',').map(t => t.trim()) : [],
        status: sp.status as 'active' | 'archived' | 'draft',
        totalInventory: sp.variants.reduce((acc, v) => acc + v.inventory_quantity, 0),
        variants: sp.variants.map(v => ({
          id: v.id.toString(),
          productId: v.product_id.toString(),
          title: v.title,
          sku: v.sku,
          price: parseFloat(v.price),
          inventoryQuantity: v.inventory_quantity,
          weight: v.weight,
          weightUnit: v.weight_unit
        })),
        images: sp.images.map(img => ({
          id: img.id.toString(),
          src: img.src,
          alt: img.alt || undefined
        }))
      }));

    } catch (error) {
      console.error("Failed to fetch Shopify products:", error);
      throw error;
    }
  }
};
