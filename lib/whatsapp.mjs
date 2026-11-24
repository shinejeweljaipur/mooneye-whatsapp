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

async function post(body, label) {
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
  return { ok: res.ok, json };
}

// Template message (works any time; needs an approved template)
// extraComponents: e.g. quick-reply button payloads
export function sendTemplate(to, templateName, params = [], lang, extraComponents = []) {
  const components = [];
  if (params.length) {
    components.push({
      type: "body",
      parameters: params.map((t) => ({ type: "text", text: String(t) })),
    });
  }
  components.push(...extraComponents);
  const template = {
    name: templateName,
    language: { code: lang || process.env.WA_TEMPLATE_LANG || "en" },
  };
  if (components.length) template.components = components;
  return post({ to, type: "template", template }, templateName);
}

// Plain text (only allowed within 24 hours of the customer's last message)
export function sendText(to, text) {
  return post({ to, type: "text", text: { body: text } }, "text");
}

// Quick-reply button payload component for a template
export const quickReply = (index, payload) => ({
  type: "button",
  sub_type: "quick_reply",
  index: String(index),
  parameters: [{ type: "payload", payload }],
});
