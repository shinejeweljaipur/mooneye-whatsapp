import { fbLogMessage } from "./firebase.mjs";

// Normalises Indian numbers to WhatsApp format: 91XXXXXXXXXX
export function toWhatsAppNumber(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10) return "91" + d;
  if (d.length === 12 && d.startsWith("91")) return d;
  return null;
}

const graphUrl = () =>
  `https://graph.facebook.com/${process.env.GRAPH_VERSION || "v25.0"}/${process.env.WA_PHONE_NUMBER_ID}/messages`;

async function post(body, label, meta = {}) {
  const res = await fetch(graphUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  const json = await res.json();
  if (!res.ok) console.error("WhatsApp error:", label, body.to, JSON.stringify(json));
  else console.log("WhatsApp sent:", label, body.to, json.messages?.[0]?.id);
  await fbLogMessage({
    ...meta,
    to: body.to,
    template: label,
    ok: res.ok,
    messageId: json.messages?.[0]?.id || null,
    error: res.ok ? null : (json.error?.message || "unknown error"),
  });
  return { ok: res.ok, json };
}

/**
 * Rich template message.
 * opts.image   - public image URL for an IMAGE header (template must have an image header)
 * opts.body    - array of body variable values ({{1}}, {{2}}, ...)
 * opts.buttons - array of button params, in button order:
 *                { url: "suffix" }        dynamic URL button  (https://.../{{1}})
 *                { payload: "TEXT" }      quick-reply button
 *                null                     static button (no parameter)
 * opts.lang    - language code (default WA_TEMPLATE_LANG or "en")
 * opts.meta    - extra info saved in the Firebase message log, e.g. { orderId, orderName, event }
 */
export function sendRich(to, templateName, opts = {}) {
  const components = [];
  if (opts.image) {
    components.push({ type: "header", parameters: [{ type: "image", image: { link: opts.image } }] });
  }
  if (opts.body?.length) {
    components.push({ type: "body", parameters: opts.body.map((t) => ({ type: "text", text: String(t) })) });
  }
  (opts.buttons || []).forEach((b, i) => {
    if (!b) return;
    if (b.url !== undefined) {
      components.push({ type: "button", sub_type: "url", index: String(i), parameters: [{ type: "text", text: String(b.url) }] });
    } else if (b.payload !== undefined) {
      components.push({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload: String(b.payload) }] });
    }
  });
  const template = {
    name: templateName,
    language: { code: opts.lang || process.env.WA_TEMPLATE_LANG || "en" },
  };
  if (components.length) template.components = components;
  return post({ to, type: "template", template }, templateName, opts.meta);
}

// Plain text (only allowed within 24 hours of the customer's last message)
export function sendText(to, text, meta = {}) {
  return post({ to, type: "text", text: { body: text } }, "text", meta);
}
