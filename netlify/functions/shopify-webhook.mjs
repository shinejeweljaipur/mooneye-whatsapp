import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { sendTemplate, toWhatsAppNumber, quickReply } from "../../lib/whatsapp.mjs";
import { getOrderContact } from "../../lib/shopify.mjs";

// Template names (can be overridden in Netlify environment variables)
const T = {
  confirmed: process.env.WA_TEMPLATE_ORDER || "order_confirmation",
  cod: process.env.WA_TEMPLATE_COD || "cod_verification",
  shipped: process.env.WA_TEMPLATE_SHIPPING || "shipping_update",
  outForDelivery: process.env.WA_TEMPLATE_OUT_FOR_DELIVERY || "out_for_delivery",
  delivered: process.env.WA_TEMPLATE_DELIVERED || "order_delivered",
  cancelled: process.env.WA_TEMPLATE_CANCELLED || "order_cancelled",
  refund: process.env.WA_TEMPLATE_REFUND || "refund_processed",
};

function validHmac(raw, given) {
  const calc = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(raw, "utf8")
    .digest("base64");
  return !!given && given.length === calc.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(calc));
}

const orderPhone = (o) =>
  toWhatsAppNumber(o.shipping_address?.phone || o.billing_address?.phone || o.phone || o.customer?.phone);
const firstName = (o) =>
  o.shipping_address?.first_name || o.billing_address?.first_name || o.customer?.first_name || "there";
const fulfillmentOrderName = (f) => String(f.name || "").replace(/\.\d+$/, ""); // "#1023.1" -> "#1023"
const isCOD = (o) =>
  [...(o.payment_gateway_names || []), o.gateway || ""].some((g) => /cash on delivery|\bcod\b/i.test(g));

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();
  if (!validHmac(raw, req.headers.get("x-shopify-hmac-sha256"))) {
    console.warn("Invalid HMAC");
    return new Response("Unauthorized", { status: 401 });
  }

  const store = getStore("processed-webhooks");

  // Shopify retries deliveries: skip any webhook already handled
  const webhookId = req.headers.get("x-shopify-webhook-id");
  if (webhookId && (await store.get(webhookId))) return new Response("duplicate");
  if (webhookId) await store.set(webhookId, new Date().toISOString());

  // Send each customer message only once per order/fulfillment + event
  async function once(key, fn) {
    const k = `sent:${key}`;
    if (await store.get(k)) { console.log("Already sent", key); return; }
    const r = await fn();
    if (r?.ok) await store.set(k, new Date().toISOString());
    return r;
  }

  const topic = req.headers.get("x-shopify-topic");
  const shop = req.headers.get("x-shopify-shop-domain");
  const p = JSON.parse(raw);
  console.log("Webhook:", topic, shop, p.name || p.id || p.token, p.shipment_status || "");

  try {
    // 1. New order: COD -> verification message with buttons, prepaid -> confirmation
    if (topic === "orders/create") {
      // Order placed, so the checkout is no longer abandoned
      if (p.checkout_token) await getStore("checkouts").delete(p.checkout_token);

      const phone = orderPhone(p);
      if (!phone) { console.warn("No valid phone on order", p.name); return new Response("no phone"); }

      if (isCOD(p) && process.env.COD_VERIFICATION !== "off") {
        await getStore("cod-orders").setJSON(String(p.id), {
          shop, phone, name: p.name, firstName: firstName(p), createdAt: Date.now(),
        });
        await once(`${p.id}:cod`, () =>
          sendTemplate(phone, T.cod, [firstName(p), p.name, `Rs. ${p.total_price}`], undefined, [
            quickReply(0, `COD_CONFIRM:${p.id}`),
            quickReply(1, `COD_CANCEL:${p.id}`),
          ]));
      } else {
        await once(`${p.id}:confirmed`, () =>
          sendTemplate(phone, T.confirmed, [firstName(p), p.name, `Rs. ${p.total_price}`]));
      }
    }

    // 2. Order cancelled
    if (topic === "orders/cancelled") {
      const phone = orderPhone(p);
      if (!phone) { console.warn("No valid phone on cancelled order", p.name); return new Response("no phone"); }
      await once(`${p.id}:cancelled`, () =>
        sendTemplate(phone, T.cancelled, [firstName(p), p.name]));
    }

    // 3. Order shipped (fulfillment created)
    if (topic === "fulfillments/create") {
      const phone = toWhatsAppNumber(p.destination?.phone);
      if (!phone) { console.warn("No valid phone on fulfillment", p.name); return new Response("no phone"); }
      await once(`${p.id}:shipped`, () =>
        sendTemplate(phone, T.shipped, [
          p.destination?.first_name || "there",
          fulfillmentOrderName(p),
          p.tracking_company || "our courier partner",
          p.tracking_url || p.tracking_number || "will be shared shortly",
        ]));
    }

    // 4. Out for delivery / 5. Delivered (shipment status updated by the courier)
    if (topic === "fulfillments/update") {
      const phone = toWhatsAppNumber(p.destination?.phone);
      const name = p.destination?.first_name || "there";
      const orderName = fulfillmentOrderName(p);
      if (phone && p.shipment_status === "out_for_delivery") {
        await once(`${p.id}:out_for_delivery`, () => sendTemplate(phone, T.outForDelivery, [name, orderName]));
      }
      if (phone && p.shipment_status === "delivered") {
        await once(`${p.id}:delivered`, () => sendTemplate(phone, T.delivered, [name, orderName]));
      }
    }

    // 6. Refund processed (payload has no phone -> look up the order)
    if (topic === "refunds/create") {
      const amount = (p.transactions || [])
        .filter((t) => t.kind === "refund" && t.status === "success")
        .reduce((s, t) => s + Number(t.amount || 0), 0);
      if (amount > 0) {
        const c = await getOrderContact(shop, p.order_id);
        const phone = toWhatsAppNumber(c?.phone);
        if (!phone) { console.warn("No valid phone for refund on order", p.order_id); return new Response("no phone"); }
        await once(`refund:${p.id}`, () =>
          sendTemplate(phone, T.refund, [c.firstName, `Rs. ${amount.toFixed(2)}`, c.name]));
      }
    }

    // 7. Abandoned checkout tracking (reminder is sent later by the abandoned-cart scheduled function)
    if (topic === "checkouts/create" || topic === "checkouts/update") {
      const checkouts = getStore("checkouts");
      if (p.completed_at) {
        await checkouts.delete(p.token);
      } else {
        const phone = toWhatsAppNumber(p.shipping_address?.phone || p.billing_address?.phone || p.phone || p.customer?.phone);
        if (phone && p.abandoned_checkout_url && Number(p.line_items?.length || 0) > 0) {
          const prev = await checkouts.get(p.token, { type: "json" });
          await checkouts.setJSON(p.token, {
            phone,
            firstName: p.shipping_address?.first_name || p.billing_address?.first_name || p.customer?.first_name || "there",
            url: p.abandoned_checkout_url,
            total: p.total_price,
            updatedAt: Date.now(),
            reminded: prev?.reminded || false,
          });
        }
      }
    }
  } catch (err) {
    console.error("Handler error:", err);
  }

  return new Response("ok");
};

export const config = { path: "/webhooks/shopify" };
