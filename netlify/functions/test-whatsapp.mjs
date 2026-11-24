// Test endpoint: /api/test-whatsapp?key=YOUR_TEST_KEY&to=98XXXXXXXX&template=hello_world
import { sendTemplate, toWhatsAppNumber } from "../../lib/whatsapp.mjs";

export default async (req) => {
  const u = new URL(req.url);
  if (!process.env.TEST_KEY || u.searchParams.get("key") !== process.env.TEST_KEY) {
    return new Response("Forbidden", { status: 403 });
  }
  const to = toWhatsAppNumber(u.searchParams.get("to"));
  if (!to) return new Response("Invalid number", { status: 400 });

  const template = u.searchParams.get("template") || "hello_world";
  let params = [];
  let lang;
  if (template === "hello_world") lang = "en_US";
  if (template === (process.env.WA_TEMPLATE_ORDER || "order_confirmation")) params = ["Test", "#TEST1001", "Rs. 2499"];
  if (template === (process.env.WA_TEMPLATE_SHIPPING || "shipping_update")) params = ["Test", "#TEST1001", "Delhivery", "https://www.delhivery.com/track"];

  const result = await sendTemplate(to, template, params, lang);
  return Response.json(result, { status: result.ok ? 200 : 500 });
};

export const config = { path: "/api/test-whatsapp" };
