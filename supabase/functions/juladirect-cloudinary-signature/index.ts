import { createClient } from "npm:@supabase/supabase-js@2";

const CLOUDINARY_PRESET = "juladirect_product_images";
const CLOUDINARY_FOLDER = "juladirect/products";
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

function jsonResponse(body, status, origin) {
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (origin && isAllowedOrigin(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin === "https://juladirect.pages.dev") return true;
  if (/^https:\/\/[a-z0-9-]+\.juladirect\.pages\.dev$/i.test(origin)) return true;
  return /^http:\/\/localhost(?::\d+)?$/i.test(origin);
}

function readDefaultSecret(name) {
  const value = Deno.env.get(name);
  if (value) return value;
  return "";
}

function readDefaultKeyMap(name) {
  try {
    const raw = Deno.env.get(name) || "{}";
    const parsed = JSON.parse(raw);
    return typeof parsed.default === "string" ? parsed.default : "";
  } catch {
    return "";
  }
}

async function cloudinarySignature(parameters, apiSecret) {
  const canonical = Object.entries(parameters)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&") + apiSecret;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Origin is not allowed." }, 403, "");
  if (request.method === "OPTIONS") return jsonResponse({ ok: true }, 200, origin);
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, origin);

  try {
    const authorization = request.headers.get("authorization") || "";
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) return jsonResponse({ error: "Sign in before uploading product photos." }, 401, origin);

    const supabaseUrl = readDefaultSecret("SUPABASE_URL");
    const publishableKey = readDefaultSecret("SUPABASE_ANON_KEY") || readDefaultKeyMap("SUPABASE_PUBLISHABLE_KEYS");
    const serviceRoleKey = readDefaultSecret("SUPABASE_SERVICE_ROLE_KEY") || readDefaultKeyMap("SUPABASE_SECRET_KEYS");
    if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
      return jsonResponse({ error: "The secure upload service is not configured." }, 503, origin);
    }

    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData?.user) return jsonResponse({ error: "Your sign-in session is invalid or expired." }, 401, origin);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: roleRows, error: roleError } = await adminClient
      .from("user_roles")
      .select("role_id")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .in("role_id", ["seller", "supplier", "admin"])
      .limit(1);
    if (roleError) {
      console.error("Cloudinary seller-role lookup failed:", roleError.message);
      return jsonResponse({ error: "Your seller permissions could not be verified." }, 500, origin);
    }
    if (!roleRows?.length) return jsonResponse({ error: "Only approved seller accounts can upload product photos." }, 403, origin);

    const cloudName = readDefaultSecret("CLOUDINARY_CLOUD_NAME");
    const apiKey = readDefaultSecret("CLOUDINARY_API_KEY");
    const apiSecret = readDefaultSecret("CLOUDINARY_API_SECRET");
    if (!cloudName || !apiKey || !apiSecret) {
      return jsonResponse({ error: "Cloudinary signed uploads are awaiting server configuration." }, 503, origin);
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `product_${authData.user.id}_${crypto.randomUUID().replaceAll("-", "")}`;
    const parameters = {
      folder: CLOUDINARY_FOLDER,
      overwrite: "false",
      public_id: publicId,
      timestamp: String(timestamp),
      upload_preset: CLOUDINARY_PRESET,
    };
    const signature = await cloudinarySignature(parameters, apiSecret);

    return jsonResponse({
      cloud_name: cloudName,
      api_key: apiKey,
      upload_url: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
      folder: CLOUDINARY_FOLDER,
      public_id: publicId,
      timestamp,
      upload_preset: CLOUDINARY_PRESET,
      signature,
    }, 200, origin);
  } catch (error) {
    console.error("Cloudinary signature service error:", error?.message || error);
    return jsonResponse({ error: "A secure upload signature could not be created. Please try again." }, 500, origin);
  }
});
