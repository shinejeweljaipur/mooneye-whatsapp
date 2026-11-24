// Normalises Indian numbers to WhatsApp format: 91XXXXXXXXXX
export function toWhatsAppNumber(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10) return "91" + d;
  if (d.length === 12 && d.startsWith("91")) return d;
  return null;
}

export async function sendTemplate(to, templateName, params = [], lang = process.env.WA_TEMPLATE_LANG || "en") {
  const url = `https://graph.facebook.com/${process.env.GRAPH_VERSION || "v25.0"}/${process.env.WA_PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: { name: templateName, language: { code: lang } },
  };
  if (params.length) {
    body.template.components = [{
      type: "body",
      parameters: params.map((t) => ({ type: "text", text: String(t) })),
    }];
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) console.error("WhatsApp error:", templateName, to, JSON.stringify(json));
  else console.log("WhatsApp sent:", templateName, to, json.messages?.[0]?.id);
  return { ok: res.ok, json };
}
