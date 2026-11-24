import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { sendRich, toWhatsAppNumber } from "../../lib/whatsapp.mjs";
import { getOrderInfo, getProductImage } from "../../lib/shopify.mjs";
import { saveLink, getLink } from "../../lib/links.mjs";

// Rich template names (override in Netlify environment variables if yours differ)
const T = {
  confirmed: process.env.WA_TEMPLATE_ORDER || "mooneye_order_confirmed",
  cod: process.env.WA_TEMPLATE_COD || "mooneye_cod_verify",
  shipped: process.env.WA_TEMPLATE_SHIPPING || "mooneye_shipped",
  outForDelivery: process.env.WA_TEMPLATE_OUT_FOR_DELIVERY || "mooneye_out_for_delivery",
  delivered: process.env.WA_TEMPLATE_DELIVERED || "mooneye_delivered",
  cancelled: process.env.WA_TEMPLATE_CANCELLED || "mooneye_cancelled",
  refund: process.env.WA_TEMPLATE_REFUND || "mooneye_refund",
};

function validHmac(raw, given) {
  const calc = crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(raw, "utf8").digest("base64");
  return !!given && given.length === calc.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(calc));
}

const orderPhone = (o) =>
  toWhatsAppNumber(o.shipping_address?.phone || o.billing_address?.phone || o.phone || o.customer?.phone);
const firstName = (o) =>
  o.shipping_address?.first_name || o.billing_address?.first_name || o.customer?.first_name || "there";
const fulfillmentOrderName = (f) => String(f.name || "").replace(/\.\d+$/, ""); // "#1023.1" -> "#1023"
const firstProductId = (o) => (o.line_items || []).find((li) => li.product_id)?.product_id;
const money = (v) => `Rs. ${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
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
    // 1. New order: COD -> verification with Confirm/Cancel buttons, prepaid -> confirmation
    if (topic === "orders/create") {
      if (p.checkout_token) await getStore("checkouts").delete(p.checkout_token);
      await saveLink("o", p.id, p.order_status_url);

      const phone = orderPhone(p);
      if (!phone) { console.warn("No valid phone on order", p.name); return new Response("no phone"); }
      const image = await getProductImage(shop, firstProductId(p));

      if (isCOD(p) && process.env.COD_VERIFICATION !== "off") {
        await getStore("cod-orders").setJSON(String(p.id), {
          shop, phone, name: p.name, firstName: firstName(p), createdAt: Date.now(),
        });
        await once(`${p.id}:cod`, () => sendRich(phone, T.cod, {
          image,
          body: [firstName(p), p.name, money(p.total_price)],
          buttons: [{ payload: `COD_CONFIRM:${p.id}` }, { payload: `COD_CANCEL:${p.id}` }],
        }));
      } else {
        await once(`${p.id}:confirmed`, () => sendRich(phone, T.confirmed, {
          image,
          body: [firstName(p), p.name, money(p.total_price)],
          buttons: [{ url: p.id }],                       // View Order -> /o/<orderId>
        }));
      }
    }

    // 2. Order cancelled
    if (topic === "orders/cancelled") {
      const phone = orderPhone(p);
      if (!phone) { console.warn("No valid phone on cancelled order", p.name); return new Response("no phone"); }
      const image = await getProductImage(shop, firstProductId(p));
      await once(`${p.id}:cancelled`, () => sendRich(phone, T.cancelled, {
        image,
        body: [firstName(p), p.name],
        buttons: [null],                                  // static "Shop Again" button
      }));
    }

    // 3. Shipped (fulfillment created)
    if (topic === "fulfillments/create") {
      const phone = toWhatsAppNumber(p.destination?.phone);
      if (!phone) { console.warn("No valid phone on fulfillment", p.name); return new Response("no phone"); }
      const tracking = p.tracking_url || (p.tracking_urls || [])[0] || (await getLink("o", p.order_id));
      await saveLink("t", p.id, tracking);
      const image = await getProductImage(shop, firstProductId(p));
      await once(`${p.id}:shipped`, () => sendRich(phone, T.shipped, {
        image,
        body: [p.destination?.first_name || "there", fulfillmentOrderName(p), p.tracking_company || "our courier partner"],
        buttons: [{ url: p.id }],                         // Track Shipment -> /t/<fulfillmentId>
      }));
    }

    // 4. Out for delivery / 5. Delivered (shipment status updated by the courier)
    if (topic === "fulfillments/update") {
      const phone = toWhatsAppNumber(p.destination?.phone);
      const name = p.destination?.first_name || "there";
      const orderName = fulfillmentOrderName(p);
      if (phone && (p.shipment_status === "out_for_delivery" || p.shipment_status === "delivered")) {
        const tracking = p.tracking_url || (p.tracking_urls || [])[0];
        if (tracking) await saveLink("t", p.id, tracking);
        const image = await getProductImage(shop, firstProductId(p));
        if (p.shipment_status === "out_for_delivery") {
          await once(`${p.id}:out_for_delivery`, () => sendRich(phone, T.outForDelivery, {
            image, body: [name, orderName], buttons: [{ url: p.id }],   // Track Shipment
          }));
        } else {
          await once(`${p.id}:delivered`, () => sendRich(phone, T.delivered, {
            image, body: [name, orderName], buttons: [null],          // static "Shop Again"
          }));
        }
      }
    }

    // 6. Refund processed (payload has no phone -> look up the order)
    if (topic === "refunds/create") {
      const amount = (p.transactions || [])
        .filter((t) => t.kind === "refund" && t.status === "success")
        .reduce((s, t) => s + Number(t.amount || 0), 0);
      if (amount > 0) {
        const o = await getOrderInfo(shop, p.order_id);
        const phone = toWhatsAppNumber(o?.phone);
        if (!phone) { console.warn("No valid phone for refund on order", p.order_id); return new Response("no phone"); }
        if (!(await getLink("o", p.order_id))) await saveLink("o", p.order_id, o.statusUrl);
        const image = await getProductImage(shop, o.productId);
        await once(`refund:${p.id}`, () => sendRich(phone, T.refund, {
          image,
          body: [o.firstName, money(amount), o.name],
          buttons: [{ url: p.order_id }],                 // View Order -> /o/<orderId>
        }));
      }
    }

    // 7. Abandoned checkout tracking (reminder sent later by the abandoned-cart scheduled function)
    if (topic === "checkouts/create" || topic === "checkouts/update") {
      const checkouts = getStore("checkouts");
      if (p.completed_at) {
        await checkouts.delete(p.token);
      } else {
        const phone = toWhatsAppNumber(p.shipping_address?.phone || p.billing_address?.phone || p.phone || p.customer?.phone);
        if (phone && p.abandoned_checkout_url && Number(p.line_items?.length || 0) > 0) {
          const prev = await checkouts.get(p.token, { type: "json" });
          await saveLink("c", p.token, p.abandoned_checkout_url);
          await checkouts.setJSON(p.token, {
            shop,
            phone,
            firstName: p.shipping_address?.first_name || p.billing_address?.first_name || p.customer?.first_name || "there",
            total: p.total_price,
            productId: firstProductId(p) || null,
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
