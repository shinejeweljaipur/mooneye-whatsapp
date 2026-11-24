// Redirects WhatsApp button taps to the real page:
//   /o/<orderId>        -> Shopify order status page
//   /t/<fulfillmentId>  -> courier tracking page
//   /c/<checkoutToken>  -> abandoned checkout (complete your order)
import { getLink } from "../../lib/links.mjs";

export default async (req) => {
  const [, type, id] = new URL(req.url).pathname.split("/");
  const target = id ? await getLink(type, id) : null;
  return Response.redirect(target || process.env.STORE_URL || "https://mooneye.in", 302);
};

export const config = { path: ["/o/:id", "/t/:id", "/c/:id"] };
