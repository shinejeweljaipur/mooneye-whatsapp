// Test endpoint: /api/test-whatsapp?key=YOUR_TEST_KEY&to=98XXXXXXXX&template=TEMPLATE_NAME
import { sendTemplate, toWhatsAppNumber, quickReply } from "../../lib/whatsapp.mjs";

export default async (req) => {
  const u = new URL(req.url);
  if (!process.env.TEST_KEY || u.searchParams.get("key") !== process.env.TEST_KEY) {
    return new Response("Forbidden", { status: 403 });
  }
  const to = toWhatsAppNumber(u.searchParams.get("to"));
  if (!to) return new Response("Invalid number", { status: 400 });

  const e = process.env;
  const template = u.searchParams.get("template") || "hello_world";
  const samples = {
    [e.WA_TEMPLATE_ORDER || "order_confirmation"]: ["Test", "#TEST1001", "Rs. 2499"],
    [e.WA_TEMPLATE_COD || "cod_verification"]: ["Test", "#TEST1001", "Rs. 2499"],
    [e.WA_TEMPLATE_SHIPPING || "shipping_update"]: ["Test", "#TEST1001", "Delhivery", "https://www.delhivery.com/track"],
    [e.WA_TEMPLATE_OUT_FOR_DELIVERY || "out_for_delivery"]: ["Test", "#TEST1001"],
    [e.WA_TEMPLATE_DELIVERED || "order_delivered"]: ["Test", "#TEST1001"],
    [e.WA_TEMPLATE_CANCELLED || "order_cancelled"]: ["Test", "#TEST1001"],
    [e.WA_TEMPLATE_REFUND || "refund_processed"]: ["Test", "Rs. 2499", "#TEST1001"],
    [e.WA_TEMPLATE_ABANDONED || "abandoned_cart"]: ["Test", "Rs. 2499", "https://mooneye.in/cart"],
  };
  const params = samples[template] || [];
  const extra = template === (e.WA_TEMPLATE_COD || "cod_verification")
    ? [quickReply(0, "COD_CONFIRM:0"), quickReply(1, "COD_CANCEL:0")]
    : [];
  const lang = template === "hello_world" ? "en_US" : undefined;

  const result = await sendTemplate(to, template, params, lang, extra);
  return Response.json(result, { status: result.ok ? 200 : 500 });
};

export const config = { path: "/api/test-whatsapp" };
