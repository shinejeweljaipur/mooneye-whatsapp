import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { sendTemplate, toWhatsAppNumber } from "../../lib/whatsapp.mjs";

function validHmac(raw, given) {
  const calc = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(raw, "utf8")
    .digest("base64");
  return !!given && given.length === calc.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(calc));
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text(); // raw body needed for HMAC
  if (!validHmac(raw, req.headers.get("x-shopify-hmac-sha256"))) {
    console.warn("Invalid HMAC");
    return new Response("Unauthorized", { status: 401 });
  }

  // Shopify retries deliveries: skip any webhook already handled
  const webhookId = req.headers.get("x-shopify-webhook-id");
  const store = getStore("processed-webhooks");
  if (webhookId && (await store.get(webhookId))) return new Response("duplicate");
  if (webhookId) await store.set(webhookId, new Date().toISOString());

  const topic = req.headers.get("x-shopify-topic");
  const shop = req.headers.get("x-shopify-shop-domain");
  const p = JSON.parse(raw);
  console.log("Webhook:", topic, shop, p.name || p.id);

  try {
    if (topic === "orders/create") {
      const phone = toWhatsAppNumber(
        p.shipping_address?.phone || p.billing_address?.phone || p.phone || p.customer?.phone
      );
      if (!phone) { console.warn("No valid phone on order", p.name); return new Response("no phone"); }
      await sendTemplate(phone, process.env.WA_TEMPLATE_ORDER || "order_confirmation", [
        p.shipping_address?.first_name || p.customer?.first_name || "there",
        p.name,                                   // e.g. #1023
        `Rs. ${p.total_price}`,
      ]);
    }

    if (topic === "fulfillments/create") {
      const phone = toWhatsAppNumber(p.destination?.phone);
      if (!phone) { console.warn("No valid phone on fulfillment", p.name); return new Response("no phone"); }
      const orderName = String(p.name || "").replace(/\.\d+$/, ""); // "#1023.1" -> "#1023"
      await sendTemplate(phone, process.env.WA_TEMPLATE_SHIPPING || "shipping_update", [
        p.destination?.first_name || "there",
        orderName,
        p.tracking_company || "our courier partner",
        p.tracking_url || p.tracking_number || "will be shared shortly",
      ]);
    }
  } catch (err) {
    console.error("Handler error:", err);
  }

  // Always answer 200 fast so Shopify does not keep retrying
  return new Response("ok");
};

export const config = { path: "/webhooks/shopify" };
