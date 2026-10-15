/* Trusted, server-authorized operations.  No trust data is stored in localStorage. */
(() => {
    "use strict";
    const client = () => window.GamBasketBusiness?.getClient?.() || window.supabaseClient || window.GamBasketAuth?.getClient?.();

    async function rpc(name, params = {}) {
        const activeClient = client();
        if (!activeClient) throw new Error("GamBasket is not connected.");
        const { data, error } = await activeClient.rpc(name, params);
        if (error) throw error;
        return data;
    }

    const submitReport = ({ targetUserId = null, targetProductId = null, targetStoreId = null, reportType = "other", reason, evidence = null }) =>
        rpc("create_trust_report", { p_target_user_id: targetUserId, p_target_product_id: targetProductId, p_target_store_id: targetStoreId, p_report_type: reportType, p_reason: reason, p_evidence: evidence });
    const submitReview = ({ orderId, productId, rating, title = null, body = null }) =>
        rpc("submit_marketplace_review", { p_order_id: orderId, p_product_id: productId, p_rating: Number(rating), p_title: title, p_body: body });
    const openDispute = ({ orderId, reason, description = null, evidence = null }) =>
        rpc("open_marketplace_dispute", { p_order_id: orderId, p_reason: reason, p_description: description, p_evidence: evidence });
    const submitVerification = ({ roleType, businessName, businessCategory, identityDocumentUrl = null, businessDocumentUrl = null, additionalDocumentUrl = null, notes = null }) =>
        rpc("submit_verification_request", { p_role_type: roleType, p_business_name: businessName, p_business_category: businessCategory, p_identity_document_url: identityDocumentUrl, p_business_document_url: businessDocumentUrl, p_additional_document_url: additionalDocumentUrl, p_notes: notes });
    const submitSellerPromotion = ({ title, description, type, discount, minimum, starts, ends }) =>
        rpc("create_seller_promotion", { p_title: title, p_description: description, p_type: type, p_discount: Number(discount || 0), p_minimum: Number(minimum || 0), p_starts: starts, p_ends: ends });

    window.GamBasketTrust = { rpc, submitReport, submitReview, openDispute, submitVerification, submitSellerPromotion };
})();
