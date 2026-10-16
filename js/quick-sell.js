/* GamBasket Quick Sell: submit a real moderated listing with a hosted photo gallery. */
(() => {
  "use strict";

  const FEE_ESTIMATE_PERCENT = 7;
  const form = document.getElementById("quickSellForm");
  if (!form) return;

  const $ = id => document.getElementById(id);
  const attributesContainer = $("quickSellAttributes");
  const photoPicker = $("quickSellImageFiles");
  const imageUrlInput = $("quickSellImage");
  const submitButton = form.querySelector('button[type="submit"]');
  const status = document.createElement("p");
  status.className = "quick-sell-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  form.insertBefore(status, submitButton);
  let selectedImageUrls = [];

  async function renderAttributes(values = {}) {
    const helper = window.GamBasketProductAttributes;
    if (helper) await helper.render(attributesContainer, $("quickSellCategory").value, values);
  }
  $("quickSellCategory")?.addEventListener("change", () => renderAttributes().catch(error => {
    console.warn("[GamBasket attributes]", error?.message);
  }));
  renderAttributes().catch(error => console.warn("[GamBasket attributes]", error?.message));

  imageUrlInput?.addEventListener("input", () => {
    const url = imageUrlInput.value.trim();
    if (url) selectedImageUrls = [url, ...selectedImageUrls.filter(value => value !== url)].slice(0, 8);
    else selectedImageUrls = selectedImageUrls.slice(1);
  });

  photoPicker?.addEventListener("change", async () => {
    const files = Array.from(photoPicker.files || []);
    if (!files.length) return;
    if (files.length > 8) {
      photoPicker.value = "";
      status.textContent = "Choose no more than 8 photos.";
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (files.some(file => !allowed.includes(file.type) || file.size > 5 * 1024 * 1024)) {
      photoPicker.value = "";
      status.textContent = "Each photo must be JPG, PNG, WEBP or GIF and no larger than 5MB.";
      return;
    }

    photoPicker.disabled = true;
    status.textContent = `Uploading ${files.length} photo(s)…`;
    try {
      const auth = window.GamBasketAuth;
      if (!auth?.uploadImage) throw new Error("The image service is not available. Reload the page and try again.");
      selectedImageUrls = [...new Set(await Promise.all(files.map(file => auth.uploadImage(file, "products")))].slice(0, 8);
      imageUrlInput.value = selectedImageUrls[0] || "";
      status.textContent = `${selectedImageUrls.length} photo(s) uploaded. The first photo is the main image.`;
    } catch (error) {
      console.error("[GamBasket photo upload]", error);
      photoPicker.value = "";
      status.textContent = error?.message || "Photo upload failed.";
    } finally {
      photoPicker.disabled = false;
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submitButton.disabled) return;

    const auth = window.GamBasketAuth;
    let user = null;
    try {
      if (auth) {
        await auth.ready?.();
        user = await auth.getUser();
      } else if (window.supabaseClient) {
        const { data } = await window.supabaseClient.auth.getUser();
        user = data?.user || null;
      }
    } catch {}
    if (!user) {
      window.location.href = "login.html?redirect=quick-sell.html";
      return;
    }

    const name = $("quickSellName").value.trim();
    const price = Number($("quickSellPrice").value);
    const description = $("quickSellDescription").value.trim();
    const category = window.GamBasketProductAttributes?.canonicalCategory($("quickSellCategory").value) || $("quickSellCategory").value;
    const condition = $("quickSellCondition").value;
    const location = $("quickSellLocation").value.trim();
    const suppliedImage = imageUrlInput.value.trim();
    if (!name || !Number.isFinite(price) || price <= 0 || !description || !location) {
      form.reportValidity();
      return;
    }

    const attributes = window.GamBasketProductAttributes?.read(attributesContainer) || {};
    if (suppliedImage && !/^https?:\/\//i.test(suppliedImage)) {
      status.textContent = "The main photo URL must begin with https:// or http://.";
      imageUrlInput.focus();
      return;
    }
    if (selectedImageUrls.length) selectedImageUrls = [...new Set([suppliedImage || selectedImageUrls[0], ...selectedImageUrls.filter(url => url !== suppliedImage)])].slice(0, 8);
    else if (suppliedImage) selectedImageUrls = [suppliedImage];
    if (!selectedImageUrls.length) {
      status.textContent = "Add at least one product photo before submitting.";
      photoPicker.focus();
      return;
    }

    const estimate = price * FEE_ESTIMATE_PERCENT / 100;
    if (!confirm(
      "Estimated marketplace fee: D " + estimate.toLocaleString() + "\n" +
      "Item price: D " + price.toLocaleString() + "\n\n" +
      "This is an estimate only. No fee is charged when you submit a listing.\n\nContinue?"
    )) return;

    const client = auth?.getClient?.() || window.supabaseClient;
    if (!client) {
      alert("GamBasket could not connect to the listing service. Your item was not submitted.");
      return;
    }

    submitButton.disabled = true;
    const originalLabel = submitButton.textContent;
    submitButton.textContent = "Submitting…";
    status.textContent = "Saving the listing for review…";
    try {
      const profile = await auth?.fetchUserProfile?.();
      const listingLocation = location || [profile?.area, profile?.region].filter(Boolean).join(", ") || "Greater Banjul";
      const { data: product, error } = await client.from("products").insert({
        title: name,
        price,
        currency: "GMD",
        category_id: category,
        attributes,
        description,
        condition,
        stock: 1,
        status: "pending_review",
        seller_id: user.id,
        location: listingLocation,
        main_image: selectedImageUrls[0],
        created_at: new Date().toISOString()
      }).select("id").single();
      if (error) throw error;

      if (selectedImageUrls.length > 1) {
        const { error: galleryError } = await client.from("product_images").insert(
          selectedImageUrls.slice(1).map((image_url, index) => ({ product_id: product.id, image_url, sort_order: index + 1 }))
        );
        if (galleryError) {
          status.textContent = "Your listing was submitted, but the extra photos were not attached. Open it from Seller Products to retry the gallery.";
          throw new Error("The listing was saved, but its photo gallery could not be saved: " + galleryError.message);
        }
      }

      status.textContent = "Listing submitted for review. It will appear publicly after approval.";
      alert("Your Quick Sell listing has been submitted for marketplace review and will stay private until approved.");
      window.location.href = "index.html";
    } catch (error) {
      console.error("[GamBasket Quick Sell]", error);
      const message = /seller or supplier|seller.*role|row-level security/i.test(error?.message || "")
        ? "Your account is not enabled to sell yet. Complete seller verification or contact GamBasket support before submitting a listing."
        : (error?.message || "The item could not be submitted. Please check the details and try again.");
      status.textContent = message;
      alert(message);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  });
})();
