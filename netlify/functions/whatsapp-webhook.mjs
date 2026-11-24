// Receives customer replies from WhatsApp (Meta webhook).
// Handles the COD verification buttons: Confirm / Cancel.
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { sendText } from "../../lib/whatsapp.mjs";
import { addOrderTags } from "../../lib/shopify.mjs";

function validMetaSignature(raw, header) {
  if (!process.env.META_APP_SECRET) return false;
  const calc = "sha256=" + crypto.createHmac("sha256", process.env.META_APP_SECRET).update(raw, "utf8").digest("hex");
  return !!header && header.length === calc.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(calc));
}

export default async (req) => {
  const u = new URL(req.url);

  // Meta "Verify and save" check
  if (req.method === "GET") {
    if (u.searchParams.get("hub.mode") === "subscribe" &&
        u.searchParams.get("hub.verify_token") === process.env.WA_VERIFY_TOKEN) {
      return new Response(u.searchParams.get("hub.challenge") || "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();
  if (!validMetaSignature(raw, req.headers.get("x-hub-signature-256"))) {
    console.warn("Invalid Meta signature");
    return new Response("Unauthorized", { status: 401 });
  }

  const body = JSON.parse(raw);
  const seen = getStore("processed-wa-messages");
  const codOrders = getStore("cod-orders");

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      for (const msg of change.value?.messages || []) {
        try {
          if (await seen.get(msg.id)) continue;
          await seen.set(msg.id, "1");

          const payload = msg.button?.payload || msg.interactive?.button_reply?.id || "";
          const m = payload.match(/^COD_(CONFIRM|CANCEL):(\d+)$/);
          if (!m) { console.log("Incoming message (not a COD reply):", msg.type, msg.from); continue; }

          const [, action, orderId] = m;
          const order = await codOrders.get(orderId, { type: "json" });
          if (!order) { console.warn("Unknown COD order", orderId); continue; }
          if (order.phone !== msg.from) { console.warn("Reply from a different number for order", orderId); continue; }
          if (order.status) {
            await sendText(msg.from, `Your response for order ${order.name} is already recorded. Thank you!`);
            continue;
          }

          if (action === "CONFIRM") {
            await addOrderTags(order.shop, orderId, ["COD Confirmed"]);
            await sendText(msg.from, `Thank you ${order.firstName}! ✅ Your order *${order.name}* is confirmed. We will notify you once it ships.`);
          } else {
            await addOrderTags(order.shop, orderId, ["COD Cancel Requested"]);
            await sendText(msg.from, `We have received your cancellation request for order *${order.name}*. Our team will process it shortly.`);
          }
          await codOrders.setJSON(orderId, { ...order, status: action, respondedAt: Date.now() });
          console.log("COD reply:", action, order.name);
        } catch (err) {
          console.error("WhatsApp webhook error:", err);
        }
      }
    }
  }
  return new Response("ok");
};

export const config = { path: "/webhooks/whatsapp" };
