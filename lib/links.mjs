// Short links used by WhatsApp URL buttons: https://<site>/o/<id>, /t/<id>, /c/<id>
import { getStore } from "@netlify/blobs";

export async function saveLink(type, id, url) {
  if (!url) return;
  await getStore("links").set(`${type}-${id}`, url);
}

export async function getLink(type, id) {
  return getStore("links").get(`${type}-${id}`);
}
