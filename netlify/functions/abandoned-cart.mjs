// Runs every hour: sends one WhatsApp reminder for checkouts left unfinished.
import { getStore } from "@netlify/blobs";
import { sendRich } from "../../lib/whatsapp.mjs";
import { getProductImage } from "../../lib/shopify.mjs";

const TEMPLATE = process.env.WA_TEMPLATE_ABANDONED || "mooneye_cart_reminder";
const DELAY_MIN = Number(process.env.ABANDONED_DELAY_MINUTES || 60); // wait before reminding
const MAX_AGE_H = 48;                                                  // forget after this

export default async () => {
  if (process.env.ABANDONED_CART === "off") return;
  const checkouts = getStore("checkouts");
  const { blobs } = await checkouts.list();
  const now = Date.now();
  let sent = 0;

  for (const { key } of blobs) {
    const c = await checkouts.get(key, { type: "json" });
    if (!c) continue;
    const ageMin = (now - c.updatedAt) / 60000;
    if (ageMin > MAX_AGE_H * 60) { await checkouts.delete(key); continue; }
    if (c.reminded || ageMin < DELAY_MIN) continue;

    const image = await getProductImage(c.shop, c.productId);
    const r = await sendRich(c.phone, TEMPLATE, {
      image,
      body: [c.firstName, `Rs. ${Number(c.total || 0).toLocaleString("en-IN")}`],
      buttons: [{ url: key }],                            // Complete Order -> /c/<checkoutToken>
    });
    await checkouts.setJSON(key, { ...c, reminded: true, remindedAt: now, reminderOk: r.ok });
    if (r.ok) sent++;
  }
  console.log(`Abandoned cart run: ${blobs.length} tracked, ${sent} reminders sent`);
};

export const config = { schedule: "@hourly" };
