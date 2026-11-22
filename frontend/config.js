/* Browser-side API configuration. Never place API keys or server secrets here. */

(() => {
    const host = window.location.hostname || "localhost";

    const isLocal = ["localhost", "127.0.0.1"].includes(host);

    const defaultApiUrl = isLocal
        ? `${window.location.protocol}//${host}:8001`
        :  "https://supportflow-ai-nfgl.onrender.com";

    window.SUPPORTFLOW_CONFIG = Object.freeze({
        API_BASE_URL: (
            window.SUPPORTFLOW_API_BASE_URL || defaultApiUrl
        ).replace(/\/+$/, ""),

        REQUEST_TIMEOUT_MS: 20000,
        CHAT_TIMEOUT_MS: 26000,

        ENDPOINTS: Object.freeze({
            HEALTH: "/health",

            REGISTER: "/auth/register",
            LOGIN: "/auth/login",
            FORGOT_PASSWORD: "/auth/forgot-password",
            VERIFY_RESET_OTP: "/auth/verify-reset-otp",
            RESET_PASSWORD: "/auth/reset-password",
            ME: "/auth/me",

            CUSTOMER_TICKETS: "/tickets/?page=1&limit=100",
            CREATE_TICKET: "/tickets/",

            AGENT_DASHBOARD: "/tickets/agent-dashboard",
            UNASSIGNED_TICKETS: "/tickets/unassigned",
            ASSIGNED_TICKETS: "/tickets/assigned",

            TICKET: (ticketId) => `/tickets/${ticketId}`,
            UPDATE_TICKET: (ticketId) => `/tickets/${ticketId}`,
            CUSTOMER_CHAT: (ticketId) => `/tickets/${ticketId}/chat`,

            CLAIM_TICKET: (ticketId) => `/tickets/${ticketId}/assign`,
            UPDATE_STATUS: (ticketId) => `/tickets/${ticketId}/status`,
            UPDATE_PRIORITY: (ticketId) => `/tickets/${ticketId}/priority`,

            ANALYZE_TICKET: (ticketId) => `/tickets/${ticketId}/analyze`,
            TICKET_ANALYSES: (ticketId) => `/tickets/${ticketId}/analyses`,
            SUPPORT_REPLIES: (ticketId) => `/tickets/${ticketId}/support-replies`,

            TICKET_MESSAGES: (ticketId) => `/tickets/${ticketId}/messages`,
            POST_TICKET_MESSAGE: (ticketId) => `/tickets/${ticketId}/messages`,

            APPROVE_PRIORITY: (ticketId, analysisId) =>
                `/tickets/${ticketId}/analyses/${analysisId}/approve-priority`,

            APPROVE_REPLY: (ticketId, analysisId) =>
                `/tickets/${ticketId}/analyses/${analysisId}/approve-reply`,

            ADMIN_DASHBOARD: "/admin/dashboard",
            ADMIN_TICKETS: "/admin/tickets",
            ADMIN_DELETE_TICKET: (ticketId) => `/admin/tickets/${ticketId}`,

            ADMIN_USERS: "/admin/users",
            ADMIN_CREATE_USER: "/admin/users",
            ADMIN_DELETE_USER: (id) => `/admin/users/${id}`,
            ADMIN_UPDATE_ROLE: (userId) => `/admin/users/${userId}/role`,
            ADMIN_ASSIGN_TICKET: (ticketId) => `/admin/tickets/${ticketId}/assign`,
            ADMIN_ANALYSES: "/admin/analyses"
        })
    });
})();