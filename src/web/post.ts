// The web host's HTTP call for licence activation, built on fetch.

import type { Post } from "../engine/license-online";

export const fetchPost: Post = async ({ url, contentType, body }) => {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": contentType, Accept: "application/json" }, body });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
};
