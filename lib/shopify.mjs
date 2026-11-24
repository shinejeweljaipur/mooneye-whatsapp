import { getStore } from "@netlify/blobs";

const API_VERSION = "2026-10";

// Admin API token via client credentials grant (cached until shortly before expiry)
export async function getAdminToken(shop) {
  const cache = getStore("shopify-tokens");
  const cached = await cache.get(shop, { type: "json" });
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) return cached.token;

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new Error("Shopify token error: " + JSON.stringify(json));
  const expiresIn = Number(json.expires_in || 3600) * 1000;
  await cache.setJSON(shop, { token: json.access_token, expiresAt: Date.now() + expiresIn });
  return json.access_token;
}

export async function adminGraphQL(shop, query, variables = {}) {
  const token = await getAdminToken(shop);
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) console.error("Shopify GraphQL errors:", JSON.stringify(json.errors));
  return json.data;
}

// Product image for the WhatsApp header (falls back to DEFAULT_IMAGE_URL)
export async function getProductImage(shop, productId) {
  const fallback = process.env.DEFAULT_IMAGE_URL || null;
  if (!shop || !productId) return fallback;
  try {
    const cache = getStore("product-images");
    const hit = await cache.get(String(productId));
    if (hit) return hit;
    const data = await adminGraphQL(shop, `
      query ($id: ID!) {
        product(id: $id) {
          featuredMedia { preview { image { url } } }
        }
      }`, { id: `gid://shopify/Product/${productId}` });
    let url = data?.product?.featuredMedia?.preview?.image?.url;
    if (url) {
      // Ask Shopify CDN for a JPG around 800px (WhatsApp accepts JPG/PNG only)
      const u = new URL(url);
      u.searchParams.set("width", "800");
      u.searchParams.set("format", "jpg");
      url = u.toString();
      await cache.set(String(productId), url);
      return url;
    }
  } catch (err) {
    console.error("Product image lookup failed:", err.message);
  }
  return fallback;
}

export async function getOrderInfo(shop, orderId) {
  const data = await adminGraphQL(shop, `
    query ($id: ID!) {
      order(id: $id) {
        name
        phone
        statusPageUrl
        customer { firstName phone }
        shippingAddress { firstName phone }
        billingAddress { firstName phone }
        lineItems(first: 1) { nodes { product { id } } }
      }
    }`, { id: `gid://shopify/Order/${orderId}` });
  const o = data?.order;
  if (!o) return null;
  const gid = o.lineItems?.nodes?.[0]?.product?.id || "";
  return {
    name: o.name,
    firstName: o.shippingAddress?.firstName || o.billingAddress?.firstName || o.customer?.firstName || "there",
    phone: o.shippingAddress?.phone || o.billingAddress?.phone || o.phone || o.customer?.phone,
    statusUrl: o.statusPageUrl,
    productId: gid.split("/").pop() || null,
  };
}

export async function addOrderTags(shop, orderId, tags) {
  const data = await adminGraphQL(shop, `
    mutation ($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
    }`, { id: `gid://shopify/Order/${orderId}`, tags });
  const errs = data?.tagsAdd?.userErrors;
  if (errs?.length) console.error("tagsAdd errors:", JSON.stringify(errs));
  return !errs?.length;
}
