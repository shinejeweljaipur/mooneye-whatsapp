// Test endpoint: /api/test-whatsapp?key=YOUR_TEST_KEY&to=98XXXXXXXX&template=TEMPLATE_NAME
import { sendRich, toWhatsAppNumber } from "../../lib/whatsapp.mjs";

export default async (req) => {
  const u = new URL(req.url);
  if (!process.env.TEST_KEY || u.searchParams.get("key") !== process.env.TEST_KEY) {
    return new Response("Forbidden", { status: 403 });
  }
  const to = toWhatsAppNumber(u.searchParams.get("to"));
  if (!to) return new Response("Invalid number", { status: 400 });

  const e = process.env;
  const image = u.searchParams.get("image") || e.DEFAULT_IMAGE_URL;
  const template = u.searchParams.get("template") || "hello_world";
  const samples = {
    [e.WA_TEMPLATE_ORDER || "mooneye_order_confirmed"]: { image, body: ["Test", "#TEST1001", "Rs. 2,499"], buttons: [{ url: "test" }] },
    [e.WA_TEMPLATE_COD || "mooneye_cod_verify"]: { image, body: ["Test", "#TEST1001", "Rs. 2,499"], buttons: [{ payload: "COD_CONFIRM:0" }, { payload: "COD_CANCEL:0" }] },
    [e.WA_TEMPLATE_SHIPPING || "mooneye_shipped"]: { image, body: ["Test", "#TEST1001", "Delhivery"], buttons: [{ url: "test" }] },
    [e.WA_TEMPLATE_OUT_FOR_DELIVERY || "mooneye_out_for_delivery"]: { image, body: ["Test", "#TEST1001"], buttons: [{ url: "test" }] },
    [e.WA_TEMPLATE_DELIVERED || "mooneye_delivered"]: { image, body: ["Test", "#TEST1001"], buttons: [null] },
    [e.WA_TEMPLATE_CANCELLED || "mooneye_cancelled"]: { image, body: ["Test", "#TEST1001"], buttons: [null] },
    [e.WA_TEMPLATE_REFUND || "mooneye_refund"]: { image, body: ["Test", "Rs. 2,499", "#TEST1001"], buttons: [{ url: "test" }] },
    [e.WA_TEMPLATE_ABANDONED || "mooneye_cart_reminder"]: { image, body: ["Test", "Rs. 2,499"], buttons: [{ url: "test" }] },
  };
  const opts = samples[template] || {};
  if (template === "hello_world") opts.lang = "en_US";

  const result = await sendRich(to, template, opts);
  return Response.json(result, { status: result.ok ? 200 : 500 });
};

export const config = { path: "/api/test-whatsapp" };
