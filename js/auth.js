/* =========================================================
   GAMBASKET AUTHENTICATION
========================================================= */

(function () {

    "use strict";


    /* =====================================================
       REDIRECT IF ALREADY LOGGED IN
    ===================================================== */

    if (document.getElementById("loginForm") || document.getElementById("signupForm")) {
        if (window.GamBasketAuth && typeof window.GamBasketAuth.ready === "function") {
            window.GamBasketAuth.ready().then(async ({ session }) => {
                if (session && session.user) {
                    const urlParams = new URLSearchParams(window.location.search);
                    const rawRedirect = urlParams.get("redirect") || "explore.html";
                    const safeRedirect = window.GamBasketGuard && window.GamBasketGuard.getSafeRedirect
                        ? window.GamBasketGuard.getSafeRedirect(rawRedirect)
                        : (rawRedirect.startsWith("http") && !rawRedirect.startsWith(window.location.origin) ? "explore.html" : rawRedirect);
                    window.location.replace(safeRedirect);
                }
            });
        }
    }


    /* =====================================================
       THEME
    ===================================================== */

    const savedTheme =
        localStorage.getItem("gambasket-theme");

    if (savedTheme === "dark") {
        document.documentElement.classList.add("dark");
    }


    const themeToggle =
        document.getElementById("themeToggle");


    if (themeToggle) {

        themeToggle.addEventListener(
            "click",
            function () {

                document.documentElement.classList.toggle(
                    "dark"
                );


                localStorage.setItem(
                    "gambasket-theme",

                    document.documentElement.classList.contains(
                        "dark"
                    )
                        ? "dark"
                        : "light"
                );

            }
        );

    }


    /* =====================================================
       PASSWORD VISIBILITY
    ===================================================== */

    document
        .querySelectorAll(".password-toggle")
        .forEach(button => {

            button.addEventListener(
                "click",
                function () {

                    const inputId =
                        this.dataset.target;

                    const input =
                        document.getElementById(
                            inputId
                        );

                    if (!input) return;


                    const isPassword =
                        input.type === "password";


                    input.type =
                        isPassword
                            ? "text"
                            : "password";


                    this.innerHTML =
                        isPassword
                            ? eyeOffIcon()
                            : eyeIcon();

                }
            );

        });


    function eyeIcon() {

        return `
            <svg
                viewBox="0 0 24 24"
                fill="none"
            >
                <path
                    d="M2.5 12C4.5 8.2 7.6 6 12 6C16.4 6 19.5 8.2 21.5 12C19.5 15.8 16.4 18 12 18C7.6 18 4.5 15.8 2.5 12Z"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                />

                <circle
                    cx="12"
                    cy="12"
                    r="2.5"
                    stroke="currentColor"
                    stroke-width="1.7"
                />
            </svg>
        `;

    }


    function eyeOffIcon() {

        return `
            <svg
                viewBox="0 0 24 24"
                fill="none"
            >
                <path
                    d="M3 3L21 21"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                />

                <path
                    d="M10.6 6.2C11.05 6.07 11.52 6 12 6C16.4 6 19.5 8.2 21.5 12C20.6 13.7 19.5 15 18.2 16"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                />

                <path
                    d="M6.2 7.8C4.7 8.8 3.45 10.25 2.5 12C4.5 15.8 7.6 18 12 18C13.4 18 14.65 17.75 15.8 17.3"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                />
            </svg>
        `;

    }


    /* =====================================================
       PASSWORD STRENGTH
    ===================================================== */

    const passwordInput =
        document.getElementById("signupPassword");


    if (passwordInput) {

        const strengthBox =
            document.getElementById(
                "passwordStrength"
            );

        const bars =
            document.querySelectorAll(
                ".strength-bar"
            );

        const label =
            document.getElementById(
                "strengthLabel"
            );


        passwordInput.addEventListener(
            "input",
            function () {

                const value =
                    this.value;

                strengthBox.classList.toggle(
                    "visible",
                    value.length > 0
                );


                let score = 0;


                if (value.length >= 8) {
                    score++;
                }

                if (/[A-Z]/.test(value)) {
                    score++;
                }

                if (/[0-9]/.test(value)) {
                    score++;
                }

                if (/[^A-Za-z0-9]/.test(value)) {
                    score++;
                }


                bars.forEach(
                    (bar, index) => {

                        bar.style.background =
                            index < score
                                ? getStrengthColor(score)
                                : "";

                    }
                );


                const labels = [
                    "",
                    "Weak",
                    "Fair",
                    "Good",
                    "Strong"
                ];


                label.textContent =
                    labels[score];

                label.style.color =
                    getStrengthColor(score);

            }
        );

    }


    function getStrengthColor(score) {

        if (score <= 1) {
            return "#ef4444";
        }

        if (score === 2) {
            return "#f59e0b";
        }

        if (score === 3) {
            return "#1877f2";
        }

        return "#16a34a";
    }


    /* =====================================================
       SIGNUP STEPS
    ===================================================== */

    const signupForm =
        document.getElementById("signupForm");


    if (signupForm) {

        let currentStep = 1;

        const totalSteps = 4;


        const steps =
            document.querySelectorAll(
                ".signup-step"
            );


        const progress =
            document.getElementById(
                "signupProgress"
            );


        const stepCounter =
            document.getElementById(
                "stepCounter"
            );


        const errorBox =
            document.getElementById(
                "signupError"
            );


        function showStep(step) {

            currentStep = step;


            steps.forEach(
                element => {

                    element.classList.toggle(
                        "active",
                        Number(
                            element.dataset.step
                        ) === step
                    );

                }
            );


            if (progress) {

                progress.style.width =
                    `${(
                        (step - 1)
                        /
                        (totalSteps - 1)
                    ) * 100}%`;

            }


            if (stepCounter) {

                stepCounter.textContent =
                    `${step} / ${totalSteps}`;

            }


            errorBox.classList.remove(
                "show"
            );


            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });

        }


        function showError(message) {

            errorBox.textContent =
                message;

            errorBox.classList.add(
                "show"
            );

        }


        document
            .querySelectorAll(
                ".next-step"
            )
            .forEach(button => {

                button.addEventListener(
                    "click",
                    function () {

                        if (
                            !validateStep(
                                currentStep
                            )
                        ) {
                            return;
                        }


                        if (
                            currentStep <
                            totalSteps
                        ) {

                            showStep(
                                currentStep + 1
                            );

                        }

                    }
                );

            });


        document
            .querySelectorAll(
                ".previous-step"
            )
            .forEach(button => {

                button.addEventListener(
                    "click",
                    function () {

                        if (
                            currentStep >
                            1
                        ) {

                            showStep(
                                currentStep - 1
                            );

                        }

                    }
                );

            });


        function validateStep(step) {

            if (step === 1) {

                const firstName =
                    document.getElementById(
                        "firstName"
                    ).value.trim();

                const lastName =
                    document.getElementById(
                        "lastName"
                    ).value.trim();


                if (!firstName || !lastName) {

                    showError(
                        "Please enter your first and last name."
                    );

                    return false;
                }

            }


            if (step === 2) {

                const email =
                    document.getElementById(
                        "signupEmail"
                    ).value.trim();

                const password =
                    document.getElementById(
                        "signupPassword"
                    ).value;


                if (!isValidEmail(email)) {

                    showError(
                        "Please enter a valid email address."
                    );

                    return false;
                }


                if (password.length < 8) {

                    showError(
                        "Your password must contain at least 8 characters."
                    );

                    return false;
                }

            }


            if (step === 3) {

                const phone =
                    document.getElementById(
                        "phone"
                    ).value.trim();


                if (!phone) {

                    showError(
                        "Please enter your phone number."
                    );

                    return false;
                }

            }


            if (step === 4) {

                const terms =
                    document.getElementById(
                        "terms"
                    );


                if (!terms.checked) {

                    showError(
                        "Please accept the Terms & Conditions and Privacy Policy."
                    );

                    return false;
                }

            }


            return true;

        }


        function isValidEmail(email) {

            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                .test(email);

        }


        /* =================================================
           SUBMIT SIGNUP
        ================================================= */

        signupForm.addEventListener(
            "submit",
            async function (event) {

                event.preventDefault();

                if (!validateStep(currentStep)) {
                    return;
                }

                const button = document.getElementById("createAccountBtn");
                const originalHtml = button.innerHTML;
                button.disabled = true;
                button.innerHTML = `
                    <span class="btn-spinner"></span>
                    Creating account...
                `;

                const firstName = document.getElementById("firstName").value.trim();
                const lastName = document.getElementById("lastName").value.trim();
                const email = document.getElementById("signupEmail").value.trim();
                const password = document.getElementById("signupPassword").value;
                const phone = document.getElementById("phone").value.trim();

                try {
                    let result;
                    if (window.GamBasketAuth && window.GamBasketAuth.isConfigured()) {
                        result = await window.GamBasketAuth.signUp({
                            email,
                            password,
                            firstName,
                            lastName,
                            phone,
                            country: "The Gambia",
                            region: "Greater Banjul"
                        });
                    } else {
                        // Fallback dev state
                        result = {
                            data: { user: { id: "dev-user-" + Date.now(), email } },
                            error: null
                        };
                    }

                    if (result.error) {
                        showError(window.getAuthErrorMessage ? window.getAuthErrorMessage(result.error) : "Something went wrong. Please try again.");
                        button.disabled = false;
                        button.innerHTML = originalHtml;
                        return;
                    }

                    localStorage.setItem(
                        "gambasket_pending_user",
                        JSON.stringify({
                            firstName,
                            lastName,
                            email,
                            phone,
                            country: "The Gambia",
                            createdAt: new Date().toISOString()
                        })
                    );

                    window.location.href = "verify-email.html";
                } catch (err) {
                    showError(window.getAuthErrorMessage ? window.getAuthErrorMessage(err) : "Something went wrong. Please try again.");
                    button.disabled = false;
                    button.innerHTML = originalHtml;
                }
            }
        );

        // GOOGLE SIGNUP HANDLER
        const googleSignupBtn = document.getElementById("googleSignupBtn");
        if (googleSignupBtn) {
            googleSignupBtn.addEventListener("click", async function (e) {
                e.preventDefault();
                const urlParams = new URLSearchParams(window.location.search);
                const rawRedirect = urlParams.get("redirect") || "explore.html";

                const originalHtml = this.innerHTML;
                this.disabled = true;
                this.innerHTML = `
                    <span class="btn-spinner"></span>
                    Connecting to Google...
                `;

                try {
                    if (window.GamBasketAuth && window.GamBasketAuth.isConfigured()) {
                        const { error } = await window.GamBasketAuth.signInWithOAuth("google", rawRedirect);
                        if (error) throw error;
                    } else {
                        throw new Error("Supabase is not configured yet.");
                    }
                } catch (err) {
                    showError(window.getAuthErrorMessage ? window.getAuthErrorMessage(err) : "Unable to connect with Google. Please try again.");
                    this.disabled = false;
                    this.innerHTML = originalHtml;
                }
            });
        }

        showStep(1);

    }


    /* =====================================================
       LOGIN
    ===================================================== */

    const loginForm = document.getElementById("loginForm");

    if (loginForm) {

        // GOOGLE LOGIN HANDLER
        const googleLoginBtn = document.getElementById("googleLoginBtn");
        if (googleLoginBtn) {
            googleLoginBtn.addEventListener("click", async function (e) {
                e.preventDefault();
                const urlParams = new URLSearchParams(window.location.search);
                const rawRedirect = urlParams.get("redirect") || "explore.html";
                const error = document.getElementById("loginError");

                const originalHtml = this.innerHTML;
                this.disabled = true;
                this.innerHTML = `
                    <span class="btn-spinner"></span>
                    Connecting to Google...
                `;

                try {
                    if (window.GamBasketAuth && window.GamBasketAuth.isConfigured()) {
                        const { error: oauthErr } = await window.GamBasketAuth.signInWithOAuth("google", rawRedirect);
                        if (oauthErr) throw oauthErr;
                    } else {
                        throw new Error("Supabase is not configured yet.");
                    }
                } catch (err) {
                    if (error) {
                        error.textContent = window.getAuthErrorMessage ? window.getAuthErrorMessage(err) : "Unable to connect with Google. Please try again.";
                        error.classList.add("show");
                    }
                    this.disabled = false;
                    this.innerHTML = originalHtml;
                }
            });
        }

        loginForm.addEventListener(
            "submit",
            async function (event) {

                event.preventDefault();

                const email = document.getElementById("loginEmail").value.trim();
                const password = document.getElementById("loginPassword").value;
                const error = document.getElementById("loginError");

                error.classList.remove("show");

                if (!isValidEmail(email)) {
                    error.textContent = "Please enter a valid email address.";
                    error.classList.add("show");
                    return;
                }

                if (!password) {
                    error.textContent = "Please enter your password.";
                    error.classList.add("show");
                    return;
                }

                const button = document.getElementById("loginButton");
                const originalHtml = button.innerHTML;
                button.disabled = true;
                button.innerHTML = `
                    <span class="btn-spinner"></span>
                    Logging in...
                `;

                try {
                    let result;
                    if (window.GamBasketAuth && window.GamBasketAuth.isConfigured()) {
                        result = await window.GamBasketAuth.signIn({ email, password });
                    } else {
                        result = {
                            data: { user: { id: "dev-user", email } },
                            error: null
                        };
                    }

                    if (result.error) {
                        error.textContent = window.getAuthErrorMessage ? window.getAuthErrorMessage(result.error) : "Incorrect email or password. Please check your details and try again.";
                        error.classList.add("show");
                        button.disabled = false;
                        button.innerHTML = originalHtml;
                        return;
                    }

                    // Check redirect parameter safely
                    const urlParams = new URLSearchParams(window.location.search);
                    const rawRedirect = urlParams.get("redirect") || "index.html";
                    const safeRedirect = window.GamBasketGuard && window.GamBasketGuard.getSafeRedirect 
                        ? window.GamBasketGuard.getSafeRedirect(rawRedirect)
                        : (rawRedirect.startsWith("http") && !rawRedirect.startsWith(window.location.origin) ? "index.html" : rawRedirect);
                    window.location.href = safeRedirect;
                } catch (err) {
                    error.textContent = window.getAuthErrorMessage ? window.getAuthErrorMessage(err) : "Something went wrong while signing you in. Please try again.";
                    error.classList.add("show");
                    button.disabled = false;
                    button.innerHTML = originalHtml;
                }
            }
        );

    }


    /* =====================================================
       FORGOT PASSWORD
    ===================================================== */

    const forgotForm = document.getElementById("forgotForm");

    if (forgotForm) {

        forgotForm.addEventListener(
            "submit",
            async function (event) {

                event.preventDefault();

                const email = document.getElementById("forgotEmail").value.trim();
                const error = document.getElementById("forgotError");

                if (!isValidEmail(email)) {
                    error.textContent = "Please enter a valid email address.";
                    error.classList.add("show");
                    return;
                }

                error.classList.remove("show");

                const button = document.getElementById("forgotButton");
                const originalHtml = button.innerHTML;
                button.disabled = true;
                button.innerHTML = `
                    <span class="btn-spinner"></span>
                    Sending...
                `;

                try {
                    if (window.GamBasketAuth && window.GamBasketAuth.isConfigured()) {
                        const { error: resetErr } = await window.GamBasketAuth.resetPasswordForEmail(email);
                        if (resetErr) throw resetErr;
                    }

                    document.getElementById("forgotForm").style.display = "none";
                    document.getElementById("forgotSuccess").style.display = "block";
                } catch (err) {
                    error.textContent = window.getAuthErrorMessage ? window.getAuthErrorMessage(err) : "Could not send reset email. Please try again.";
                    error.classList.add("show");
                    button.disabled = false;
                    button.innerHTML = originalHtml;
                }
            }
        );

    }


    /* =====================================================
       RESET PASSWORD
    ===================================================== */

    const resetForm = document.getElementById("resetForm");

    if (resetForm) {

        resetForm.addEventListener(
            "submit",
            async function (event) {

                event.preventDefault();

                const password = document.getElementById("resetPassword").value;
                const confirm = document.getElementById("resetConfirm").value;
                const error = document.getElementById("resetError");

                error.classList.remove("show");

                if (password.length < 8) {
                    error.textContent = "Your password is too weak. Use at least 8 characters with a mix of letters and numbers.";
                    error.classList.add("show");
                    return;
                }

                if (password !== confirm) {
                    error.textContent = "Passwords do not match.";
                    error.classList.add("show");
                    return;
                }

                const button = document.getElementById("resetButton");
                const originalHtml = button.innerHTML;
                button.disabled = true;
                button.innerHTML = `
                    <span class="btn-spinner"></span>
                    Updating password...
                `;

                try {
                    if (window.GamBasketAuth && window.GamBasketAuth.isConfigured()) {
                        const { error: resetErr } = await window.GamBasketAuth.updatePassword(password);
                        if (resetErr) throw resetErr;
                    }

                    resetForm.style.display = "none";
                    document.getElementById("resetSuccess").style.display = "block";
                } catch (err) {
                    error.textContent = window.getAuthErrorMessage ? window.getAuthErrorMessage(err) : "Failed to update password. Please try again.";
                    error.classList.add("show");
                    button.disabled = false;
                    button.innerHTML = originalHtml;
                }
            }
        );

    }


    /* =====================================================
       EMAIL VERIFICATION
    ===================================================== */

    const verifyButton = document.getElementById("verifyButton");

    if (verifyButton) {

        const pendingUser = JSON.parse(
            localStorage.getItem("gambasket_pending_user") || "null"
        );

        const emailDisplay = document.getElementById("verificationEmail");

        if (pendingUser && emailDisplay) {
            emailDisplay.textContent = pendingUser.email;
        }

        verifyButton.addEventListener(
            "click",
            async function () {

                verifyButton.disabled = true;
                verifyButton.innerHTML = `
                    <span class="btn-spinner"></span>
                    Verifying...
                `;

                if (window.GamBasketAuth) {
                    const session = await window.GamBasketAuth.getSession();
                    if (session) {
                        window.location.href = "index.html";
                        return;
                    }
                }

                // If not automatically logged in, redirect to login page
                window.location.href = "login.html";
            }
        );

    }


    /* =====================================================
       RESEND EMAIL
    ===================================================== */

    const resendButton =
        document.getElementById(
            "resendEmail"
        );


    if (resendButton) {

        resendButton.addEventListener(
            "click",
            function () {

                const original =
                    this.textContent;


                this.disabled = true;

                this.textContent =
                    "Email sent ✓";


                setTimeout(
                    () => {

                        this.disabled = false;

                        this.textContent =
                            original;

                    },
                    3000
                );

            }
        );

    }


    /* =====================================================
       EMAIL VALIDATOR
    ===================================================== */

    function isValidEmail(email) {

        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            .test(email);

    }


})();