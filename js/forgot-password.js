"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("forgotPasswordForm");
    const emailInput = document.getElementById("recoveryEmail");
    const requestState = document.getElementById("requestState");
    const successState = document.getElementById("successState");
    const errorBox = document.getElementById("recoveryError");
    const errorText = document.getElementById("recoveryErrorText");
    const sendButton = document.getElementById("sendResetButton");
    const buttonLabel = sendButton?.querySelector(".button-label");
    const maskedEmail = document.getElementById("maskedEmail");
    const resendButton = document.getElementById("resendButton");
    const resendTimer = document.getElementById("resendTimer");
    const themeToggle = document.getElementById("themeToggle");
    const themeIcon = document.getElementById("themeIcon");
    let lastSubmittedEmail = "";
    let resendInterval = null;
    let resendSeconds = 0;

    function updateThemeIcon() {
        if (!themeIcon) return;
        themeIcon.textContent = document.documentElement.classList.contains("dark") ? "\u2600" : "\u263e";
    }

    themeToggle?.addEventListener("click", () => {
        const isDark = document.documentElement.classList.toggle("dark");
        try { localStorage.setItem("gambasket-theme", isDark ? "dark" : "light"); } catch (_) {}
        updateThemeIcon();
    });
    updateThemeIcon();

    function showError(message) {
        if (!errorBox || !errorText) return;
        errorText.textContent = message || "We couldn't send the reset email. Please try again.";
        errorBox.hidden = false;
    }

    function clearError() {
        if (errorBox) errorBox.hidden = true;
    }

    function maskEmail(email) {
        const value = String(email || "").trim();
        const atIndex = value.lastIndexOf("@");
        if (atIndex <= 1) return value;
        const local = value.slice(0, atIndex);
        const domain = value.slice(atIndex);
        if (local.length <= 2) return `${local.charAt(0)}*${domain}`;
        return `${local.slice(0, 2)}${"*".repeat(Math.min(Math.max(3, local.length - 2), 6))}${domain}`;
    }

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function setLoading(loading) {
        if (!sendButton) return;
        sendButton.disabled = loading;
        sendButton.classList.toggle("loading", loading);
        if (buttonLabel) buttonLabel.textContent = loading ? "Sending..." : "Send reset link";
    }

    function startResendCooldown() {
        if (!resendButton || !resendTimer) return;
        clearInterval(resendInterval);
        resendSeconds = 60;
        resendButton.disabled = true;
        resendTimer.hidden = false;
        resendTimer.textContent = `(${resendSeconds}s)`;
        resendInterval = setInterval(() => {
            resendSeconds -= 1;
            resendTimer.textContent = `(${resendSeconds}s)`;
            if (resendSeconds <= 0) {
                clearInterval(resendInterval);
                resendButton.disabled = false;
                resendTimer.hidden = true;
            }
        }, 1000);
    }

    async function sendResetEmail(email) {
        if (!window.GamBasketAuth || typeof window.GamBasketAuth.resetPasswordForEmail !== "function") {
            throw new Error("Password recovery is unavailable right now.");
        }
        const result = await window.GamBasketAuth.resetPasswordForEmail(email);
        if (result?.error) throw result.error;
        return result;
    }

    function showSuccess(email) {
        lastSubmittedEmail = email;
        if (maskedEmail) maskedEmail.textContent = maskEmail(email);
        if (requestState) requestState.hidden = true;
        if (successState) successState.hidden = false;
        startResendCooldown();
    }

    form?.addEventListener("submit", async event => {
        event.preventDefault();
        clearError();
        const email = String(emailInput?.value || "").trim().toLowerCase();
        if (!email) {
            showError("Enter the email address associated with your GamBasket account.");
            emailInput?.focus();
            return;
        }
        if (!isValidEmail(email)) {
            showError("Enter a valid email address.");
            emailInput?.focus();
            return;
        }
        setLoading(true);
        try {
            await sendResetEmail(email);
            showSuccess(email);
        } catch (error) {
            console.error("[GamBasket Recovery]", error);
            showError(window.getAuthErrorMessage ? window.getAuthErrorMessage(error) : "We couldn't send the reset email right now. Please try again.");
        } finally {
            setLoading(false);
        }
    });

    resendButton?.addEventListener("click", async () => {
        if (resendButton.disabled || !lastSubmittedEmail) return;
        clearError();
        const label = resendButton.querySelector("span");
        resendButton.disabled = true;
        if (label) label.textContent = "Sending...";
        try {
            await sendResetEmail(lastSubmittedEmail);
            if (label) label.textContent = "Resend email";
            startResendCooldown();
        } catch (error) {
            console.error("[GamBasket Recovery Resend]", error);
            if (label) label.textContent = "Resend email";
            resendButton.disabled = false;
            if (requestState) requestState.hidden = false;
            if (successState) successState.hidden = true;
            showError(window.getAuthErrorMessage ? window.getAuthErrorMessage(error) : "We couldn't resend the email right now.");
        }
    });
});
