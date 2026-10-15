/* =========================================================
   GAMBASKET — CENTRALIZED AUTH ERROR TRANSLATOR
   Never expose raw Supabase/network errors to users.
   Technical details are logged to console for debugging.
========================================================= */

(function () {
    "use strict";

    /**
     * Translates raw Supabase/network errors into user-friendly messages.
     * Always logs the technical error to console.error for debugging.
     *
     * @param {Error|Object|string} error - The raw error from Supabase or network
     * @returns {string} A human-readable error message safe for UI display
     */
    function getAuthErrorMessage(error) {
        // Always log technical details for debugging
        console.error("[GamBasket Auth Error]", error);

        // Extract the message string
        let msg = "";
        if (typeof error === "string") {
            msg = error;
        } else if (error && error.message) {
            msg = error.message;
        } else if (error && error.error_description) {
            msg = error.error_description;
        } else {
            msg = String(error || "");
        }

        const lower = msg.toLowerCase();

        // Wrong email/password
        if (lower.includes("invalid login credentials") ||
            lower.includes("invalid email or password") ||
            lower.includes("wrong password") ||
            lower.includes("incorrect password")) {
            return "Incorrect email or password. Please check your details and try again.";
        }

        // Email not verified
        if (lower.includes("email not confirmed") ||
            lower.includes("not confirmed") ||
            lower.includes("email confirmation")) {
            return "Please verify your email before signing in. Check your inbox for the verification link.";
        }

        // User already exists
        if (lower.includes("user already registered") ||
            lower.includes("already been registered") ||
            lower.includes("already exists") ||
            lower.includes("duplicate key") ||
            lower.includes("unique constraint")) {
            return "An account with this email already exists. Try signing in instead.";
        }

        // Weak password
        if (lower.includes("password") && (lower.includes("too weak") || lower.includes("too short") || lower.includes("should be at least") || lower.includes("at least"))) {
            return "Your password is too weak. Use at least 8 characters with a mix of letters and numbers.";
        }

        // Invalid email format
        if (lower.includes("invalid email") || lower.includes("valid email") ||
            lower.includes("unable to validate email")) {
            return "Please enter a valid email address.";
        }

        // Rate limited
        if (lower.includes("rate limit") || lower.includes("too many requests") ||
            lower.includes("exceeded") || lower.includes("429")) {
            return "Too many attempts. Please wait a moment and try again.";
        }

        // Network errors
        if (lower.includes("fetch failed") || lower.includes("failed to fetch") ||
            lower.includes("networkerror") || lower.includes("network error") ||
            lower.includes("net::") || lower.includes("econnrefused") ||
            lower.includes("enotfound") || lower.includes("timeout") ||
            lower.includes("abort")) {
            return "We couldn\u2019t connect to GamBasket. Please check your internet connection and try again.";
        }

        // Invalid API key / 401 / misconfigured client
        if (lower.includes("invalid api") || lower.includes("apikey") ||
            lower.includes("api key") || lower.includes("invalid key") ||
            lower.includes("401") || lower.includes("unauthorized") ||
            lower.includes("not authorized") || lower.includes("jwt")) {
            return "GamBasket is temporarily unable to connect. Please try again shortly.";
        }

        // Forbidden / RLS
        if (lower.includes("403") || lower.includes("forbidden") ||
            lower.includes("rls") || lower.includes("row-level security") ||
            lower.includes("permission denied") || lower.includes("insufficient")) {
            return "You don\u2019t have permission to perform this action.";
        }

        // Server errors
        if (lower.includes("500") || lower.includes("internal server") ||
            lower.includes("server error") || lower.includes("502") ||
            lower.includes("503") || lower.includes("service unavailable")) {
            return "GamBasket is experiencing a temporary issue. Please try again in a few minutes.";
        }

        // Signup disabled
        if (lower.includes("signups not allowed") || lower.includes("signup disabled")) {
            return "Account registration is currently disabled. Please try again later.";
        }

        // OAuth & Google Sign-In errors
        if (lower.includes("access_denied") || lower.includes("popup_closed") ||
            lower.includes("user_cancelled") || lower.includes("cancelled") ||
            lower.includes("canceled")) {
            return "Google sign-in was cancelled. Please try again.";
        }

        if (lower.includes("unsupported_provider") || lower.includes("provider is not enabled") ||
            lower.includes("provider disabled") || lower.includes("oauth provider")) {
            return "Google sign-in is currently unavailable. Please sign in with email and password.";
        }

        if (lower.includes("oauth") || lower.includes("callback") ||
            lower.includes("state mismatch") || lower.includes("code exchange")) {
            return "Unable to complete Google sign-in. Please try again.";
        }

        // Session expired
        if (lower.includes("session expired") || lower.includes("refresh token") ||
            lower.includes("token expired") || lower.includes("token is expired") ||
            lower.includes("no session")) {
            return "Your session has expired. Please sign in again.";
        }

        // Generic fallback — never expose raw error
        return "Something went wrong. Please try again.";
    }

    // Expose globally
    window.getAuthErrorMessage = getAuthErrorMessage;
})();
