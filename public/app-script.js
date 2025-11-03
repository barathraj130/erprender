const API = "/api";
let editingUserId = null;
let editingTxnId = null;
let editingLenderId = null;
let editingAgreementId = null;
let editingProductId = null;
let editingInvoiceId = null;
let currentLinkingProductId = null;
let editingProductSupplierLinkId = null;
let currentUser = null;

let usersDataCache = [];
let allTransactionsCache = [];
let externalEntitiesCache = [];
let businessAgreementsCache = [];
let productsCache = [];
let invoicesCache = [];
let productSuppliersCache = [];
let businessProfileCache = null;
let unreadNotificationsCache = [];

// --- FIX: Correctly define the isLoading object ---
let isLoading = {
    users: false,
    transactions: false,
    lenders: false,
    businessAgreements: false,
    products: false,
    invoices: false,
    businessProfile: false
};


// For Chart instances - DECLARE THEM GLOBALLY ONCE
let revenueChartInstance = null;
let categoryChartInstance = null;
let cashFlowChartInstance = null; // Added for new report

// DETAILED categories - used by ledgers, reports, and displayTransactions (if showing business flow)
const transactionCategories = [
    // --- Customer Transactions ---
    // Revenue from Sales
    { name: "Sale to Customer (On Credit)", type: "receivable_increase", group: "customer_revenue", isProductSale: true, affectsLedger: "none", relevantTo: "customer" },
    { name: "Sale to Customer (Cash)", type: "cash_income", group: "customer_revenue", isProductSale: true, affectsLedger: "cash", relevantTo: "customer" },
    { name: "Sale to Customer (Bank)", type: "bank_income", group: "customer_revenue", isProductSale: true, affectsLedger: "bank", relevantTo: "customer" },
    { name: "Sale to Customer (Cash/Direct)", type: "cash_income", group: "customer_revenue", isProductSale: true, affectsLedger: "cash", relevantTo: "customer" }, // Added for calculation

    // Payments from Customers
    { name: "Payment Received from Customer (Cash)", type: "cash_income", group: "customer_payment", affectsLedger: "cash", relevantTo: "customer" },
    { name: "Payment Received from Customer (Bank)", type: "bank_income", group: "customer_payment", affectsLedger: "bank", relevantTo: "customer" },
    { name: "Amount Received in Bank (from Customer/Other)", type: "bank_income", group: "customer_payment", affectsLedger: "bank", relevantTo: "customer" }, // Added for calculation
    { name: "Payment Received from Customer", type: "unknown_income_OR_asset_decrease", group: "customer_payment", affectsLedger: "unknown", relevantTo: "customer" }, // Added for calculation (generic)

    // Customer Loans
    { name: "Loan Disbursed to Customer (from Cash)", type: "cash_expense_asset", group: "customer_loan_out", affectsLedger: "cash", relevantTo: "customer" },
    { name: "Loan Disbursed to Customer (from Bank)", type: "bank_expense_asset", group: "customer_loan_out", affectsLedger: "bank", relevantTo: "customer" },
    { name: "Loan Repayment Received from Customer (Cash)", type: "cash_income", group: "customer_loan_in", affectsLedger: "cash", relevantTo: "customer" },
    { name: "Loan Repayment Received from Customer (Bank)", type: "bank_income", group: "customer_loan_in", affectsLedger: "bank", relevantTo: "customer" },
    { name: "Interest on Customer Loan Received (Cash)", type: "cash_income", group: "customer_loan_in", affectsLedger: "cash", relevantTo: "customer" },
    { name: "Interest on Customer Loan Received (Bank)", type: "bank_income", group: "customer_loan_in", affectsLedger: "bank", relevantTo: "customer" },
    
    // Customer Chits
    { name: "Chit Installment Received from Customer (Cash)", type: "cash_income", group: "customer_chit_in", affectsLedger: "cash", relevantTo: "customer" },
    { name: "Chit Installment Received from Customer (Bank)", type: "bank_income", group: "customer_chit_in", affectsLedger: "bank", relevantTo: "customer" },
    { name: "Chit Payout Made to Customer (Cash)", type: "cash_expense", group: "customer_chit_out", affectsLedger: "cash", relevantTo: "customer" },
    { name: "Chit Payout Made to Customer (Bank)", type: "bank_expense", group: "customer_chit_out", affectsLedger: "bank", relevantTo: "customer" },
    
    // Customer Returns
    { name: "Product Return from Customer (Credit Note)", type: "receivable_decrease", group: "customer_return", isProductSale: true, affectsLedger: "none", relevantTo: "customer" },
    { name: "Product Return from Customer (Refund via Cash)", type: "cash_expense", group: "customer_return", isProductSale: true, affectsLedger: "cash", relevantTo: "customer" },
    { name: "Product Return from Customer (Refund via Bank)", type: "bank_expense", group: "customer_return", isProductSale: true, affectsLedger: "bank", relevantTo: "customer" },

    // --- Supplier Transactions ---
    // Purchases from Suppliers
    { name: "Purchase from Supplier (On Credit)", type: "payable_increase", group: "supplier_expense", isProductPurchase: true, affectsLedger: "none", relevantTo: "lender" },
    { name: "Purchase from Supplier (Cash)", type: "cash_expense", group: "supplier_expense", isProductPurchase: true, affectsLedger: "cash", relevantTo: "lender" },
    { name: "Purchase from Supplier (Bank)", type: "bank_expense", group: "supplier_expense", isProductPurchase: true, affectsLedger: "bank", relevantTo: "lender" },
    { name: "Initial Stock Purchase (On Credit)", type: "payable_increase", group: "supplier_expense", isProductPurchase: true, affectsLedger: "none", relevantTo: "lender" }, // For auto-creation
    
    // Payments to Suppliers
    { name: "Payment Made to Supplier (Cash)", type: "cash_expense", group: "supplier_payment", affectsLedger: "cash", relevantTo: "lender" },
    { name: "Payment Made to Supplier (Bank)", type: "bank_expense", group: "supplier_payment", affectsLedger: "bank", relevantTo: "lender" },
    
    // Returns to Suppliers
    { name: "Product Return to Supplier (Credit Received)", type: "payable_decrease", group: "supplier_return", isProductPurchase: true, affectsLedger: "none", relevantTo: "lender" },
    { name: "Product Return to Supplier (Cash Refund)", type: "cash_income", group: "supplier_return", isProductPurchase: true, affectsLedger: "cash", relevantTo: "lender" },
    { name: "Product Return to Supplier (Bank Refund)", type: "bank_income", group: "supplier_return", isProductPurchase: true, affectsLedger: "bank", relevantTo: "lender" },

    // --- Business Finance Transactions (External Entities - Lenders, Banks, Chit Providers) ---
    // Loans Taken by Business
    { name: "Loan Received by Business (to Bank)", type: "bank_income_liability", group: "biz_loan_in", affectsLedger: "bank", relevantTo: "lender" },
    { name: "Loan Received by Business (to Cash)", type: "cash_income_liability", group: "biz_loan_in", affectsLedger: "cash", relevantTo: "lender" },
    { name: "Loan Principal Repaid by Business (from Bank)", type: "bank_expense", group: "biz_loan_repay", affectsLedger: "bank", relevantTo: "lender" },
    { name: "Loan Principal Repaid by Business (from Cash)", type: "cash_expense", group: "biz_loan_repay", affectsLedger: "cash", relevantTo: "lender" },
    { name: "Loan Interest Paid by Business (from Bank)", type: "bank_expense", group: "biz_loan_repay", affectsLedger: "bank", relevantTo: "lender" },
    { name: "Loan Interest Paid by Business (from Cash)", type: "cash_expense", group: "biz_loan_repay", affectsLedger: "cash", relevantTo: "lender" },
    
    // Business Chits (External)
    { name: "Business Pays Chit Installment (Cash)", type: "cash_expense", group: "biz_chit_out", affectsLedger: "cash", relevantTo: "lender" },
    { name: "Business Pays Chit Installment (Bank)", type: "bank_expense", group: "biz_chit_out", affectsLedger: "bank", relevantTo: "lender" },
    { name: "Business Receives Chit Payout (to Cash)", type: "cash_income", group: "biz_chit_in", affectsLedger: "cash", relevantTo: "lender" },
    { name: "Business Receives Chit Payout (to Bank)", type: "bank_income", group: "biz_chit_in", affectsLedger: "bank", relevantTo: "lender" },

    // --- Internal & Operational Transactions ---
    // Bank & Cash Contra
    { name: "Cash Deposited to Bank", type: "neutral_cash_movement", group: "bank_ops", affectsLedger: "both_cash_out_bank_in", relevantTo: "none" },
    { name: "Cash Withdrawn from Bank", type: "neutral_cash_movement", group: "bank_ops", affectsLedger: "both_cash_in_bank_out", relevantTo: "none" },
    { name: "Bank Charges", type: "bank_expense", group: "bank_ops", affectsLedger: "bank", relevantTo: "none" }, // Typically bank only
    
    // General Business Operations
    { name: "Rent Paid (Cash)", type: "cash_expense", group: "biz_ops", affectsLedger: "cash", relevantTo: "none" },
    { name: "Rent Paid (Bank)", type: "bank_expense", group: "biz_ops", affectsLedger: "bank", relevantTo: "none" },
    { name: "Utilities Paid (Cash)", type: "cash_expense", group: "biz_ops", affectsLedger: "cash", relevantTo: "none" },
    { name: "Utilities Paid (Bank)", type: "bank_expense", group: "biz_ops", affectsLedger: "bank", relevantTo: "none" },
    { name: "Salaries Paid (Cash)", type: "cash_expense", group: "biz_ops", affectsLedger: "cash", relevantTo: "none" },
    { name: "Salaries Paid (Bank)", type: "bank_expense", group: "biz_ops", affectsLedger: "bank", relevantTo: "none" },
    { name: "Office Supplies Purchased (Cash)", type: "cash_expense", group: "biz_ops", affectsLedger: "cash", relevantTo: "none" },
    { name: "Office Supplies Purchased (Bank)", type: "bank_expense", group: "biz_ops", affectsLedger: "bank", relevantTo: "none" },
    { name: "Marketing Expenses (Cash)", type: "cash_expense", group: "biz_ops", affectsLedger: "cash", relevantTo: "none" },
    { name: "Marketing Expenses (Bank)", type: "bank_expense", group: "biz_ops", affectsLedger: "bank", relevantTo: "none" },
    { name: "Other Business Income (Cash)", type: "cash_income", group: "biz_ops", affectsLedger: "cash", relevantTo: "none" },
    { name: "Other Business Income (Bank)", type: "bank_income", group: "biz_ops", affectsLedger: "bank", relevantTo: "none" },
    { name: "Other Business Expense (Cash)", type: "cash_expense", group: "biz_ops", affectsLedger: "cash", relevantTo: "none" },
    { name: "Other Business Expense (Bank)", type: "bank_expense", group: "biz_ops", affectsLedger: "bank", relevantTo: "none" },
    //opening in settings
    { name: "Opening Balance - Bank", type: "bank_income", group: "opening_balance", affectsLedger: "bank", relevantTo: "none" },
    { name: "Opening Balance - Cash", type: "cash_income", group: "opening_balance", affectsLedger: "cash", relevantTo: "none" },
    // Inventory Adjustments
    { name: "Stock Adjustment (Increase)", type: "neutral_stock", group: "inventory_adjustment", isProductPurchase: true, affectsLedger: "none", relevantTo: "none" },
    { name: "Stock Adjustment (Decrease)", type: "neutral_stock", group: "inventory_adjustment", isProductSale: true, affectsLedger: "none", relevantTo: "none" },
];
const baseTransactionCategories = [
    // -- Customer --
    { name: "Sale to Customer", group: "customer_revenue", isProductSale: true, relevantTo: "customer", needsPaymentMode: true, defaultSignForParty: 1, categoryPattern: "Sale to Customer ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Payment Received from Customer", group: "customer_payment", relevantTo: "customer", needsPaymentMode: true, defaultSignForParty: -1, categoryPattern: "Payment Received from Customer ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Loan Disbursed to Customer", group: "customer_loan_out", relevantTo: "customer", needsPaymentMode: true, defaultSignForParty: 1, categoryPattern: "Loan Disbursed to Customer ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Loan Repayment Received from Customer", group: "customer_loan_in", relevantTo: "customer", needsPaymentMode: true, defaultSignForParty: -1, categoryPattern: "Loan Repayment Received from Customer ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Interest on Customer Loan Received", group: "customer_loan_in", relevantTo: "customer", needsPaymentMode: true, defaultSignForParty: -1, categoryPattern: "Interest on Customer Loan Received ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Product Return from Customer (Refund)", group: "customer_return", isProductSale: true, relevantTo: "customer", needsPaymentMode: true, defaultSignForParty: 1, categoryPattern: "Product Return from Customer (Refund via {PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" }, // Business pays out
    { name: "Product Return from Customer (Credit Note)", group: "customer_return", isProductSale: true, relevantTo: "customer", needsPaymentMode: false, defaultSignForParty: -1, categoryPattern: "Product Return from Customer (Credit Note)", affectsLedgerPattern: "none" },
    { name: "Amount Received in Bank (from Customer/Other)", group: "customer_payment", relevantTo: "customer", needsPaymentMode: false, defaultSignForParty: -1, categoryPattern: "Amount Received in Bank (from Customer/Other)", affectsLedgerPattern: "bank" },
    { name: "Sale to Customer (Cash/Direct)", group: "customer_revenue", isProductSale: true, relevantTo: "customer", needsPaymentMode: false, defaultSignForParty: 1, categoryPattern: "Sale to Customer (Cash/Direct)", affectsLedgerPattern: "cash" },

    // -- Supplier --
    { name: "Purchase from Supplier", group: "supplier_expense", isProductPurchase: true, relevantTo: "lender", needsPaymentMode: true, defaultSignForParty: 1, categoryPattern: "Purchase from Supplier ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Payment Made to Supplier", group: "supplier_payment", relevantTo: "lender", needsPaymentMode: true, defaultSignForParty: -1, categoryPattern: "Payment Made to Supplier ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Product Return to Supplier (Refund Recvd)", group: "supplier_return", isProductPurchase: true, relevantTo: "lender", needsPaymentMode: true, defaultSignForParty: 1, categoryPattern: "Product Return to Supplier ({PaymentMode} Refund)", affectsLedgerPattern: "{PaymentModeLowerCase}"}, // Business receives
    { name: "Product Return to Supplier (Credit Recvd)", group: "supplier_return", isProductPurchase: true, relevantTo: "lender", needsPaymentMode: false, defaultSignForParty: -1, categoryPattern: "Product Return to Supplier (Credit Received)", affectsLedgerPattern: "none"},

    // -- Business Finance (External Entity as Lender) --
    { name: "Loan Received by Business", group: "biz_loan_in", relevantTo: "lender", needsPaymentMode: true, defaultSignForParty: 1, categoryPattern: "Loan Received by Business ({PaymentModeDestination})", affectsLedgerPattern: "{PaymentModeLowerCase}" }, 
    { name: "Loan Principal Repaid by Business", group: "biz_loan_repay", relevantTo: "lender", needsPaymentMode: true, defaultSignForParty: -1, categoryPattern: "Loan Principal Repaid by Business (from {PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Loan Interest Paid by Business", group: "biz_loan_repay", relevantTo: "lender", needsPaymentMode: true, defaultSignForParty: -1, categoryPattern: "Loan Interest Paid by Business (from {PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Business Pays Chit Installment", group: "biz_chit_out", relevantTo: "lender", needsPaymentMode: true, defaultSignForParty: -1, categoryPattern: "Business Pays Chit Installment ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Business Receives Chit Payout", group: "biz_chit_in", relevantTo: "lender", needsPaymentMode: true, defaultSignForParty: 1, categoryPattern: "Business Receives Chit Payout ({PaymentModeDestination})", affectsLedgerPattern: "{PaymentModeLowerCase}" },

    // -- Internal & Operational (relevantTo: "none") --
    { name: "Rent Paid", group: "biz_ops", relevantTo: "none", needsPaymentMode: true, defaultSignForParty: 0, categoryPattern: "Rent Paid ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Utilities Paid", group: "biz_ops", relevantTo: "none", needsPaymentMode: true, defaultSignForParty: 0, categoryPattern: "Utilities Paid ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Salaries Paid", group: "biz_ops", relevantTo: "none", needsPaymentMode: true, defaultSignForParty: 0, categoryPattern: "Salaries Paid ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Office Supplies Purchased", group: "biz_ops", relevantTo: "none", needsPaymentMode: true, defaultSignForParty: 0, categoryPattern: "Office Supplies Purchased ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Marketing Expenses", group: "biz_ops", relevantTo: "none", needsPaymentMode: true, defaultSignForParty: 0, categoryPattern: "Marketing Expenses ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Other Business Income", group: "biz_ops", relevantTo: "none", needsPaymentMode: true, defaultSignForParty: 0, categoryPattern: "Other Business Income ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    { name: "Other Business Expense", group: "biz_ops", relevantTo: "none", needsPaymentMode: true, defaultSignForParty: 0, categoryPattern: "Other Business Expense ({PaymentMode})", affectsLedgerPattern: "{PaymentModeLowerCase}" },
    
    { name: "Cash Deposited to Bank", group: "bank_ops", relevantTo: "none", needsPaymentMode: false, defaultSignForParty: 0, categoryPattern: "Cash Deposited to Bank", affectsLedgerPattern: "both_cash_out_bank_in" },
    { name: "Cash Withdrawn from Bank", group: "bank_ops", relevantTo: "none", needsPaymentMode: false, defaultSignForParty: 0, categoryPattern: "Cash Withdrawn from Bank", affectsLedgerPattern: "both_cash_in_bank_out" },
    { name: "Bank Charges", group: "bank_ops", relevantTo: "none", needsPaymentMode: false, defaultSignForParty: 0, categoryPattern: "Bank Charges", affectsLedgerPattern: "bank" }, 
    
    { name: "Stock Adjustment (Increase)", group: "inventory_adjustment", isProductPurchase: true, relevantTo: "none", needsPaymentMode: false, defaultSignForParty: 0, categoryPattern: "Stock Adjustment (Increase)", affectsLedgerPattern: "none" },
    { name: "Stock Adjustment (Decrease)", group: "inventory_adjustment", isProductSale: true, relevantTo: "none", needsPaymentMode: false, defaultSignForParty: 0, categoryPattern: "Stock Adjustment (Decrease)", affectsLedgerPattern: "none" },
];
async function openUserModal(user = null) {
    const modal = document.getElementById("userModal");
    const form = document.getElementById("userForm");
    const modalTitle = document.getElementById("userModalTitle");

    if (!modal || !form || !modalTitle) {
        console.error("User modal, form, or title element not found in DOM!");
        alert("Error: Cannot open the customer details form.");
        return;
    }

    form.reset();
    editingUserId = null; 
    modalTitle.textContent = "Add New Customer"; 

    if (user) {
        editingUserId = user.id;
        modalTitle.textContent = `Edit Customer: ${user.username}`;
        
        document.getElementById("username").value = user.username || "";
        document.getElementById("email").value = user.email || "";
        document.getElementById("phone").value = user.phone || "";
        document.getElementById("company").value = user.company || "";
        document.getElementById("balance").value = user.initial_balance !== undefined ? user.initial_balance : 0;
        document.getElementById("address_line1").value = user.address_line1 || "";
        document.getElementById("address_line2").value = user.address_line2 || "";
        document.getElementById("city_pincode").value = user.city_pincode || "";
        document.getElementById("state").value = user.state || "";
        document.getElementById("gstin").value = user.gstin || "";
        document.getElementById("state_code").value = user.state_code || "";
    }
    
    modal.classList.add('show');
}

// In app-script.js

function closeUserModal() {
    const modal = document.getElementById("userModal");
    if (modal) {
        // Use the class to hide the modal
        modal.classList.remove('show');
    }
    // Clear the editing state so the next open is for a "new" user
    editingUserId = null; 
}
async function apiFetch(endpoint, options = {}) {
    const token = localStorage.getItem('erp-token');
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(endpoint, { ...options, headers });

    if (res.status === 401) {
        // Unauthorized - token is invalid or expired
        logout(); // Force logout
        return; // Stop execution
    }
    return res;
}

// FIX: This is the new, more robust application entry point logic.
document.addEventListener("DOMContentLoaded", () => {
    // This script runs on all pages (login.html, index.html)
    // We need to determine which page we're on.
    const isAuthPage = window.location.pathname.endsWith('/login.html') || window.location.pathname.endsWith('/signup.html');

    // If we are NOT on an auth page, we must be logged in.
    if (!isAuthPage) {
        // If there's no token, redirect to login immediately.
        if (!localStorage.getItem('erp-token')) {
            window.location.replace('/login.html');
            return; // Stop further execution
        }
        // If a token exists, initialize the main application.
        initializeApp();
    } 
    // If we ARE on an auth page, no further action is needed here.
    // The script in login.html will handle the form submission.
});
async function initializeApp() {
    try {
        // CORRECTED: The API endpoint now matches the one defined in server.js
        const res = await apiFetch(`${API}/jwt-auth/me`);

        if (!res || !res.ok) {
            // This happens if the token is present but invalid (e.g., expired, tampered).
            throw new Error('Session is invalid or expired. Please log in again.');
        }
        
        currentUser = await res.json();
        console.log("Authenticated user:", currentUser);

        // If we successfully get user data, proceed to build the app UI.
        updateHeaderProfile(currentUser);
        setupEventListeners();
        loadInitialData();
        setupNavigation();

    } catch (error) {
        console.error("Authentication check failed:", error.message);
        logout(); // The token was bad, so clear it and redirect to login.
    }
}
function updateHeaderProfile(user) {
    if (!user) return;
    const userNameEl = document.querySelector('.user-profile .user-name');
    const userRoleEl = document.querySelector('.user-profile .user-role');

    if (userNameEl) userNameEl.textContent = user.username;
    if (userRoleEl) userRoleEl.textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);
}

function logout() {
    localStorage.removeItem('erp-token');
    currentUser = null;
    usersDataCache = [];
    allTransactionsCache = [];
    externalEntitiesCache = [];
    businessAgreementsCache = [];
    productsCache = [];
    invoicesCache = [];
    window.location.replace('/login.html');
}


function getSectionIdFromPath(path = window.location.pathname) {
    const map = {
        '/': 'dashboardAnalytics',
        '/index.html': 'dashboardAnalytics',
        '/dashboard': 'dashboardAnalytics',
        '/customers': 'customerManagementSection',
        '/suppliers': 'supplierManagementSection',
        '/inventory': 'inventoryManagementSection',
        '/invoices': 'invoiceManagementSection',
        '/transactions': 'allTransactionsSection',
        '/ledgers': 'ledgersSection',
        '/finance': 'businessFinanceSection',
        '/reports': 'reportsSection'
    };
    return map[path] || 'dashboardAnalytics';
}

async function loadInitialData() {
    await Promise.all([
        loadUsers(),
        loadAllTransactions(), 
        loadLenders(null, true), 
        loadProducts(),
        loadInvoices(),
        loadBusinessProfile(),
        loadNotifications()
    ]);
    await loadBusinessExternalFinanceAgreements();
    populateTransactionCategoryDropdown();
    const initialSectionId = getSectionIdFromPath();
    navigateToSection(initialSectionId);
}

async function loadBusinessProfile() {
    if (isLoading.businessProfile && businessProfileCache)
        return businessProfileCache;
    isLoading.businessProfile = true;
    try {
        const res = await apiFetch(`${API}/invoices/config/business-profile`);
        if (!res || !res.ok) {
            const errText = await res
                .text()
                .catch(() => "Could not read error response.");
            console.error(
                `Business Profile fetch failed: ${res.status} ${errText}`,
            );
            businessProfileCache = getDefaultBusinessProfile();
            return businessProfileCache;
        }
        const data = await res.json();
        businessProfileCache =
            data && Object.keys(data).length > 0
                ? data
                : getDefaultBusinessProfile();
        return businessProfileCache;
    } catch (error) {
        console.error("Error loading business profile:", error.message);
        businessProfileCache = getDefaultBusinessProfile();
        return businessProfileCache;
    } finally {
        isLoading.businessProfile = false;
    }
}

function getDefaultBusinessProfile() {
    return {
        company_name: "ADVENTURER EXPORT",
        gstin: "33ABCFA3111D1ZF",
        address_line1: "3/2B, Nesavalar Colony, 2 nd street,PN Road",
        address_line2: "",
        city_pincode: "TIRUPUR-641 602",
        state: "TAMILNADU",
        state_code: "33",
        phone: "9791902205,9842880404",
        email: "contact@adventurerexport.com",
        bank_name: "ICICI",
        bank_account_no: "106105501618",
        bank_ifsc_code: "ICIC0001061",
        logo_url: "",
    };
}
function setupEventListeners() {
    // --- START: CORRECTED SIDEBAR LOGIC ---
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
    const mainContentWrapper = document.querySelector('.main-content-wrapper');

    const handleSidebarToggle = () => {
        sidebar.classList.toggle('open');
        // On desktop, adjust the main content margin when toggling
        if (window.innerWidth > 992) {
            mainContentWrapper.classList.toggle('sidebar-collapsed', !sidebar.classList.contains('open'));
        }
    };

    const handleResize = () => {
        if (window.innerWidth > 992) {
            // Desktop: Ensure sidebar is open and content has correct margin
            sidebar.classList.add('open');
            mainContentWrapper.classList.remove('sidebar-collapsed');
        } else {
            // Mobile: Ensure sidebar is closed and content takes full width
            sidebar.classList.remove('open');
            mainContentWrapper.classList.add('sidebar-collapsed');
        }
    };

    if (menuToggle && sidebar && mainContentWrapper) {
        menuToggle.addEventListener('click', handleSidebarToggle);
    }
    if (sidebarCloseBtn && sidebar) {
        sidebarCloseBtn.addEventListener('click', () => sidebar.classList.remove('open'));
    }
    
    // Set initial state on load and on resize
    window.addEventListener('resize', handleResize);
    handleResize(); // Call once on initial load
    // --- END: CORRECTED SIDEBAR LOGIC ---

    const companyExpenseForm = document.getElementById("companyExpenseForm");
    if(companyExpenseForm) companyExpenseForm.addEventListener('submit', handleCompanyExpenseSubmit);

    document.getElementById("loanFundsReceiptForm").addEventListener('submit', handleLoanFundsReceiptSubmit);
    document.getElementById("userForm").addEventListener("submit", handleUserSubmit);
    document.getElementById('openingBalanceForm').addEventListener('submit', handleOpeningBalanceSubmit);
    document.getElementById("transactionForm").addEventListener("submit", handleTransactionSubmit);
    document.getElementById("lenderForm").addEventListener("submit", handleLenderSubmit);
    document.getElementById("businessChitLoanAgreementForm").addEventListener("submit", handleBusinessChitLoanAgreementSubmit);
    document.getElementById("productForm").addEventListener("submit", handleProductSubmit);
    document.getElementById("invoiceForm").addEventListener("submit", handleInvoiceSubmit);
    document.getElementById("productSupplierLinkForm").addEventListener("submit", handleProductSupplierLinkSubmit);
    document.getElementById('repayLoanForm').addEventListener('submit', handleLoanRepaymentSubmit);
    
    const customerBalanceForm = document.getElementById('customerBalanceForm');
    if(customerBalanceForm) customerBalanceForm.addEventListener('submit', handleCustomerBalanceSubmit);
    
    const existingLoanForm = document.getElementById('existingLoanForm');
    if(existingLoanForm) existingLoanForm.addEventListener('submit', handleExistingLoanSubmit);
    
    const userTxHistoryFilter = document.getElementById("userTxHistoryCategoryFilter");
    if (userTxHistoryFilter) {
        userTxHistoryFilter.addEventListener("change", (e) => {
            const userId = e.target.dataset.userId;
            const userName = e.target.dataset.userName;
            if (userId && userName) {
                loadUserTransactionHistory(
                    parseInt(userId),
                    userName,
                    e.target.value,
                );
            }
        });
    }
    const notificationBell = document.getElementById('notificationBell');
    if (notificationBell) {
        notificationBell.addEventListener('click', (event) => {
            event.stopPropagation();
            const dropdown = document.getElementById('notificationDropdown');
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';

            if (dropdown.style.display === 'block' && unreadNotificationsCache.length > 0) {
                markNotificationsAsRead();
            }
        });

        document.addEventListener('click', (event) => {
            const dropdown = document.getElementById('notificationDropdown');
            if (dropdown && !dropdown.contains(event.target) && !notificationBell.contains(event.target)) {
                dropdown.style.display = 'none';
            }
        });
    }

    const globalSearchInputElem = document.getElementById("globalSearchInput");
    if (globalSearchInputElem) {
        globalSearchInputElem.addEventListener("keypress", (e) => {
            if (e.key === "Enter") performGlobalSearch();
        });
    }

    const cashLedgerDateInput = document.getElementById("cashLedgerDate");
    if (cashLedgerDateInput)
        cashLedgerDateInput.addEventListener("change", () => loadCashLedger());
    const bankLedgerDateInput = document.getElementById("bankLedgerDate");
    if (bankLedgerDateInput)
        bankLedgerDateInput.addEventListener("change", () => loadBankLedger());

    const invoiceTypeDropdown = document.getElementById("inv_invoice_type");
    if (invoiceTypeDropdown) {
        invoiceTypeDropdown.addEventListener("change", () => {
            toggleGstFields();
            togglePartyBillReturnsField();
            toggleConsigneeFields();
        });
    }
    const sameAsCustomerCheckbox = document.getElementById(
        "inv_same_as_customer",
    );
    if (sameAsCustomerCheckbox) {
        sameAsCustomerCheckbox.addEventListener(
            "change",
            toggleConsigneeFields,
        );
    }
    const customerDropdownForInvoice =
        document.getElementById("inv_customer_id");
    if (customerDropdownForInvoice) {
        customerDropdownForInvoice.addEventListener(
            "change",
            populateCustomerDetailsForInvoice,
        );
    }
    
    // START: ADD THIS NEW BLOCK FOR INVOICE PAYMENT METHOD
    const invPaymentInput = document.getElementById("inv_payment_being_made_now");
    if (invPaymentInput) {
        invPaymentInput.addEventListener('input', () => {
            const amount = parseFloat(invPaymentInput.value) || 0;
            const paymentMethodGroup = document.getElementById("inv_payment_method_group");
            if (paymentMethodGroup) {
                paymentMethodGroup.style.display = (amount !== 0) ? 'block' : 'none';
            }
        });
    }
    // END: ADD THIS NEW BLOCK FOR INVOICE PAYMENT METHOD

    const txPartyTypeCustomerRadio = document.getElementById(
        "txPartyTypeCustomer",
    );
    const txPartyTypeLenderRadio = document.getElementById("txPartyTypeLender");
    if (txPartyTypeCustomerRadio)
        txPartyTypeCustomerRadio.addEventListener(
            "change",
            toggleTxPartyDropdowns,
        );
    if (txPartyTypeLenderRadio)
        txPartyTypeLenderRadio.addEventListener(
            "change",
            toggleTxPartyDropdowns,
        );

    const lenderEntityTypeDropdown =
        document.getElementById("lenderEntityType");
    if (lenderEntityTypeDropdown)
        lenderEntityTypeDropdown.addEventListener(
            "change",
            toggleInitialPayableField,
        );
    
    const categoryDropdownInModal = document.getElementById("category"); // This is the base category dropdown
    if (categoryDropdownInModal) {
        categoryDropdownInModal.addEventListener("change", () => {
            const selectedBaseCategoryName = categoryDropdownInModal.value;
            const baseCatInfo = baseTransactionCategories.find(c => c.name === selectedBaseCategoryName);
            const paymentModeGroup = document.getElementById("paymentModeGroup");
            if (paymentModeGroup) {
                paymentModeGroup.style.display = (baseCatInfo && baseCatInfo.needsPaymentMode) ? 'flex' : 'none';
            }
            // Logic for line items and amount field readOnly status (from openTransactionModal)
            const lineItemsSection = document.getElementById("transactionLineItemsSection");
            const lineItemsTableBody = document.getElementById("txLineItemsTableBody");
            const amountField = document.getElementById("amount");
            const amountLabel = document.querySelector('label[for="amount"]');

            const isProductInvolved = baseCatInfo && (baseCatInfo.isProductSale || baseCatInfo.isProductPurchase);

            if (lineItemsSection) {
                lineItemsSection.style.display = isProductInvolved ? "block" : "none";
                if ( isProductInvolved && lineItemsTableBody && lineItemsTableBody.rows.length === 0 ) {
                    addTxLineItemRow();
                }
            }
            if (amountLabel) {
                amountLabel.textContent = (baseCatInfo && isProductInvolved) ? "Total Item Amount (₹):" : "Amount (₹):";
            }
            if (amountField){
                amountField.readOnly = !!isProductInvolved; 
                if(isProductInvolved) updateTxGrandTotal();
            }
        });
    }
    
    const headerAddButton = document.getElementById('headerAddButton');
    const addNewDropdown = document.getElementById('addNewDropdown');
    if(headerAddButton && addNewDropdown) {
        headerAddButton.addEventListener('click', (event) => {
            event.stopPropagation();
            addNewDropdown.style.display = addNewDropdown.style.display === 'block' ? 'none' : 'block';
        });
        document.addEventListener('click', (event) => {
            if (!headerAddButton.contains(event.target) && !addNewDropdown.contains(event.target)) {
                addNewDropdown.style.display = 'none';
            }
        });
    }
}//ADD THESE NEW FUNCTIONS TO SCRIPT.JS ---

async function loadNotifications() {
    try {
        const res = await apiFetch(`${API}/notifications`);
        if (!res || !res.ok) throw new Error('Failed to load notifications');
        
        unreadNotificationsCache = await res.json();
        updateNotificationUI();
    } catch (error) {
        console.error("Error loading notifications:", error.message);
    }
}

function updateNotificationUI() {
    const countBadge = document.getElementById('notificationCount');
    const notificationList = document.getElementById('notificationList');
    if (!countBadge || !notificationList) return;

    if (unreadNotificationsCache.length > 0) {
        countBadge.textContent = unreadNotificationsCache.length;
        countBadge.style.display = 'inline-block';

        const iconMap = {
            'info': 'fa-info-circle',
            'success': 'fa-check-circle',
            'warning': 'fa-exclamation-triangle',
            'danger': 'fa-exclamation-circle'
        };

        notificationList.innerHTML = unreadNotificationsCache.map(n => `
            <div class="notification-item" data-link="${n.link || '#'}">
                <div class="notification-icon ${n.type}">
                    <i class="fas ${iconMap[n.type] || 'fa-bell'}"></i>
                </div>
                <div class="notification-content">
                    <p>${n.message}</p>
                    <div class="time">${formatTimeAgo(n.created_at)}</div>
                </div>
            </div>
        `).join('');
        
        // Add click listeners to navigate
        document.querySelectorAll('.notification-item').forEach(item => {
            item.addEventListener('click', () => {
                const link = item.dataset.link;
                if (link && link !== '#') {
                    // This is a simple navigation. A more advanced router would be better.
                    const section = link.split('#')[0].substring(1); // e.g., 'inventory'
                    navigateToSection(`${section}ManagementSection`);
                }
                 document.getElementById('notificationDropdown').style.display = 'none';
            });
        });

    } else {
        countBadge.style.display = 'none';
        notificationList.innerHTML = '<div class="notification-item-placeholder">No new notifications</div>';
    }
}

async function markNotificationsAsRead() {
    if (unreadNotificationsCache.length === 0) return;

    const idsToMark = unreadNotificationsCache.map(n => n.id);
    
    // Optimistically update UI
    const countBadge = document.getElementById('notificationCount');
    if(countBadge) countBadge.style.display = 'none';
    unreadNotificationsCache = []; // Clear cache

    try {
        await apiFetch(`${API}/notifications/mark-as-read`, {
            method: 'PUT',
            body: JSON.stringify({ ids: idsToMark })
        });
        // No need to do anything on success, UI is already updated
    } catch (error) {
        console.error("Failed to mark notifications as read on backend:", error.message);
        // If it fails, we could potentially reload notifications to show the badge again
    }
}

function closeAddNewDropdown() {
    const addNewDropdown = document.getElementById('addNewDropdown');
    if (addNewDropdown) addNewDropdown.style.display = 'none';
}


function navigateToSection(sectionId) {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.app-section').forEach(sec => sec.style.display = 'none');

    const targetNavItem = document.querySelector(`.sidebar-nav .nav-item[data-section="${sectionId}"]`);
    const targetSection = document.getElementById(sectionId);
    const mainHeader = document.getElementById("mainHeaderText");

    if (targetNavItem && targetSection) {
        targetNavItem.classList.add('active');
        targetSection.style.display = 'block';

        let headerText = targetNavItem.textContent.replace(/[0-9]/g, '').trim();
        if (headerText.includes("Dashboard")) headerText = "Dashboard";
        else if (headerText.includes("Customers")) headerText = "Customer Management";
        else if (headerText.includes("Suppliers")) headerText = "Supplier Management";
        else if (headerText.includes("Inventory")) headerText = "Inventory Management";
        else if (headerText.includes("Invoices")) headerText = "Invoice Management";
        else if (headerText.includes("Transactions")) headerText = "All Transactions";
        else if (headerText.includes("Company")) headerText = "Company Operations";
        else if (headerText.includes("Ledgers")) headerText = "Business Ledgers";
        else if (headerText.includes("Business Finance")) headerText = "Business Finance";
        else if (headerText.includes("Reports")) headerText = "Reports & Analytics";
         else if (sectionId === "companySection") {
        loadAndDisplayCompanyExpenses();
    }
        if(mainHeader) mainHeader.textContent = headerText;

        if (sectionId === "dashboardAnalytics") {
            updateDashboardCards();
            initializeDashboardCharts();
            loadRecentActivity();
        } else if (sectionId === "customerManagementSection") {
            loadUsers().then(() => loadCustomerSummaries());
        } else if (sectionId === "supplierManagementSection") {
            loadSupplierSummaries();
        } else if (sectionId === "inventoryManagementSection") {
            loadProducts();
        } else if (sectionId === "invoiceManagementSection") {
            loadInvoices();
        } else if (sectionId === "allTransactionsSection") {
            loadAllTransactions();
        } 
          else if (sectionId === "companySection") {
            loadAndDisplayCompanyExpenses();
        }
         else if (sectionId === "ledgersSection") {
            showLedger('cash');
        }  else if (sectionId === "companySection") {
            loadAndDisplayCompanyExpenses();
        }
        else if (sectionId === "businessFinanceSection") {
            loadAllTransactions().then(() => {
                loadLenders(null, true).then(() => {
                    populateAgreementEntityDropdown();
                    loadBusinessExternalFinanceAgreements();
                });
            });
        } else if (sectionId === "reportsSection") {
            const reportPeriodMonth = document.getElementById('reportPeriodMonth');
            if (reportPeriodMonth) {
                reportPeriodMonth.value = new Date().toISOString().slice(0, 7);
            }
            const reportDisplayArea = document.getElementById('reportDisplayArea');
            if (reportDisplayArea) {
                reportDisplayArea.style.display = 'none';
                reportDisplayArea.innerHTML = ''; // Clear previous report
            }
        }
    } else {
        console.error(`ERROR: Could NOT find targetNavItem or targetSection for ${sectionId}`);
    }

    const globalSearchResultsDiv = document.getElementById("globalSearchResults");
    if (globalSearchResultsDiv) globalSearchResultsDiv.style.display = "none";
    const globalSearchInputElem = document.getElementById("globalSearchInput");
    if (globalSearchInputElem) globalSearchInputElem.value = "";

    if (window.innerWidth <= 992) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('open');
    }
}



function setupNavigation() {
    console.log("setupNavigation: Attaching navigation event listeners.");
    const navItems = document.querySelectorAll(".sidebar-nav .nav-item");
    
    if (navItems.length === 0) {
        console.error("setupNavigation: No navigation items found with '.sidebar-nav .nav-item'.");
        return;
    }

    navItems.forEach(item => {
        if (item.dataset.section) {
            item.addEventListener("click", (e) => {
                e.preventDefault();
                const sectionId = item.dataset.section;
                navigateToSection(sectionId);
            });
        }
    });
}
function getPeriodDateRanges(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let currentStart, currentEnd, previousStart, previousEnd;

    switch (period) {
        case 'last_month':
            currentStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            currentEnd = new Date(today.getFullYear(), today.getMonth(), 0);
            previousStart = new Date(today.getFullYear(), today.getMonth() - 2, 1);
            previousEnd = new Date(today.getFullYear(), today.getMonth() - 1, 0);
            break;

        case 'this_quarter':
            const quarter = Math.floor(today.getMonth() / 3);
            currentStart = new Date(today.getFullYear(), quarter * 3, 1);
            currentEnd = new Date(today.getFullYear(), quarter * 3 + 3, 0);
            previousStart = new Date(today.getFullYear(), (quarter - 1) * 3, 1);
            previousEnd = new Date(today.getFullYear(), quarter * 3, 0);
            break;

        case 'this_year':
            currentStart = new Date(today.getFullYear(), 0, 1);
            currentEnd = new Date(today.getFullYear(), 11, 31);
            previousStart = new Date(today.getFullYear() - 1, 0, 1);
            previousEnd = new Date(today.getFullYear() - 1, 11, 31);
            break;

        case 'this_month':
        default:
            currentStart = new Date(today.getFullYear(), today.getMonth(), 1);
            currentEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            previousStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            previousEnd = new Date(today.getFullYear(), today.getMonth(), 0);
            break;
    }
    return { currentStart, currentEnd, previousStart, previousEnd };
}

function calculatePercentageChange(current, previous) {
    if (previous === 0) {
        if (current > 0) return 100.0;
        return 0.0;
    }
    if (current === 0 && previous < 0) return 100.0; // From negative to zero is 100% improvement
    if (current === 0 && previous > 0) return -100.0; // From positive to zero is 100% loss

    return ((current - previous) / Math.abs(previous)) * 100;
}
function updateDashboardCards() {
    const customersOnly = usersDataCache.filter(user => user.role !== 'admin');

    const navCustomerCount = document.getElementById('navCustomerCount');
    const navSupplierCount = document.getElementById('navSupplierCount');
    const navInventoryCount = document.getElementById('navInventoryCount');
    const navInvoiceCount = document.getElementById('navInvoiceCount');

    if(navCustomerCount) navCustomerCount.textContent = customersOnly.length;
    if(navSupplierCount) navSupplierCount.textContent = externalEntitiesCache.filter(e => e.entity_type === 'Supplier').length;
    if(navInventoryCount) navInventoryCount.textContent = productsCache.length;
    if(navInvoiceCount) navInvoiceCount.textContent = invoicesCache.length;

    const period = document.getElementById('dashboardPeriod')?.value || 'this_month';
    const ranges = getPeriodDateRanges(period);

    let currentRevenue = 0;
    let previousRevenue = 0;
    let newCustomersCurrent = 0;

    // 1. Calculate revenue from invoices
    invoicesCache.forEach(inv => {
        const invDate = new Date(inv.invoice_date);
        if (inv.status !== 'Void' && inv.status !== 'Draft') {
            const revenue = parseFloat(inv.amount_before_tax || 0);
            if (invDate >= ranges.currentStart && invDate <= ranges.currentEnd) {
                currentRevenue += revenue;
            } else if (invDate >= ranges.previousStart && invDate <= ranges.currentEnd) { // Note: previousEnd should be used
                previousRevenue += revenue;
            }
        }
    });
    
    // --- THE FIX IS HERE ---
    // 2. Add revenue from direct transactions, EXCLUDING opening balances
    allTransactionsCache.forEach(tx => {
        const txDate = new Date(tx.date);
        const catInfo = transactionCategories.find(c => c.name === tx.category);

        // This is the critical check: ensure the group is not 'opening_balance'
        if (!catInfo || catInfo.group === 'opening_balance') {
            return; 
        }

        // Check if transaction is within the current period
        if (txDate >= ranges.currentStart && txDate <= ranges.currentEnd) {
            if (catInfo.type.includes('income') && !tx.related_invoice_id) {
                if(catInfo.group === 'customer_revenue' || catInfo.group === 'biz_ops') {
                     currentRevenue += parseFloat(tx.amount || 0);
                }
            }
        } 
        // Check if transaction is within the previous period for comparison
        else if (txDate >= ranges.previousStart && txDate <= ranges.previousEnd) { // Corrected to previousEnd
            if (catInfo.type.includes('income') && !tx.related_invoice_id) {
                 if(catInfo.group === 'customer_revenue' || catInfo.group === 'biz_ops') {
                    previousRevenue += parseFloat(tx.amount || 0);
                 }
            }
        }
    });
    
    customersOnly.forEach(user => {
        const joinDate = new Date(user.created_at);
        if (joinDate >= ranges.currentStart && joinDate <= ranges.currentEnd) {
            newCustomersCurrent++;
        }
    });
    
    const monthlyRevenueEl = document.getElementById("monthlyRevenue");
    if (monthlyRevenueEl) {
        monthlyRevenueEl.textContent = `₹${currentRevenue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }

    const revenueChangeEl = document.getElementById("revenueChange");
    if (revenueChangeEl) {
        const revenueChangePercent = calculatePercentageChange(currentRevenue, previousRevenue);
        revenueChangeEl.textContent = `${revenueChangePercent >= 0 ? '+' : ''}${revenueChangePercent.toFixed(1)}%`;
        revenueChangeEl.className = revenueChangePercent >= 0 ? 'kpi-change positive' : 'kpi-change negative';
    }

    const totalCustomersEl = document.getElementById("totalCustomers");
    if(totalCustomersEl) totalCustomersEl.textContent = customersOnly.length;
    
    const customersChangeEl = document.getElementById("customersChange");
    if(customersChangeEl) customersChangeEl.textContent = `+${newCustomersCurrent} new`;
    
    const totalProductsEl = document.getElementById("totalProducts");
    if(totalProductsEl) totalProductsEl.textContent = productsCache.length;

    const pendingInv = invoicesCache.filter(inv => inv.status !== "Paid" && inv.status !== "Void");
    const pendingAmt = pendingInv.reduce((sum, inv) => sum + parseFloat(inv.total_amount || 0) - parseFloat(inv.paid_amount || 0), 0);
    
    const pendingInvoicesEl = document.getElementById("pendingInvoices");
    if(pendingInvoicesEl) pendingInvoicesEl.textContent = `${pendingInv.length} invoices`;
    
    const pendingAmountEl = document.getElementById("pendingAmount");
    if(pendingAmountEl) pendingAmountEl.textContent = `₹${pendingAmt.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    const lowStockCount = productsCache.filter(p => p.low_stock_threshold > 0 && p.current_stock <= p.low_stock_threshold).length;
    const lowStockAlertEl = document.getElementById("lowStockAlert");
    if(lowStockAlertEl){
        lowStockAlertEl.textContent = `${lowStockCount} low stock`;
        lowStockAlertEl.style.color = lowStockCount > 0 ? 'var(--danger-color)' : 'var(--text-light-color)';
    }
    
    const todayStr = new Date().toISOString().split('T')[0];
    const todaysInvoices = invoicesCache.filter(inv => inv.invoice_date.startsWith(todayStr) && inv.status !== 'Void' && inv.status !== 'Draft');
    const todaysRevenue = todaysInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount_before_tax || 0), 0);
    const avgOrderValue = todaysInvoices.length > 0 ? todaysRevenue / todaysInvoices.length : 0;
    
    const todayRevenueEl = document.getElementById('todayRevenue');
    if(todayRevenueEl) todayRevenueEl.textContent = `₹${todaysRevenue.toFixed(2)}`;
    
    const todayOrdersEl = document.getElementById('todayOrders');
    if(todayOrdersEl) todayOrdersEl.textContent = todaysInvoices.length;

    const todayAvgOrderEl = document.getElementById('todayAvgOrder');
    if(todayAvgOrderEl) todayAvgOrderEl.textContent = `₹${avgOrderValue.toFixed(2)}`;
}
async function populateUserDropdown() {
    try {
        if (!Array.isArray(usersDataCache) || (usersDataCache.length === 0 && !isLoading.users)) {
            await loadUsers();
        }
        
        const dropdown = document.getElementById("transaction_user_id");
        if (!dropdown) return;

        const customersOnly = usersDataCache.filter(user => user.role !== 'admin');

        const currentValue = dropdown.value;
        dropdown.innerHTML = '<option value="">Select Customer...</option>';
        
        if (Array.isArray(customersOnly)) {
            customersOnly.forEach((user) => {
                const option = document.createElement("option");
                option.value = user.id;
                option.textContent = `${user.username} (ID: ${user.id})`;
                dropdown.appendChild(option);
            });
        }

        if (currentValue) {
            const exists = customersOnly.some((user) => user.id == currentValue);
            if (exists) {
                dropdown.value = currentValue;
            }
        }
    } catch (error) {
        console.error("Error populating user dropdown:", error.message);
    }
}
function populateTransactionCategoryDropdown() {
    const dropdown = document.getElementById("category"); 
    if (!dropdown) {
        return;
    }
    const currentValue = dropdown.value;
    dropdown.innerHTML = '<option value="">Select Base Category...</option>';
    baseTransactionCategories.forEach((cat) => { 
        const option = document.createElement("option");
        option.value = cat.name; 
        option.textContent = cat.name;
        dropdown.appendChild(option);
    });
    if (currentValue) dropdown.value = currentValue;

    const paymentModeGroup = document.getElementById("paymentModeGroup");
    if(paymentModeGroup) paymentModeGroup.style.display = 'none';
}


async function populateLenderDropdownForTxModal() {
    const dropdown = document.getElementById("transaction_lender_id");
    if (!dropdown) return;
    try {
        let entitiesToUse = externalEntitiesCache;
        if (
            !Array.isArray(entitiesToUse) ||
            (entitiesToUse.length === 0 && !isLoading.lenders)
        ) {
            entitiesToUse = await loadLenders();
        }
        dropdown.innerHTML =
            '<option value="">Select Supplier/External Entity...</option>';
        if (Array.isArray(entitiesToUse)) {
            entitiesToUse.forEach((entity) => {
                const option = document.createElement("option");
                option.value = entity.id;
                option.textContent = `${entity.lender_name} (${entity.entity_type || 'General'})`;
                dropdown.appendChild(option);
            });
        }
    } catch (e) {
        console.error("Error populating lender dropdown for Tx modal", e);
        if (dropdown)
            dropdown.innerHTML = '<option value="">Error loading</option>';
    }
}

async function populateAgreementDropdownForTxModal() {
    const dropdown = document.getElementById("transaction_agreement_id");
    if (!dropdown) return;
    try {
        let agreementsToUse = businessAgreementsCache;
        if (
            !Array.isArray(agreementsToUse) ||
            (agreementsToUse.length === 0 && !isLoading.businessAgreements)
        ) {
            agreementsToUse = await loadBusinessExternalFinanceAgreements();
        }
        dropdown.innerHTML =
            '<option value="">Link to Business Agreement (Optional)...</option>';
        if (Array.isArray(agreementsToUse)) {
            agreementsToUse.forEach((agreement) => {
                const option = document.createElement("option");
                option.value = agreement.agreement_id;
                option.textContent = `AGR-${agreement.agreement_id}: ${agreement.lender_name} (${agreement.agreement_type.replace(/_/g, " ")})`;
                dropdown.appendChild(option);
            });
        }
    } catch (e) {
        console.error("Error populating agreement dropdown for Tx modal", e);
        if (dropdown)
            dropdown.innerHTML = '<option value="">Error loading</option>';
    }
}
async function loadUsers() {
    if (isLoading.users) return usersDataCache;
    isLoading.users = true;
    try {
        const res = await apiFetch(`${API}/users`);
        if (!res || !res.ok) throw new Error('Failed to fetch users');
        usersDataCache = await res.json();
        return usersDataCache;
    } catch (error) {
        console.error("Error loading users:", error.message);
        return [];
    } finally {
        isLoading.users = false;
    }
}
async function loadAllTransactions() {
    if (isLoading.transactions) return allTransactionsCache;
    isLoading.transactions = true;
    const tableBody = document.querySelector("#allTransactionsSection #transactionTable tbody");
    if(tableBody) tableBody.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';
    try {
        const res = await apiFetch(`${API}/transactions`);
        if (!res || !res.ok) throw new Error('Failed to fetch transactions');
        allTransactionsCache = await res.json();
        displayTransactions(allTransactionsCache);
        return allTransactionsCache;
    } catch (error) {
        console.error("Error loading transactions:", error.message);
        if(tableBody) tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Error loading transactions. Check console.</td></tr>`;
        return [];
    } finally {
        isLoading.transactions = false;
    }
}
// Replace the existing displayTransactions function
function displayTransactions(transactionsToDisplay) {
    const table = document.getElementById("transactionTable");
    if (!table) {
        console.error("Transaction table not found in DOM for displayTransactions");
        return;
    }
    const tbody = table.querySelector("tbody") || table;
    tbody.innerHTML = "";
    if (
        !Array.isArray(transactionsToDisplay) ||
        transactionsToDisplay.length === 0
    ) {
        tbody.innerHTML =
            '<tr><td colspan="7" style="text-align:center;">No transactions found.</td></tr>';
        return;
    }

    // Correctly sort by date descending, then by ID descending
    const sortedTransactions = transactionsToDisplay.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        if (dateB - dateA !== 0) {
            return dateB - dateA;
        }
        return b.id - a.id;
    });
    
    // --- FIX: Initialize serial number to total count and decrement ---
    let serialNumber = sortedTransactions.length;

    sortedTransactions.forEach((tx) => {
        const row = tbody.insertRow();
        let displayName = "N/A (Business)";
        if (tx.user_id) {
            const user = usersDataCache.find((u) => u.id === tx.user_id);
            displayName = user ? user.username : `Cust. ID ${tx.user_id}`;
        } else if (tx.lender_id) {
            const entity = externalEntitiesCache.find(
                (e) => e.id === tx.lender_id,
            );
            displayName = entity
                ? entity.lender_name
                : tx.external_entity_name || `Ext. ID ${tx.lender_id}`;
        }

        const ledgerAmount = parseFloat(tx.amount);
        const catInfo = transactionCategories.find(c => c.name === tx.category);

        let amountClass = '';
        let displayAmount = Math.abs(ledgerAmount);

        if (catInfo) {
            if (catInfo.type.includes('income') && !catInfo.type.includes('liability')) {
                amountClass = 'positive';
            } 
            else if (catInfo.type.includes('income') && catInfo.type.includes('liability')) {
                amountClass = 'info'; 
            }
            else if (catInfo.type.includes('expense')) {
                amountClass = 'negative';
            }
            else if (catInfo.type === 'receivable_increase') {
                amountClass = 'receivable'; 
            }
            else if (catInfo.type === 'payable_increase') {
                amountClass = 'negative'; 
            }
            else {
                amountClass = ledgerAmount >= 0 ? 'positive' : 'negative';
            }
        } else {
            amountClass = ledgerAmount >= 0 ? 'positive' : 'negative';
        }
        
        const txDate = new Date(tx.date + 'T00:00:00');
        const formattedDate = `${String(txDate.getDate()).padStart(2, '0')}-${txDate.toLocaleString('default', { month: 'short' })}-${txDate.getFullYear()}`;

        row.innerHTML = `
            <td>${serialNumber--}</td>
            <td>${displayName}</td>
            <td class="num ${amountClass}">₹${displayAmount.toFixed(2)}</td>
            <td>${tx.description || "-"}</td>
            <td>${tx.category || "-"}</td>
            <td>${formattedDate}</td>
            <td>
              <button class='btn btn-info btn-sm' onclick='openTransactionModal(${JSON.stringify(tx)})'><i class="fas fa-edit"></i></button>
              <button class='btn btn-danger btn-sm' onclick='deleteTransaction(${tx.id})'><i class="fas fa-trash"></i></button>
            </td>`;
    });
}
function showLedger(type) {
    document.getElementById("cashLedgerContent").style.display = "none";
    document.getElementById("bankLedgerContent").style.display = "none";
    document
        .querySelectorAll(".ledger-tab-btn")
        .forEach((btn) => btn.classList.remove("active"));

    if (type === "cash") {
        document.getElementById("cashLedgerContent").style.display = "block";
        document
            .querySelector('.ledger-tab-btn[onclick*="cash"]')
            .classList.add("active");
        loadCashLedger();
    } else if (type === "bank") {
        document.getElementById("bankLedgerContent").style.display = "block";
        document
            .querySelector('.ledger-tab-btn[onclick*="bank"]')
            .classList.add("active");
        loadBankLedger();
    }
}
async function loadCashLedger(date = null) {
    const selectedDate =
        date ||
        document.getElementById("cashLedgerDate")?.value ||
        new Date().toISOString().split("T")[0];
    const ledgerDateElem = document.getElementById("cashLedgerDate");
    if (ledgerDateElem) ledgerDateElem.value = selectedDate;

    const table = document.getElementById("cashLedgerTable");
    if (!table) return;
    const tbody = table.querySelector("tbody");
    const tfoot =
        table.querySelector("tfoot") ||
        table.appendChild(document.createElement("tfoot"));
    tbody.innerHTML =
        '<tr><td colspan="7" style="text-align:center;">Loading cash ledger...</td></tr>';
    tfoot.innerHTML = "";

    try {
        if(usersDataCache.length === 0 && !isLoading.users) await loadUsers();
        if(allTransactionsCache.length === 0 && !isLoading.transactions) await loadAllTransactions();
        if(externalEntitiesCache.length === 0 && !isLoading.lenders) await loadLenders();

        let openingCashBalance = 0;
        allTransactionsCache
            .filter((t) => new Date(t.date) < new Date(selectedDate))
            .forEach((t) => {
                const catInfo = transactionCategories.find( 
                    (c) => c.name === t.category,
                );
                if (!catInfo || !catInfo.affectsLedger || !catInfo.affectsLedger.includes("cash")) return;
                
                let actualCashFlow = 0;
                if (catInfo.type.includes("income")) {
                    actualCashFlow = Math.abs(parseFloat(t.amount || 0));
                } else if (catInfo.type.includes("expense")) {
                    actualCashFlow = -Math.abs(parseFloat(t.amount || 0));
                } else if (catInfo.name === 'Cash Withdrawn from Bank') {
                    actualCashFlow = Math.abs(parseFloat(t.amount || 0));
                } else if (catInfo.name === 'Cash Deposited to Bank') {
                    actualCashFlow = -Math.abs(parseFloat(t.amount || 0));
                }
                openingCashBalance += actualCashFlow;
            });
        
        const entries = allTransactionsCache
            .filter((t) => {
                const catInfo = transactionCategories.find( 
                    (c) => c.name === t.category,
                );
                return (
                    t.date === selectedDate &&
                    catInfo &&
                    catInfo.affectsLedger &&
                    catInfo.affectsLedger.includes("cash")
                );
            })
            .sort((a, b) => a.id - b.id);


        tbody.innerHTML = "";
        const openingRow = tbody.insertRow();
        openingRow.innerHTML = `<td>${formatLedgerDate(selectedDate)}</td><td colspan="3">Opening Cash Balance</td><td></td><td></td><td class="num ${openingCashBalance >= 0 ? "positive-balance" : "negative-balance"}">₹${openingCashBalance.toFixed(2)}</td>`;


        let runningCashBalance = openingCashBalance;
        let dailyTotalDebits = 0; 
        let dailyTotalCredits = 0; 

        if (entries.length === 0) {
            tbody.innerHTML +=
                '<tr><td colspan="7" style="text-align:center;">No cash transactions for this day.</td></tr>';
        } else {
            entries.forEach((entry) => {
                const catInfo = transactionCategories.find( 
                    (c) => c.name === entry.category,
                );
                let debit = ""; 
                let credit = ""; 
                let actualCashFlowForEntry = 0;

                if (catInfo.type.includes("income")) {
                     actualCashFlowForEntry = Math.abs(parseFloat(entry.amount || 0));
                } else if (catInfo.type.includes("expense")) {
                    actualCashFlowForEntry = -Math.abs(parseFloat(entry.amount || 0));
                } else if (catInfo.name === 'Cash Withdrawn from Bank') { 
                     actualCashFlowForEntry = Math.abs(parseFloat(entry.amount || 0));
                } else if (catInfo.name === 'Cash Deposited to Bank') { 
                    actualCashFlowForEntry = -Math.abs(parseFloat(entry.amount || 0));
                }
                
                if(actualCashFlowForEntry > 0) {
                    debit = actualCashFlowForEntry.toFixed(2);
                    dailyTotalDebits += actualCashFlowForEntry;
                } else {
                    credit = Math.abs(actualCashFlowForEntry).toFixed(2);
                    dailyTotalCredits += Math.abs(actualCashFlowForEntry);
                }

                runningCashBalance += actualCashFlowForEntry;


                let displayName = "N/A (Business Internal)";
                if (entry.user_id) {
                    const user = usersDataCache.find( (u) => u.id === entry.user_id, );
                    displayName = user ? user.username : `Cust. ID ${entry.user_id}`;
                } else if (entry.lender_id) {
                    const entity = externalEntitiesCache.find( (e) => e.id === entry.lender_id, );
                    displayName = entity ? entity.lender_name : `Ext. Entity ID ${entry.lender_id}`;
                }

                const row = tbody.insertRow();
                row.innerHTML = `<td>${formatLedgerDate(entry.date)}</td><td>${displayName}</td><td>${entry.description || "-"}</td><td>${entry.category || "-"}</td><td class="num positive">${debit ? "₹" + debit : ""}</td><td class="num negative">${credit ? "₹" + credit : ""}</td><td class="num ${runningCashBalance >= 0 ? "positive-balance" : "negative-balance"}">₹${runningCashBalance.toFixed(2)}</td>`;
            });
        }
        const dailyNetChange = dailyTotalDebits - dailyTotalCredits;
        tfoot.innerHTML = `<tr><td colspan="7" style="padding-top:10px; border-top: 1px solid #ccc;"></td></tr><tr><td colspan="4" style="text-align: right;"><strong>Totals for Day:</strong></td><td class="positive"><strong>₹${dailyTotalDebits.toFixed(2)}</strong></td><td class="negative"><strong>₹${dailyTotalCredits.toFixed(2)}</strong></td><td></td></tr><tr><td colspan="4" style="text-align: right;"><strong>Net Cash Flow for Day:</strong></td><td colspan="2" class="num ${dailyNetChange >= 0 ? "positive" : "negative"}" style="text-align:center;"><strong>₹${dailyNetChange.toFixed(2)}</strong></td><td></td></tr><tr><td colspan="4" style="text-align: right;"><strong>Closing Cash Balance:</strong></td><td colspan="2" class="num ${runningCashBalance >= 0 ? "positive-balance" : "negative-balance"}" style="text-align:center;"><strong>₹${runningCashBalance.toFixed(2)}</strong></td><td></td></tr>`;
    } catch (error) {
        console.error("Failed to load cash ledger:", error);
        if(tbody)
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Error: ${error.message}</td></tr>`;
    }
}
async function loadBankLedger(date = null) {
    const selectedDate =
        date ||
        document.getElementById("bankLedgerDate")?.value ||
        new Date().toISOString().split("T")[0];
    const ledgerDateElem = document.getElementById("bankLedgerDate");
    if (ledgerDateElem) ledgerDateElem.value = selectedDate;

    const table = document.getElementById("bankLedgerTable");
    if (!table) return;
    const tbody = table.querySelector("tbody");
    const tfoot =
        table.querySelector("tfoot") ||
        table.appendChild(document.createElement("tfoot"));
    tbody.innerHTML =
        '<tr><td colspan="7" style="text-align:center;">Loading bank ledger...</td></tr>';
    tfoot.innerHTML = "";

    try {
        if(usersDataCache.length === 0 && !isLoading.users) await loadUsers();
        if(allTransactionsCache.length === 0 && !isLoading.transactions) await loadAllTransactions();
        if(externalEntitiesCache.length === 0 && !isLoading.lenders) await loadLenders();

        let openingBankBalance = 0;
        allTransactionsCache
            .filter((t) => new Date(t.date) < new Date(selectedDate))
            .forEach((t) => {
                const catInfo = transactionCategories.find( 
                    (c) => c.name === t.category,
                );
                if (!catInfo || !catInfo.affectsLedger || !catInfo.affectsLedger.includes("bank")) return;

                let actualBankFlow = 0;
                if (catInfo.type.includes("income")) { 
                     actualBankFlow = Math.abs(parseFloat(t.amount || 0));
                } else if (catInfo.type.includes("expense")) {
                    actualBankFlow = -Math.abs(parseFloat(t.amount || 0));
                } else if (catInfo.name === 'Cash Deposited to Bank') {
                    actualBankFlow = Math.abs(parseFloat(t.amount || 0));
                } else if (catInfo.name === 'Cash Withdrawn from Bank') {
                    actualBankFlow = -Math.abs(parseFloat(t.amount || 0));
                }
                openingBankBalance += actualBankFlow;
            });

        const entries = allTransactionsCache
            .filter((t) => {
                const catInfo = transactionCategories.find( 
                    (c) => c.name === t.category,
                );
                return (
                    t.date === selectedDate &&
                    catInfo &&
                    catInfo.affectsLedger &&
                    catInfo.affectsLedger.includes("bank")
                );
            })
            .sort((a, b) => a.id - b.id);

        tbody.innerHTML = "";
        const openingRow = tbody.insertRow();
        openingRow.innerHTML = `<td>${formatLedgerDate(selectedDate)}</td><td colspan="3">Opening Bank Balance</td><td></td><td></td><td class="num ${openingBankBalance >= 0 ? "positive-balance" : "negative-balance"}">₹${openingBankBalance.toFixed(2)}</td>`;

        let runningBankBalance = openingBankBalance;
        let dailyTotalDebits = 0; 
        let dailyTotalCredits = 0; 

        if (entries.length === 0) {
            tbody.innerHTML +=
                '<tr><td colspan="7" style="text-align:center;">No bank transactions for this day.</td></tr>';
        } else {
            entries.forEach((entry) => {
                const catInfo = transactionCategories.find(
                    (c) => c.name === entry.category,
                );
                let debit = ""; 
                let credit = ""; 
                let actualBankFlowForEntry = 0;
                
                if (catInfo.type.includes("income")) {
                    actualBankFlowForEntry = Math.abs(parseFloat(entry.amount || 0));
                } else if (catInfo.type.includes("expense")) {
                    actualBankFlowForEntry = -Math.abs(parseFloat(entry.amount || 0));
                } else if (catInfo.name === 'Cash Deposited to Bank') { 
                     actualBankFlowForEntry = Math.abs(parseFloat(entry.amount || 0));
                } else if (catInfo.name === 'Cash Withdrawn from Bank') { 
                    actualBankFlowForEntry = -Math.abs(parseFloat(entry.amount || 0));
                }

                if(actualBankFlowForEntry > 0) {
                    debit = actualBankFlowForEntry.toFixed(2);
                    dailyTotalDebits += actualBankFlowForEntry;
                } else {
                    credit = Math.abs(actualBankFlowForEntry).toFixed(2);
                    dailyTotalCredits += Math.abs(actualBankFlowForEntry);
                }
                
                runningBankBalance += actualBankFlowForEntry;

                let displayName = "N/A (Business Internal)";
                if (entry.user_id) {
                    const user = usersDataCache.find( (u) => u.id === entry.user_id, );
                    displayName = user ? user.username : `Cust. ID ${entry.user_id}`;
                } else if (entry.lender_id) {
                    const entity = externalEntitiesCache.find( (e) => e.id === entry.lender_id, );
                    displayName = entity ? entity.lender_name : `Ext. Entity ID ${entry.lender_id}`;
                }

                const row = tbody.insertRow();
                row.innerHTML = `<td>${formatLedgerDate(entry.date)}</td><td>${displayName}</td><td>${entry.description || "-"}</td><td>${entry.category || "-"}</td><td class="num positive">${debit ? "₹" + debit : ""}</td><td class="num negative">${credit ? "₹" + credit : ""}</td><td class="num ${runningBankBalance >= 0 ? "positive-balance" : "negative-balance"}">₹${runningBankBalance.toFixed(2)}</td>`;
            });
        }
        const dailyNetChange = dailyTotalDebits - dailyTotalCredits;
        tfoot.innerHTML = `<tr><td colspan="7" style="padding-top:10px; border-top: 1px solid #ccc;"></td></tr><tr><td colspan="4" style="text-align: right;"><strong>Totals for Day:</strong></td><td class="positive"><strong>₹${dailyTotalDebits.toFixed(2)}</strong></td><td class="negative"><strong>₹${dailyTotalCredits.toFixed(2)}</strong></td><td></td></tr><tr><td colspan="4" style="text-align: right;"><strong>Net Bank Flow for Day:</strong></td><td colspan="2" class="num ${dailyNetChange >= 0 ? "positive" : "negative"}" style="text-align:center;"><strong>₹${dailyNetChange.toFixed(2)}</strong></td><td></td></tr><tr><td colspan="4" style="text-align: right;"><strong>Closing Bank Balance:</strong></td><td colspan="2" class="num ${runningBankBalance >= 0 ? "positive-balance" : "negative-balance"}" style="text-align:center;"><strong>₹${runningBankBalance.toFixed(2)}</strong></td><td></td></tr>`;
    } catch (error) {
        console.error("Failed to load bank ledger:", error);
        if(tbody)
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Error: ${error.message}</td></tr>`;
    }
}

function printLedger(tableId, ledgerTitle) {
    const ledgerTable = document.getElementById(tableId)?.cloneNode(true);
    if (!ledgerTable) {
        alert("Ledger table not found for printing.");
        return;
    }
    const dateInputId =
        tableId === 'cashLedgerTable' ? 'cashLedgerDate' : 'bankLedgerDate';
    const selectedDate = document.getElementById(dateInputId)?.value || "N/A";
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
    <html><head><title>${ledgerTitle} - ${selectedDate}</title>
    <style>body{font-family:Arial,sans-serif}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background-color:#f2f2f2}.positive{color:#28a745!important}.negative{color:#dc3545!important}.positive-balance{color:#28a745!important}.negative-balance{color:#dc3545!important}tfoot{font-weight:bold}tfoot tr:first-child td{border-top:2px solid #333}</style>
    </head><body><h1>${ledgerTitle} - ${selectedDate}</h1>${ledgerTable.outerHTML}
    <script>window.onload=()=>{window.print();window.close()}<\/script></body></html>`);
    printWindow.document.close();
}
async function handleUserSubmit(e) {
    e.preventDefault();
    const data = {
        username: document.getElementById("username").value.trim(),
        email: document.getElementById("email").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        company: document.getElementById("company").value.trim(),
        initial_balance: parseFloat(document.getElementById("balance").value),
        address_line1: document.getElementById("address_line1").value.trim(),
        address_line2: document.getElementById("address_line2").value.trim(),
        city_pincode: document.getElementById("city_pincode").value.trim(),
        state: document.getElementById("state").value.trim(),
        gstin: document.getElementById("gstin").value.trim(),
        state_code: document.getElementById("state_code").value.trim(),
    };
    if (!data.username || isNaN(data.initial_balance)) {
        alert("Customer Name and a valid Opening Balance are required.");
        return;
    }
    try {
        const method = editingUserId ? "PUT" : "POST";
        const endpoint = editingUserId ? `${API}/users/${editingUserId}` : `${API}/users`;
        const res = await apiFetch(endpoint, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if(!res) return;
        const result = await res.json();
        if (!res.ok)
            throw new Error(result.error || `Operation failed: ${res.statusText}`);
        alert(result.message || (editingUserId ? "Customer updated" : "Customer added"));
        editingUserId = null;
        closeUserModal();
        await loadUsers();
        if (document.getElementById("customerManagementSection")?.style.display === 'block' || document.getElementById("businessFinanceSection")?.style.display === 'block') {
            loadCustomerSummaries();
        }
    } catch (error) {
        console.error("Error submitting customer form:", error);
        alert("Operation failed: " + error.message);
    }
}

function formatLedgerDate(dateString) {
    const date = new Date(dateString + 'T00:00:00'); // Ensure correct date parsing
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}


function openUserModal(user = null) {
    const modal = document.getElementById("userModal");
    const form = document.getElementById("userForm");
    if (!modal || !form) {
        console.error("User modal or form not found in DOM");
        return;
    }
    form.reset();
    editingUserId = null;

    if (user) {
        editingUserId = user.id;
        document.getElementById("username").value = user.username || "";
        document.getElementById("email").value = user.email || "";
        document.getElementById("phone").value = user.phone || "";
        document.getElementById("company").value = user.company || "";
        document.getElementById("balance").value =
            user.initial_balance !== undefined ? user.initial_balance : 0;
        document.getElementById("address_line1").value =
            user.address_line1 || "";
        document.getElementById("address_line2").value =
            user.address_line2 || "";
        document.getElementById("city_pincode").value = user.city_pincode || "";
        document.getElementById("state").value = user.state || "";
        document.getElementById("gstin").value = user.gstin || "";
        document.getElementById("state_code").value = user.state_code || "";
    }
    modal.classList.add('show');
}
function closeUserModal() {
    const modal = document.getElementById("userModal");
    if (modal) modal.classList.remove('show');
    editingUserId = null;
}
async function deleteUser(id) {
    if (!confirm("Are you sure? This will delete the customer and all associated accounting records. This CANNOT be undone."))
        return;
    try {
        const res = await apiFetch(`${API}/users/${id}`, { method: "DELETE" });
        if(!res) return;
        const result = await res.json();
        if (!res.ok)
            throw new Error(result.error || `Failed: ${res.statusText}`);
        alert(result.message || "Customer deleted");
        await loadUsers();
        await loadAllTransactions(); 
        const cashLedgerActive = document.getElementById("cashLedgerContent")?.style.display !== 'none';
        const bankLedgerActive = document.getElementById("bankLedgerContent")?.style.display !== 'none';
        if (cashLedgerActive) loadCashLedger();
        if (bankLedgerActive) loadBankLedger();
        if (document.getElementById("customerManagementSection")?.style.display === 'block')
            loadCustomerSummaries();
        if (document.getElementById("invoiceManagementSection")?.style.display === 'block') {
            loadInvoices(); 
        }
    } catch (error) {
        console.error("Delete customer error:", error);
        alert(error.message);
    }
}
function toggleTxPartyDropdowns() {
    const userDropdown = document.getElementById("transaction_user_id");
    const lenderDropdown = document.getElementById("transaction_lender_id");
    const agreementDropdown = document.getElementById("transaction_agreement_id");
    const forCustomerRadio = document.getElementById("txPartyTypeCustomer");

    if (!userDropdown || !lenderDropdown || !agreementDropdown || !forCustomerRadio) {
        console.error("One or more party type dropdowns/radios are missing in transactionModal!");
        return;
    }

    if (forCustomerRadio.checked) {
        userDropdown.parentElement.style.display = "block";
        lenderDropdown.parentElement.style.display = "none";
        if (lenderDropdown) lenderDropdown.value = "";
        if (agreementDropdown) {
            agreementDropdown.parentElement.style.display = "none";
            agreementDropdown.value = "";
        }
    } else {
        userDropdown.parentElement.style.display = "none";
        if (userDropdown) userDropdown.value = "";
        lenderDropdown.parentElement.style.display = "block";
        if (agreementDropdown) agreementDropdown.parentElement.style.display = "block";
    }
}

function getFullCategoryDetails(baseCategoryName, paymentMode) {
    const baseCatInfo = baseTransactionCategories.find(c => c.name === baseCategoryName);
    if (!baseCatInfo) return null;

    if (baseCatInfo.needsPaymentMode) {
        let mode = paymentMode || "On Credit";
        let finalCategoryName = baseCatInfo.categoryPattern.replace("{PaymentMode}", mode);

        if (mode === 'On Credit') {
            finalCategoryName = baseCatInfo.categoryPattern.replace("{PaymentMode}", "On Credit");
        } else if (baseCatInfo.group.includes('biz_loan')) {
            finalCategoryName = baseCatInfo.categoryPattern.replace("{PaymentModeDestination}", `(to ${mode})`).replace("{PaymentMode}", `from ${mode}`);
        }

        return {
            fullCategoryName: finalCategoryName,
            ...baseCatInfo
        };
    } else {
        return {
            fullCategoryName: baseCatInfo.categoryPattern,
            ...baseCatInfo
        };
    }
}
// REPLACE this entire function in app-script.js

async function openTransactionModal(tx = null, preselectUserId = null, isBusinessExternal = false, preselectLenderId = null, preselectAgreementId = null, preselectCategory = null, preselectInvoiceId = null) {
    const modal = document.getElementById("transactionModal");
    const form = document.getElementById("transactionForm");
    const modalTitleElement = document.getElementById("transactionModalTitle");
    const userDropdown = document.getElementById("transaction_user_id");
    const lenderDropdown = document.getElementById("transaction_lender_id");
    const agreementDropdown = document.getElementById("transaction_agreement_id");
    const amountField = document.getElementById("amount");
    const categoryDropdown = document.getElementById("category");
    const descriptionField = document.getElementById("description");
    const dateField = document.getElementById("date");
    const lineItemsSection = document.getElementById("transactionLineItemsSection");
    const lineItemsTableBody = document.getElementById("txLineItemsTableBody");
    const forCustomerRadio = document.getElementById("txPartyTypeCustomer");
    const forLenderRadio = document.getElementById("txPartyTypeLender");
    const paymentModeGroup = document.getElementById("paymentModeGroup");
    const partySelectionDiv = forCustomerRadio.closest('.form-group.radio-group');
    const relatedInvoiceIdInput = document.getElementById("related_invoice_id"); // Get the hidden input

    if (!modal || !form || !modalTitleElement || !userDropdown || !lenderDropdown || !agreementDropdown || !amountField || !categoryDropdown || !descriptionField || !dateField || !lineItemsSection || !lineItemsTableBody || !forCustomerRadio || !forLenderRadio || !paymentModeGroup || !partySelectionDiv) {
        console.error("One or more elements in transactionModal are missing!");
        alert("Error: Transaction modal components not found.");
        return;
    }

    form.reset();
    relatedInvoiceIdInput.value = ""; // Reset the hidden field
    if (lineItemsTableBody) lineItemsTableBody.innerHTML = "";
    updateTxGrandTotal();

    if (usersDataCache.length === 0 && !isLoading.users) await loadUsers();
    if (externalEntitiesCache.length === 0 && !isLoading.lenders) await loadLenders();
    if (businessAgreementsCache.length === 0 && !isLoading.businessAgreements) await loadBusinessExternalFinanceAgreements();
    if (productsCache.length === 0 && !isLoading.products) await loadProducts();

    await populateUserDropdown();
    await populateLenderDropdownForTxModal();
    await populateAgreementDropdownForTxModal();
    populateTransactionCategoryDropdown();

    const amountLabel = document.querySelector('label[for="amount"]');
    const newCategoryDropdown = categoryDropdown.cloneNode(true);
    categoryDropdown.parentNode.replaceChild(newCategoryDropdown, categoryDropdown);

    newCategoryDropdown.onchange = () => {
        const selectedBaseCategoryName = newCategoryDropdown.value;
        const baseCatInfo = baseTransactionCategories.find(c => c.name === selectedBaseCategoryName);
        
        if (baseCatInfo && baseCatInfo.relevantTo === 'none') {
            partySelectionDiv.style.display = 'none';
        } else {
            partySelectionDiv.style.display = 'flex';
        }

        const isProductInvolved = baseCatInfo && (baseCatInfo.isProductSale || baseCatInfo.isProductPurchase);

        if (lineItemsSection) lineItemsSection.style.display = isProductInvolved ? "block" : "none";
        if (paymentModeGroup) paymentModeGroup.style.display = (baseCatInfo && baseCatInfo.needsPaymentMode) ? 'flex' : 'none';
        if (amountLabel) amountLabel.textContent = (baseCatInfo && isProductInvolved) ? "Total Item Amount (₹):" : "Amount (₹):";
        if (amountField) amountField.readOnly = !!isProductInvolved;
        if (isProductInvolved && lineItemsTableBody && lineItemsTableBody.rows.length === 0) addTxLineItemRow();
        if (isProductInvolved) updateTxGrandTotal();

        if (baseCatInfo && baseCatInfo.relevantTo) {
            if (baseCatInfo.relevantTo === 'customer') forCustomerRadio.checked = true;
            else if (baseCatInfo.relevantTo === 'lender') forLenderRadio.checked = true;
            toggleTxPartyDropdowns();
        } else if (!editingTxnId && baseCatInfo && baseCatInfo.relevantTo !== 'none') {
            forCustomerRadio.checked = true;
            toggleTxPartyDropdowns();
        }

        if (baseCatInfo && baseCatInfo.needsPaymentMode) document.getElementById("txPayModeCash").checked = true;
        else if (baseCatInfo && !baseCatInfo.needsPaymentMode) document.getElementsByName("txPaymentMode").forEach(radio => radio.checked = false);
    };

    if (tx) { // Editing existing transaction
        editingTxnId = tx.id;
        modalTitleElement.textContent = `Edit Transaction #${tx.id}`;
        userDropdown.value = tx.user_id || "";
        lenderDropdown.value = tx.lender_id || "";
        agreementDropdown.value = tx.agreement_id || "";
        amountField.value = tx.amount !== undefined ? Math.abs(tx.amount) : "";
        descriptionField.value = tx.description || "";
        dateField.value = tx.date ? tx.date.split("T")[0] : new Date().toISOString().split("T")[0];
        relatedInvoiceIdInput.value = tx.related_invoice_id || ""; // Populate if editing
        
        if(tx.lender_id) forLenderRadio.checked = true;
        else forCustomerRadio.checked = true;
        toggleTxPartyDropdowns();

        const originalFullCatFromDB = tx.category;
        let baseNameToSelect = originalFullCatFromDB, paymentModeToSelect = null, needsModeForEditDisplay = false;

        for (const bc of baseTransactionCategories) {
            if (bc.needsPaymentMode) {
                const patternNoMode = bc.categoryPattern.replace(" ({PaymentMode})", "").replace(" (from {PaymentMode})", "").replace(" (to {PaymentMode})", "");
                if (originalFullCatFromDB.startsWith(patternNoMode)) {
                    baseNameToSelect = bc.name;
                    needsModeForEditDisplay = true;
                    if (originalFullCatFromDB.includes("Cash")) paymentModeToSelect = "Cash";
                    else if (originalFullCatFromDB.includes("Bank")) paymentModeToSelect = "Bank";
                    else if (originalFullCatFromDB.includes("Credit")) paymentModeToSelect = "On Credit";
                    break;
                }
            } else if (originalFullCatFromDB === bc.categoryPattern) {
                baseNameToSelect = bc.name;
                break;
            }
        }
        
        newCategoryDropdown.value = baseNameToSelect; 
        if(needsModeForEditDisplay){
            paymentModeGroup.style.display = 'flex';
            if (paymentModeToSelect === "Cash") document.getElementById("txPayModeCash").checked = true;
            else if (paymentModeToSelect === "Bank") document.getElementById("txPayModeBank").checked = true;
            else if (paymentModeToSelect === "On Credit") document.getElementById("txPayModeCredit").checked = true;
        } else {
            paymentModeGroup.style.display = 'none';
        }
        
        newCategoryDropdown.dispatchEvent(new Event('change'));

    } else { // New transaction
        editingTxnId = null;
        dateField.value = new Date().toISOString().split("T")[0];
        amountField.value = "";
        newCategoryDropdown.value = ""; 
        descriptionField.value = "";
        document.getElementById("txPayModeCash").checked = true;
        paymentModeGroup.style.display = 'none'; 

        if (preselectInvoiceId) {
            relatedInvoiceIdInput.value = preselectInvoiceId; // Populate for new payment
        }

        if (isBusinessExternal) {
            modalTitleElement.textContent = "New Business/External Transaction";
            forLenderRadio.checked = true;
            if (preselectLenderId) lenderDropdown.value = preselectLenderId;
            if (preselectAgreementId) agreementDropdown.value = preselectAgreementId;
        } else if (preselectUserId) {
            const user = usersDataCache.find(u => u.id === preselectUserId);
            modalTitleElement.textContent = `New Transaction for ${user ? user.username : `Customer ID ${preselectUserId}`}`;
            forCustomerRadio.checked = true;
            userDropdown.value = preselectUserId;
        } else {
            modalTitleElement.textContent = "New Transaction";
            forCustomerRadio.checked = true;
        }
        if (preselectCategory) {
            newCategoryDropdown.value = preselectCategory;
            newCategoryDropdown.dispatchEvent(new Event('change'));
        }
    
    }
    modal.classList.add('show');
}
// REPLACE this entire function in app-script.js

async function handleTransactionSubmit(e) {
    e.preventDefault();

    const userIdInput = document.getElementById("transaction_user_id").value;
    const lenderIdInput = document.getElementById("transaction_lender_id").value;
    const agreementIdInput = document.getElementById("transaction_agreement_id").value;
    const isForCustomer = document.getElementById("txPartyTypeCustomer").checked;
    const relatedInvoiceId = document.getElementById("related_invoice_id").value || null;

    const userId = (isForCustomer && userIdInput && userIdInput !== "") ? parseInt(userIdInput) : null;
    const lenderId = (!isForCustomer && lenderIdInput && lenderIdInput !== "") ? parseInt(lenderIdInput) : null;
    const agreementId = (!isForCustomer && agreementIdInput && agreementIdInput !== "" && document.getElementById("transaction_agreement_id").style.display !== 'none') ? parseInt(agreementIdInput) : null;

    const baseCategoryName = document.getElementById("category").value;
    const baseCatInfo = baseTransactionCategories.find(cat => cat.name === baseCategoryName);

    if (!baseCatInfo) {
        alert("Invalid base category selected.");
        return;
    }

    let paymentMode = null;
    const paymentModeGroup = document.getElementById("paymentModeGroup");
    if (baseCatInfo.needsPaymentMode && paymentModeGroup.style.display !== 'none') {
        const paymentModeRadios = document.getElementsByName("txPaymentMode");
        for (const radio of paymentModeRadios) {
            if (radio.checked) {
                paymentMode = radio.value;
                break;
            }
        }
        if (!paymentMode) {
            alert("Please select a payment mode for this category.");
            return;
        }
    } else if (!baseCatInfo.needsPaymentMode) {
        paymentMode = "none";
    }
    
    const categoryDetails = getFullCategoryDetails(baseCategoryName, paymentMode);
    const fullCategoryName = categoryDetails.fullCategoryName;

    if (!fullCategoryName || (fullCategoryName === baseCategoryName && baseCatInfo.needsPaymentMode && paymentMode !== "On Credit")) {
        alert(`Could not determine full category for '${baseCategoryName}' with payment mode '${paymentMode}'. Please check category definitions.`);
        return;
    }

    let totalAmountInputValue = parseFloat(document.getElementById("amount").value);
    const isProductInvolved = baseCatInfo.isProductSale || baseCatInfo.isProductPurchase;

    const lineItems = [];
    if (isProductInvolved) {
        document.querySelectorAll("#txLineItemsTableBody tr").forEach((row) => {
            const productId = row.querySelector(".tx-line-product").value;
            const quantity = parseFloat(row.querySelector(".tx-line-qty").value);
            const unitPrice = parseFloat(row.querySelector(".tx-line-price").value);
            if (productId && quantity > 0 && unitPrice >= 0) {
                lineItems.push({ product_id: productId, quantity: quantity, unit_price: unitPrice });
            }
        });
        if (lineItems.length === 0 && (baseCatInfo.isProductSale || baseCatInfo.isProductPurchase)) {
            alert("For product sales/purchases, please add at least one valid line item.");
            return;
        }
        totalAmountInputValue = parseFloat(document.getElementById("txLineItemsGrandTotal").textContent) || 0;
    }

    const transactionDate = document.getElementById("date").value;
    const transactionDescription = document.getElementById("description").value.trim();

    if ((baseCategoryName !== "Stock Adjustment (Increase)" && baseCategoryName !== "Stock Adjustment (Decrease)") && (isNaN(totalAmountInputValue) || totalAmountInputValue <= 0) && !isProductInvolved) {
        alert("Amount must be a positive number (unless it's a pure stock quantity adjustment or calculated from line items).");
        return;
    }
    if (!baseCategoryName) { alert("Please select a base category."); return; }
    if (!transactionDate) { alert("Date is required."); return; }

    let finalAmount = totalAmountInputValue;

    if (userId && categoryDetails.relevantTo === 'customer') {
        finalAmount = Math.abs(finalAmount) * (categoryDetails.defaultSignForParty || 1);
    } else if (lenderId && categoryDetails.relevantTo === 'lender') {
        finalAmount = Math.abs(finalAmount) * (categoryDetails.defaultSignForParty || 1);
    } else if (categoryDetails.relevantTo === 'none') {
        const originalDetailedCategory = transactionCategories.find(tc => tc.name === fullCategoryName);
        if (originalDetailedCategory) {
            if (originalDetailedCategory.type && originalDetailedCategory.type.includes("expense")) finalAmount = -Math.abs(finalAmount);
            else if (originalDetailedCategory.type && originalDetailedCategory.type.includes("income")) finalAmount = Math.abs(finalAmount);
            if (fullCategoryName === "Cash Deposited to Bank") finalAmount = -Math.abs(finalAmount);
            if (fullCategoryName === "Cash Withdrawn from Bank") finalAmount = Math.abs(finalAmount);
        } else {
            if (categoryDetails.type === "expense") finalAmount = -Math.abs(finalAmount);
            else if (categoryDetails.type === "income") finalAmount = Math.abs(finalAmount);
        }
    }
    
    if (baseCategoryName.includes("Stock Adjustment")) {
        if (isNaN(totalAmountInputValue) || (totalAmountInputValue === 0 && lineItems.length > 0)) {
            finalAmount = 0;
        } else if (isNaN(totalAmountInputValue)) {
            finalAmount = 0;
        } else finalAmount = totalAmountInputValue;
    }

    const txData = {
        user_id: userId,
        lender_id: lenderId,
        agreement_id: agreementId,
        amount: finalAmount,
        description: transactionDescription,
        category: fullCategoryName,
        date: transactionDate,
        line_items: (isProductInvolved && lineItems.length > 0) ? lineItems : undefined,
        related_invoice_id: relatedInvoiceId ? parseInt(relatedInvoiceId) : null,
    };
    
    try {
        const method = editingTxnId ? "PUT" : "POST";
        const endpoint = method === "PUT" ? `${API}/transactions/${editingTxnId}` : `${API}/transactions`;

        const res = await apiFetch(endpoint, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(txData),
        });
        if(!res) return;
        const result = await res.json();

        if (!res.ok) {
            throw new Error(result.error || `Operation failed: ${res.statusText} - ${result.details || ""}`);
        }
        
        alert(result.message || (editingTxnId ? "Transaction updated" : "Transaction added"));
        
        editingTxnId = null;
        closeTransactionModal();
        
        await loadAllTransactions();
        if (txData.line_items && txData.line_items.length > 0) {
            await loadProducts();
        }
        await loadUsers();
        await loadInvoices(); // Refresh invoices to get updated paid_amount

        const cashLedgerActive = document.getElementById("cashLedgerContent")?.style.display !== 'none';
        const bankLedgerActive = document.getElementById("bankLedgerContent")?.style.display !== 'none';
        if (cashLedgerActive) loadCashLedger();
        if (bankLedgerActive) loadBankLedger();

        if (document.getElementById("customerManagementSection")?.style.display === 'block') loadCustomerSummaries();
        if (document.getElementById("supplierManagementSection")?.style.display === 'block') loadSupplierSummaries();
        if (document.getElementById("businessFinanceSection")?.style.display === 'block') loadBusinessExternalFinanceAgreements();
        if (document.getElementById("inventoryManagementSection")?.style.display === 'block') displayProducts();
        updateDashboardCards();

    } catch (error) {
        console.error("Error submitting transaction form:", error);
        alert("Operation failed: " + error.message);
    }
}

function closeTransactionModal() {
    const modal = document.getElementById("transactionModal");
    if (modal) {
        modal.classList.remove('show');
    }
    editingTxnId = null;
    const form = document.getElementById("transactionForm");
    if (form) {
        form.reset();
    }

    const forCustomerRadio = document.getElementById("txPartyTypeCustomer");
    if(forCustomerRadio) forCustomerRadio.checked = true; 
    toggleTxPartyDropdowns(); 

    const lineItemsSection = document.getElementById("transactionLineItemsSection");
    if(lineItemsSection) lineItemsSection.style.display = "none";
    const lineItemsTableBody = document.getElementById("txLineItemsTableBody");
    if(lineItemsTableBody) lineItemsTableBody.innerHTML = "";
    const grandTotalSpan = document.getElementById("txLineItemsGrandTotal");
    if(grandTotalSpan) grandTotalSpan.textContent = "0.00";
    const amountInput = document.getElementById("amount");
    if(amountInput) amountInput.readOnly = false;

    const paymentModeGroup = document.getElementById("paymentModeGroup");
    if(paymentModeGroup) paymentModeGroup.style.display = 'none';
    document.getElementById("txPayModeCash").checked = true; 

    const amountLabel = document.querySelector('label[for="amount"]');
    if(amountLabel) amountLabel.textContent = "Amount (₹):";
}
function addTxLineItemRow(itemData = null) {
    const tableBody = document.getElementById("txLineItemsTableBody");
    if (!tableBody || !productsCache) return;
    const newRow = tableBody.insertRow();

    const productCell = newRow.insertCell();
    const productSelect = document.createElement("select");
    productSelect.className = "form-control tx-line-product";
    productSelect.innerHTML = '<option value="">Select Product...</option>';
    productsCache.forEach((p) => {
        const option = document.createElement("option");
        option.value = p.id;
        option.textContent = `${p.product_name} (Stock: ${p.current_stock})`;
        option.dataset.price = p.sale_price;
        option.dataset.stock = p.current_stock;
        productSelect.appendChild(option);
    });
    productSelect.addEventListener("change", (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        const price = selectedOption.dataset.price;
        const row = e.target.closest("tr");
        if (row && price) {
            row.querySelector(".tx-line-price").value =
                parseFloat(price).toFixed(2);
            updateTxLineTotal(row);
        }
    });
    productCell.appendChild(productSelect);

    const qtyCell = newRow.insertCell();
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.className = "form-control tx-line-qty";
    qtyInput.value = itemData ? itemData.quantity : 1;
    qtyInput.min = 1;
    qtyInput.style.width="70px";
    qtyInput.addEventListener("input", (e) => {
        updateTxLineTotal(e.target.closest("tr"));
    });
    qtyCell.appendChild(qtyInput);

    const priceCell = newRow.insertCell();
    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.step = "0.01";
    priceInput.className = "form-control tx-line-price";
    priceInput.value = itemData
        ? parseFloat(itemData.unit_price).toFixed(2)
        : "0.00";
    priceInput.style.width="100px";
    priceInput.addEventListener("input", (e) =>
        updateTxLineTotal(e.target.closest("tr")),
    );
    priceCell.appendChild(priceInput);

    const totalCell = newRow.insertCell();
    totalCell.className = "tx-line-item-total";
    totalCell.textContent = "0.00";

    const actionCell = newRow.insertCell();
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn btn-danger btn-sm";
    removeButton.innerHTML = "×";
    removeButton.onclick = () => {
        newRow.remove();
        updateTxGrandTotal();
    };
    actionCell.appendChild(removeButton);

    if(itemData && itemData.product_id) {
        productSelect.value = itemData.product_id;
        const event = new Event('change');
        productSelect.dispatchEvent(event); 
    } else {
        updateTxLineTotal(newRow); 
    }
}

function updateTxLineTotal(row) {
    if(!row) return;
    const qty = parseFloat(row.querySelector(".tx-line-qty").value) || 0;
    const price = parseFloat(row.querySelector(".tx-line-price").value) || 0;
    const lineTotal = qty * price;
    row.querySelector(".tx-line-item-total").textContent = lineTotal.toFixed(2);
    updateTxGrandTotal();
}
function updateTxGrandTotal() {
    let grandTotal = 0;
    document.querySelectorAll("#txLineItemsTableBody tr").forEach((row) => {
        grandTotal +=
            parseFloat(row.querySelector(".tx-line-item-total").textContent) ||
            0;
    });
    const grandTotalSpan = document.getElementById("txLineItemsGrandTotal");
    if(grandTotalSpan) grandTotalSpan.textContent = grandTotal.toFixed(2);

    const amountInput = document.getElementById("amount");
    if(amountInput && amountInput.readOnly) {
        amountInput.value = grandTotal.toFixed(2);
    }
}
async function deleteTransaction(id) {
    if (!confirm("Are you sure? This will reverse stock changes (if any) and delete the financial record.")) return;
    try {
        const res = await apiFetch(`${API}/transactions/${id}`, {
            method: "DELETE",
        });
        if(!res) return;
        const result = await res.json();
        if (!res.ok)
            throw new Error(result.error || `Failed: ${res.statusText}`);
        alert(result.message || "Transaction deleted");

        await loadAllTransactions();
        await loadUsers();
        await loadProducts();
        const cashLedgerActive =
            document.getElementById("cashLedgerContent")?.style.display !==
            'none';
        const bankLedgerActive =
            document.getElementById("bankLedgerContent")?.style.display !==
            'none';
        if (cashLedgerActive) loadCashLedger();
        if (bankLedgerActive) loadBankLedger();
        if (
            document.getElementById("customerManagementSection")?.style
                .display === 'block'
        )
            loadCustomerSummaries();
        if (
            document.getElementById("supplierManagementSection")?.style
                .display === 'block'
        )
            loadSupplierSummaries();
        if (
            document.getElementById("businessFinanceSection")?.style.display ===
            'block'
        )
            loadBusinessExternalFinanceAgreements();
        if (document.getElementById("inventoryManagementSection")?.style.display === 'block') {
             displayProducts(); 
        }
        updateDashboardCards(); 
    } catch (error) {
        console.error("Delete transaction error:", error);
        alert(error.message);
    }
}
function toggleInitialPayableField() {
    const entityTypeDropdown = document.getElementById("lenderEntityType");
    const initialPayableGroup = document.getElementById("initialPayableGroup");
    if (entityTypeDropdown && initialPayableGroup) {
        if (entityTypeDropdown.value === 'Supplier') {
            initialPayableGroup.style.display = "block";
        } else {
            initialPayableGroup.style.display = "none";
            const initialPayableInput = document.getElementById("lenderInitialPayable");
            if (initialPayableInput) initialPayableInput.value = 0;
        }
    }
}
function openLenderModal(lender = null, entityType = "General") {
    const modal = document.getElementById("lenderModal");
    const form = document.getElementById("lenderForm");
    const title = document.getElementById("lenderModalTitle");
    const typeDropdown = document.getElementById("lenderEntityType");
    const initialPayableInput = document.getElementById("lenderInitialPayable");
    const lenderIdInput = document.getElementById("lenderId");

    if (!modal || !form || !title || !typeDropdown || !initialPayableInput || !lenderIdInput) {
        console.error("One or more elements in lenderModal are missing from the DOM!");
        alert("Error: Lender modal components not found. Please check console.");
        return;
    }

    form.reset();
    editingLenderId = null;
    lenderIdInput.value = "";
    typeDropdown.value = entityType;
    initialPayableInput.value = "0.00";

    if (lender) {
        editingLenderId = lender.id;
        title.textContent = `Edit External Entity: ${lender.lender_name}`;
        lenderIdInput.value = lender.id;
        document.getElementById("lenderName").value = lender.lender_name || "";
        typeDropdown.value = lender.entity_type || "General";
        initialPayableInput.value = (lender.entity_type === 'Supplier' && lender.initial_payable_balance !== undefined) ? parseFloat(lender.initial_payable_balance).toFixed(2) : "0.00";
        document.getElementById("lenderContactPerson").value = lender.contact_person || "";
        document.getElementById("lenderPhone").value = lender.phone || "";
        document.getElementById("lenderEmail").value = lender.email || "";
        document.getElementById("lenderNotes").value = lender.notes || "";
    } else {
        title.textContent = `Add New ${entityType === 'Financial' ? 'Financial Entity' : entityType}`;
    }
    toggleInitialPayableField();
    modal.classList.add('show');
}
function closeLenderModal() {
    const modal = document.getElementById("lenderModal");
    if (modal) {
        modal.classList.remove('show');
    }
    editingLenderId = null;
    const form = document.getElementById("lenderForm");
    if(form){form.reset();}
}
async function handleLenderSubmit(e) {
    e.preventDefault();
    const entityType = document.getElementById("lenderEntityType").value;
    const initialPayable = (entityType === 'Supplier') ? (parseFloat(document.getElementById("lenderInitialPayable").value) || 0) : 0;

    const data = {
        lender_name: document.getElementById("lenderName").value.trim(),
        entity_type: entityType,
        contact_person: document.getElementById("lenderContactPerson").value.trim(),
        phone: document.getElementById("lenderPhone").value.trim(),
        email: document.getElementById("lenderEmail").value.trim(),
        notes: document.getElementById("lenderNotes").value.trim(),
        initial_payable_balance: initialPayable
    };
    if (!data.lender_name) {
        alert("External Entity Name is required.");
        return;
    }
    const method = editingLenderId ? "PUT" : "POST";
    const endpoint = editingLenderId ? `${API}/lenders/${editingLenderId}` : `${API}/lenders`;
    try {
        const res = await apiFetch(endpoint, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res) return;
        const result = await res.json();
        if (!res.ok)
            throw new Error(result.error || `Operation failed: ${res.statusText}`);
        
        alert(result.message || (editingLenderId ? "External entity updated" : "External entity created"));
        
        closeLenderModal();
        await loadLenders(null, true);
        
        if (document.getElementById("supplierManagementSection")?.style.display === 'block') {
            loadSupplierSummaries();
        }
        if (document.getElementById("businessFinanceSection")?.style.display === 'block') {
            populateAgreementEntityDropdown();
        }
        const linkSupplierDropdown = document.getElementById("linkSupplierId");
        if (linkSupplierDropdown) populateSuppliersForProductLinkModal();

    } catch (error) {
        console.error("Error saving external entity:", error);
        alert("Error: " + error.message);
    }
}

async function loadLenders(entityTypeFilter = null, forceReloadAllCache = false) {
    if(!entityTypeFilter && !isLoading.lenders && externalEntitiesCache.length > 0 && !forceReloadAllCache) return externalEntitiesCache;


    let specificLoad = !!entityTypeFilter; 
    if(!specificLoad || forceReloadAllCache) isLoading.lenders = true; 

    const tableBody = document.getElementById("lendersTableBody");

    if (tableBody && (!specificLoad || forceReloadAllCache) && document.getElementById("businessFinanceSection")?.style.display === 'block')
        tableBody.innerHTML =
            '<tr><td colspan="7" style="text-align:center;">Loading external entities...</td></tr>';

    try {
        const fetchUrl = entityTypeFilter
        ? `${API}/lenders?type=${entityTypeFilter}`
        : `${API}/lenders`;
        const res = await apiFetch(fetchUrl);
        if(!res) return [];
        if (!res.ok)
            throw new Error(
                `Failed to fetch external entities: ${res.statusText} ${await res.text()}`,
            );
        const data = await res.json();

        const entitiesToDisplay = Array.isArray(data) ? data : [];
        
        if(!specificLoad || forceReloadAllCache) { 
            externalEntitiesCache = entitiesToDisplay; 
        }

        if (tableBody && (!specificLoad || forceReloadAllCache) && document.getElementById("businessFinanceSection")?.style.display === 'block') {
            tableBody.innerHTML = "";
            const generalLenders = externalEntitiesCache.filter(e => e.entity_type !== 'Supplier');
            if (generalLenders.length === 0) {
                tableBody.innerHTML =
                    '<tr><td colspan="7" style="text-align:center;">No general external entities found.</td></tr>';
            } else {
                generalLenders.forEach((entity) => {
                    const row = tableBody.insertRow();
                    row.insertCell().textContent = entity.id;
                    row.insertCell().textContent = entity.lender_name;
                    row.insertCell().textContent =
                        entity.entity_type || 'General';
                    row.insertCell().textContent = entity.contact_person || "-";
                    row.insertCell().textContent = entity.phone || "-";
                    row.insertCell().textContent = entity.notes || "-";
                    const actionsCell = row.insertCell();
                    actionsCell.innerHTML = `<button class='btn btn-primary btn-sm' onclick='openLenderModal(${JSON.stringify(entity)}, "${entity.entity_type}")'><i class="fas fa-edit"></i></button> <button class='btn btn-danger btn-sm' onclick='deleteLender(${entity.id})'><i class="fas fa-trash"></i></button>`;
                });
            }
        }
        if (!specificLoad || forceReloadAllCache) updateDashboardCards(); 
        return entitiesToDisplay; 
    } catch (error) {
        console.error("Error loading external entities:", error);
        if(tableBody && (!specificLoad || forceReloadAllCache))
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Error: ${error.message}</td></tr>`;
        if(!specificLoad || forceReloadAllCache) externalEntitiesCache = [];
        return [];
    } finally {
        if(!specificLoad || forceReloadAllCache) isLoading.lenders = false;
    }
}
async function deleteLender(id) {
    if (!confirm("Are you sure you want to delete this external entity? This may affect product-supplier links and business agreements."))
        return;
    try {
        const res = await apiFetch(`${API}/lenders/${id}`, {
            method: "DELETE",
        });
        if (!res) return;
        const result = await res.json();
        if (!res.ok)
            throw new Error(result.error || `Failed to delete: ${res.statusText}`);
        
        alert(result.message || "External entity deleted");
        await loadLenders(null, true);
        
        if (document.getElementById("supplierManagementSection")?.style.display === 'block') {
            loadSupplierSummaries();
        }
        if (document.getElementById("businessFinanceSection")?.style.display === 'block') {
            populateAgreementEntityDropdown();
            loadBusinessExternalFinanceAgreements();
        }
        const linkSupplierDropdown = document.getElementById("linkSupplierId");
        if (linkSupplierDropdown && document.getElementById("productSupplierLinkModal").style.display === 'block') {
            populateSuppliersForProductLinkModal();
        }
        if (document.getElementById("inventoryManagementSection")?.style.display === 'block') {
            loadProducts();
        }

    } catch (error) {
        console.error("Error deleting external entity:", error);
        alert("Error: " + error.message);
    }
}

async function loadCustomerSummaries() {
    const customerTableBody = document.getElementById("customerTableBody");
    if (!customerTableBody) {
        console.error("Customer summary table body not found in the DOM.");
        return;
    }
    customerTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Loading customer data...</td></tr>';
    
    try {
        // Ensure necessary data caches are populated before proceeding
        if (usersDataCache.length === 0 && !isLoading.users) await loadUsers();
        if (allTransactionsCache.length === 0 && !isLoading.transactions) await loadAllTransactions();
        
        customerTableBody.innerHTML = ""; // Clear the loading message
        
        // Filter out system users like 'admin' to only show actual customers
        const customersOnly = usersDataCache.filter(user => user.role !== 'admin');

        if (!Array.isArray(customersOnly) || customersOnly.length === 0) {
            customerTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No customers found.</td></tr>';
            return;
        }

        let serialNumber = 1; // For user-friendly row numbering

        customersOnly.forEach((user) => {
            const receivable = parseFloat(user.remaining_balance || 0);

            let loanOutstanding = 0;
            let chitNetPosition = 0;

            const userTransactions = allTransactionsCache.filter((tx) => tx.user_id === user.id);

            userTransactions.forEach((tx) => {
                const categoryInfo = transactionCategories.find((cat) => cat.name === tx.category);
                if (categoryInfo) {
                    const amount = parseFloat(tx.amount);
                    if (categoryInfo.group === "customer_loan_out") {
                        loanOutstanding += amount;
                    } else if (categoryInfo.group === "customer_loan_in") {
                        loanOutstanding += amount; // These are negative, so it correctly reduces the outstanding amount
                    } else if (categoryInfo.group === "customer_chit_in") {
                        chitNetPosition -= amount; // Business receives, so liability to customer increases
                    } else if (categoryInfo.group === "customer_chit_out") {
                        chitNetPosition -= amount; // Business pays out, liability decreases
                    }
                }
            });

            const row = customerTableBody.insertRow();
            
            row.insertCell().textContent = serialNumber++;
            row.insertCell().textContent = user.username;
            row.insertCell().textContent = (parseFloat(user.initial_balance) || 0).toFixed(2);
            
            const receivableCell = row.insertCell();
            receivableCell.textContent = receivable.toFixed(2);
            receivableCell.className = receivable > 0 ? "negative-balance num" : receivable < 0 ? "positive-balance num" : "num";
            
            const loanCell = row.insertCell();
            loanCell.textContent = loanOutstanding.toFixed(2);
            loanCell.className = loanOutstanding > 0 ? "negative-balance num" : "num";
            
            const chitCell = row.insertCell();
            chitCell.textContent = chitNetPosition.toFixed(2);
            chitCell.className = chitNetPosition >= 0 ? "negative-balance num" : "positive-balance num";
            
            row.insertCell().textContent = new Date(user.created_at).toLocaleDateString();
            
            const actionsCell = row.insertCell();
            actionsCell.innerHTML = `
                <button class="btn btn-sm btn-info" onclick="openUserTransactionHistoryModal(${user.id}, '${user.username.replace(/'/g, "\\'")}')" title="View History">
                    <i class="fas fa-history"></i>
                </button>
                <button class='btn btn-primary btn-sm' onclick='openUserModal(${JSON.stringify(user)})' title="Edit Customer">
                    <i class="fas fa-edit"></i>
                </button>
                <button class='btn btn-danger btn-sm' onclick='deleteUser(${user.id})' title="Delete Customer">
                    <i class="fas fa-trash"></i>
                </button>
            `;
        });

    } catch (error) {
        console.error("Error loading customer summaries:", error);
        if (customerTableBody) {
            customerTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:red;">Error: ${error.message}</td></tr>`;
        }
    }
}
async function loadSupplierSummaries() {
    const supplierTableBody = document.getElementById("supplierTableBody");
    if(!supplierTableBody) return;
    supplierTableBody.innerHTML =
        '<tr><td colspan="6" style="text-align:center;">Loading supplier data...</td></tr>';
    try {
        const suppliers = await loadLenders("Supplier", true); // Force refresh for suppliers

        supplierTableBody.innerHTML = "";
        if (!Array.isArray(suppliers) || suppliers.length === 0) {
            supplierTableBody.innerHTML =
                '<tr><td colspan="6" style="text-align:center;">No suppliers found. Add them via "+ Add Supplier" button.</td></tr>';
            return;
        }

        let serialNumber = 1;
        suppliers.forEach((supplier) => {
            const row = supplierTableBody.insertRow();
            row.insertCell().textContent = serialNumber++;
            row.insertCell().textContent = supplier.lender_name;
            row.insertCell().textContent = supplier.contact_person || "-";
            
            const payableCell = row.insertCell();
            const currentPayable = parseFloat(supplier.current_payable || 0); 
            payableCell.textContent = currentPayable.toFixed(2);
            payableCell.className =
                currentPayable > 0 
                    ? "negative-balance num" 
                    : currentPayable < 0 
                      ? "positive-balance num"
                      : "num";

            row.insertCell().textContent = supplier.notes || "-";
            row.insertCell().innerHTML = `<button class="btn btn-sm btn-info" onclick="viewBusinessExternalTransactions('${supplier.lender_name.replace(/'/g, "\\'")}', 'Supplier', ${supplier.id})"><i class="fas fa-list-alt"></i></button> <button class='btn btn-primary btn-sm' onclick='openLenderModal(${JSON.stringify(supplier)}, "Supplier")'><i class="fas fa-edit"></i></button>`;
        });

        if (supplierTableBody.rows.length === 0 && suppliers.length > 0) {
            supplierTableBody.innerHTML =
                '<tr><td colspan="6" style="text-align:center;">No financial activity or payable info for listed suppliers.</td></tr>';
        } else if (
            supplierTableBody.rows.length === 0 &&
            suppliers.length === 0
        ) {
             supplierTableBody.innerHTML =
                '<tr><td colspan="6" style="text-align:center;">No suppliers found.</td></tr>';
        }
    } catch (error) {
        console.error("Error loading supplier summaries:", error);
        if(supplierTableBody)
            supplierTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Error: ${error.message}</td></tr>`;
    }
}
async function populateAgreementEntityDropdown() {
    const dropdown = document.getElementById("agreement_entity_id");
    if (!dropdown) return;
    try {
        let entitiesToUse = externalEntitiesCache;
        if (!Array.isArray(entitiesToUse) || (entitiesToUse.length === 0 && !isLoading.lenders)) {
            entitiesToUse = await loadLenders(null, true);
        }
        dropdown.innerHTML = '<option value="">Select External Entity...</option>';
        if (Array.isArray(entitiesToUse)) {
            entitiesToUse.forEach((entity) => {
                const option = document.createElement("option");
                option.value = entity.id;
                option.textContent = `${entity.lender_name} (${entity.entity_type || 'General'})`;
                dropdown.appendChild(option);
            });
        }
    } catch (error) {
        console.error(error);
        if (dropdown)
            dropdown.innerHTML = '<option value="">Error loading entities</option>';
    }
}
function openCreateBusinessChitLoanAgreementModal(agreementId = null) {
    const modal = document.getElementById("businessChitLoanAgreementModal");
    const form = document.getElementById("businessChitLoanAgreementForm");
    const title = document.getElementById("businessChitLoanAgreementModalTitle");
    form.reset();
    editingAgreementId = null;
    document.getElementById("agreementId").value = "";
    document.getElementById("agreement_interest_rate").value = "";

    const agreement = agreementId ? businessAgreementsCache.find(a => a.agreement_id === agreementId) : null;
    
    populateAgreementEntityDropdown().then(() => {
        if (agreement) {
            editingAgreementId = agreement.agreement_id;
            title.textContent = "Edit Business Finance Agreement";
            document.getElementById("agreementId").value = editingAgreementId;
            document.getElementById("agreement_entity_id").value = agreement.lender_id;
            document.getElementById("agreement_type").value = agreement.agreement_type;
            document.getElementById("agreement_total_amount").value = agreement.total_amount;
            document.getElementById("agreement_interest_rate").value = (agreement.interest_rate !== undefined && agreement.interest_rate !== null) ? agreement.interest_rate : "0";
            document.getElementById("agreement_start_date").value = agreement.start_date.split("T")[0];
            document.getElementById("agreement_details").value = agreement.details || "";
        } else {
            editingAgreementId = null;
            title.textContent = "New Business Finance Agreement";
            document.getElementById("agreement_start_date").value = new Date().toISOString().split("T")[0];
            document.getElementById("agreement_interest_rate").value = "0";
        }
    });
    modal.classList.add('show');
}
function closeBusinessChitLoanAgreementModal() {
    const modal = document.getElementById("businessChitLoanAgreementModal");
    if (modal) {
        modal.classList.remove('show');
    }
    editingAgreementId = null;
    const form = document.getElementById("businessChitLoanAgreementForm");
    if(form){form.reset();}
}
function openLoanFundsReceiptModal(agreementData) {
    const modal = document.getElementById("loanFundsReceiptModal");
    if (!modal || !agreementData) return;
    
    document.getElementById('receipt_agreement_id').value = agreementData.agreement_id;
    document.getElementById('receipt_lender_id').value = agreementData.lender_id;
    document.getElementById('receipt_amount').value = agreementData.total_amount;
    document.getElementById('receipt_date').value = agreementData.start_date;
    document.getElementById('receipt_agreement_type').value = agreementData.agreement_type;

    modal.classList.add('show');
}
function closeLoanFundsReceiptModal() {
    const modal = document.getElementById("loanFundsReceiptModal");
    if (modal) modal.classList.remove('show');
}
async function handleLoanFundsReceiptSubmit(e) {
    e.preventDefault();
    
    const agreementId = document.getElementById('receipt_agreement_id').value;
    const lenderId = document.getElementById('receipt_lender_id').value;
    const amount = parseFloat(document.getElementById('receipt_amount').value);
    const date = document.getElementById('receipt_date').value;
    const agreementType = document.getElementById('receipt_agreement_type').value;
    const receiptMethod = document.querySelector('input[name="receipt_method"]:checked').value;

    let category = '';
    let description = '';
    
    if (agreementType === 'loan_taken_by_biz') {
        category = `Loan Received by Business (to ${receiptMethod})`;
        description = `Initial amount for loan agreement #${agreementId}`;
    } else if (agreementType === 'loan_given_by_biz') {
        category = `Loan Disbursed to Customer (from ${receiptMethod})`;
        description = `Initial disbursement for loan agreement #${agreementId}`;
    } else {
        alert("This workflow is only for loan agreements.");
        return;
    }

    const transactionData = {
        lender_id: lenderId,
        agreement_id: agreementId,
        amount: amount, 
        description: description,
        category: category,
        date: date.split('T')[0]
    };
    
    try {
        const res = await apiFetch(`${API}/transactions`, {
            method: 'POST',
            body: JSON.stringify(transactionData)
        });
        if (!res || !res.ok) {
            const result = await res.json();
            throw new Error(result.error || "Failed to create the financial transaction.");
        }
        alert("Agreement and initial financial transaction created successfully!");
        closeLoanFundsReceiptModal();
        
        await loadAllTransactions();
        await loadBusinessExternalFinanceAgreements();
        const cashLedgerActive = document.getElementById("cashLedgerContent")?.style.display !== 'none';
        const bankLedgerActive = document.getElementById("bankLedgerContent")?.style.display !== 'none';
        if (cashLedgerActive) loadCashLedger();
        if (bankLedgerActive) loadBankLedger();

    } catch (error) {
        console.error("Error creating loan receipt transaction:", error);
        alert("Error: " + error.message);
    }
}

async function loadBusinessExternalFinanceAgreements() {
    if (isLoading.businessAgreements) return businessAgreementsCache;
    isLoading.businessAgreements = true;

    const tableBody = document.getElementById("businessExternalFinanceTableBody");
    if (!tableBody) {
        isLoading.businessAgreements = false;
        return [];
    }
    
    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Loading business agreements...</td></tr>';

    try {
        if (allTransactionsCache.length === 0 && !isLoading.transactions) {
            console.log("[loadBusinessExternalFinanceAgreements] Transaction cache empty, fetching now...");
            await loadAllTransactions();
        }

        const agreementsRes = await apiFetch(`${API}/business-agreements`);
        if (!agreementsRes || !agreementsRes.ok) {
            const errTxt = await agreementsRes.text().catch(() => "Failed to read error");
            throw new Error(`Agreements fetch failed: ${agreementsRes.status} ${errTxt}`);
        }
        
        const data = await agreementsRes.json();
        businessAgreementsCache = Array.isArray(data) ? data : [];
        
        displayBusinessExternalFinanceAgreements();
        
        return businessAgreementsCache;

    } catch (error) {
        console.error("Error loading business agreements:", error);
        businessAgreementsCache = [];
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;">Error: ${error.message}</td></tr>`;
        }
        return [];
    } finally {
        isLoading.businessAgreements = false;
    }
}
function displayBusinessExternalFinanceAgreements() {
    const tableBody = document.getElementById("businessExternalFinanceTableBody");
    if (!tableBody) return;
    tableBody.innerHTML = "";

    if (!Array.isArray(businessAgreementsCache) || businessAgreementsCache.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center;">No agreements found.</td></tr>';
        return;
    }
    businessAgreementsCache.forEach((agreement) => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = agreement.lender_name;

        const typeCell = row.insertCell();
        typeCell.textContent = agreement.agreement_type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
        typeCell.className = 'type-cell';

        const principalCell = row.insertCell();
        const effectivePrincipal = (parseFloat(agreement.outstanding_principal) || 0) + (parseFloat(agreement.calculated_principal_paid) || 0);
        principalCell.textContent = effectivePrincipal.toFixed(2);
        principalCell.className = 'num';
        
        const monthlyRate = parseFloat(agreement.interest_rate) || 0;
        const rateCell = row.insertCell();
        rateCell.textContent = monthlyRate.toFixed(2) + "%";
        rateCell.className = 'num';
        
        // --- FIX: Add new EMI column ---
        const emiCell = row.insertCell();
        emiCell.textContent = agreement.emi_amount ? parseFloat(agreement.emi_amount).toFixed(2) : "N/A";
        emiCell.className = 'num';
        
        const interestPayableCell = row.insertCell();
        const interest_payable = agreement.interest_payable !== undefined ? parseFloat(agreement.interest_payable) : NaN;
        interestPayableCell.textContent = !isNaN(interest_payable) ? interest_payable.toFixed(2) : "N/A";
        const isAsset = agreement.agreement_type === 'loan_given_by_biz';
        interestPayableCell.className = (interest_payable > 0 && !isAsset) ? "negative-balance num" : ((interest_payable > 0 && isAsset) ? "positive-balance num" : "num");

        const paidCell = row.insertCell();
        const total_paid = parseFloat(agreement.calculated_principal_paid || 0) + parseFloat(agreement.calculated_interest_paid || 0);
        paidCell.textContent = total_paid.toFixed(2);
        paidCell.className = "num";

        const balanceCell = row.insertCell();
        const netBalance = parseFloat(agreement.outstanding_principal || 0);
        balanceCell.textContent = netBalance.toFixed(2);
        balanceCell.className = netBalance > 0 ? "negative-balance num" : "positive-balance num";
        
        const actionsCell = row.insertCell();
        actionsCell.className = 'actions-cell';

        const breakdownBtn = document.createElement('button');
        breakdownBtn.className = 'btn btn-sm btn-secondary';
        breakdownBtn.title = 'View Breakdown';
        breakdownBtn.innerHTML = '<i class="fas fa-list-ul"></i>';
        breakdownBtn.onclick = () => openLoanDetailsModal(agreement.agreement_id);
        actionsCell.appendChild(breakdownBtn);

        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-sm btn-primary';
        editBtn.title = 'Edit Agreement';
        editBtn.innerHTML = '<i class="fas fa-edit"></i>';
        editBtn.onclick = () => openCreateBusinessChitLoanAgreementModal(agreement.agreement_id);
        actionsCell.appendChild(editBtn);

        if (agreement.agreement_type === 'loan_taken_by_biz' || agreement.agreement_type === 'loan_given_by_biz') {
             const buttonText = agreement.agreement_type === 'loan_given_by_biz' ? 'Receive Pmt.' : 'Repay';
             const buttonIcon = agreement.agreement_type === 'loan_given_by_biz' ? 'fa-hand-holding-usd' : 'fa-wallet';
             const repayBtn = document.createElement('button');
             repayBtn.className = 'btn btn-sm btn-success';
             repayBtn.title = buttonText;
             repayBtn.innerHTML = `<i class="fas ${buttonIcon}"></i>`; // Text removed for compactness
             repayBtn.onclick = () => openRepayLoanModal(agreement.agreement_id);
             actionsCell.appendChild(repayBtn);
        } else {
             const addTxBtn = document.createElement('button');
             addTxBtn.className = 'btn btn-sm btn-success';
             addTxBtn.title = 'Add Transaction for this Agreement';
             addTxBtn.innerHTML = '<i class="fas fa-plus"></i>';
             addTxBtn.onclick = () => openTransactionModal(null, null, true, agreement.lender_id, agreement.agreement_id);
             actionsCell.appendChild(addTxBtn);
        }
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-sm btn-danger';
        deleteBtn.title = 'Delete Agreement';
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.onclick = () => deleteBusinessAgreement(agreement.agreement_id);
        actionsCell.appendChild(deleteBtn);
    });

    if (tableBody.rows.length === 0 && businessAgreementsCache.length > 0) {
        tableBody.innerHTML =
            '<tr><td colspan="9" style="text-align:center;">No transactions matched agreements.</td></tr>';
    }
}
async function deleteBusinessAgreement(agreementId) {
    if (!confirm("Are you sure you want to delete this business agreement? This will not delete associated transactions."))
        return;
    try {
        const res = await apiFetch(`${API}/business-agreements/${agreementId}`, {
            method: "DELETE",
        });
        if(!res) return;
        const result = await res.json();
        if (!res.ok)
            throw new Error(result.error || `Failed to delete: ${res.statusText}`);
        alert(result.message || "Business agreement deleted");
        loadBusinessExternalFinanceAgreements();
    } catch (error) {
        console.error("Error deleting agreement:", error);
        alert("Error: " + error.message);
    }
}
function openTransactionModalForBusinessExternal() {
    openTransactionModal(null, null, true);
}


let currentViewingUserId = null;
let currentViewingUserName = null;
function openUserTransactionHistoryModal(
    userId,
    userName,
    initialFilter = 'all',
) {
    currentViewingUserId = userId;
    currentViewingUserName = userName;
    const modal = document.getElementById("userTransactionHistoryModal");
    const title = document.getElementById("userTransactionHistoryModalTitle");
    const filterDropdown = document.getElementById(
        "userTxHistoryCategoryFilter",
    );
    title.textContent = `Transaction History for ${userName}`;
    filterDropdown.value = initialFilter;
    filterDropdown.dataset.userId = userId;
    filterDropdown.dataset.userName = userName;
    loadUserTransactionHistory(userId, userName, initialFilter);
    modal.classList.add('show');
}
function closeUserTransactionHistoryModal() {
    const modal = document.getElementById("userTransactionHistoryModal");
    if (modal) {
        modal.classList.remove('show');
    }
    currentViewingUserId = null;
    currentViewingUserName = null;
}
async function loadUserTransactionHistory(
    userId,
    userName,
    categoryGroupFilter = 'all',
) {
    const table = document.getElementById("userTransactionHistoryTable");
    const tableBody = table?.querySelector("tbody");
    const tableFoot = table?.querySelector("tfoot") || table?.appendChild(document.createElement("tfoot"));

    if (!tableBody || !tableFoot) return;
    
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading history...</td></tr>';
    tableFoot.innerHTML = "";

    try {
        if (allTransactionsCache.length === 0 && !isLoading.transactions) await loadAllTransactions();
        if (usersDataCache.length === 0 && !isLoading.users) await loadUsers();
        if (invoicesCache.length === 0 && !isLoading.invoices) await loadInvoices();

        const customer = usersDataCache.find(u => u.id === userId);
        if (!customer) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Customer not found.</td></tr>`;
            return;
        }

        let allEntries = [...allTransactionsCache.filter(tx => tx.user_id === userId)];
        
        // **START OF THE FIX**
        // Create pseudo-transactions for all payments made on invoices for this user
        const userInvoicesWithPayments = invoicesCache.filter(inv => inv.customer_id === userId && parseFloat(inv.paid_amount || 0) > 0);
        
        userInvoicesWithPayments.forEach(inv => {
            allEntries.push({
                // Treat it like a transaction for sorting and display
                id: `inv-pmt-${inv.id}`, // Unique-ish ID
                date: inv.invoice_date, // Assume payment date is invoice date for simplicity
                category: 'Payment Received (Invoice)',
                description: `Payment for Invoice #${inv.invoice_number}`,
                amount: -Math.abs(parseFloat(inv.paid_amount)), // Payment reduces customer balance (credit)
                isInvoicePayment: true, // Custom flag
            });
        });
        // **END OF THE FIX**

        const filteredEntries = categoryGroupFilter === 'all'
            ? allEntries
            : allEntries.filter(entry => {
                // Allow invoice payments to show in the "All" and "Payments" filters
                if (entry.isInvoicePayment) {
                    return categoryGroupFilter === 'all' || categoryGroupFilter === 'customer_payment';
                }
                const categoryInfo = transactionCategories.find(cat => cat.name === entry.category);
                if (!categoryInfo || !categoryInfo.group) return false;
                if (categoryGroupFilter === "customer_loan") return ["customer_loan_out", "customer_loan_in"].includes(categoryInfo.group);
                if (categoryGroupFilter === "customer_chit") return ["customer_chit_in", "customer_chit_out"].includes(categoryInfo.group);
                if (categoryGroupFilter === "customer_revenue") return ["customer_revenue", "customer_service"].includes(categoryInfo.group);
                return categoryInfo.group === categoryGroupFilter;
            });
        
        filteredEntries.sort((a, b) => new Date(a.date) - new Date(b.date) || (a.id||0) - (b.id||0));
        
        tableBody.innerHTML = "";

        const firstTransactionDate = filteredEntries.length > 0 ? filteredEntries[0].date : new Date().toISOString().split('T')[0];
        
        let openingBalance = parseFloat(customer.initial_balance || 0);
        
        allTransactionsCache
            .filter(tx => tx.user_id === userId && tx.date < firstTransactionDate)
            .forEach(tx => { openingBalance += parseFloat(tx.amount || 0); });

        // Also add past invoice payments to opening balance
        invoicesCache
            .filter(inv => inv.customer_id === userId && inv.invoice_date < firstTransactionDate && parseFloat(inv.paid_amount || 0) > 0)
            .forEach(inv => { openingBalance -= parseFloat(inv.paid_amount); });

        let runningBalance = openingBalance;
        let totalDebits = 0;
        let totalCredits = 0;
        
        const openingDate = new Date(firstTransactionDate + 'T00:00:00');
        const formattedOpeningDate = `${String(openingDate.getDate()).padStart(2, '0')}-${openingDate.toLocaleString('default', { month: 'short' })}-${openingDate.getFullYear()}`;

        const openingRow = tableBody.insertRow();
        openingRow.innerHTML = `
            <td>${formattedOpeningDate}</td>
            <td><strong>Opening Balance</strong></td>
            <td class="num"></td>
            <td class="num"></td>
            <td class="num ${runningBalance >= 0 ? 'positive-balance' : 'negative-balance'}"><strong>₹${runningBalance.toFixed(2)}</strong></td>
        `;

        if (filteredEntries.length === 0) {
            tableBody.innerHTML += `<tr><td colspan="5" style="text-align:center;">No transactions found for ${userName} with selected filter.</td></tr>`;
        } else {
            filteredEntries.forEach((tx) => {
                const row = tableBody.insertRow();
                let debit = "";
                let credit = "";
                const amount = parseFloat(tx.amount || 0);

                if (amount > 0) {
                    debit = amount.toFixed(2);
                    totalDebits += amount;
                } else {
                    credit = Math.abs(amount).toFixed(2);
                    totalCredits += Math.abs(amount);
                }
                
                runningBalance += amount;
                
                let particulars = `${tx.category || "N/A"}`;
                if (tx.description) particulars += ` (${tx.description})`;

                let actionButton = '';
                if (tx.related_invoice_id && tx.category.toLowerCase().includes('sale to customer')) {
                    const invoice = invoicesCache.find(inv => inv.id === tx.related_invoice_id);
                    if (invoice && invoice.status !== 'Paid') {
                        const balanceDue = (parseFloat(invoice.total_amount) || 0) - (parseFloat(invoice.paid_amount) || 0);
                        if (balanceDue > 0) {
                           actionButton = `<button class="btn btn-success btn-sm" style="margin-left:10px;" onclick="openTransactionModal(null, ${userId}, false, null, null, 'Payment Received from Customer', ${tx.related_invoice_id})">Pay Now</button>`;
                        }
                    }
                }
                
                const txDate = new Date(tx.date + 'T00:00:00');
                const formattedTxDate = `${String(txDate.getDate()).padStart(2, '0')}-${txDate.toLocaleString('default', { month: 'short' })}-${txDate.getFullYear()}`;

                row.innerHTML = `
                    <td>${formattedTxDate}</td>
                    <td>${particulars} ${actionButton}</td>
                    <td class="num positive">${debit ? '₹' + debit : ''}</td>
                    <td class="num negative">${credit ? '₹' + credit : ''}</td>
                    <td class="num ${runningBalance >= 0 ? 'positive-balance' : 'negative-balance'}">₹${runningBalance.toFixed(2)}</td>
                `;
            });
        }

        tableFoot.innerHTML = `
            <tr style="border-top: 2px solid #ccc; font-weight: bold;">
                <td colspan="2" style="text-align:right;">Total</td>
                <td class="num positive">₹${totalDebits.toFixed(2)}</td>
                <td class="num negative">₹${totalCredits.toFixed(2)}</td>
                <td></td>
            </tr>
            <tr style="font-weight: bold;">
                <td colspan="4" style="text-align:right;">Closing Balance</td>
                <td class="num ${runningBalance >= 0 ? 'positive-balance' : 'negative-balance'}">₹${runningBalance.toFixed(2)}</td>
            </tr>
        `;

    } catch (error) {
        console.error(`Error loading ledger for user ${userId}:`, error);
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Error: ${error.message}</td></tr>`;
    }
}
function viewBusinessExternalTransactions(entityName, entityType, entityId){
    alert(`Viewing transactions for ${entityType}: ${entityName} (ID: ${entityId}). (Modal/detailed view to be implemented)\nThis currently relies on matching the lender_id in transactions.`);
    const entityTxns = allTransactionsCache.filter(tx => tx.lender_id === entityId);
    console.log(`Filtered transactions for ${entityType} ${entityName}:`, entityTxns);
    openEntityTransactionHistoryModal(entityId, entityName, 'lender');
}

function viewAgreementTransactions(agreementId, lenderName){ // lenderName here is actually agreement's entity name
    alert(`Viewing transactions for agreement with ${lenderName} (ID: ${agreementId}). (Modal/detailed view to be implemented)\nThis currently relies on matching the agreement_id in transactions.`);
    const agreementTxns = allTransactionsCache.filter(tx => tx.agreement_id === agreementId);
     console.log("Filtered transactions for agreement:", agreementId, agreementTxns);
    openEntityTransactionHistoryModal(agreementId, `Agreement with ${lenderName}`, 'agreement');
}
async function loadProducts() {
    if (isLoading.products) return productsCache;
    isLoading.products = true;
    const tableBody = document.getElementById("productTableBody");
    if (tableBody)
        tableBody.innerHTML =
            '<tr><td colspan="9" style="text-align:center;">Loading products...</td></tr>';
    try {
        const res = await apiFetch(`${API}/products`);
        if (!res || !res.ok) {
            const errTxt = await res
                .text()
                .catch(() => "Could not read error response.");
            throw new Error(`Products fetch failed: ${res.status} ${errTxt}`);
        }
        const data = await res.json();
        productsCache = Array.isArray(data) ? data : [];
        displayProducts();
        updateDashboardCards();
        return productsCache;
    } catch (error) {
        console.error("Error loading products:", error);
        if(tableBody)
            tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;">Error: ${error.message}</td></tr>`;
        productsCache = [];
        return [];
    } finally {
        isLoading.products = false;
    }
}

function displayProducts() {
    const tableBody = document.getElementById("productTableBody");
    if(!tableBody) return;
    tableBody.innerHTML = "";
    if (!Array.isArray(productsCache) || productsCache.length === 0) {
        tableBody.innerHTML =
            '<tr><td colspan="9" style="text-align:center;">No products found. Add one.</td></tr>';
        return;
    }
    let serialNumber = 1;
    productsCache.forEach((product) => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = serialNumber++;
        row.insertCell().textContent = product.product_name;
        row.insertCell().textContent = product.sku || "-";
        row.insertCell().textContent = product.preferred_supplier_name || "-";
        
        const prefPurchasePriceCell = row.insertCell();
        prefPurchasePriceCell.textContent = (product.preferred_supplier_purchase_price !== null && product.preferred_supplier_purchase_price !== undefined) ? parseFloat(product.preferred_supplier_purchase_price).toFixed(2) : "-";
        prefPurchasePriceCell.classList.add("num");

        const costPriceCell = row.insertCell();
        costPriceCell.textContent = (product.cost_price || 0).toFixed(2);
        costPriceCell.classList.add("num");

        const salePriceCell = row.insertCell();
        salePriceCell.textContent = product.sale_price.toFixed(2);
        salePriceCell.classList.add("num");

        row.insertCell().textContent = product.current_stock;
        const actionsCell = row.insertCell();
        actionsCell.innerHTML = `
            <button class='btn btn-primary btn-sm' onclick='openProductModal(${product.id})'><i class="fas fa-edit"></i></button>
            <button class='btn btn-danger btn-sm' onclick='deleteProduct(${product.id})'><i class="fas fa-trash"></i></button>
        `;
    });
}

async function openProductModal(productIdOrNull = null) {
    const modal = document.getElementById("productModal");
    const form = document.getElementById("productForm");
    const title = document.getElementById("productModalTitle");
    form.reset();
    editingProductId = productIdOrNull;
    currentLinkingProductId = productIdOrNull;
    
    document.getElementById("productId").value = productIdOrNull || "";
    document.getElementById("productSuppliersTableBody").innerHTML = "";
    const linkSupplierBtn = document.querySelector('#productModal button[onclick="openProductSupplierLinkModal()"]');

    if (productIdOrNull) {
        title.textContent = "Edit Product & Manage Suppliers";
        if (linkSupplierBtn) {
            linkSupplierBtn.disabled = false;
            linkSupplierBtn.title = "Link a supplier to this product";
            linkSupplierBtn.classList.remove('btn-disabled');
        }
        try {
            const productRes = await apiFetch(`${API}/products/${productIdOrNull}`);
            if (!productRes || !productRes.ok)
                throw new Error("Failed to fetch product details.");
            const product = await productRes.json();

            document.getElementById("productName").value = product.product_name || "";
            document.getElementById("productSku").value = product.sku || "";
            document.getElementById("productHsnAcs").value = product.hsn_acs_code || "";
            document.getElementById("productDescription").value = product.description || "";
            document.getElementById("productCostPrice").value = product.cost_price !== undefined ? product.cost_price : "";
            document.getElementById("productSalePrice").value = product.sale_price !== undefined ? product.sale_price : "";
            document.getElementById("productCurrentStock").value = product.current_stock !== undefined ? product.current_stock : "";
            document.getElementById("productUnitOfMeasure").value = product.unit_of_measure || "pcs";
            document.getElementById("productLowStockThreshold").value = product.low_stock_threshold !== undefined ? product.low_stock_threshold : 0;
            document.getElementById("productReorderLevel").value = product.reorder_level !== undefined ? product.reorder_level : 0;

            productSuppliersCache = product.suppliers || [];
            displayProductSuppliersList(productSuppliersCache);
        } catch (error) {
            console.error("Error opening product modal for edit:", error);
            alert("Could not load product details: " + error.message);
            closeProductModal();
            return;
        }
    } else {
        title.textContent = "Add New Product";
        currentLinkingProductId = null;
        document.getElementById("productUnitOfMeasure").value = "pcs";
        document.getElementById("productLowStockThreshold").value = 0;
        document.getElementById("productReorderLevel").value = 0;
        productSuppliersCache = [];
        displayProductSuppliersList([]);
        if (linkSupplierBtn) {
            linkSupplierBtn.disabled = true;
            linkSupplierBtn.title = "Save product first to link suppliers";
            linkSupplierBtn.classList.add('btn-disabled');
        }
    }
    modal.classList.add('show');
}


function closeProductModal() {
    const modal = document.getElementById("productModal");
    if (modal) {
        modal.classList.remove('show');
    }
    editingProductId = null;
    currentLinkingProductId = null;
    const form = document.getElementById("productForm");
    if(form){form.reset();}
    document.getElementById("productSuppliersTableBody").innerHTML = "";
    productSuppliersCache = [];
}
// Product Functions
async function handleProductSubmit(e) {
    e.preventDefault();
    const productModalTitle = document.getElementById("productModalTitle");
    const data = {
        product_name: document.getElementById("productName").value.trim(),
        sku: document.getElementById("productSku").value.trim() || null,
        hsn_acs_code: document.getElementById("productHsnAcs").value.trim() || null,
        description: document.getElementById("productDescription").value.trim(),
        cost_price: parseFloat(document.getElementById("productCostPrice").value) || 0,
        sale_price: parseFloat(document.getElementById("productSalePrice").value),
        current_stock: parseInt(document.getElementById("productCurrentStock").value),
        unit_of_measure: document.getElementById("productUnitOfMeasure").value.trim() || "pcs",
        low_stock_threshold: parseInt(document.getElementById("productLowStockThreshold").value) || 0,
        reorder_level: parseInt(document.getElementById("productReorderLevel").value) || 0,
    };

    if (!data.product_name || isNaN(data.sale_price) || isNaN(data.current_stock)) {
        alert("Product Name, Sale Price, and Current Stock are required and must be valid numbers.");
        return;
    }

    const method = editingProductId ? "PUT" : "POST";
    const endpoint = editingProductId ? `${API}/products/${editingProductId}` : `${API}/products`;

    try {
        const res = await apiFetch(endpoint, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res) return;
        const result = await res.json();
        if (!res.ok)
            throw new Error(result.error || `Operation failed: ${res.statusText}`);

        alert(result.message || (editingProductId ? "Product details updated" : "Product created"));

        if (method === "POST" && result.product && result.product.id) {
            editingProductId = result.product.id;
            currentLinkingProductId = result.product.id;
            document.getElementById("productId").value = editingProductId;
            if (productModalTitle)
                productModalTitle.textContent = "Edit Product & Manage Suppliers";
            const linkSupplierBtn = document.querySelector('#productModal button[onclick="openProductSupplierLinkModal()"]');
            if (linkSupplierBtn) {
                linkSupplierBtn.disabled = false;
                linkSupplierBtn.title = "Link a supplier to this product";
                linkSupplierBtn.classList.remove('btn-disabled');
            }
        }

        await loadProducts();
        if (editingProductId) {
            await loadAndDisplayProductSuppliers(editingProductId);
        }
        await loadLenders(null, true);
        if (document.getElementById("supplierManagementSection")?.style.display === 'block') {
            loadSupplierSummaries();
        }
    } catch (error) {
        console.error("Error saving product details:", error);
        alert("Error saving product details: " + error.message);
    }
}
async function deleteProduct(productId) {
    if (!confirm("Are you sure you want to delete this product? This action CANNOT be undone and will also remove associated supplier links."))
        return;
    try {
        const res = await apiFetch(`${API}/products/${productId}`, {
            method: "DELETE",
        });
        if (!res) return;
        const result = await res.json();
        if (!res.ok)
            throw new Error(result.error || `Failed to delete product: ${res.statusText}`);
        alert(result.message || "Product deleted");
        await loadProducts();
        await loadLenders(null, true);
        if (document.getElementById("supplierManagementSection")?.style.display === 'block') {
            loadSupplierSummaries();
        }
    } catch (error) {
        console.error("Error deleting product:", error);
        alert("Error deleting product: " + error.message);
    }
}
async function openProductSupplierLinkModal(linkData = null) {
    if (!currentLinkingProductId) {
        alert("Please save the product details first OR ensure an existing product is loaded before linking suppliers.");
        return;
    }
    editingProductSupplierLinkId = linkData ? linkData.product_supplier_id : null;

    const modal = document.getElementById("productSupplierLinkModal");
    const form = document.getElementById("productSupplierLinkForm");
    const title = document.getElementById("productSupplierLinkModalTitle");
    form.reset();

    document.getElementById("linkModalProductId").value = currentLinkingProductId;
    document.getElementById("productSupplierLinkId").value = editingProductSupplierLinkId || "";

    await populateSuppliersForProductLinkModal();

    if (linkData) {
        const currentProduct = productsCache.find((p) => p.id == currentLinkingProductId);
        title.textContent = `Edit Supplier Link for ${currentProduct?.product_name || "Product"}`;
        document.getElementById("linkSupplierId").value = linkData.supplier_id;
        document.getElementById("linkSupplierSku").value = linkData.supplier_sku || "";
        document.getElementById("linkSupplierPurchasePrice").value = linkData.purchase_price !== null ? parseFloat(linkData.purchase_price).toFixed(2) : "";
        document.getElementById("linkSupplierLeadTime").value = linkData.lead_time_days || "";
        document.getElementById("linkIsPreferredSupplier").checked = !!linkData.is_preferred;
        document.getElementById("linkSupplierNotes").value = linkData.supplier_specific_notes || linkData.notes || "";
    } else {
        const currentProduct = productsCache.find((p) => p.id == currentLinkingProductId);
        title.textContent = `Link New Supplier to ${currentProduct?.product_name || "Product"}`;
    }
    modal.classList.add('show');
}

function closeProductSupplierLinkModal() {
    const modal = document.getElementById("productSupplierLinkModal");
    if (modal) modal.classList.remove('show');
    editingProductSupplierLinkId = null;
    document.getElementById("productSupplierLinkForm").reset();
}
async function populateSuppliersForProductLinkModal() {
    const dropdown = document.getElementById("linkSupplierId");
    if (!dropdown) return;

    if (externalEntitiesCache.length === 0 && !isLoading.lenders) {
        await loadLenders(null, true);
    }
    const suppliers = externalEntitiesCache.filter(
        (e) => e.entity_type === 'Supplier',
    );

    const currentValue = dropdown.value;
    dropdown.innerHTML = '<option value="">Select Supplier...</option>';
    suppliers.forEach((supplier) => {
        const option = document.createElement("option");
        option.value = supplier.id;
        option.textContent = supplier.lender_name;
        dropdown.appendChild(option);
    });
    if (currentValue) dropdown.value = currentValue;
}
async function handleProductSupplierLinkSubmit(e) {
    e.preventDefault();
    const productId = document.getElementById("linkModalProductId").value;
    const supplierId = document.getElementById("linkSupplierId").value;

    if (!productId || !supplierId) {
        alert("Product and Supplier must be selected.");
        return;
    }

    const data = {
        product_id: parseInt(productId),
        supplier_id: parseInt(supplierId),
        supplier_sku: document.getElementById("linkSupplierSku").value.trim() || null,
        purchase_price: document.getElementById("linkSupplierPurchasePrice").value ? parseFloat(document.getElementById("linkSupplierPurchasePrice").value) : null,
        lead_time_days: document.getElementById("linkSupplierLeadTime").value ? parseInt(document.getElementById("linkSupplierLeadTime").value) : null,
        is_preferred: document.getElementById("linkIsPreferredSupplier").checked,
        notes: document.getElementById("linkSupplierNotes").value.trim() || null,
    };

    const method = editingProductSupplierLinkId ? "PUT" : "POST";
    const endpoint = editingProductSupplierLinkId ? `${API}/product-suppliers/${editingProductSupplierLinkId}` : `${API}/product-suppliers`;

    try {
        const res = await apiFetch(endpoint, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res) return;
        const result = await res.json();
        if (!res.ok)
            throw new Error(result.error || "Failed to save product-supplier link.");

        alert(result.message || "Product-supplier link saved.");
        closeProductSupplierLinkModal();
        await loadAndDisplayProductSuppliers(productId);
        await loadProducts();
        await loadLenders(null, true);
        if (document.getElementById("supplierManagementSection")?.style.display === 'block') {
            loadSupplierSummaries();
        }
    } catch (error) {
        console.error("Error saving product-supplier link:", error);
        alert("Error: " + error.message);
    }
}

async function deleteProductSupplierLink(productSupplierId, productIdToRefresh) {
    if (!confirm("Are you sure you want to unlink this supplier from the product?"))
        return;
    try {
        const res = await apiFetch(`${API}/product-suppliers/${productSupplierId}`, { method: "DELETE" });
        if (!res) return;
        const result = await res.json();
        if (!res.ok)
            throw new Error(result.error || "Failed to unlink supplier.");
        alert(result.message || "Supplier unlinked successfully.");
        await loadAndDisplayProductSuppliers(productIdToRefresh);
        await loadProducts();
        await loadLenders(null, true);
        if (document.getElementById("supplierManagementSection")?.style.display === 'block') {
            loadSupplierSummaries();
        }
    } catch (error) {
        console.error("Error unlinking supplier:", error);
        alert("Error: " + error.message);
    }
}

async function loadAndDisplayProductSuppliers(productId) {
    if (!productId) {
        displayProductSuppliersList([]);
        return;
    }
    try {
        const res = await apiFetch(
            `${API}/product-suppliers/product/${productId}`,
        );
        if (!res || !res.ok)
            throw new Error("Failed to fetch suppliers for this product.");
        productSuppliersCache = await res.json();
        displayProductSuppliersList(productSuppliersCache);
    } catch (error) {
        console.error("Error loading product suppliers:", error);
        displayProductSuppliersList([]);
    }
}
function displayProductSuppliersList(suppliers) {
    const tableBody = document.getElementById("productSuppliersTableBody");
    if (!tableBody) return;
    tableBody.innerHTML = "";

    if (!suppliers || suppliers.length === 0) {
        tableBody.innerHTML =
            '<tr><td colspan="5" style="text-align:center;">No suppliers linked yet.</td></tr>';
        return;
    }

    suppliers.forEach((link) => {
        const row = tableBody.insertRow();
        row.insertCell().textContent =
            link.supplier_name || `Supplier ID: ${link.supplier_id}`;
        row.insertCell().textContent = link.supplier_sku || "-";
        row.insertCell().textContent =
            link.purchase_price !== null
                ? parseFloat(link.purchase_price).toFixed(2)
                : "-";
        row.insertCell().innerHTML = `<input type="checkbox" ${link.is_preferred ? "checked" : ""} disabled style="margin: auto; display: block;">`;
        const actionsCell = row.insertCell();
        actionsCell.innerHTML = `
            <button class="btn btn-primary btn-sm" onclick='openProductSupplierLinkModal(${JSON.stringify(link)})'><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm" onclick='deleteProductSupplierLink(${link.product_supplier_id}, ${link.product_id})'><i class="fas fa-unlink"></i></button>
        `;
    });
}


async function deleteProductSupplierLink(
    productSupplierId,
    productIdToRefresh,
) {
    if (
        !confirm(
            "Are you sure you want to unlink this supplier from the product?",
        )
    )
        return;
    try {
        const res = await apiFetch(
            `${API}/product-suppliers/${productSupplierId}`,
            { method: "DELETE" },
        );
        if(!res) return;
        const result = await res.json();
        if (!res.ok)
            throw new Error(result.error || "Failed to unlink supplier.");
        alert(result.message || "Supplier unlinked successfully.");
        await loadAndDisplayProductSuppliers(productIdToRefresh);
        await loadProducts();
        await loadLenders(null, true);
        if (document.getElementById("supplierManagementSection")?.style.display === 'block') {
            loadSupplierSummaries();
        }
    } catch (error) {
        console.error("Error unlinking supplier:", error);
        alert("Error: " + error.message);
    }
}
async function loadInvoices() {
    if (isLoading.invoices) return invoicesCache;
    isLoading.invoices = true;
    const tableBody = document.getElementById("invoiceTableBody");
    if (tableBody)
        tableBody.innerHTML =
            '<tr><td colspan="8" style="text-align:center;">Loading invoices...</td></tr>';

    try {
        const res = await apiFetch(`${API}/invoices`);
        if (!res || !res.ok) {
            const errText = await res
                .text()
                .catch(() => "Could not read error response.");
            throw new Error(`Invoices fetch failed: ${res.status} ${errText}`);
        }
        const data = await res.json();
        invoicesCache = Array.isArray(data) ? data : [];
        displayInvoices();
        updateDashboardCards();
        return invoicesCache;
    } catch (error) {
        console.error("Error loading invoices:", error.message);
        if(tableBody)
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;">Error loading invoices: ${error.message}</td></tr>`;
        invoicesCache = [];
        return [];
    } finally {
        isLoading.invoices = false;
    }
}

function displayInvoices() {
    const tableBody = document.getElementById("invoiceTableBody");
    if(!tableBody) return;
    tableBody.innerHTML = "";

    if (!Array.isArray(invoicesCache) || invoicesCache.length === 0) {
        tableBody.innerHTML =
            '<tr><td colspan="8" style="text-align:center;">No invoices found.</td></tr>';
        return;
    }

    invoicesCache.forEach((inv) => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = inv.invoice_number;
        row.insertCell().textContent =
            inv.customer_name || `ID: ${inv.customer_id}`;
        row.insertCell().textContent = inv.invoice_type
            ? inv.invoice_type
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (l) => l.toUpperCase())
            : "N/A";
        row.insertCell().textContent = new Date(
            inv.invoice_date,
        ).toLocaleDateString();
        row.insertCell().textContent = new Date(
            inv.due_date,
        ).toLocaleDateString();
        const totalCell = row.insertCell();
        totalCell.textContent = parseFloat(inv.total_amount).toFixed(2);
        totalCell.classList.add("num");
        row.insertCell().innerHTML = `<span class="status-badge status-${inv.status.toLowerCase().replace(/\s+/g, '-')}">${inv.status}</span>`;
        row.insertCell().innerHTML = `
            <button class="btn btn-info btn-sm" onclick="viewInvoice(${inv.id})"><i class="fas fa-eye"></i></button>
            <button class="btn btn-secondary btn-sm" onclick="printCurrentInvoiceById(${inv.id})"><i class="fas fa-print"></i></button>
            <button class="btn btn-danger btn-sm" onclick="deleteInvoice(${inv.id})"><i class="fas fa-trash"></i></button>
        `;
    });
}
function toggleGstFields() {
    const invoiceType = document.getElementById("inv_invoice_type").value;
    const gstSection = document.getElementById("invGstSection");
    const gstSummarySection = document.getElementById("invGstSummarySection");
    const saveButton = document.getElementById("saveInvoiceBtn");

    const shouldShowGst = (invoiceType === "TAX_INVOICE" || (invoiceType === "SALES_RETURN"));
    
    if (shouldShowGst) {
        if(gstSection) gstSection.style.display = "flex";
        if(gstSummarySection) gstSummarySection.style.display = "table-row";
    } else {
        if(gstSection) gstSection.style.display = "none";
        if(gstSummarySection) gstSummarySection.style.display = "none";
        document.getElementById("inv_cgst_rate_overall").value = 0;
        document.getElementById("inv_sgst_rate_overall").value = 0;
        document.getElementById("inv_igst_rate_overall").value = 0;
    }

    if (invoiceType === "SALES_RETURN") {
        if(saveButton) saveButton.textContent = "Create Credit Note";
    } else {
        if(saveButton) saveButton.textContent = "Save Invoice";
    }

    updateInvTotals();
}

function togglePartyBillReturnsField() {
    const invoiceType = document.getElementById("inv_invoice_type").value;
    const partyBillReturnsSection = document.getElementById(
        "invPartyBillReturnsSection",
    );
    const returnsDisplayRow = document.getElementById("invReturnsDisplay");

    if (invoiceType === "PARTY_BILL") {
        if(partyBillReturnsSection) partyBillReturnsSection.style.display = "block";
        if(returnsDisplayRow) returnsDisplayRow.style.display = "block"; // This was table-row, might be fine as block
    } else {
        if(partyBillReturnsSection) partyBillReturnsSection.style.display = "none";
        if(returnsDisplayRow) returnsDisplayRow.style.display = "none";
        document.getElementById("inv_party_bill_returns_amount").value = 0;
    }
    updateInvTotals();
}
async function openInvoiceModal(invoiceId = null, type = 'TAX_INVOICE') {
    editingInvoiceId = invoiceId;
    const modal = document.getElementById("invoiceModal");
    const form = document.getElementById("invoiceForm");
    const title = document.getElementById("invoiceModalTitle");
    const lineItemsTableBody = document.getElementById("invLineItemsTableBody");
    const invoiceNumberInput = document.getElementById("inv_invoice_number_display");
    const sameAsCustomerCheckbox = document.getElementById("inv_same_as_customer");
    const paymentBeingMadeNowInput = document.getElementById("inv_payment_being_made_now");
    const cumulativePaidDisplay = document.getElementById("inv_cumulative_paid_display");
    const invoiceTypeDropdown = document.getElementById("inv_invoice_type");
    const originalInvoiceInfoDiv = document.getElementById('originalInvoiceInfo');

    form.reset();
    if(originalInvoiceInfoDiv) originalInvoiceInfoDiv.textContent = '';
    if (lineItemsTableBody) lineItemsTableBody.innerHTML = "";
    if (invoiceNumberInput) invoiceNumberInput.value = "";
    if (paymentBeingMadeNowInput) paymentBeingMadeNowInput.value = "0.00";
    if (cumulativePaidDisplay) cumulativePaidDisplay.textContent = "0.00";
    

    if (!businessProfileCache && !isLoading.businessProfile) {
        await loadBusinessProfile();
    }
    await populateUserDropdownForInv();
    if (productsCache.length === 0 && !isLoading.products) await loadProducts();

    if (invoiceId) { // Editing existing invoice/return
        title.textContent = "Edit Document";
        try {
            const res = await apiFetch(`${API}/invoices/${invoiceId}`);
            if (!res || !res.ok)
                throw new Error(`Failed to fetch invoice details: ${res.status} ${await res.text()}`);
            const inv = await res.json();

            document.getElementById("invoiceId").value = inv.id;
            if (invoiceNumberInput) invoiceNumberInput.value = inv.invoice_number;
            invoiceTypeDropdown.value = inv.invoice_type || "TAX_INVOICE";
            document.getElementById("inv_customer_id").value = inv.customer_id;
            document.getElementById("inv_invoice_date").value = inv.invoice_date.split("T")[0];
            document.getElementById("inv_due_date").value = inv.due_date.split("T")[0];
            document.getElementById("inv_status").value = inv.status;
            document.getElementById("inv_notes").value = inv.notes || "";
            
            if (inv.invoice_type === 'SALES_RETURN') {
                document.getElementById("original_invoice_number_input").value = inv.original_invoice_number || '';
            }

            if (cumulativePaidDisplay) cumulativePaidDisplay.textContent = (inv.paid_amount || 0).toFixed(2);
            if (paymentBeingMadeNowInput) {
                paymentBeingMadeNowInput.value = "0.00";
                paymentBeingMadeNowInput.placeholder = "Enter new payment amount";
            }

            document.getElementById("inv_party_bill_returns_amount").value = inv.party_bill_returns_amount || 0;
            document.getElementById("inv_reverse_charge").value = inv.reverse_charge || "No";
            document.getElementById("inv_transportation_mode").value = inv.transportation_mode || "";
            document.getElementById("inv_vehicle_number").value = inv.vehicle_number || "";
            document.getElementById("inv_date_of_supply").value = inv.date_of_supply ? inv.date_of_supply.split("T")[0] : "";
            document.getElementById("inv_place_of_supply_state").value = inv.place_of_supply_state || "";
            document.getElementById("inv_place_of_supply_state_code").value = inv.place_of_supply_state_code || "";
            document.getElementById("inv_bundles_count").value = (inv.bundles_count === null || inv.bundles_count === undefined) ? "" : inv.bundles_count;

            const customer = usersDataCache.find((u) => u.id == inv.customer_id);
            let isEffectivelySame = false;
            if (customer) {
                isEffectivelySame = (inv.consignee_name || "") === (customer.username || "") &&
                                    (inv.consignee_address_line1 || "") === (customer.address_line1 || "") &&
                                    (inv.consignee_address_line2 || "") === (customer.address_line2 || "") &&
                                    (inv.consignee_city_pincode || "") === (customer.city_pincode || "") &&
                                    (inv.consignee_state || "") === (customer.state || "") &&
                                    (inv.consignee_gstin || "") === (customer.gstin || "") &&
                                    (inv.consignee_state_code || "") === (customer.state_code || "");
                if (!isEffectivelySame && !inv.consignee_name && !inv.consignee_address_line1 && !inv.consignee_city_pincode && !inv.consignee_state && !inv.consignee_gstin && !inv.consignee_state_code) {
                    isEffectivelySame = true;
                }
            } else if (!inv.consignee_name && !inv.consignee_address_line1) {
                isEffectivelySame = true;
            }
            if (sameAsCustomerCheckbox) sameAsCustomerCheckbox.checked = isEffectivelySame;

            document.getElementById("inv_consignee_name").value = inv.consignee_name || "";
            document.getElementById("inv_consignee_address_line1").value = inv.consignee_address_line1 || "";
            document.getElementById("inv_consignee_address_line2").value = inv.consignee_address_line2 || "";
            document.getElementById("inv_consignee_city_pincode").value = inv.consignee_city_pincode || "";
            document.getElementById("inv_consignee_state").value = inv.consignee_state || "";
            document.getElementById("inv_consignee_gstin").value = inv.consignee_gstin || "";
            document.getElementById("inv_consignee_state_code").value = inv.consignee_state_code || "";
            document.getElementById("inv_amount_in_words").value = inv.amount_in_words || "";

            const subtotalForTaxCalc = parseFloat(inv.amount_before_tax) || 0;
            if (inv.invoice_type === 'TAX_INVOICE' || inv.invoice_type === 'SALES_RETURN') {
                document.getElementById("inv_cgst_rate_overall").value = (inv.total_cgst_amount && subtotalForTaxCalc !== 0) ? (Math.abs(inv.total_cgst_amount / subtotalForTaxCalc) * 100).toFixed(2) : 2.5;
                document.getElementById("inv_sgst_rate_overall").value = (inv.total_sgst_amount && subtotalForTaxCalc !== 0) ? (Math.abs(inv.total_sgst_amount / subtotalForTaxCalc) * 100).toFixed(2) : 2.5;
                document.getElementById("inv_igst_rate_overall").value = (inv.total_igst_amount && subtotalForTaxCalc !== 0) ? (Math.abs(inv.total_igst_amount / subtotalForTaxCalc) * 100).toFixed(2) : 0;
            } else {
                document.getElementById("inv_cgst_rate_overall").value = 0;
                document.getElementById("inv_sgst_rate_overall").value = 0;
                document.getElementById("inv_igst_rate_overall").value = 0;
            }

            if (inv.line_items && Array.isArray(inv.line_items)) {
                inv.line_items.forEach((item) => addInvLineItemRow({ ...item, quantity: Math.abs(item.quantity) }));
            } else {
                addInvLineItemRow();
            }

        } catch (error) {
            console.error("Error fetching invoice details:", error);
            alert("Could not load invoice details: " + error.message);
            return;
        }
    } else { // Creating a new document
        title.textContent = (type === 'SALES_RETURN') ? 'New Sales Return' : 'New Invoice';
        invoiceTypeDropdown.value = type;

        document.getElementById("invoiceId").value = "";
        if (invoiceNumberInput) invoiceNumberInput.placeholder = (type === 'SALES_RETURN') ? "Auto-generated as CN-..." : "Enter or Suggest Invoice Number";
        document.getElementById("inv_invoice_date").value = new Date().toISOString().split("T")[0];
        document.getElementById("inv_due_date").value = new Date(new Date().setDate(new Date().getDate() + 30)).toISOString().split("T")[0];
        document.getElementById("inv_cgst_rate_overall").value = 2.5;
        document.getElementById("inv_sgst_rate_overall").value = 2.5;
        document.getElementById("inv_igst_rate_overall").value = 0;
        if (paymentBeingMadeNowInput) {
            paymentBeingMadeNowInput.value = "0.00";
            paymentBeingMadeNowInput.placeholder = "Enter payment amount if any";
        }
        if (cumulativePaidDisplay) cumulativePaidDisplay.textContent = "0.00";

        if (invoiceTypeDropdown.value === 'TAX_INVOICE') {
            if (sameAsCustomerCheckbox) sameAsCustomerCheckbox.checked = false;
        } else {
            if (sameAsCustomerCheckbox) sameAsCustomerCheckbox.checked = true;
        }
        addInvLineItemRow();
    }
    populateCustomerDetailsForInvoice();
    
    // --- START OF FIX ---
    // Explicitly call toggleGstFields after setting up the form, especially for editing.
    toggleGstFields();
    // --- END OF FIX ---

    togglePartyBillReturnsField();
    toggleConsigneeFields();
    toggleOriginalInvoiceSection();

    modal.classList.add('show');
}// in app-script.js

async function openEntityTransactionHistoryModal(entityId, entityName, type = 'lender') {
    const modal = document.getElementById("entityTransactionHistoryModal");
    const title = document.getElementById("entityTransactionHistoryModalTitle");
    const tableBody = modal?.querySelector("tbody");
    const tableFoot = modal?.querySelector("tfoot");

    if (!modal || !title || !tableBody || !tableFoot) return;

    title.textContent = `Transaction History for ${entityName}`;
    tableBody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
    tableFoot.innerHTML = "";

    try {
        let allRelatedTxns;
        let initialBalance = 0;

        if (type === 'lender') {
            allRelatedTxns = allTransactionsCache.filter(tx => tx.lender_id === entityId);
            const entity = externalEntitiesCache.find(e => e.id === entityId);
            if (entity) {
                initialBalance = parseFloat(entity.initial_payable_balance || 0);
            }
        } else if (type === 'agreement') {
            allRelatedTxns = allTransactionsCache.filter(tx => tx.agreement_id === entityId);
        } else {
            allRelatedTxns = [];
        }

        allRelatedTxns.sort((a, b) => new Date(a.date) - new Date(b.date) || a.id - a.id);

        let runningBalance = initialBalance;
        let totalDebits = 0;
        let totalCredits = 0;

        tableBody.innerHTML = ""; // Clear loading

        if (type === 'lender' && initialBalance !== 0) {
            const openingRow = tableBody.insertRow();
            const openingCredit = `₹${Math.abs(initialBalance).toFixed(2)}`;
            totalCredits += Math.abs(initialBalance);
            const balanceClass = runningBalance >= 0 ? 'negative-balance' : 'positive-balance';
            openingRow.innerHTML = `
                <td>-</td>
                <td colspan="2"><strong>Opening Balance</strong></td>
                <td class="num negative">${openingCredit}</td>
                <td class="num ${balanceClass}"><strong>₹${Math.abs(runningBalance).toFixed(2)}</strong></td>
            `;
        }

        if (allRelatedTxns.length === 0 && tableBody.rows.length === 0) {
            tableBody.innerHTML += '<tr><td colspan="5" style="text-align:center;">No transactions found for this entity.</td></tr>';
        }

        allRelatedTxns.forEach(tx => {
            const row = tableBody.insertRow();
            const amount = parseFloat(tx.amount || 0);
            let debit = "";
            let credit = "";

            if (amount < 0) {
                debit = `₹${Math.abs(amount).toFixed(2)}`;
                totalDebits += Math.abs(amount);
            } else {
                credit = `₹${amount.toFixed(2)}`;
                totalCredits += amount;
            }
            runningBalance += amount;

            // --- THIS IS THE KEY FIX ---
            // Combine category and description into one 'particulars' string.
            const particulars = `${tx.category || "N/A"}`;
            const description = tx.description || "";

            const finalBalanceDisplay = Math.abs(runningBalance);
            const balanceClass = runningBalance > 0 ? 'negative-balance' : 'positive-balance';

            // Now we create the row with the correct number of cells
            row.innerHTML = `
                <td>${new Date(tx.date).toLocaleDateString()}</td>
                <td>${particulars}</td>
                <td>${description}</td>
                <td class="num positive">${debit}</td>
                <td class="num negative">${credit}</td>
                <td class="num ${balanceClass}">₹${finalBalanceDisplay.toFixed(2)}</td>
            `;
        });

        tableFoot.innerHTML = `
            <tr style="border-top: 2px solid #ccc; font-weight: bold;">
                <td colspan="3" style="text-align:right;">Total</td>
                <td class="num positive">₹${totalDebits.toFixed(2)}</td>
                <td class="num negative">₹${totalCredits.toFixed(2)}</td>
                <td></td>
            </tr>
            <tr style="font-weight: bold;">
                <td colspan="5" style="text-align:right;">Closing Balance (Payable)</td>
                <td class="num ${runningBalance > 0 ? 'negative-balance' : 'positive-balance'}">₹${Math.abs(runningBalance).toFixed(2)}</td>
            </tr>
        `;

    } catch (error) {
        console.error("Error loading entity history:", error);
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red;">Error: ${error.message}</td></tr>`;
    }
    modal.classList.add('show');
}
function populateCustomerDetailsForInvoice() {
    const customerId = document.getElementById("inv_customer_id").value;
    const customer = usersDataCache.find((u) => u.id == customerId);

    const nameDisplay = document.getElementById("inv_customer_name_display");
    const addressDisplay = document.getElementById("inv_customer_address_display");
    const gstinDisplay = document.getElementById("inv_customer_gstin_display");
    const stateCodeDisplay = document.getElementById("inv_customer_statecode_display");
    const placeOfSupplyState = document.getElementById("inv_place_of_supply_state");
    const placeOfSupplyStateCode = document.getElementById("inv_place_of_supply_state_code");

    if (customer) {
        if (nameDisplay) nameDisplay.value = customer.username || "";
        let address = (customer.address_line1 || "") + (customer.address_line2 ? "\n" + customer.address_line2 : "");
        address += (customer.city_pincode ? "\n" + customer.city_pincode : "");
        address += (customer.state ? ", " + customer.state : "");
        if (addressDisplay) addressDisplay.value = address.trim();
        if (gstinDisplay) gstinDisplay.value = customer.gstin || "";
        if (stateCodeDisplay) stateCodeDisplay.value = customer.state_code || "";
        if (placeOfSupplyState) placeOfSupplyState.value = customer.state || "";
        if (placeOfSupplyStateCode) placeOfSupplyStateCode.value = customer.state_code || "";
    } else {
        // Clear all fields if no customer is selected
        if (nameDisplay) nameDisplay.value = "";
        if (addressDisplay) addressDisplay.value = "";
        if (gstinDisplay) gstinDisplay.value = "";
        if (stateCodeDisplay) stateCodeDisplay.value = "";
        if (placeOfSupplyState) placeOfSupplyState.value = businessProfileCache ? businessProfileCache.state || "" : "";
        if (placeOfSupplyStateCode) placeOfSupplyStateCode.value = businessProfileCache ? businessProfileCache.state_code || "" : "";
    }
    
    // This function is now the single source of truth. It will handle the consignee logic.
    toggleConsigneeFields(); 
}
function toggleConsigneeFields() {
    const sameAsCustomerCheckbox = document.getElementById( "inv_same_as_customer" );
    const isSameAsCustomer = sameAsCustomerCheckbox ? sameAsCustomerCheckbox.checked : true; // Default to true if checkbox not found to hide fields
    const invoiceType = document.getElementById("inv_invoice_type").value;
    const consigneeFieldsDiv = document.getElementById("invConsigneeFields");

    if (!consigneeFieldsDiv) {
        console.warn("Consignee fields div not found for toggleConsigneeFields");
        return;
    }
    if (!businessProfileCache && invoiceType === "TAX_INVOICE" && !editingInvoiceId && !isSameAsCustomer) {
        console.warn("Business profile cache not ready for toggleConsigneeFields when needed.");
    }


    const consigneeNameInput = document.getElementById("inv_consignee_name");
    const consigneeAddr1Input = document.getElementById(
        "inv_consignee_address_line1",
    );
    const consigneeAddr2Input = document.getElementById(
        "inv_consignee_address_line2",
    );
    const consigneeCityPincodeInput = document.getElementById(
        "inv_consignee_city_pincode",
    );
    const consigneeStateInput = document.getElementById("inv_consignee_state");
    const consigneeGstinInput = document.getElementById("inv_consignee_gstin");
    const consigneeStateCodeInput = document.getElementById(
        "inv_consignee_state_code",
    );

    if (isSameAsCustomer) {
        consigneeFieldsDiv.style.display = "none";
        const customerId = document.getElementById("inv_customer_id").value;
        const customer = usersDataCache.find((u) => u.id == customerId);
        if (customer) {
            if(consigneeNameInput) consigneeNameInput.value = customer.username || "";
            if(consigneeAddr1Input) consigneeAddr1Input.value = customer.address_line1 || "";
            if(consigneeAddr2Input) consigneeAddr2Input.value = customer.address_line2 || "";
            if(consigneeCityPincodeInput) consigneeCityPincodeInput.value = customer.city_pincode || "";
            if(consigneeStateInput) consigneeStateInput.value = customer.state || "";
            if(consigneeGstinInput) consigneeGstinInput.value = customer.gstin || "";
            if(consigneeStateCodeInput) consigneeStateCodeInput.value = customer.state_code || "";
        } else { 
            if(consigneeNameInput) consigneeNameInput.value = "";
            if(consigneeAddr1Input) consigneeAddr1Input.value = "";
            if(consigneeAddr2Input) consigneeAddr2Input.value = "";
            if(consigneeCityPincodeInput) consigneeCityPincodeInput.value = "";
            if(consigneeStateInput) consigneeStateInput.value = "";
            if(consigneeGstinInput) consigneeGstinInput.value = "";
            if(consigneeStateCodeInput) consigneeStateCodeInput.value = "";
        }
    } else {
        consigneeFieldsDiv.style.display = "block";
        if (businessProfileCache && invoiceType === "TAX_INVOICE" && !editingInvoiceId) { // Only auto-fill for NEW Tax Invoices if "Same as" is UNCHECKED
            if(consigneeNameInput) consigneeNameInput.value = businessProfileCache.company_name || "";
            if(consigneeAddr1Input) consigneeAddr1Input.value = businessProfileCache.address_line1 || "";
            if(consigneeAddr2Input) consigneeAddr2Input.value = businessProfileCache.address_line2 || "";
            if(consigneeCityPincodeInput) consigneeCityPincodeInput.value = businessProfileCache.city_pincode || "";
            if(consigneeStateInput) consigneeStateInput.value = businessProfileCache.state || "";
            if(consigneeGstinInput) consigneeGstinInput.value = businessProfileCache.gstin || "";
            if(consigneeStateCodeInput) consigneeStateCodeInput.value = businessProfileCache.state_code || "";
        } else if (!editingInvoiceId && invoiceType !== "TAX_INVOICE") {
            if(consigneeNameInput) consigneeNameInput.value = "";
            if(consigneeAddr1Input) consigneeAddr1Input.value = "";
            if(consigneeAddr2Input) consigneeAddr2Input.value = "";
            if(consigneeCityPincodeInput) consigneeCityPincodeInput.value = "";
            if(consigneeStateInput) consigneeStateInput.value = "";
            if(consigneeGstinInput) consigneeGstinInput.value = "";
            if(consigneeStateCodeInput) consigneeStateCodeInput.value = "";
        }
    }
}

function closeInvoiceModal() {
    const modal = document.getElementById("invoiceModal");
    if (modal) modal.classList.remove('show');
    editingInvoiceId = null;
    const form = document.getElementById("invoiceForm");
    if (form) form.reset();

    document.getElementById("invLineItemsTableBody").innerHTML = "";
    document.getElementById("invSubtotal").textContent = "0.00";
    document.getElementById("invTotalCGST").textContent = "0.00";
    document.getElementById("invTotalSGST").textContent = "0.00";
    document.getElementById("invTotalIGST").textContent = "0.00";
    document.getElementById("invReturnsAmountDisplay").textContent = "0.00";
    document.getElementById("invGrandTotal").textContent = "0.00";
    document.getElementById("inv_customer_name_display").value = "";
    document.getElementById("inv_customer_address_display").value = "";
    document.getElementById("inv_customer_gstin_display").value = "";
    document.getElementById("inv_customer_statecode_display").value = "";

    document.getElementById("inv_invoice_type").value = "TAX_INVOICE";
    document.getElementById("inv_cgst_rate_overall").value = "2.5";
    document.getElementById("inv_sgst_rate_overall").value = "2.5";
    document.getElementById("inv_igst_rate_overall").value = "0";
    document.getElementById("inv_party_bill_returns_amount").value = "0";
    const sameAsCustCheckbox = document.getElementById("inv_same_as_customer");
    if(sameAsCustCheckbox) sameAsCustCheckbox.checked = false; 
    document.getElementById("inv_status").value = "Draft";
    document.getElementById("inv_reverse_charge").value = "No";
    document.getElementById("inv_payment_being_made_now").value = "0.00";
    const cumulativePaidDisplay = document.getElementById(
        "inv_cumulative_paid_display",
    );
    if (cumulativePaidDisplay) cumulativePaidDisplay.textContent = "0.00";

    toggleGstFields();
    togglePartyBillReturnsField();
    toggleConsigneeFields();
}


async function populateUserDropdownForInv() {
    try {
        if (
            !Array.isArray(usersDataCache) ||
            (usersDataCache.length === 0 && !isLoading.users)
        )
            await loadUsers();
        
        const dropdown = document.getElementById("inv_customer_id");
        if (!dropdown) return;

        const customersOnly = usersDataCache.filter(user => user.role !== 'admin');

        const currentValue = dropdown.value;
        dropdown.innerHTML = '<option value="">Select Customer...</option>';
        
        if (Array.isArray(customersOnly)) {
            customersOnly.forEach((user) => {
                const option = document.createElement("option");
                option.value = user.id;
                option.textContent = `${user.username} (ID: ${user.id})`;
                dropdown.appendChild(option);
            });
        }
        
        if (currentValue) dropdown.value = currentValue; 
    } catch (error) {
        console.error(
            "Error populating Invoice customer dropdown:",
            error.message,
        );
    }
}
function addInvLineItemRow(itemData = null) {
    const tableBody = document.getElementById("invLineItemsTableBody");
    const newRow = tableBody.insertRow();

    const productCell = newRow.insertCell();
    productCell.style.verticalAlign = "top"; 
    const productSelect = document.createElement("select");
    productSelect.className = "form-control inv-line-product";
    productSelect.style.marginBottom = "5px"; 
    productSelect.innerHTML = '<option value="">Select Product...</option>';
    productsCache.forEach((p) => {
        const option = document.createElement("option");
        option.value = p.id;
        option.textContent = p.product_name;
        option.dataset.price = p.sale_price;
        option.dataset.description = p.product_name; 
        option.dataset.hsn = p.hsn_acs_code || "";
        option.dataset.uom = p.unit_of_measure || "Pcs";
        productSelect.appendChild(option);
    });
    const freeTextOption = document.createElement("option"); 
    freeTextOption.value = "custom";
    freeTextOption.textContent = "Custom Service/Item...";
    productSelect.appendChild(freeTextOption);
    productCell.appendChild(productSelect);

    const descriptionInput = document.createElement("input"); 
    descriptionInput.type = "text";
    descriptionInput.className = "form-control inv-line-description";
    descriptionInput.placeholder = "Manual Description (if needed)";
    descriptionInput.value = itemData ? itemData.description : "";
    productCell.appendChild(descriptionInput);

    const hsnCell = newRow.insertCell();
    const hsnInput = document.createElement("input");
    hsnInput.type = "text";
    hsnInput.className = "form-control inv-line-hsn";
    hsnInput.placeholder = "HSN";
    hsnInput.value = itemData ? (itemData.hsn_acs_code || itemData.final_hsn_acs_code || "") : ""; 
    hsnCell.appendChild(hsnInput);

    const uomCell = newRow.insertCell();
    const uomInput = document.createElement("input");
    uomInput.type = "text";
    uomInput.className = "form-control inv-line-uom";
    uomInput.placeholder = "UoM";
    uomInput.value = itemData ? (itemData.unit_of_measure || itemData.final_unit_of_measure || "Pcs") : "Pcs";
    uomCell.appendChild(uomInput);

    // --- THIS IS THE KEY FIX ---
    productSelect.addEventListener("change", (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        const row = e.target.closest("tr");
        if (!row) return;

        const currentDescriptionInput = row.querySelector(".inv-line-description");
        
        if (e.target.value === "custom") {
            currentDescriptionInput.value = ""; 
            currentDescriptionInput.placeholder = "Enter custom service/item";
            row.querySelector(".inv-line-price").value = "0.00";
            row.querySelector(".inv-line-hsn").value = "";
            row.querySelector(".inv-line-uom").value = "Svc"; 
        } else if (selectedOption && selectedOption.value) {
            // ALWAYS update the description, price, HSN, and UOM on change.
            currentDescriptionInput.value = selectedOption.dataset.description || "";
            currentDescriptionInput.placeholder = "Manual Description (if needed)";
            row.querySelector(".inv-line-price").value = parseFloat(selectedOption.dataset.price || 0).toFixed(2);
            row.querySelector(".inv-line-hsn").value = selectedOption.dataset.hsn || "";
            row.querySelector(".inv-line-uom").value = selectedOption.dataset.uom || "Pcs";
        }
        updateInvLineItemTotal(row);
    });
    // --- END OF FIX ---

    const qtyCell = newRow.insertCell();
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.className = "form-control inv-line-qty num"; 
    qtyInput.step="any";
    qtyInput.value = itemData ? itemData.quantity : 1;
    qtyInput.addEventListener("input", (e) => updateInvLineItemTotal(e.target.closest("tr")));
    qtyCell.appendChild(qtyInput);

    const priceCell = newRow.insertCell();
    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.step = "0.01";
    priceInput.className = "form-control inv-line-price num";
    priceInput.value = itemData ? parseFloat(itemData.unit_price).toFixed(2) : "0.00";
    priceInput.addEventListener("input", (e) => updateInvLineItemTotal(e.target.closest("tr")));
    priceCell.appendChild(priceInput);

    const discountCell = newRow.insertCell();
    const discountInput = document.createElement("input");
    discountInput.type = "number";
    discountInput.step = "0.01";
    discountInput.className = "form-control inv-line-discount num";
    discountInput.placeholder = "0.00";
    discountInput.value = itemData ? (parseFloat(itemData.discount_amount) || 0).toFixed(2) : "0.00";
    discountInput.addEventListener("input", (e) => updateInvLineItemTotal(e.target.closest("tr")));
    discountCell.appendChild(discountInput);
    
    const taxableAmountCell = newRow.insertCell();
    taxableAmountCell.className = "inv-line-item-taxable-amount num";
    taxableAmountCell.textContent = itemData ? (parseFloat(itemData.taxable_value) || 0).toFixed(2) : "0.00";

    const actionCell = newRow.insertCell();
    actionCell.style.textAlign = "center";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn btn-danger btn-sm";
    removeButton.innerHTML = "×";
    removeButton.onclick = () => { newRow.remove(); updateInvTotals(); };
    actionCell.appendChild(removeButton);

    if (itemData) {
        if (itemData.product_id) productSelect.value = itemData.product_id;
        else productSelect.value = "custom"; 
        descriptionInput.value = itemData.description || ""; 
        const event = new Event('change', { bubbles: true }); 
        productSelect.dispatchEvent(event);
    } else {
        updateInvLineItemTotal(newRow); 
    }
}
function updateInvLineItemTotal(row) {
    if (!row) return;
    const qty = parseFloat(row.querySelector(".inv-line-qty").value) || 0;
    const price = parseFloat(row.querySelector(".inv-line-price").value) || 0;
    const discount = parseFloat(row.querySelector(".inv-line-discount").value) || 0;

    const amountBeforeDiscount = qty * price;
    const taxableValue = amountBeforeDiscount - discount;
    row.querySelector(".inv-line-item-taxable-amount").textContent = taxableValue.toFixed(2);

    updateInvTotals();
}
function updateInvTotals() {
    let subtotal = 0;
    let lineItemReturnsTotal = 0;

    document.querySelectorAll("#invLineItemsTableBody tr").forEach((row) => {
        const qty = parseFloat(row.querySelector(".inv-line-qty").value) || 0;
        const price = parseFloat(row.querySelector(".inv-line-price").value) || 0;
        const discount = parseFloat(row.querySelector(".inv-line-discount").value) || 0;
        const taxableValue = (qty * price) - discount;
        
        // This part is correct
        if (qty >= 0) {
            subtotal += taxableValue;
        } else {
            lineItemReturnsTotal += taxableValue;
        }
    });
    document.getElementById("invSubtotal").textContent = subtotal.toFixed(2);

    const returnsDisplayRow = document.getElementById("invReturnsDisplay");
    const returnsAmountDisplay = document.getElementById("invReturnsAmountDisplay");
    
    let totalReturnsAmount = Math.abs(lineItemReturnsTotal);

    const invoiceType = document.getElementById("inv_invoice_type").value;
    if (invoiceType === "PARTY_BILL") {
        const partyBillReturnAmount = Math.abs(parseFloat(document.getElementById("inv_party_bill_returns_amount").value) || 0);
        totalReturnsAmount += partyBillReturnAmount;
    }
    
    if (totalReturnsAmount > 0) {
        returnsAmountDisplay.textContent = totalReturnsAmount.toFixed(2);
        returnsDisplayRow.style.display = "table-row";
    } else {
        returnsDisplayRow.style.display = "none";
    }

    let totalCGST = 0, totalSGST = 0, totalIGST = 0;

    if (invoiceType === "TAX_INVOICE" || invoiceType === "SALES_RETURN") {
        const cgstRate = parseFloat(document.getElementById("inv_cgst_rate_overall").value) || 0;
        const sgstRate = parseFloat(document.getElementById("inv_sgst_rate_overall").value) || 0;
        const igstRate = parseFloat(document.getElementById("inv_igst_rate_overall").value) || 0;
        
        const taxableSubtotal = subtotal;

        if (igstRate > 0) { 
            totalIGST = taxableSubtotal * (igstRate / 100);
            document.getElementById("inv_cgst_rate_overall").value = 0; 
            document.getElementById("inv_sgst_rate_overall").value = 0;
            totalCGST = 0; totalSGST = 0;
        } else { 
            totalCGST = taxableSubtotal * (cgstRate / 100);
            totalSGST = taxableSubtotal * (sgstRate / 100);
            document.getElementById("inv_igst_rate_overall").value = 0; 
            totalIGST = 0;
        }
    }

    document.getElementById("invTotalCGST").textContent = totalCGST.toFixed(2);
    document.getElementById("invTotalSGST").textContent = totalSGST.toFixed(2);
    document.getElementById("invTotalIGST").textContent = totalIGST.toFixed(2);

    // --- START OF FIX ---
    // The grand total calculation was not including the tax amounts.
    let grandTotal = subtotal + totalCGST + totalSGST + totalIGST + lineItemReturnsTotal;
    // --- END OF FIX ---

    document.getElementById("invGrandTotal").textContent = grandTotal.toFixed(2);

    const amountInWordsInput = document.getElementById("inv_amount_in_words");
    if (amountInWordsInput) {
        amountInWordsInput.value = convertAmountToWords(grandTotal).toUpperCase() + " RUPEES ONLY";
    }
}
async function handleInvoiceSubmit(e) {
    e.preventDefault();
    
    const customerId = document.getElementById("inv_customer_id").value;
    if (!customerId) {
        alert("Please select a customer before saving the invoice.");
        return; 
    }

    const invoiceType = document.getElementById("inv_invoice_type").value;
    const isReturn = invoiceType === 'SALES_RETURN';

    const lineItems = [];
    document.querySelectorAll("#invLineItemsTableBody tr").forEach(row => {
        const productSelect = row.querySelector(".inv-line-product");
        const productId = productSelect.value === "custom" ? null : productSelect.value;
        const description = row.querySelector(".inv-line-description").value.trim();
        const hsn = row.querySelector(".inv-line-hsn").value.trim();
        const uom = row.querySelector(".inv-line-uom").value.trim();
        const quantity = parseFloat(row.querySelector(".inv-line-qty").value);
        const unitPrice = parseFloat(row.querySelector(".inv-line-price").value);
        const discountAmount = parseFloat(row.querySelector(".inv-line-discount").value) || 0;

        if ( (productId || description) && !isNaN(quantity) && quantity !== 0 && !isNaN(unitPrice) && unitPrice >= 0 && !isNaN(discountAmount) && discountAmount >= 0) {
            lineItems.push({
                product_id: productId,
                description: description || productSelect.options[productSelect.selectedIndex].text, 
                hsn_acs_code: hsn,
                unit_of_measure: uom,
                quantity: quantity,
                unit_price: unitPrice,
                discount_amount: discountAmount,
            });
        }
    });

    if (lineItems.length === 0) {
        alert("Please add at least one valid line item.");
        return;
    }
    
    const paymentBeingMadeNowInput = document.getElementById("inv_payment_being_made_now");
    const paymentBeingMadeNow = parseFloat(paymentBeingMadeNowInput.value) || 0;
    let paymentMethodForNewPayment = null; 

    if (paymentBeingMadeNow !== 0) {
        const selectedMethodRadio = document.querySelector('input[name="inv_payment_method"]:checked');
        if (selectedMethodRadio) {
            paymentMethodForNewPayment = selectedMethodRadio.value;
        } else {
            alert("A payment amount was entered, but no payment method was selected. The payment will not be recorded.");
        }
    }
    
    // --- START OF FIX ---
    // Correctly read the GST rates from the form for all relevant invoice types.
    const cgstRate = (invoiceType === 'TAX_INVOICE' || isReturn) ? (parseFloat(document.getElementById("inv_cgst_rate_overall").value) || 0) : 0;
    const sgstRate = (invoiceType === 'TAX_INVOICE' || isReturn) ? (parseFloat(document.getElementById("inv_sgst_rate_overall").value) || 0) : 0;
    const igstRate = (invoiceType === 'TAX_INVOICE' || isReturn) ? (parseFloat(document.getElementById("inv_igst_rate_overall").value) || 0) : 0;
    // --- END OF FIX ---


    const data = {
        invoice_number: document.getElementById("inv_invoice_number_display").value.trim(),
        original_invoice_number: invoiceType === 'SALES_RETURN' ? document.getElementById("original_invoice_number_input").value.trim() : null,
        customer_id: customerId,
        invoice_date: document.getElementById("inv_invoice_date").value,
        due_date: document.getElementById("inv_due_date").value,
        status: document.getElementById("inv_status").value,
        invoice_type: invoiceType,
        notes: document.getElementById("inv_notes").value.trim(),
        line_items: lineItems,
        // --- START OF FIX ---
        // Pass the determined GST rates to the backend.
        cgst_rate: cgstRate,
        sgst_rate: sgstRate,
        igst_rate: igstRate,
        // --- END OF FIX ---
        party_bill_returns_amount: invoiceType === 'PARTY_BILL' ? (Math.abs(parseFloat(document.getElementById("inv_party_bill_returns_amount").value) || 0)) : 0,
        payment_being_made_now: (paymentMethodForNewPayment && paymentBeingMadeNow !== 0) ? paymentBeingMadeNow : 0,
        payment_method_for_new_payment: (paymentMethodForNewPayment && paymentBeingMadeNow !== 0) ? paymentMethodForNewPayment : null,
        reverse_charge: document.getElementById("inv_reverse_charge").value,
        transportation_mode: document.getElementById("inv_transportation_mode").value.trim(),
        vehicle_number: document.getElementById("inv_vehicle_number").value.trim(),
        date_of_supply: document.getElementById("inv_date_of_supply").value || null,
        place_of_supply_state: document.getElementById("inv_place_of_supply_state").value.trim(),
        place_of_supply_state_code: document.getElementById("inv_place_of_supply_state_code").value.trim(),
        bundles_count: document.getElementById("inv_bundles_count").value ? parseInt(document.getElementById("inv_bundles_count").value) : null,
        consignee_name: document.getElementById("inv_consignee_name").value.trim(),
        consignee_address_line1: document.getElementById("inv_consignee_address_line1").value.trim(),
        consignee_address_line2: document.getElementById("inv_consignee_address_line2").value.trim(),
        consignee_city_pincode: document.getElementById("inv_consignee_city_pincode").value.trim(),
        consignee_state: document.getElementById("inv_consignee_state").value.trim(),
        consignee_gstin: document.getElementById("inv_consignee_gstin").value.trim(),
        consignee_state_code: document.getElementById("inv_consignee_state_code").value.trim(),
        amount_in_words: document.getElementById("inv_amount_in_words").value.trim(),
    };

    if (document.getElementById("inv_same_as_customer").checked) {
        const selectedCustomer = usersDataCache.find(u => u.id == customerId);
        if (selectedCustomer) {
            data.consignee_name = selectedCustomer.username;
            data.consignee_address_line1 = selectedCustomer.address_line1;
            data.consignee_address_line2 = selectedCustomer.address_line2;
            data.consignee_city_pincode = selectedCustomer.city_pincode;
            data.consignee_state = selectedCustomer.state;
            data.consignee_gstin = selectedCustomer.gstin;
            data.consignee_state_code = selectedCustomer.state_code;
        }
    }

    if (invoiceType !== 'SALES_RETURN' && !data.invoice_number) {
        alert("Invoice Number is required for this document type.");
        return;
    }
    
    const method = editingInvoiceId ? "PUT" : "POST";
    const endpoint = editingInvoiceId ? `${API}/invoices/${editingInvoiceId}` : `${API}/invoices`;

    try {
        const res = await apiFetch(endpoint, {
            method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
        });
        if(!res) return;
        const result = await res.json();
        
        if (!res.ok) {
            throw new Error(result.error || `Operation failed: ${res.statusText} - ${result.details || ""}`);
        }

        let alertMessage = result.message || (editingInvoiceId ? "Document updated successfully." : "Document created successfully.");
        if (data.payment_being_made_now !== 0 && data.payment_method_for_new_payment) {
             alertMessage += `\nPayment/Refund of ₹${Math.abs(data.payment_being_made_now).toFixed(2)} via ${data.payment_method_for_new_payment.toUpperCase()} was processed.`;
        }
        
        alert(alertMessage);

        closeInvoiceModal();
        await loadInvoices();
        await loadAllTransactions(); 
        await loadProducts();
        await loadUsers();
        await loadCustomerSummaries(); 

        const cashLedgerActive = document.getElementById("cashLedgerContent")?.style.display !== 'none';
        const bankLedgerActive = document.getElementById("bankLedgerContent")?.style.display !== 'none';
        if (cashLedgerActive) loadCashLedger();
        if (bankLedgerActive) loadBankLedger();
        updateDashboardCards();

    } catch (error) {
        console.error("Error saving invoice:", error);
        alert("Error saving document: " + error.message);
    }
}
async function deleteInvoice(invoiceId) {
    if (!confirm("Are you sure you want to delete this invoice and all its related financial records and stock movements? This CANNOT be undone.")) return;
    try {
        const res = await apiFetch(`${API}/invoices/${invoiceId}`, { method: "DELETE" });
        if(!res) return;
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || `Failed to delete: ${res.statusText}`);
        alert(result.message || "Invoice deleted");
        await loadInvoices();
        await loadAllTransactions(); 
        await loadProducts();
        await loadUsers();
        loadCustomerSummaries(); 
    } catch (error) { console.error("Error deleting invoice:", error); alert("Error: " + error.message); }
}
async function viewInvoice(invoiceId) {
    openInvoiceModal(invoiceId);
}

async function printCurrentInvoiceById(invoiceIdFromList) {
    if(invoiceIdFromList) {
        await generateAndShowPrintableInvoice(invoiceIdFromList);
    } else {
        alert("Invalid Invoice ID provided for printing.");
    }
}
async function printCurrentInvoice() {
    if (editingInvoiceId) {
        await generateAndShowPrintableInvoice(editingInvoiceId);
    } else {
        alert("Please save the invoice first or ensure an invoice is loaded in the modal to print.");
    }
}
async function generateAndShowPrintableInvoice(invoiceIdToPrint) {
    try {
        const [invoiceRes, companyProfile] = await Promise.all([
            apiFetch(`${API}/invoices/${invoiceIdToPrint}`),
            loadBusinessProfile()
        ]);

        if (!invoiceRes || !invoiceRes.ok) throw new Error("Failed to fetch invoice data.");
        const invoiceData = await invoiceRes.json();
        
        if (!companyProfile || !companyProfile.company_name) {
            alert("Company profile could not be loaded. Please update it in the Company section.");
            return;
        }

        const printWindow = window.open('', '_blank', 'height=800,width=1000');
        if (!printWindow) {
            alert("Could not open print window. Please disable your pop-up blocker.");
            return;
        }

        printWindow.document.write('<!DOCTYPE html><html><head><title>Invoice ' + invoiceData.invoice_number + '</title>');
        printWindow.document.write(`
            <style>
                body { font-family: "Arial", sans-serif; font-size: 9pt; margin: 0; color: #000; }
                @page { size: A4; margin: 0; }
                .print-container { width: 210mm; height: 297mm; padding: 5mm; box-sizing: border-box; }
                .invoice-box { border: 1px solid #000; padding: 2mm; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
                .main-table { width: 100%; height: 100%; border-collapse: collapse; display: flex; flex-direction: column; }
                .main-table > thead, .main-table > tfoot { flex-shrink: 0; }
                .main-table > tbody { flex-grow: 1; }
                td, th { padding: 1mm; vertical-align: top; }
                .text-center { text-align: center; } .text-right { text-align: right; } .font-bold { font-weight: bold; }
                .company-name { font-size: 16pt; font-weight: bold; }
                .invoice-title { font-size: 14pt; font-weight: bold; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 1.5mm 0; margin: 2mm 0; }
                .details-table td { padding: 0.5mm 1mm; font-size: 9pt; }
                .label { font-weight: bold; }
                .address-grid { margin-top: 2mm; border-top: 1px solid #000; border-bottom: 1px solid #000; }
                .address-grid td { width: 50%; padding: 2mm; vertical-align: top; }
                .address-grid td:first-child { border-right: 1px solid #000; }
                .address-title { text-decoration: underline; font-weight: bold; margin-bottom: 1mm; display: block; }
                .items-table { width: 100%; border-collapse: collapse; }
                .items-table th, .items-table td { border: 1px solid #000; font-size: 9pt; padding: 1.5mm; word-wrap: break-word; }
                .items-table thead th { background-color: #f2f2f2; }
                .items-table tfoot td { font-weight: bold; }
                .footer-section { padding-top: 2mm; }
                .totals-summary { width: 50%; float: right; }
                .totals-summary td { padding: 1mm 2mm; }
                .grand-total td { font-weight: bold; border-top: 1px solid #000; }
                .final-footer { display: flex; justify-content: space-between; align-items: flex-end; width: 100%; padding-top: 10mm; }
                .signature { text-align: right; }
            </style>
        `);

        printWindow.document.write('</head><body><div class="print-container"><div class="invoice-box">');
        
        let headerHtml = `
            <div class="text-center">
                <div class="company-name">${companyProfile.company_name}</div>
                <div>${companyProfile.address_line1}, ${companyProfile.city_pincode}, ${companyProfile.state}</div>
                <div class="font-bold">GSTIN No.: ${companyProfile.gstin}</div>
            </div>
            <div class="invoice-title text-center">${invoiceData.invoice_type.replace(/_/g, ' ')}</div>
            <table style="width:100%; font-size:9pt;">
                 <tr>
                    <td style="width:50%">
                        <table class="details-table">
                            <tr><td class="label">Invoice No:</td><td>${invoiceData.invoice_number}</td></tr>
                            <tr><td class="label">Invoice Date:</td><td>${new Date(invoiceData.invoice_date).toLocaleDateString('en-GB')}</td></tr>
                            <tr><td class="label">State:</td><td>${companyProfile.state}, <span class="label">State Code:</span> ${companyProfile.state_code}</td></tr>
                        </table>
                    </td>
                    <td style="width:50%">
                         <table class="details-table">
                            <tr><td class="label">Transportation Mode:</td><td>${invoiceData.transportation_mode || 'N/A'}</td></tr>
                            <tr><td class="label">Vehicle Number:</td><td>${invoiceData.vehicle_number || 'N/A'}</td></tr>
                            <tr><td class="label">Date of Supply:</td><td>${invoiceData.date_of_supply ? new Date(invoiceData.date_of_supply).toLocaleDateString('en-GB') : new Date(invoiceData.invoice_date).toLocaleDateString('en-GB')}</td></tr>
                            <tr><td class="label">Place of Supply:</td><td>${invoiceData.place_of_supply_state}, <span class="label">State Code:</span> ${invoiceData.place_of_supply_state_code}</td></tr>
                        </table>
                    </td>
                </tr>
            </table>
            <table class="address-grid">
                <tr>
                    <td>
                        <span class="address-title">Details of Receiver/Billed To:</span>
                        <div class="font-bold">${invoiceData.customer_name}</div>
                        <div>${invoiceData.customer_address_line1 || ''}<br>${invoiceData.customer_city_pincode || ''}</div>
                        <div><span class="label">GSTIN:</span> ${invoiceData.customer_gstin || 'N/A'}</div>
                        <div><span class="label">State:</span> ${invoiceData.customer_state || ''}, <span class="label">Code:</span> ${invoiceData.customer_state_code || ''}</div>
                    </td>
                    <td>
                        <span class="address-title">Details of Consignee/Shipped To:</span>
                        <div class="font-bold">${invoiceData.consignee_name}</div>
                        <div>${invoiceData.consignee_address_line1 || ''}<br>${invoiceData.consignee_city_pincode || ''}</div>
                         <div><span class="label">PH:</span> ${invoiceData.customer_phone || ''}</div>
                        <div><span class="label">GSTIN:</span> ${invoiceData.consignee_gstin || 'N/A'}</div>
                        <div><span class="label">State:</span> ${invoiceData.consignee_state || ''}, <span class="label">Code:</span> ${invoiceData.consignee_state_code || ''}</div>
                    </td>
                </tr>
            </table>`;

        let itemsHtml = `<table class="items-table"><thead><tr><th style="width:4%">Sr.</th><th style="width:30%">Name of Product/Service</th><th style="width:8%">HSN</th><th style="width:6%">UOM</th><th class="text-right" style="width:7%">Qty</th><th class="text-right" style="width:9%">Rate</th><th class="text-right" style="width:10%">Amount</th><th class="text-right" style="width:9%">Taxable</th><th class="text-right" style="width:8%">GST</th><th class="text-right" style="width:10%">Total</th></tr></thead><tbody>`;
        let totalQty = 0, totalTaxable = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0, grandTotal = 0;
        
        invoiceData.line_items.forEach((item, index) => {
            const taxable_value = parseFloat(item.taxable_value) || 0;
            const cgst_amount = parseFloat(item.cgst_amount) || 0;
            const sgst_amount = parseFloat(item.sgst_amount) || 0;
            const igst_amount = parseFloat(item.igst_amount) || 0;
            const gstAmount = cgst_amount + sgst_amount + igst_amount;
            
            totalQty += parseFloat(item.quantity) || 0;
            totalTaxable += taxable_value;
            totalCgst += cgst_amount;
            totalSgst += sgst_amount;
            totalIgst += igst_amount;
            grandTotal += parseFloat(item.line_total) || 0;

            itemsHtml += `<tr>
                <td class="text-center">${index + 1}</td>
                <td>${item.description}</td>
                <td class="text-center">${item.final_hsn_acs_code || ''}</td>
                <td class="text-center">${item.final_unit_of_measure || ''}</td>
                <td class="text-right">${(parseFloat(item.quantity) || 0).toFixed(2)}</td>
                <td class="text-right">${(parseFloat(item.unit_price) || 0).toFixed(2)}</td>
                <td class="text-right">${((parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0)).toFixed(2)}</td>
                <td class="text-right">${taxable_value.toFixed(2)}</td>
                <td class="text-right">${gstAmount.toFixed(2)}</td>
                <td class="text-right font-bold">${(parseFloat(item.line_total) || 0).toFixed(2)}</td>
            </tr>`;
        });
        
        for (let i = invoiceData.line_items.length; i < 15; i++) {
             itemsHtml += `<tr><td style="height:1.5em;"></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
        }

        itemsHtml += `</tbody><tfoot><tr>
            <td colspan="4" class="font-bold text-right">Total</td>
            <td class="text-right font-bold">${totalQty.toFixed(2)}</td>
            <td colspan="2"></td>
            <td class="text-right font-bold">${totalTaxable.toFixed(2)}</td>
            <td class="text-right font-bold">${(totalCgst + totalSgst + totalIgst).toFixed(2)}</td>
            <td class="text-right font-bold">${grandTotal.toFixed(2)}</td>
        </tr></tfoot></table>`;
        
        let footerHtml = `
            <div class="footer-section">
                <table>
                    <tr>
                        <td style="width: 50%; vertical-align: top;">
                            <div><span class="label">Total Amount in words:</span> <span class="font-bold" style="text-transform: uppercase;">${invoiceData.amount_in_words || convertAmountToWords(grandTotal) + ' RUPEES ONLY'}</span></div>
                            <div style="margin-top: 5px;"><span class="label">Bundles:</span> <span class="font-bold">${invoiceData.bundles_count || 'N/A'}</span></div>
                            <div style="margin-top: 10px;">
                                <span class="label" style="text-decoration: underline;">Bank Details:</span>
                                <div><span class="label">BANK NAME:</span> ${companyProfile.bank_name}</div>
                                <div><span class="label">A/C NO:</span> ${companyProfile.bank_account_no}</div>
                                <div><span class="label">IFSC NO:</span> ${companyProfile.bank_ifsc_code}</div>
                            </div>
                        </td>
                        <td style="width: 50%; vertical-align: top;">
                            <table class="totals-summary">
                                <tr><td>Total Amount Before Tax</td><td class="text-right">${totalTaxable.toFixed(2)}</td></tr>
                                <tr><td>Add: CGST</td><td class="text-right">${totalCgst.toFixed(2)}</td></tr>
                                <tr><td>Add: SGST</td><td class="text-right">${totalSgst.toFixed(2)}</td></tr>
                                <tr><td>Add: IGST</td><td class="text-right">${totalIgst.toFixed(2)}</td></tr>
                                <tr class="grand-total"><td>Total Amount After Tax</td><td class="text-right">${grandTotal.toFixed(2)}</td></tr>
                            </table>
                        </td>
                    </tr>
                    <tr><td colspan="2" style="padding-top: 5mm;"><span class="label">GST Payable on Reverse Charge:</span> No</td></tr>
                </table>
                <div class="final-footer">
                    <div>(Common Seal)</div>
                    <div class="signature">
                        <div>Certified that the particulars given above are true & correct.</div>
                        <div style="margin-top:15mm;" class="font-bold">For, ${companyProfile.company_name}</div>
                        <div style="margin-top:2mm;">Authorised Signatory</div>
                    </div>
                </div>
            </div>`;

        printWindow.document.write('<div class="main-table">' + headerHtml + itemsHtml + '</div>' + footerHtml);
        printWindow.document.write('</div></div></body></html>');
        printWindow.document.close();
        printWindow.focus();
        
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 250);

    } catch (error) {
        console.error("Error preparing invoice for print:", error);
        alert("Could not prepare invoice for printing: " + error.message);
    }
}
function convertAmountToWords(amount) {
    // --- THIS IS THE KEY FIX FOR NEGATIVE NUMBERS ---
    const isNegative = amount < 0;
    const absoluteAmount = Math.abs(amount);

    const number = Math.round(absoluteAmount * 100) / 100;
    const wholePart = Math.floor(number);
    const decimalPart = Math.round((number - wholePart) * 100);

    const ones = [ "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
    const tens = [ "", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

    function numToWords(n) {
        if (n < 0) return "MINUS " + numToWords(Math.abs(n)); // Should not be hit now, but safe
        if (n === 0) return ""; 

        if (n < 20) return ones[n];
        if (n < 100) return (tens[Math.floor(n / 10)] + (n % 10 !== 0 ? " " + ones[n % 10] : "")).trim();
        if (n < 1000) return (ones[Math.floor(n / 100)] + " HUNDRED" + (n % 100 !== 0 ? " AND " + numToWords(n % 100) : "")).trim();
        if (n < 100000) return (numToWords(Math.floor(n / 1000)) + " THOUSAND" + (n % 1000 !== 0 ? " " + numToWords(n % 1000) : "")).trim();
        if (n < 10000000) return (numToWords(Math.floor(n / 100000)) + " LAKH" + (n % 100000 !== 0 ? " " + numToWords(n % 100000) : "")).trim();
        if (n < 1000000000) return (numToWords(Math.floor(n / 10000000)) + " CRORE" + (n % 10000000 !== 0 ? " " + numToWords(n % 10000000) : "")).trim();
        
        return "NUMBER TOO LARGE";
    }

    if (wholePart === 0 && decimalPart === 0) return "ZERO RUPEES"; 

    let words = numToWords(wholePart);
    
    if (decimalPart > 0) {
        if(words === "") words = "ZERO"; 
        words += " RUPEES AND " + numToWords(decimalPart) + " PAISE";
    } else {
        if(words === "") words = "ZERO"; 
        words += " RUPEES";
    }
    
    // Add the "MINUS" prefix if the original amount was negative
    if (isNegative) {
        return "MINUS " + words.trim();
    }

    return words.trim();
}
async function performGlobalSearch() {
    const query = document
        .getElementById("globalSearchInput")
        .value.trim()
        .toLowerCase();
    const resultsContainer = document.getElementById("globalSearchResults");
    const resultsTableBody = document.querySelector(
        "#globalSearchResultsTable tbody",
    );
    const resultsTableHead = document.querySelector(
        "#globalSearchResultsTable thead",
    );

    if (!query) {
        if (resultsContainer) resultsContainer.style.display = "none";
        return;
    }
    if (!resultsTableBody || !resultsTableHead || !resultsContainer) return;

    resultsTableBody.innerHTML = '<tr><td colspan="6">Searching...</td></tr>';
    resultsContainer.style.display = "block"; 
    try {
        if (allTransactionsCache.length === 0 && !isLoading.transactions) await loadAllTransactions();
        if (usersDataCache.length === 0 && !isLoading.users) await loadUsers();
        if (externalEntitiesCache.length === 0 && !isLoading.lenders) await loadLenders(null, true); // Force load all
        if (productsCache.length === 0 && !isLoading.products) await loadProducts();
        if (invoicesCache.length === 0 && !isLoading.invoices) await loadInvoices();

        const matchedTransactions = allTransactionsCache.filter(
            (tx) =>
                (tx.description && tx.description.toLowerCase().includes(query)) ||
                (tx.category && tx.category.toLowerCase().includes(query)) ||
                tx.amount.toString().includes(query) ||
                (tx.date && tx.date.includes(query)) ||
                (tx.customer_name && tx.customer_name.toLowerCase().includes(query)) || 
                (tx.external_entity_name && tx.external_entity_name.toLowerCase().includes(query)) 
        );
        const matchedCustomers = usersDataCache.filter(
            (user) =>
                (user.username && user.username.toLowerCase().includes(query)) ||
                (user.email && user.email.toLowerCase().includes(query)),
        );
        const matchedExternalEntities = externalEntitiesCache.filter(
            (entity) =>
                (entity.lender_name && entity.lender_name.toLowerCase().includes(query)) ||
                (entity.entity_type && entity.entity_type.toLowerCase().includes(query)),
        );
        const matchedProducts = productsCache.filter(
            (product) =>
                (product.product_name && product.product_name.toLowerCase().includes(query)) ||
                (product.sku && product.sku.toLowerCase().includes(query)) ||
                (product.description && product.description.toLowerCase().includes(query)),
        );
        const matchedInvoices = invoicesCache.filter(
            (inv) =>
                (inv.invoice_number && inv.invoice_number.toLowerCase().includes(query)) ||
                (inv.customer_name && inv.customer_name.toLowerCase().includes(query)) || 
                (inv.status && inv.status.toLowerCase().includes(query)),
        );

        resultsTableBody.innerHTML = "";
        resultsTableHead.innerHTML = ""; 
        let foundResults = false;

        if (matchedTransactions.length > 0) {
            foundResults = true;
            resultsTableHead.innerHTML = `<tr><th>Type</th><th>Date</th><th>User/Entity</th><th>Category</th><th>Description</th><th>Amount (₹)</th></tr>`;
            matchedTransactions.forEach((tx) => {
                const row = resultsTableBody.insertRow();
                row.insertCell().textContent = "Transaction";
                row.insertCell().textContent = new Date(tx.date).toLocaleDateString();
                const userName = tx.customer_name || (tx.user_id ? `Cust. ID ${tx.user_id}` : "Business");
                const entityName = tx.external_entity_name || (tx.lender_id ? `Ext. ID ${tx.lender_id}` : "");
                row.insertCell().textContent = userName + (entityName ? ` / ${entityName}` : "");
                row.insertCell().textContent = tx.category;
                row.insertCell().textContent = tx.description || "-";
                
                let displayedAmount = parseFloat(tx.amount);
                const amountCell = row.insertCell();
                amountCell.textContent = displayedAmount.toFixed(2);
                amountCell.className = displayedAmount >= 0 ? "positive" : "negative";
            });
        }
        if (matchedCustomers.length > 0) {
            foundResults = true;
            if(resultsTableHead.innerHTML === "") resultsTableHead.innerHTML = `<tr><th>Type</th><th>Name</th><th>Email</th><th>Action</th><th></th><th></th></tr>`;
            else resultsTableBody.innerHTML += `<tr><td colspan="6"><hr></td></tr>`;
            matchedCustomers.forEach((user) => {
                const row = resultsTableBody.insertRow();
                row.insertCell().textContent = "Customer";
                row.insertCell().textContent = user.username;
                row.insertCell().textContent = user.email || "-";
                row.insertCell().innerHTML = `<button class="btn btn-sm btn-info" onclick="navigateToUser(${user.id})">View Customer</button>`;
                row.insertCell(); row.insertCell(); 
            });
        }
        if (matchedExternalEntities.length > 0) {
            foundResults = true;
            if(resultsTableHead.innerHTML === "") resultsTableHead.innerHTML = `<tr><th>Type</th><th>Entity Name</th><th>Entity Type</th><th>Action</th><th></th><th></th></tr>`;
             else resultsTableBody.innerHTML += `<tr><td colspan="6"><hr></td></tr>`;
            matchedExternalEntities.forEach((entity) => {
                const row = resultsTableBody.insertRow();
                row.insertCell().textContent = "External Entity";
                row.insertCell().textContent = entity.lender_name;
                row.insertCell().textContent = entity.entity_type || "General";
                row.insertCell().innerHTML = `<button class="btn btn-sm btn-info" onclick="navigateToBusinessFinanceAndOpenEntity(${entity.id}, '${entity.entity_type}')">View Entity</button>`;
                row.insertCell();
                row.insertCell();
            });
        }
        if (matchedProducts.length > 0) {
            foundResults = true;
            if(resultsTableHead.innerHTML === "") resultsTableHead.innerHTML = `<tr><th>Type</th><th>Product Name</th><th>SKU</th><th>Stock</th><th>Action</th><th></th></tr>`;
            else resultsTableBody.innerHTML += `<tr><td colspan="6"><hr></td></tr>`;
            matchedProducts.forEach((product) => {
                const row = resultsTableBody.insertRow();
                row.insertCell().textContent = "Product";
                row.insertCell().textContent = product.product_name;
                row.insertCell().textContent = product.sku || "-";
                row.insertCell().textContent = product.current_stock;
                row.insertCell().innerHTML = `<button class="btn btn-sm btn-info" onclick="navigateToInventoryAndOpenProduct(${product.id})">View Product</button>`;
                row.insertCell();
            });
        }
         if (matchedInvoices.length > 0) {
            foundResults = true;
            if(resultsTableHead.innerHTML === "") resultsTableHead.innerHTML = `<tr><th>Type</th><th>Invoice #</th><th>Customer</th><th>Status</th><th>Action</th><th></th></tr>`;
            else resultsTableBody.innerHTML += `<tr><td colspan="6"><hr></td></tr>`;
            matchedInvoices.forEach((inv) => {
                const row = resultsTableBody.insertRow();
                row.insertCell().textContent = "Invoice";
                row.insertCell().textContent = inv.invoice_number;
                row.insertCell().textContent = inv.customer_name || `Cust. ID ${inv.customer_id}`;
                row.insertCell().textContent = inv.status;
                row.insertCell().innerHTML = `<button class="btn btn-sm btn-info" onclick="navigateToInvoicesAndOpen(${inv.id})">View Invoice</button>`;
                row.insertCell();
            });
        }


        if (!foundResults) {
            resultsTableHead.innerHTML = ""; 
            resultsTableBody.innerHTML =
                '<tr><td colspan="6">No results found.</td></tr>';
        }
    } catch (error) {
        console.error("Global search error:", error);
        resultsTableBody.innerHTML =
            '<tr><td colspan="6">Error during search.</td></tr>';
    }
}
function navigateToUser(userId) {
    navigateToSection('customerManagementSection');
    const user = usersDataCache.find(u => u.id === userId);
    if (user) openUserModal(user);
}
function navigateToBusinessFinanceAndOpenEntity(entityId, entityType = 'General') {
    if (entityType === 'Supplier') {
        navigateToSection('supplierManagementSection');
    } else {
        navigateToSection('businessFinanceSection');
    }
    const entity = externalEntitiesCache.find(e => e.id === entityId);
    if (entity) openLenderModal(entity, entityType);
}
function navigateToInventoryAndOpenProduct(productId) {
    navigateToSection('inventoryManagementSection');
    openProductModal(productId);
}
function navigateToInvoicesAndOpen(invoiceId) {
   navigateToSection('invoiceManagementSection');
    openInvoiceModal(invoiceId);
}
async function generateAndDisplayReport(reportType, view = 'monthly') {
    const periodInput = document.getElementById('reportPeriodMonth');
    const displayArea = document.getElementById('reportDisplayArea');
    if (!periodInput || !displayArea) return;

    const period = periodInput.value;
    if (!period) {
        alert("Please select a period (Month and Year).");
        return;
    }

    displayArea.style.display = 'block';
    displayArea.innerHTML = `<p>Generating ${reportType.replace(/_/g, ' ')} report for ${period}...</p>`;

    if (allTransactionsCache.length === 0) await loadAllTransactions();
    if (invoicesCache.length === 0) await loadInvoices();
    if (productsCache.length === 0) await loadProducts();
    if (usersDataCache.length === 0) await loadUsers();

    let reportHtml = '';
    const [year, month] = period.split('-');

    const monthlyTransactions = allTransactionsCache.filter(tx => tx.date.startsWith(period));

    switch (reportType) {
        case 'turnover_report':
            reportHtml = generateTurnoverReport(period, view);
            break;
        case 'pnl_summary':
            reportHtml = generatePnlReport(monthlyTransactions, period);
            break;
        case 'cash_flow':
            reportHtml = generateCashFlowReport(monthlyTransactions, period);
            setTimeout(() => createCashFlowChart(monthlyTransactions), 50);
            break;
        case 'business_valuation':
            reportHtml = await generateValuationReport(period);
            break;
        case 'payments_breakdown':
            reportHtml = generatePaymentsBreakdownReport(monthlyTransactions, period); 
            break;
        case 'top_customers':
            reportHtml = generateTopCustomersReport(monthlyTransactions, period);
            break;
        case 'top_products':
            reportHtml = await generateTopProductsReport(period);
            break;
        case 'full_disclosure':
            reportHtml = await generateFullDisclosureReport(period);
            break;
    }
    
    displayArea.innerHTML = reportHtml;
}
function generatePnlReport(transactions, period) {
    let totalRevenue = 0;
    let totalCogs = 0;
    let otherIncome = 0;
    let operatingExpenses = 0;
    let interestPaid = 0;

    // 1. Calculate Revenue and COGS from Invoices
    const monthlyInvoices = invoicesCache.filter(inv => 
        inv.invoice_date.startsWith(period) && 
        inv.status !== 'Void' && 
        inv.status !== 'Draft'
    );

    monthlyInvoices.forEach(invoice => {
        totalRevenue += parseFloat(invoice.amount_before_tax || 0);
        
        // Calculate COGS accurately
        if (invoice.line_items) {
            invoice.line_items.forEach(item => {
                if (item.product_id) {
                    const product = productsCache.find(p => p.id === item.product_id);
                    if (product) {
                        totalCogs += (parseFloat(product.cost_price) || 0) * (parseFloat(item.quantity) || 0);
                    }
                }
            });
        }
    });

    // 2. Calculate Other Income and Expenses from Transactions
    transactions.forEach(tx => {
        const catInfo = transactionCategories.find(c => c.name === tx.category);
        if (!catInfo) return;

        const amount = parseFloat(tx.amount || 0);

        // Capture other income (e.g., interest received, bank interest)
        if (catInfo.type.includes('income') && !catInfo.group.includes('customer_revenue') && !catInfo.group.includes('customer_payment')) {
             otherIncome += Math.abs(amount);
        }
        
        // Capture operating expenses (rent, salaries, etc.)
        if (catInfo.group === 'biz_ops' && amount < 0) {
            operatingExpenses += Math.abs(amount);
        }

        // Capture interest paid on business loans
        if (catInfo.name.startsWith('Loan Interest Paid by Business')) {
            interestPaid += Math.abs(amount);
        }
    });

    const grossProfit = totalRevenue - totalCogs;
    const totalExpenses = operatingExpenses + interestPaid;
    const netProfit = grossProfit + otherIncome - totalExpenses;

    return `
        <h3 class="report-title">Profit & Loss Summary - ${period}</h3>
        <div class="pnl-summary-grid">
            <div class="pnl-card"><h5>Total Revenue</h5><p class="positive">₹${totalRevenue.toFixed(2)}</p></div>
            <div class="pnl-card"><h5>Cost of Goods Sold</h5><p class="negative">₹${totalCogs.toFixed(2)}</p></div>
            <div class="pnl-card gross-profit"><h5>Gross Profit</h5><p>₹${grossProfit.toFixed(2)}</p></div>
            <div class="pnl-card"><h5>Other Income</h5><p class="positive">₹${otherIncome.toFixed(2)}</p></div>
            <div class="pnl-card"><h5>Operating Expenses</h5><p class="negative">₹${operatingExpenses.toFixed(2)}</p></div>
            <div class="pnl-card"><h5>Interest Paid</h5><p class="negative">₹${interestPaid.toFixed(2)}</p></div>
        </div>
        <div class="pnl-summary-grid">
            <div class="pnl-card net-profit" style="grid-column: 1 / -1;">
                <h5>Net Profit / (Loss)</h5><p class="${netProfit >= 0 ? 'positive' : 'negative'}">₹${netProfit.toFixed(2)}</p>
            </div>
        </div>
        <p style="font-size: 0.8em; text-align: center; margin-top: 15px; color: #666;">Note: This is an estimated P&L statement. COGS is based on the cost price at the time of sale. Revenue is recognized on the invoice date.</p>
    `;
}
function generateCashFlowReport(transactions, period) {
    return `
        <h3 class="report-title">Monthly Cash Flow - ${period}</h3>
        <div class="report-chart-wrapper">
            <canvas id="cashFlowChart"></canvas>
        </div>
    `;
}

function createCashFlowChart(transactions) {
    const canvas = document.getElementById("cashFlowChart");
    if (!canvas) return;
    if (cashFlowChartInstance) cashFlowChartInstance.destroy();
    const ctx = canvas.getContext("2d");

    let income = 0;
    let expenses = 0;

    transactions.forEach(tx => {
        const catInfo = transactionCategories.find(c => c.name === tx.category);
        if (catInfo && (catInfo.affectsLedger === 'cash' || catInfo.affectsLedger === 'bank' || catInfo.affectsLedger.startsWith('both'))) {
            const amount = parseFloat(tx.amount || 0);
            
            if (catInfo.type.includes('income') || (catInfo.group === 'customer_payment' && amount < 0) || catInfo.affectsLedger === 'both_cash_in_bank_out') {
                income += Math.abs(amount);
            } else if (catInfo.type.includes('expense') || (catInfo.group === 'supplier_payment' && amount < 0) || catInfo.affectsLedger === 'both_cash_out_bank_in') {
                expenses += Math.abs(amount);
            }
        }
    });
    
    cashFlowChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Cash Flow'],
            datasets: [
                {
                    label: 'Income',
                    data: [income],
                    backgroundColor: 'rgba(40, 167, 69, 0.7)',
                    borderColor: 'rgba(40, 167, 69, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Expenses',
                    data: [expenses],
                    backgroundColor: 'rgba(220, 53, 69, 0.7)',
                    borderColor: 'rgba(220, 53, 69, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: value => `₹${value.toLocaleString()}` }
                }
            },
            plugins: {
                title: { display: true, text: 'Income vs. Expenses' },
                tooltip: { 
                    callbacks: { 
                        label: (context) => `₹${context.parsed.y.toLocaleString()}` 
                    } 
                } 
            }
        }
    });
}


function generateTopCustomersReport(transactions, period) {
    const customerRevenue = {};
    transactions.forEach(tx => {
        const catInfo = transactionCategories.find(c => c.name === tx.category);
        if (catInfo && catInfo.group === 'customer_revenue' && tx.user_id) {
            const amount = parseFloat(tx.amount || 0);
            customerRevenue[tx.user_id] = (customerRevenue[tx.user_id] || 0) + amount;
        }
    });

    const sortedCustomers = Object.entries(customerRevenue)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10); // Top 10

    let tableRows = sortedCustomers.map(([userId, total]) => {
        const user = usersDataCache.find(u => u.id == userId);
        return `<tr><td>${user ? user.username : 'Unknown User'}</td><td class="num positive">₹${total.toFixed(2)}</td></tr>`;
    }).join('');

    if (sortedCustomers.length === 0) {
        tableRows = '<tr><td colspan="2" style="text-align:center;">No customer revenue data for this period.</td></tr>';
    }

    return `
        <h3 class="report-title">Top 10 Customers by Revenue - ${period}</h3>
        <table>
            <thead><tr><th>Customer Name</th><th class="num">Total Revenue</th></tr></thead>
            <tbody>${tableRows}</tbody>
        </table>
    `;
}

async function generateTopProductsReport(period) {
    const productSales = {};

    const monthlyInvoices = invoicesCache.filter(inv => inv.invoice_date.startsWith(period));

    for (const inv of monthlyInvoices) {
        if (!inv.line_items) {
            try {
                const res = await apiFetch(`${API}/invoices/${inv.id}`);
                if(!res) continue;
                const detailedInvoice = await res.json();
                inv.line_items = detailedInvoice.line_items || [];
            } catch (e) {
                console.error(`Could not fetch line items for invoice ${inv.id}`, e);
                continue;
            }
        }

        inv.line_items.forEach(item => {
            if (item.product_id) {
                const qty = parseFloat(item.quantity || 0);
                productSales[item.product_id] = (productSales[item.product_id] || 0) + qty;
            }
        });
    }

    const sortedProducts = Object.entries(productSales)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    let tableRows = sortedProducts.map(([productId, quantity]) => {
        const product = productsCache.find(p => p.id == productId);
        return `<tr><td>${product ? product.product_name : 'Unknown Product'}</td><td class="num">${quantity.toFixed(2)}</td></tr>`;
    }).join('');

    if (sortedProducts.length === 0) {
        tableRows = '<tr><td colspan="2" style="text-align:center;">No product sales data for this period.</td></tr>';
    }

    return `
        <h3 class="report-title">Top 10 Selling Products by Quantity - ${period}</h3>
        <table>
            <thead><tr><th>Product Name</th><th class="num">Total Quantity Sold</th></tr></thead>
            <tbody>${tableRows}</tbody>
        </table>
    `;
}

async function generateFullDisclosureReport(period) {
    const [year, month] = period.split('-').map(Number);
    const lastMonthDate = new Date(year, month - 2, 1);
    const lastMonthPeriod = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const lastYearDate = new Date(year - 1, month - 1, 1);
    const lastYearPeriod = `${lastYearDate.getFullYear()}-${String(lastYearDate.getMonth() + 1).padStart(2, '0')}`;
    const yearStr = String(year);

    const getInvoicesForPeriod = (p) => invoicesCache.filter(inv => inv.invoice_date.startsWith(p) && inv.status !== 'Void' && inv.status !== 'Draft');
    const getTransactionsForPeriod = (p) => allTransactionsCache.filter(tx => tx.date.startsWith(p));
    const getNewCustomersForPeriod = (p) => usersDataCache.filter(u => u.created_at && u.created_at.startsWith(p) && u.role !== 'admin');

    // Current period data
    const currentMonthInvoices = getInvoicesForPeriod(period);
    const currentMonthRevenue = currentMonthInvoices.reduce((sum, inv) => sum + parseFloat(inv.total_amount || 0), 0);
    const currentMonthTxCount = getTransactionsForPeriod(period).length;
    const currentMonthNewCustomers = getNewCustomersForPeriod(period).length;
    const collectedRevenue = currentMonthInvoices.reduce((sum, inv) => sum + parseFloat(inv.paid_amount || 0), 0);
    const uncollectedRevenue = currentMonthRevenue - collectedRevenue;
    const ytdInvoices = invoicesCache.filter(inv => inv.invoice_date.startsWith(yearStr) && new Date(inv.invoice_date) <= new Date(`${period}-31`) && inv.status !== 'Void' && inv.status !== 'Draft');
    const ytdRevenue = ytdInvoices.reduce((sum, inv) => sum + parseFloat(inv.total_amount || 0), 0);

    // Last month data
    const lastMonthInvoices = getInvoicesForPeriod(lastMonthPeriod);
    const lastMonthRevenue = lastMonthInvoices.reduce((sum, inv) => sum + parseFloat(inv.total_amount || 0), 0);
    const lastMonthTxCount = getTransactionsForPeriod(lastMonthPeriod).length;
    const lastMonthNewCustomers = getNewCustomersForPeriod(lastMonthPeriod).length;

    // Last year's same month data
    const lastYearInvoices = getInvoicesForPeriod(lastYearPeriod);
    const lastYearRevenue = lastYearInvoices.reduce((sum, inv) => sum + parseFloat(inv.total_amount || 0), 0);
    const lastYearTxCount = getTransactionsForPeriod(lastYearPeriod).length;
    const lastYearNewCustomers = getNewCustomersForPeriod(lastYearPeriod).length;

    // Helper to generate change HTML
    const getChangeHtml = (current, previous, label) => {
        const change = calculatePercentageChange(current, previous);
        return `<p class="change ${change >= 0 ? 'positive' : 'negative'}">${change.toFixed(1)}% ${label}</p>`;
    };

    // --- Sales Analysis ---
    const topProducts = await generateTopProductsReport(period);
    const salesByState = {};
    for(const inv of currentMonthInvoices) {
        if (!inv.customer_state) {
            const cust = usersDataCache.find(u => u.id === inv.customer_id);
            inv.customer_state = cust ? cust.state : 'Unknown';
        }
        const state = inv.customer_state || 'Unknown';
        salesByState[state] = (salesByState[state] || 0) + parseFloat(inv.total_amount || 0);
    }
    const topStates = Object.entries(salesByState).sort((a,b) => b[1] - a[1]).slice(0, 5);
    
    const bestProductPerState = {};
    for (const inv of currentMonthInvoices) {
        const state = usersDataCache.find(u => u.id === inv.customer_id)?.state || 'Unknown';
        if (!inv.line_items) continue;
        for(const item of inv.line_items) {
            if (!item.product_id) continue;
            if (!bestProductPerState[state]) bestProductPerState[state] = {};
            bestProductPerState[state][item.product_id] = (bestProductPerState[state][item.product_id] || 0) + parseFloat(item.quantity);
        }
    }
    const topProductByStateHtml = Object.entries(bestProductPerState).map(([state, products]) => {
        const topProductId = Object.keys(products).reduce((a, b) => products[a] > products[b] ? a : b);
        const topProduct = productsCache.find(p => p.id == topProductId);
        return `<tr><td>${state}</td><td>${topProduct ? topProduct.product_name : `Product ID ${topProductId}`}</td></tr>`;
    }).join('');


    return `
        <h3 class="report-title">Full Disclosure Report - ${period}</h3>
        
        <div class="disclosure-section">
            <h4 class="disclosure-section-title">Key Performance Indicators</h4>
            <div class="disclosure-kpi-grid">
                <div class="disclosure-kpi-card"><h5>Gross Revenue</h5><p class="value">₹${currentMonthRevenue.toFixed(2)}</p>${getChangeHtml(currentMonthRevenue, lastMonthRevenue, 'vs Last Month')}${getChangeHtml(currentMonthRevenue, lastYearRevenue, 'vs Last Year')}</div>
                <div class="disclosure-kpi-card"><h5>Invoices Issued</h5><p class="value">${currentMonthInvoices.length}</p>${getChangeHtml(currentMonthInvoices.length, lastMonthInvoices.length, 'vs Last Month')}${getChangeHtml(currentMonthInvoices.length, lastYearInvoices.length, 'vs Last Year')}</div>
                <div class="disclosure-kpi-card"><h5>New Customers</h5><p class="value">${currentMonthNewCustomers}</p>${getChangeHtml(currentMonthNewCustomers, lastMonthNewCustomers, 'vs Last Month')}${getChangeHtml(currentMonthNewCustomers, lastYearNewCustomers, 'vs Last Year')}</div>
                <div class="disclosure-kpi-card"><h5>Transactions</h5><p class="value">${currentMonthTxCount}</p>${getChangeHtml(currentMonthTxCount, lastMonthTxCount, 'vs Last Month')}${getChangeHtml(currentMonthTxCount, lastYearTxCount, 'vs Last Year')}</div>
            </div>
        </div>

        <div class="disclosure-section">
            <h4 class="disclosure-section-title">Revenue Deep Dive</h4>
            <div class="disclosure-kpi-grid">
                <div class="disclosure-kpi-card"><h5>This Month</h5><p class="value positive">₹${currentMonthRevenue.toFixed(2)}</p></div>
                <div class="disclosure-kpi-card"><h5>Year-to-Date</h5><p class="value positive">₹${ytdRevenue.toFixed(2)}</p></div>
                <div class="disclosure-kpi-card"><h5>Collected (Month)</h5><p class="value positive">₹${collectedRevenue.toFixed(2)}</p></div>
                <div class="disclosure-kpi-card"><h5>Uncollected (Month)</h5><p class="value negative">₹${uncollectedRevenue.toFixed(2)}</p></div>
            </div>
        </div>

        <div class="disclosure-section">
            <h4 class="disclosure-section-title">Sales Analysis</h4>
            <div class="disclosure-split-view">
                <div>
                    <h5>Top 5 Selling Products (by Quantity)</h5>
                    ${topProducts}
                </div>
                <div>
                    <h5>Top 5 States (by Revenue)</h5>
                    <table>
                        <thead><tr><th>State</th><th class="num">Total Revenue</th></tr></thead>
                        <tbody>${topStates.map(([state, total]) => `<tr><td>${state}</td><td class="num positive">₹${total.toFixed(2)}</td></tr>`).join('') || `<tr><td colspan="2">No sales data.</td></tr>`}</tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <div class="disclosure-section">
             <h4 class="disclosure-section-title">Regional Product Performance</h4>
             <div>
                <h5>Top Selling Product by State</h5>
                <table>
                    <thead><tr><th>State</th><th>Best Selling Product</th></tr></thead>
                    <tbody>${topProductByStateHtml || '<tr><td colspan="2">No data available for this period.</td></tr>'}</tbody>
                </table>
             </div>
        </div>
    `;
}

// --- DASHBOARD CHARTS AND ACTIVITY ---
function initializeDashboardCharts() {
    if (revenueChartInstance) { revenueChartInstance.destroy(); revenueChartInstance = null; }
    if (categoryChartInstance) { categoryChartInstance.destroy(); categoryChartInstance = null; }
    if (cashFlowChartInstance) { cashFlowChartInstance.destroy(); cashFlowChartInstance = null; }

    createRevenueChart();
    createCategoryChart();
}
function createRevenueChart() {
    const canvas = document.getElementById("revenueChart");
    if (!canvas) return;
    if (revenueChartInstance) {
        revenueChartInstance.destroy();
    }
    
    const ctx = canvas.getContext("2d");
    const period = document.getElementById('dashboardPeriod').value;
    const granularity = document.querySelector('.chart-controls .chart-time-btn.active').dataset.period;
    const ranges = getPeriodDateRanges(period);

    const today = new Date();
    today.setHours(23, 59, 59, 999); 
    const loopEndDate = today < ranges.currentEnd ? today : ranges.currentEnd;

    const aggregatedData = new Map();

    // Initialize date keys for daily granularity to show days with zero revenue
    if (granularity === 'daily') {
        let currentDate = new Date(ranges.currentStart);
        while (currentDate <= loopEndDate) {
            aggregatedData.set(currentDate.toISOString().split('T')[0], 0);
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }

    // 1. Aggregate revenue from INVOICES
    invoicesCache.forEach(inv => {
        const invDate = new Date(inv.invoice_date);
        if (invDate >= ranges.currentStart && invDate <= ranges.currentEnd && inv.status !== 'Void' && inv.status !== 'Draft') {
            const revenue = parseFloat(inv.amount_before_tax || 0);
            const dateStr = inv.invoice_date.split('T')[0];
            let key;

            if (granularity === 'daily') {
                key = dateStr;
            } else if (granularity === 'weekly') {
                const d = new Date(dateStr);
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
                key = new Date(d.setDate(diff)).toISOString().split('T')[0];
            } else { // monthly
                key = dateStr.substring(0, 7);
            }
            aggregatedData.set(key, (aggregatedData.get(key) || 0) + revenue);
        }
    });

    // 2. Aggregate revenue from direct TRANSACTIONS
    allTransactionsCache.forEach(tx => {
        const txDate = new Date(tx.date);
        const catInfo = transactionCategories.find(c => c.name === tx.category);
        if (txDate >= ranges.currentStart && txDate <= ranges.currentEnd && catInfo && catInfo.type.includes('income') && !tx.related_invoice_id && (catInfo.group === 'customer_revenue' || catInfo.group === 'biz_ops')) {
            const revenue = parseFloat(tx.amount || 0);
            const dateStr = tx.date;
            let key;
            
            if (granularity === 'daily') {
                key = dateStr;
            } else if (granularity === 'weekly') {
                const d = new Date(dateStr);
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                key = new Date(d.setDate(diff)).toISOString().split('T')[0];
            } else { // monthly
                key = dateStr.substring(0, 7);
            }
            aggregatedData.set(key, (aggregatedData.get(key) || 0) + revenue);
        }
    });
    
    // --- THE FIX IS HERE ---
    // Correctly sort and format labels and data points for all granularities.
    const sortedKeys = Array.from(aggregatedData.keys()).sort((a, b) => new Date(a) - new Date(b));
    const labels = sortedKeys.map(key => {
        if (granularity === 'daily') {
            return new Date(key + 'T00:00:00').toLocaleDateString("en-US", { month: "short", day: "numeric" });
        } else if (granularity === 'weekly') {
            return `Wk of ${new Date(key + 'T00:00:00').toLocaleDateString("en-US", { month: 'short', day: 'numeric' })}`;
        } else { // monthly
            const [year, month] = key.split('-');
            return new Date(year, month - 1).toLocaleDateString("en-US", { month: 'short', year: 'numeric' });
        }
    });
    const dataPoints = sortedKeys.map(key => aggregatedData.get(key));

    const maxValue = Math.max(...dataPoints, 0); // Ensure maxValue is at least 0
    const yAxisMax = maxValue > 0 ? maxValue * 1.2 : 10; // Add 20% buffer, or default to 10 if no data

    revenueChartInstance = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: "Revenue",
                data: dataPoints,
                borderColor: "rgba(74, 144, 226, 1)",
                backgroundColor: "rgba(74, 144, 226, 0.1)",
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointBackgroundColor: "rgba(74, 144, 226, 1)",
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { 
                legend: { display: false }, 
                tooltip: { 
                    callbacks: { 
                        label: (context) => `Revenue: ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(context.parsed.y)}`
                    } 
                } 
            },
            scales: {
                y: { 
                    beginAtZero: true,
                    max: yAxisMax,
                    ticks: { 
                        callback: value => new Intl.NumberFormat('en-IN', {
                            style: 'currency',
                            currency: 'INR',
                            notation: 'compact',
                            maximumFractionDigits: 1
                        }).format(value)
                    } 
                },
                x: { grid: { display: false } }
            },
            interaction: { intersect: false, mode: 'index' },
        },
    });
}
function createCategoryChart() {
    const canvas = document.getElementById("categoryChart");
    const placeholder = document.getElementById("topSellingPlaceholder");
    if (!canvas || !placeholder) return;
    if (categoryChartInstance) categoryChartInstance.destroy();
    const ctx = canvas.getContext("2d");
    
    const period = document.getElementById('dashboardPeriod')?.value || 'this_month';
    const ranges = getPeriodDateRanges(period);
    const productSales = {};

    invoicesCache.forEach(inv => {
        const invDate = new Date(inv.invoice_date);
        if (invDate >= ranges.currentStart && invDate <= ranges.currentEnd && inv.status !== 'Void' && inv.status !== 'Draft') {
            if (inv.line_items && Array.isArray(inv.line_items)) {
                inv.line_items.forEach(item => {
                    if (item.product_id) {
                        const revenue = parseFloat(item.line_total || 0);
                        const product = productsCache.find(p => p.id === item.product_id);
                        const productName = product ? product.product_name : `Product ID ${item.product_id}`;
                        productSales[productName] = (productSales[productName] || 0) + revenue;
                    }
                });
            }
        }
    });

    const sortedProducts = Object.entries(productSales)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5); 

    if (sortedProducts.length === 0) {
        placeholder.style.display = 'block';
        canvas.style.display = 'none';
        return;
    }
    placeholder.style.display = 'none';
    canvas.style.display = 'block';

    const chartColors = ["#4A90E2", "#50E3C2", "#F5A623", "#BD10E0", "#7ED321"];

    categoryChartInstance = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: sortedProducts.map(([productName]) => productName),
            datasets: [{
                data: sortedProducts.map(([, amount]) => amount),
                backgroundColor: chartColors,
                borderColor: '#ffffff',
                borderWidth: 2,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: "bottom", labels: { padding: 10, font: {size: 10} } },
                tooltip: { callbacks: { label: (context) => `${context.label}: ₹${context.parsed.toLocaleString()}` } }
            },
            cutout: '60%',
        },
    });
}

function updateDashboardPeriod() {
    updateDashboardCards();
    updateChartsBasedOnPeriod(); 
}

function updateChartsBasedOnPeriod() {
    createRevenueChart();
    createCategoryChart(); 
}

document.querySelectorAll('.chart-time-btn').forEach(button => {
    button.addEventListener('click', (event) => {
        document.querySelectorAll('.chart-time-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        updateChartsBasedOnPeriod();
    });
})
async function loadRecentActivity() {
    const activityList = document.getElementById("recentActivityList");
    if (!activityList) return;

    const activities = [];

    // Process transactions for the activity feed
    const recentTransactions = allTransactionsCache
        .sort((a, b) => new Date(b.date || b.created_at) - new Date(a.date || a.created_at) || b.id - a.id)
        .slice(0, 5) // Get the 5 most recent transactions
        .map(tx => {
            const catInfo = transactionCategories.find(c => c.name === tx.category);
            let displayedAmount = parseFloat(tx.amount || 0);
            let flowType = '';
            let icon = 'fa-exchange-alt';
            let bgColor = 'var(--text-light-color)';

            if (catInfo) {
                if (catInfo.type.includes("income") || (catInfo.group === "customer_payment" && displayedAmount < 0)) {
                    flowType = 'Inflow';
                    icon = 'fa-arrow-up';
                    bgColor = 'var(--success-color)';
                } else if (catInfo.type.includes("expense") || (catInfo.group === "supplier_payment" && displayedAmount < 0)) {
                    flowType = 'Outflow';
                    icon = 'fa-arrow-down';
                    bgColor = 'var(--danger-color)';
                } else if (catInfo.type === 'receivable_increase') {
                     flowType = 'Receivable';
                     icon = 'fa-file-invoice';
                     bgColor = 'var(--info-color)';
                } else if (catInfo.type === 'payable_increase') {
                     flowType = 'Payable';
                     icon = 'fa-receipt';
                     bgColor = 'var(--warning-color)';
                }
            }
            
            return {
                type: "transaction",
                title: `${tx.category || "Transaction"}`,
                subtitle: `₹${Math.abs(displayedAmount).toFixed(2)}${flowType ? ` (${flowType})` : ''}`,
                time: formatTimeAgo(tx.date || tx.created_at),
                icon: icon,
                bgColor: bgColor,
                date: new Date(tx.date || tx.created_at)
            };
        });

    // Process invoices for the activity feed
    const recentInvoices = invoicesCache
        .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 5) // Get the 5 most recent invoices
        .map(inv => ({
            type: "invoice",
            title: `Invoice #${inv.invoice_number}`,
            subtitle: `₹${parseFloat(inv.total_amount || 0).toFixed(2)} (${inv.status})`,
            time: formatTimeAgo(inv.created_at),
            icon: 'fa-file-invoice-dollar',
            bgColor: 'var(--info-color)',
            date: new Date(inv.created_at)
        }));

    // Combine and sort all activities to get the most recent items
    activities.push(...recentTransactions, ...recentInvoices);
    activities.sort((a, b) => b.date - a.date);


    if (activities.length === 0) {
        activityList.innerHTML = '<div class="activity-item-placeholder">No recent activity</div>';
        return;
    }

    // Display the top 5 most recent activities
    activityList.innerHTML = activities.slice(0, 5) 
        .map(activity => `
        <div class="activity-item">
            <div class="activity-icon" style="background-color:${activity.bgColor};">
                <i class="fas ${activity.icon}"></i>
            </div>
            <div class="activity-content">
                <div class="activity-title">${activity.title}</div>
                <div class="activity-subtitle">${activity.subtitle}</div>
            </div>
            <div class="activity-time">${activity.time}</div>
        </div>
    `).join("");
}
function formatTimeAgo(dateString) {
    if (!dateString) return "Unknown";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return `Yesterday`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


function showLowStockProducts() {
    const lowStockProducts = productsCache.filter(product => {
        const currentStock = parseInt(product.current_stock || 0);
        const minLevel = parseInt(product.low_stock_threshold || 0); 
        return minLevel > 0 && currentStock <= minLevel;
    });

    if (lowStockProducts.length === 0) {
        alert("No products with low stock levels found.");
        return;
    }

    const alertMessage = `Low Stock Alert!\n\nThe following products need restocking:\n\n${lowStockProducts.map(p => `• ${p.product_name}: ${p.current_stock || 0} units remaining (Threshold: ${p.low_stock_threshold})`).join("\n")}`;
    alert(alertMessage);
    navigateToSection('inventoryManagementSection');
}

function refreshRecentActivity() {
    loadRecentActivity();
}
function openEntityTransactionHistoryModal(entityId, entityName, type = 'lender') {
    const modal = document.getElementById("entityTransactionHistoryModal");
    const title = document.getElementById("entityTransactionHistoryModalTitle");
    const tableBody = document.getElementById("entityTransactionHistoryTableBody");

    if (!modal || !title || !tableBody) return;
    
    // --- FIX: Add 'large' class to make the modal wider ---
    modal.classList.add('large');

    title.textContent = `Transaction History for ${entityName}`;
    tableBody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';

    let filteredTxns;
    if (type === 'lender') {
        filteredTxns = allTransactionsCache.filter(tx => tx.lender_id === entityId);
    } else if (type === 'agreement') {
        filteredTxns = allTransactionsCache.filter(tx => tx.agreement_id === entityId);
    } else {
        filteredTxns = [];
    }

    filteredTxns.sort((a, b) => new Date(b.date) - new Date(a.date));

    tableBody.innerHTML = "";
    if (filteredTxns.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No transactions found.</td></tr>';
    } else {
        filteredTxns.forEach(tx => {
            const row = tableBody.insertRow();
            row.insertCell().textContent = new Date(tx.date).toLocaleDateString();
            row.insertCell().textContent = tx.category;
            row.insertCell().textContent = tx.description || '-';
            
            const amountCell = row.insertCell();
            amountCell.textContent = parseFloat(tx.amount).toFixed(2);
            amountCell.className = tx.amount >= 0 ? "positive num" : "negative num";

            let relatedTo = 'N/A';
            if(tx.user_id) relatedTo = usersDataCache.find(u => u.id === tx.user_id)?.username || `Cust. #${tx.user_id}`;
            else if(tx.lender_id) relatedTo = externalEntitiesCache.find(e => e.id === tx.lender_id)?.lender_name || `Lender #${tx.lender_id}`;
            row.insertCell().textContent = relatedTo;
        });
    }

    modal.classList.add('show');
}
function closeEntityTransactionHistoryModal() {
    const modal = document.getElementById("entityTransactionHistoryModal");
    if (modal) modal.classList.remove('show');
}
// New function to open the repayment modal

function openRepayLoanModal(agreementId) {
    const agreement = businessAgreementsCache.find(a => a.agreement_id === agreementId);
    if (!agreement) {
        alert("Error: Could not find the agreement data.");
        return;
    }

    const modal = document.getElementById("repayLoanModal");
    const form = document.getElementById("repayLoanForm");
    form.reset();
    
    const isLoanTaken = agreement.agreement_type === 'loan_taken_by_biz';

    document.getElementById('repayLoanModalTitle').textContent = isLoanTaken ? `Repay Loan to ${agreement.lender_name}` : `Receive Loan Payment from ${agreement.lender_name}`;
    document.getElementById('repay_agreement_id').value = agreement.agreement_id;
    
    const outstandingPrincipal = parseFloat(agreement.outstanding_principal || 0);
    const interestPayableOrReceivable = parseFloat(agreement.interest_payable || 0);

    document.getElementById('repay_outstanding_principal').textContent = outstandingPrincipal.toFixed(2);
    document.getElementById('repay_interest_payable').textContent = interestPayableOrReceivable.toFixed(2);
    document.getElementById('repay_date').value = new Date().toISOString().split('T')[0];
    
    document.querySelector('label[for="repay_payment_amount"]').textContent = isLoanTaken ? "Payment Amount (₹)*" : "Received Amount (₹)*";
    document.querySelector('label[for="repay_method_bank"]').textContent = isLoanTaken ? "From Bank" : "To Bank";
    document.querySelector('label[for="repay_method_cash"]').textContent = isLoanTaken ? "From Cash" : "To Cash";
    
    document.getElementById('repay_type_combined').checked = true;
    toggleRepayOptions();

    modal.classList.add('show');
}
function toggleRepayOptions() {
    const paymentAmountInput = document.getElementById('repay_payment_amount');
    const paymentType = document.querySelector('input[name="repay_payment_type"]:checked').value;
    const interestDue = parseFloat(document.getElementById('repay_interest_payable').textContent) || 0;
    const principalDue = parseFloat(document.getElementById('repay_outstanding_principal').textContent) || 0;

    if (paymentType === 'interest') {
        paymentAmountInput.value = interestDue.toFixed(2);
    } else if (paymentType === 'principal') {
        paymentAmountInput.value = principalDue.toFixed(2);
    } else {
        paymentAmountInput.placeholder = "Enter total payment amount";
        if(paymentAmountInput.value === interestDue.toFixed(2) || paymentAmountInput.value === principalDue.toFixed(2)){
             paymentAmountInput.value = '';
        }
    }
}
function closeRepayLoanModal() {
    const modal = document.getElementById("repayLoanModal");
    if (modal) modal.classList.remove('show');
}
// New function to handle the repayment logic
async function handleLoanRepaymentSubmit(e) {
    e.preventDefault();
    const agreementId = document.getElementById('repay_agreement_id').value;
    const paymentAmount = parseFloat(document.getElementById('repay_payment_amount').value);
    const paymentType = document.querySelector('input[name="repay_payment_type"]:checked').value;
    const paymentMethod = document.querySelector('input[name="repay_payment_method"]:checked').value;
    const paymentDate = document.getElementById('repay_date').value;

    if (isNaN(paymentAmount) || paymentAmount <= 0) {
        alert("Please enter a valid payment amount.");
        return;
    }

    const agreement = businessAgreementsCache.find(a => a.agreement_id == agreementId);
    if (!agreement) {
        alert("Could not find the loan agreement. Please refresh the page.");
        return;
    }
    
    const isLoanTaken = agreement.agreement_type === 'loan_taken_by_biz';
    const amountSign = isLoanTaken ? -1 : 1; 

    const interestCategory = isLoanTaken 
        ? `Loan Interest Paid by Business (from ${paymentMethod})` 
        : `Interest on Customer Loan Received (${paymentMethod})`;
    const principalCategory = isLoanTaken 
        ? `Loan Principal Repaid by Business (from ${paymentMethod})` 
        : `Loan Repayment Received from Customer (${paymentMethod})`;
    
    const transactionPromises = [];

    let interestToPay = 0;
    let principalToPay = 0;

    if (paymentType === 'interest') {
        interestToPay = paymentAmount;
    } else if (paymentType === 'principal') {
        principalToPay = paymentAmount;
    } else {
        const interestDue = Math.abs(parseFloat(agreement.interest_payable || 0));
        interestToPay = Math.min(paymentAmount, interestDue);
        principalToPay = paymentAmount - interestToPay;
    }

    if (interestToPay > 0) {
        const interestTx = {
            lender_id: agreement.lender_id,
            agreement_id: agreementId,
            amount: amountSign * interestToPay,
            description: `Interest payment for loan with ${agreement.lender_name}`,
            category: interestCategory,
            date: paymentDate
        };
        transactionPromises.push(apiFetch(`${API}/transactions`, {
            method: 'POST',
            body: JSON.stringify(interestTx)
        }));
    }
    
    if (principalToPay > 0) {
        const principalTx = {
            lender_id: agreement.lender_id,
            agreement_id: agreementId,
            amount: amountSign * principalToPay,
            description: `Principal payment for loan with ${agreement.lender_name}`,
            category: principalCategory,
            date: paymentDate
        };
        transactionPromises.push(apiFetch(`${API}/transactions`, {
            method: 'POST',
            body: JSON.stringify(principalTx)
        }));
    }

    if (transactionPromises.length === 0) {
        alert("No payment amount to process. Please enter an amount.");
        return;
    }

    try {
        const responses = await Promise.all(transactionPromises);
        for (const res of responses) {
            if (!res || !res.ok) {
                const result = await res.json();
                throw new Error(result.error || `A transaction failed: ${res.statusText}`);
            }
        }
        
        alert("Loan payment(s) processed successfully!");
        closeRepayLoanModal();
        
        await loadAllTransactions(); 
        await loadBusinessExternalFinanceAgreements(); 
        
        const cashLedgerActive = document.getElementById("cashLedgerContent")?.style.display !== 'none';
        const bankLedgerActive = document.getElementById("bankLedgerContent")?.style.display !== 'none';
        if (cashLedgerActive) loadCashLedger();
        if (bankLedgerActive) loadBankLedger();

    } catch (error) {
        console.error("Error processing loan repayment:", error);
        alert("Error processing payment: " + error.message);
    }
}

function openLoanDetailsModal(agreementId) {
    const modal = document.getElementById("loanDetailsModal");
    if (!modal) return;

    const agreement = businessAgreementsCache.find(a => a.agreement_id === agreementId);
    if (!agreement) {
        alert("Could not find agreement details. Please refresh.");
        return;
    }

    document.getElementById('loanDetailsTitle').textContent = `Details for Loan with ${agreement.lender_name}`;
    document.getElementById('loanDetailsHeaderInfo').innerHTML = `
        <strong>Type:</strong> ${agreement.agreement_type.replace(/_/g, ' ')} | 
        <strong>Principal:</strong> ₹${parseFloat(agreement.total_amount).toFixed(2)} | 
        <strong>Interest Rate:</strong> ${agreement.interest_rate}% p.m.
    `;

    const interestTableBody = document.getElementById('loanInterestBreakdownTableBody');
    interestTableBody.innerHTML = '';
    if (agreement.monthly_breakdown && agreement.monthly_breakdown.length > 0) {
        agreement.monthly_breakdown.forEach(item => {
            const row = interestTableBody.insertRow();
            row.insertCell().textContent = item.month;
            const dueCell = row.insertCell();
            dueCell.textContent = parseFloat(item.interest_due).toFixed(2);
            dueCell.className = 'num';
            const statusCell = row.insertCell();
            statusCell.innerHTML = `<span class="status-badge status-${item.status.toLowerCase()}">${item.status}</span>`;
        });
    } else {
        interestTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No monthly interest data available.</td></tr>';
    }

    const paymentHistoryTableBody = document.getElementById('loanPaymentHistoryTableBody');
    paymentHistoryTableBody.innerHTML = '';
    const relatedTransactions = allTransactionsCache
        .filter(tx => tx.agreement_id === agreementId)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (relatedTransactions.length > 0) {
        relatedTransactions.forEach(tx => {
            const row = paymentHistoryTableBody.insertRow();
            row.insertCell().textContent = new Date(tx.date).toLocaleDateString();
            row.insertCell().textContent = tx.category;
            const amountCell = row.insertCell();
            const amount = parseFloat(tx.amount);
            amountCell.textContent = Math.abs(amount).toFixed(2);
            amountCell.className = 'num';
        });
    } else {
        paymentHistoryTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No payment transactions found for this agreement.</td></tr>';
    }

    modal.classList.add('show');
}

function closeLoanDetailsModal() {
    const modal = document.getElementById("loanDetailsModal");
    if (modal) modal.classList.remove("show");
}
async function generateValuationReport(period) {
    if (usersDataCache.length === 0) await loadUsers();
    if (productsCache.length === 0) await loadProducts();
    if (allTransactionsCache.length === 0) await loadAllTransactions();
    if (externalEntitiesCache.length === 0) await loadLenders(null, true);
    if (businessAgreementsCache.length === 0) await loadBusinessExternalFinanceAgreements();

    let totalCash = 0;
    let totalBank = 0;
    allTransactionsCache.forEach(t => {
        const catInfo = transactionCategories.find(c => c.name === t.category);
        if (!catInfo || !catInfo.affectsLedger) return;
        const amount = parseFloat(t.amount);
        if (catInfo.affectsLedger === 'cash') {
            if (catInfo.type.includes("income")) totalCash += Math.abs(amount);
            else if (catInfo.type.includes("expense")) totalCash -= Math.abs(amount);
        } else if (catInfo.affectsLedger === 'bank') {
            if (catInfo.type.includes("income")) totalBank += Math.abs(amount);
            else if (catInfo.type.includes("expense")) totalBank -= Math.abs(amount);
        } else if (catInfo.affectsLedger === 'both_cash_out_bank_in') {
            totalCash -= Math.abs(amount);
            totalBank += Math.abs(amount);
        } else if (catInfo.affectsLedger === 'both_cash_in_bank_out') {
            totalCash += Math.abs(amount);
            totalBank -= Math.abs(amount);
        }
    });

    const accountsReceivable = usersDataCache
        .filter(u => u.role !== 'admin')
        .reduce((sum, user) => {
            const userTransactionsTotal = allTransactionsCache
                .filter(tx => tx.user_id === user.id)
                .reduce((txSum, tx) => txSum + parseFloat(tx.amount || 0), 0);
            return sum + (parseFloat(user.initial_balance) || 0) + userTransactionsTotal;
        }, 0);

    const inventoryValue = productsCache.reduce((sum, p) => {
        return sum + (parseFloat(p.current_stock || 0) * parseFloat(p.cost_price || 0));
    }, 0);

    const loansGiven = businessAgreementsCache
        .filter(a => a.agreement_type === 'loan_given_by_biz')
        .reduce((sum, a) => sum + parseFloat(a.outstanding_principal || 0), 0);
    
    const totalAssets = totalCash + totalBank + accountsReceivable + inventoryValue + loansGiven;

    const suppliers = externalEntitiesCache.filter(e => e.entity_type === 'Supplier');
    const accountsPayable = suppliers.reduce((sum, s) => {
         const supplierTransactionsTotal = allTransactionsCache
                .filter(tx => tx.lender_id === s.id)
                .reduce((txSum, tx) => txSum + parseFloat(tx.amount || 0), 0);
        return sum + (parseFloat(s.initial_payable_balance) || 0) + supplierTransactionsTotal;
    }, 0);
    
    const loansTaken = businessAgreementsCache
        .filter(a => a.agreement_type === 'loan_taken_by_biz')
        .reduce((sum, a) => sum + parseFloat(a.outstanding_principal || 0), 0);

    const totalLiabilities = accountsPayable + loansTaken;
    
    const netWorth = totalAssets - totalLiabilities;

    return `
        <h3 class="report-title">Business Valuation Snapshot (as of Today)</h3>
        <div class="disclosure-split-view">
            <div class="disclosure-section">
                <h4 class="disclosure-section-title">Assets</h4>
                <table>
                    <tbody>
                        <tr><td>Cash on Hand</td><td class="num positive">₹${totalCash.toFixed(2)}</td></tr>
                        <tr><td>Bank Balance</td><td class="num positive">₹${totalBank.toFixed(2)}</td></tr>
                        <tr><td>Accounts Receivable</td><td class="num positive">₹${accountsReceivable.toFixed(2)}</td></tr>
                        <tr><td>Inventory Value (at Cost)</td><td class="num positive">₹${inventoryValue.toFixed(2)}</td></tr>
                        <tr><td>Loans Given Out (Principal)</td><td class="num positive">₹${loansGiven.toFixed(2)}</td></tr>
                        <tr style="border-top: 1px solid #333; font-weight: bold;"><td>Total Assets</td><td class="num positive">₹${totalAssets.toFixed(2)}</td></tr>
                    </tbody>
                </table>
            </div>
            <div class="disclosure-section">
                <h4 class="disclosure-section-title">Liabilities</h4>
                <table>
                    <tbody>
                        <tr><td>Accounts Payable</td><td class="num negative">₹${accountsPayable.toFixed(2)}</td></tr>
                        <tr><td>Loans Taken (Principal)</td><td class="num negative">₹${loansTaken.toFixed(2)}</td></tr>
                        <tr style="border-top: 1px solid #333; font-weight: bold;"><td>Total Liabilities</td><td class="num negative">₹${totalLiabilities.toFixed(2)}</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
        <div class="pnl-summary-grid">
            <div class="pnl-card net-profit valuation-net-worth" style="grid-column: 1 / -1;">
                <h5>Estimated Net Worth (Assets - Liabilities)</h5><p>₹${netWorth.toFixed(2)}</p>
            </div>
        </div>
    `;
}

function generatePaymentsBreakdownReport(monthlyTransactions, period) {
    let supplierPayments = 0;
    let loanPrincipalRepayments = 0;
    let loanInterestPayments = 0;

    monthlyTransactions.forEach(tx => {
        const amount = Math.abs(parseFloat(tx.amount || 0));
        const cat = tx.category || '';
        if (cat.startsWith('Payment Made to Supplier')) {
            supplierPayments += amount;
        } else if (cat.startsWith('Loan Principal Repaid by Business')) {
            loanPrincipalRepayments += amount;
        } else if (cat.startsWith('Loan Interest Paid by Business')) {
            loanInterestPayments += amount;
        }
    });
    
    const totalPayments = supplierPayments + loanPrincipalRepayments + loanInterestPayments;

    return `
        <h3 class="report-title">Payments Breakdown - ${period}</h3>
        <div class="pnl-summary-grid">
             <div class="pnl-card"><h5>Total Payments Made</h5><p class="negative">₹${totalPayments.toFixed(2)}</p></div>
        </div>
        <table>
            <thead><tr><th>Payment Type</th><th class="num">Total Amount Paid (₹)</th></tr></thead>
            <tbody>
                <tr><td>Payments to Suppliers</td><td class="num negative">₹${supplierPayments.toFixed(2)}</td></tr>
                <tr><td>Loan Principal Repayments</td><td class="num negative">₹${loanPrincipalRepayments.toFixed(2)}</td></tr>
                <tr><td>Loan Interest Payments</td><td class="num negative">₹${loanInterestPayments.toFixed(2)}</td></tr>
            </tbody>
            <tfoot>
                <tr style="font-weight: bold;">
                    <td>Grand Total</td>
                    <td class="num negative">₹${totalPayments.toFixed(2)}</td>
                </tr>
            </tfoot>
        </table>
    `;
}
async function handleBusinessChitLoanAgreementSubmit(e) {
    e.preventDefault();
    const data = {
        lender_id: document.getElementById("agreement_entity_id").value,
        agreement_type: document.getElementById("agreement_type").value,
        total_amount: parseFloat(document.getElementById("agreement_total_amount").value),
        interest_rate: parseFloat(document.getElementById("agreement_interest_rate").value) || 0,
        start_date: document.getElementById("agreement_start_date").value,
        details: document.getElementById("agreement_details").value.trim(),
    };

    if (!data.lender_id || !data.agreement_type || isNaN(data.total_amount) || !data.start_date) {
        alert("Please fill all required fields: Entity, Type, Total Amount, and Start Date.");
        return;
    }
    if (isNaN(data.interest_rate) || data.interest_rate < 0) {
        alert("Interest Rate must be a valid non-negative number.");
        return;
    }

    const method = editingAgreementId ? "PUT" : "POST";
    const endpoint = editingAgreementId ? `${API}/business-agreements/${editingAgreementId}` : `${API}/business-agreements`;

    try {
        const res = await apiFetch(endpoint, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res) return;
        const result = await res.json();
        if (!res.ok) {
            throw new Error(result.error || `Operation failed: ${res.statusText}`);
        }

        closeBusinessChitLoanAgreementModal();
        
        if (method === "POST" && result.agreement && (result.agreement.agreement_type === 'loan_taken_by_biz' || result.agreement.agreement_type === 'loan_given_by_biz')) {
            openLoanFundsReceiptModal(result.agreement);
        } else {
            alert(result.message || (editingAgreementId ? "Agreement updated" : "Agreement created"));
            loadBusinessExternalFinanceAgreements();
        }

    } catch (error) {
        console.error("Error saving business agreement:", error);
        alert("Error: " + error.message);
    }
}
async function handleCompanyExpenseSubmit(e) {
    e.preventDefault();
    const form = document.getElementById("companyExpenseForm");
    const categoryName = form.expenseCategory.value;
    const paymentMethod = form.querySelector('input[name="expensePayMode"]:checked').value;
    
    const fullCategoryName = `${categoryName} (${paymentMethod})`;

    const data = {
        user_id: null,
        lender_id: null,
        amount: -Math.abs(parseFloat(form.expenseAmount.value)),
        description: form.expenseDescription.value,
        category: fullCategoryName,
        date: form.expenseDate.value,
    };
    
    if (!data.category || isNaN(data.amount) || !data.date || !data.description) {
        alert("Please fill all required fields for the expense.");
        return;
    }

    try {
        const res = await apiFetch(`${API}/transactions`, {
            method: 'POST', body: JSON.stringify(data),
        });
        if(!res) return;
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || `Failed: ${res.statusText}`);
        
        alert(result.message || "Company expense added successfully.");
        closeCompanyExpenseModal();
        await loadAllTransactions();
        loadAndDisplayCompanyExpenses();
        
        const cashLedgerActive = document.getElementById("cashLedgerContent")?.style.display !== 'none';
        const bankLedgerActive = document.getElementById("bankLedgerContent")?.style.display !== 'none';
        if (cashLedgerActive) loadCashLedger();
        if (bankLedgerActive) loadBankLedger();
    } catch (error) {
        console.error("Error submitting company expense:", error);
        alert("Error: " + error.message);
    }
}
function openCompanyExpenseModal(preselectCategory = null) {
    const modal = document.getElementById("companyExpenseModal");
    if (!modal) return;
    const form = document.getElementById("companyExpenseForm");
    form.reset();

    if (preselectCategory) {
        document.getElementById("expenseCategory").value = preselectCategory;
    }
    document.getElementById("expenseDate").value = new Date().toISOString().split("T")[0];
    modal.classList.add('show');
}

// Add this function near the other "closeModal" functions
function closeCompanyExpenseModal() {
    const modal = document.getElementById("companyExpenseModal");
    if(modal) modal.classList.remove('show');
}

function loadAndDisplayCompanyExpenses() {
    const tableBody = document.getElementById("companyExpensesTableBody");
    if (!tableBody) return;

    const companyExpenses = allTransactionsCache.filter(tx => {
        const catInfo = transactionCategories.find(c => c.name === tx.category);
        return catInfo && catInfo.group === 'biz_ops';
    });

    companyExpenses.sort((a, b) => new Date(b.date) - new Date(a.date));

    tableBody.innerHTML = "";
    if (companyExpenses.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No company expenses recorded yet.</td></tr>';
        return;
    }

    companyExpenses.forEach(tx => {
        const row = tableBody.insertRow();
        const amount = parseFloat(tx.amount || 0);

        row.innerHTML = `
            <td>${new Date(tx.date).toLocaleDateString()}</td>
            <td>${tx.category || "-"}</td>
            <td>${tx.description || "-"}</td>
            <td class="num negative">₹${Math.abs(amount).toFixed(2)}</td>
            <td>
                <button class='btn btn-info btn-sm' onclick='openTransactionModal(${JSON.stringify(tx)})'><i class="fas fa-edit"></i></button>
                <button class='btn btn-danger btn-sm' onclick='deleteTransaction(${tx.id})'><i class="fas fa-trash"></i></button>
            </td>
        `;
    });
}
async function handleOpeningBalanceSubmit(e) {
    e.preventDefault();
    
    const bankBalance = parseFloat(document.getElementById('opening_bank_balance').value);
    const cashBalance = parseFloat(document.getElementById('opening_cash_balance').value);
    const balanceDate = document.getElementById('opening_balance_date').value;

    if (isNaN(bankBalance) || isNaN(cashBalance) || !balanceDate) {
        alert("Please enter valid numbers for both balances and select a date.");
        return;
    }

    if (!confirm(`Are you sure you want to set the opening balances?\n\nBank: ₹${bankBalance.toFixed(2)}\nCash: ₹${cashBalance.toFixed(2)}\nAs of: ${balanceDate}\n\nThis is a one-time setup action and should not be repeated.`)) {
        return;
    }

    const transactionsToCreate = [];

    if (bankBalance !== 0) {
        transactionsToCreate.push({
            amount: bankBalance,
            description: `Opening balance as of ${balanceDate}`,
            category: "Opening Balance - Bank",
            date: balanceDate
        });
    }

    if (cashBalance !== 0) {
        transactionsToCreate.push({
            amount: cashBalance,
            description: `Opening balance as of ${balanceDate}`,
            category: "Opening Balance - Cash",
            date: balanceDate
        });
    }

    if (transactionsToCreate.length === 0) {
        alert("Both balances are zero. Nothing to set.");
        return;
    }

    try {
        for (const txData of transactionsToCreate) {
            const res = await apiFetch(`${API}/transactions`, {
                method: 'POST',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(txData)
            });
            if (!res || !res.ok) {
                const result = await res.json();
                throw new Error(result.error || `Failed to create transaction for ${txData.category}`);
            }
        }

        alert("Opening balance transactions created successfully!");
        document.getElementById('openingBalanceModal').classList.remove('show');
        await loadAllTransactions();
        navigateToSection('ledgersSection');
        
    } catch (error) {
        console.error("Error setting opening balances:", error);
        alert("Error: " + error.message);
    }
}
async function openOnboardingModal() {
    const modal = document.getElementById('onboardingModal');
    if (!modal) return;
    
    const customerDropdown = document.getElementById('onboard_customer_id');
    const lenderDropdown = document.getElementById('onboard_lender_id');

    await loadUsers();
    await loadLenders(null, true);

    customerDropdown.innerHTML = '<option value="">Select Customer/Party...</option>';
    usersDataCache.forEach(u => {
        if (u.role !== 'admin') {
            const option = document.createElement('option');
            option.value = u.id;
            option.textContent = u.username;
            customerDropdown.appendChild(option);
        }
    });

    lenderDropdown.innerHTML = '<option value="">Select Financial Entity...</option>';
    externalEntitiesCache.forEach(e => {
         if (e.entity_type === 'Financial') {
            const option = document.createElement('option');
            option.value = e.id;
            option.textContent = e.lender_name;
            lenderDropdown.appendChild(option);
        }
    });
    
    document.getElementById('onboard_balance_date').value = new Date().toISOString().split('T')[0];
    document.getElementById('onboard_loan_start_date').value = new Date().toISOString().split('T')[0];
    document.getElementById('onboard_loan_last_paid_date').value = new Date().toISOString().split('T')[0];

    showOnboardingTab('customer');
    modal.classList.add('show');
}


function showOnboardingTab(tabName) {
    document.querySelectorAll('.onboarding-tab').forEach(tab => tab.style.display = 'none');
    document.querySelectorAll('#onboardingModal .ledger-tabs .ledger-tab-btn').forEach(btn => btn.classList.remove('active'));

    if (tabName === 'customer') {
        document.getElementById('onboardCustomerTab').style.display = 'block';
        document.querySelector('#onboardingModal .ledger-tabs .ledger-tab-btn[onclick*="customer"]').classList.add('active');
    } else {
        document.getElementById('onboardLoanTab').style.display = 'block';
        document.querySelector('#onboardingModal .ledger-tabs .ledger-tab-btn[onclick*="loan"]').classList.add('active');
    }
}
async function handleCustomerBalanceSubmit(e) {
    e.preventDefault();
    const customerId = document.getElementById('onboard_customer_id').value;
    const balance = parseFloat(document.getElementById('onboard_customer_balance').value);
    const date = document.getElementById('onboard_balance_date').value;

    if (!customerId || isNaN(balance) || !date) {
        alert("Please select a customer, enter a valid balance, and select a date.");
        return;
    }

    const txData = {
        user_id: customerId,
        amount: balance,
        description: `Onboarded historical balance as of ${date}`,
        category: "Opening Balance Adjustment",
        date: date
    };

    try {
        const res = await apiFetch(`${API}/transactions`, {
            method: 'POST', body: JSON.stringify(txData)
        });
        if (!res || !res.ok) {
            const result = await res.json();
            throw new Error(result.error || "Failed to set balance.");
        }
        alert("Customer balance set successfully!");
        document.getElementById('onboardingModal').classList.remove('show');
        await loadAllTransactions();
        await loadUsers();
        navigateToSection('customerManagementSection');
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}
async function handleExistingLoanSubmit(e) {
    e.preventDefault();
    const data = {
        lender_id: document.getElementById('onboard_lender_id').value,
        original_amount: parseFloat(document.getElementById('onboard_loan_original_amount').value) || 0,
        current_balance: parseFloat(document.getElementById('onboard_loan_current_balance').value),
        start_date: document.getElementById('onboard_loan_start_date').value,
        last_paid_date: document.getElementById('onboard_loan_last_paid_date').value,
        interest_rate: parseFloat(document.getElementById('onboard_loan_interest_rate').value) || 0,
        details: document.getElementById('onboard_loan_details').value.trim()
    };

    if (!data.lender_id || isNaN(data.current_balance) || !data.start_date || !data.last_paid_date) {
        alert("Please fill all required fields for the loan.");
        return;
    }

    try {
        const res = await apiFetch(`${API}/business-agreements/existing`, {
            method: 'POST', body: JSON.stringify(data)
        });
        if (!res || !res.ok) {
            const result = await res.json();
            throw new Error(result.error || "Failed to onboard loan.");
        }
        alert("Existing loan onboarded successfully!");
        document.getElementById('onboardingModal').classList.remove('show');
        await loadAllTransactions();
        await loadBusinessExternalFinanceAgreements();
        navigateToSection('businessFinanceSection');
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

// Add this new function to your app-script.js file
async function runGoogleSheetsImport() {
    if (!confirm("Are you sure you want to import data from Google Sheets? This will create new entities, agreements, and opening balance transactions for data that doesn't already exist in the system. This process is safe to run multiple times.")) {
        return;
    }

    const importBtn = document.querySelector('button[onclick="runGoogleSheetsImport()"]');
    const originalBtnText = importBtn.innerHTML;
    importBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
    importBtn.disabled = true;

    try {
        const res = await apiFetch('/api/import/google-sheets', {
            method: 'POST'
        });

        const result = await res.json();

        if (!res.ok) {
            throw new Error(result.error || 'The import process failed on the server.');
        }

        let summaryMessage = `Import process finished!\n\n` +
            `- Sheets Processed: ${result.summary.processed}\n` +
            `- Records Imported: ${result.summary.imported}\n` +
            `- Records Skipped (already exist): ${result.summary.skipped}\n` +
            `- Errors: ${result.summary.errors}\n\n` +
            `------------------\nDetails:\n------------------\n`;

        result.summary.details.forEach(detail => {
            summaryMessage += `• Sheet "${detail.sheet}": ${detail.status.toUpperCase()}`;
            if (detail.reason) summaryMessage += ` - Reason: ${detail.reason}`;
            if (detail.type) summaryMessage += ` - Type: ${detail.type}`;
            if (detail.amount) summaryMessage += ` - Amount: ${detail.amount}`;
            summaryMessage += '\n';
        });

        alert(summaryMessage);

        await loadInitialData();
        navigateToSection('businessFinanceSection');

    } catch (error) {
        console.error("Error running Google Sheets import:", error);
        alert("An error occurred during the import process. Please check the console for details.\n\n" + error.message);
    } finally {
        importBtn.innerHTML = originalBtnText;
        importBtn.disabled = false;
    }
}
// This is the only function that needs to be updated.
// Replace the existing createCategoryChart function with this one.

async function createCategoryChart() {
    const canvas = document.getElementById("categoryChart");
    const placeholder = document.getElementById("topSellingPlaceholder");
    if (!canvas || !placeholder) return;
    if (categoryChartInstance) categoryChartInstance.destroy();
    const ctx = canvas.getContext("2d");

    const period = document.getElementById('dashboardPeriod')?.value || 'this_month';
    const ranges = getPeriodDateRanges(period);
    const productSales = {};

    // --- NEW LOGIC START ---
    // Filter relevant invoices for the period first
    const monthlyInvoices = invoicesCache.filter(inv => {
        const invDate = new Date(inv.invoice_date);
        return invDate >= ranges.currentStart && invDate <= ranges.currentEnd && inv.status !== 'Void' && inv.status !== 'Draft';
    });

    // Asynchronously fetch line items for any invoice that doesn't have them
    const invoicesToFetch = monthlyInvoices.filter(inv => !inv.line_items);
    if (invoicesToFetch.length > 0) {
        placeholder.innerHTML = 'Analyzing sales data...'; // Give user feedback
        placeholder.style.display = 'block';
        canvas.style.display = 'none';

        await Promise.all(invoicesToFetch.map(async (inv) => {
            try {
                const res = await apiFetch(`${API}/invoices/${inv.id}`);
                if (res && res.ok) {
                    const detailedInvoice = await res.json();
                    // Update the invoice in the main cache with its line items
                    const cachedInv = invoicesCache.find(i => i.id === inv.id);
                    if (cachedInv) {
                        cachedInv.line_items = detailedInvoice.line_items || [];
                    }
                }
            } catch (e) {
                console.error(`Could not fetch line items for invoice ${inv.id} for chart`, e);
            }
        }));
    }
    // --- NEW LOGIC END ---

    // Now, process all relevant invoices, which should all have line_items
    monthlyInvoices.forEach(inv => {
        if (inv.line_items && Array.isArray(inv.line_items)) {
            inv.line_items.forEach(item => {
                if (item.product_id) {
                    const revenue = parseFloat(item.line_total || 0);
                    const product = productsCache.find(p => p.id === item.product_id);
                    const productName = product ? product.product_name : `Product ID ${item.product_id}`;
                    productSales[productName] = (productSales[productName] || 0) + revenue;
                } else if (item.description) { // Handle custom line items
                    const revenue = parseFloat(item.line_total || 0);
                    productSales[item.description] = (productSales[item.description] || 0) + revenue;
                }
            });
        }
    });

    const sortedProducts = Object.entries(productSales)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);

    if (sortedProducts.length === 0) {
        placeholder.innerHTML = 'No sales data for this period.'; // Reset placeholder text
        placeholder.style.display = 'block';
        canvas.style.display = 'none';
        return;
    }

    placeholder.style.display = 'none';
    canvas.style.display = 'block';

    const chartColors = ["#4A90E2", "#50E3C2", "#F5A623", "#BD10E0", "#7ED321"];

    categoryChartInstance = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: sortedProducts.map(([productName]) => productName),
            datasets: [{
                data: sortedProducts.map(([, amount]) => amount),
                backgroundColor: chartColors,
                borderColor: '#ffffff',
                borderWidth: 2,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: "bottom", labels: { padding: 10, font: {size: 10} } },
                tooltip: { callbacks: { label: (context) => `${context.label}: ₹${context.parsed.toLocaleString()}` } }
            },
            cutout: '60%',
        },
    });
}
// Add this new function to your app-script.js file
// Add this new function to app-script.js
function printTransactionHistory(tableId, title) {
    const historyTable = document.getElementById(tableId)?.cloneNode(true);
    if (!historyTable) {
        alert("History table not found for printing.");
        return;
    }

    // Remove the 'Actions' column if it exists in the clone to not print it
    const actionsHeaderIndex = Array.from(historyTable.querySelectorAll('thead th')).findIndex(th => th.textContent.toLowerCase() === 'actions');
    if (actionsHeaderIndex > -1) {
        historyTable.querySelectorAll('tr').forEach(row => {
            if (row.cells[actionsHeaderIndex]) {
                row.deleteCell(actionsHeaderIndex);
            }
        });
    }


    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
    <html>
        <head>
            <title>${title}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                h3 { text-align: center; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; }
                .num { text-align: right; }
                .positive { color: #28a745; }
                .negative { color: #dc3545; }
                .positive-balance { color: #28a745; font-weight: bold; }
                .negative-balance { color: #dc3545; font-weight: bold; }
                tfoot { font-weight: bold; }
            </style>
        </head>
        <body>
            <h3>${title}</h3>
            ${historyTable.outerHTML}
            <script>
                window.onload = () => {
                    window.print();
                    window.close();
                }
            <\/script>
        </body>
    </html>`);
    printWindow.document.close();
}
function populateUserHistoryFilterDropdown(userId) {
    const dropdown = document.getElementById("userTxHistoryCategoryFilter");
    if (!dropdown) return;

    // Find all transaction groups relevant to this user
    const userTransactions = allTransactionsCache.filter(tx => tx.user_id === userId);
    const relevantGroups = new Set();
    userTransactions.forEach(tx => {
        const catInfo = transactionCategories.find(c => c.name === tx.category);
        if (catInfo && catInfo.group) {
            // Combine related groups for simpler filtering
            if (catInfo.group.includes('loan')) {
                relevantGroups.add('customer_loan');
            } else if (catInfo.group.includes('chit')) {
                relevantGroups.add('customer_chit');
            } else {
                relevantGroups.add(catInfo.group);
            }
        }
    });

    // Map internal group names to user-friendly labels
    const groupLabels = {
        'customer_revenue': 'Sales & Revenue',
        'customer_payment': 'Payments Received',
        'customer_loan': 'Loans',
        'customer_chit': 'Chits',
        'customer_return': 'Returns & Refunds'
    };

    // Populate the dropdown with an "All" option and the dynamic options
    dropdown.innerHTML = '<option value="all">All Transactions</option>';
    relevantGroups.forEach(groupKey => {
        const option = document.createElement('option');
        option.value = groupKey;
        option.textContent = groupLabels[groupKey] || groupKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        dropdown.appendChild(option);
    });
}
async function openUserTransactionHistoryModal(
    userId,
    userName,
    initialFilter = 'all',
) {
    currentViewingUserId = userId;
    currentViewingUserName = userName;
    const modal = document.getElementById("userTransactionHistoryModal");
    const title = document.getElementById("userTransactionHistoryModalTitle");
    const filterDropdown = document.getElementById(
        "userTxHistoryCategoryFilter",
    );
    if (!modal || !title || !filterDropdown) return;

    title.textContent = `Transaction History for ${userName}`;
    
    // --- THIS IS THE KEY ADDITION ---
    // Populate the filter dropdown with relevant options for this specific user
    populateUserHistoryFilterDropdown(userId); 
    // -----------------------------

    filterDropdown.value = initialFilter;
    filterDropdown.dataset.userId = userId;
    filterDropdown.dataset.userName = userName;
    
    loadUserTransactionHistory(userId, userName, initialFilter);
    modal.classList.add('show');
}
// in app-script.js
function toggleOriginalInvoiceSection() {
    const invoiceType = document.getElementById("inv_invoice_type").value;
    const originalInvoiceSection = document.getElementById("originalInvoiceSection");
    
    const invoiceNumberInput = document.getElementById("inv_invoice_number_display");
    const invoiceNumberGroup = invoiceNumberInput ? invoiceNumberInput.parentElement : null;

    if (!invoiceNumberInput || !invoiceNumberGroup) {
        console.error("Could not find invoice number input or its parent group.");
        return; 
    }

    if (invoiceType === 'SALES_RETURN') {
        if (originalInvoiceSection) originalInvoiceSection.style.display = 'block';
        if (invoiceNumberGroup) invoiceNumberGroup.style.display = 'none'; // Hide the regular invoice # input
        invoiceNumberInput.required = false; // Prevent validation error on the hidden field
    } else {
        if (originalInvoiceSection) originalInvoiceSection.style.display = 'none';
        if (invoiceNumberGroup) invoiceNumberGroup.style.display = 'block'; // Show the regular invoice # input
        invoiceNumberInput.required = true;
    }
}
// in app-script.js

async function loadOriginalInvoiceForReturn() {
    const originalInvoiceNumber = document.getElementById('original_invoice_number_input').value.trim();
    const infoDiv = document.getElementById('originalInvoiceInfo');
    const customerDropdown = document.getElementById('inv_customer_id');
    const lineItemsTableBody = document.getElementById('invLineItemsTableBody');

    if (!originalInvoiceNumber) {
        infoDiv.textContent = "Please enter an invoice number to load.";
        infoDiv.style.color = 'var(--danger-color)';
        return;
    }

    infoDiv.textContent = "Loading...";
    infoDiv.style.color = 'var(--text-light-color)';

    const originalInvoice = invoicesCache.find(inv => inv.invoice_number === originalInvoiceNumber);

    if (!originalInvoice) {
        infoDiv.textContent = `Invoice "${originalInvoiceNumber}" not found in recently loaded invoices.`;
        infoDiv.style.color = 'var(--danger-color)';
        return;
    }

    try {
        let detailedInvoice = originalInvoice;
        if (!detailedInvoice.line_items || detailedInvoice.line_items.length === 0) {
            const res = await apiFetch(`${API}/invoices/${originalInvoice.id}`);
            if (!res || !res.ok) throw new Error('Failed to fetch full invoice details.');
            detailedInvoice = await res.json();
        }

        customerDropdown.value = detailedInvoice.customer_id;
        customerDropdown.dispatchEvent(new Event('change'));

        // --- START OF FIX ---
        // Automatically set GST rates based on the original invoice type
        if (detailedInvoice.invoice_type === 'TAX_INVOICE') {
            const subtotal = parseFloat(detailedInvoice.amount_before_tax) || 0;
            // Calculate rates from original amounts to be precise
            const cgstRate = (detailedInvoice.total_cgst_amount && subtotal !== 0) ? (detailedInvoice.total_cgst_amount / subtotal) * 100 : 0;
            const sgstRate = (detailedInvoice.total_sgst_amount && subtotal !== 0) ? (detailedInvoice.total_sgst_amount / subtotal) * 100 : 0;
            const igstRate = (detailedInvoice.total_igst_amount && subtotal !== 0) ? (detailedInvoice.total_igst_amount / subtotal) * 100 : 0;
            
            document.getElementById("inv_cgst_rate_overall").value = cgstRate.toFixed(2);
            document.getElementById("inv_sgst_rate_overall").value = sgstRate.toFixed(2);
            document.getElementById("inv_igst_rate_overall").value = igstRate.toFixed(2);
        } else {
            // If original invoice was not taxable, ensure return is also not taxable
            document.getElementById("inv_cgst_rate_overall").value = 0;
            document.getElementById("inv_sgst_rate_overall").value = 0;
            document.getElementById("inv_igst_rate_overall").value = 0;
        }
        // --- END OF FIX ---

        lineItemsTableBody.innerHTML = '';
        if (detailedInvoice.line_items && detailedInvoice.line_items.length > 0) {
            detailedInvoice.line_items.forEach(item => {
                addInvLineItemRow({ ...item, quantity: Math.abs(item.quantity) });
            });
        }
        
        // Trigger a recalculation of totals after setting rates and adding items
        updateInvTotals(); 
        
        infoDiv.textContent = `Successfully loaded items from Invoice #${originalInvoiceNumber}. Please adjust quantities for return.`;
        infoDiv.style.color = 'var(--success-color)';

    } catch (error) {
        console.error("Error loading original invoice for return:", error);
        infoDiv.textContent = "Error loading invoice details. Please check console.";
        infoDiv.style.color = 'var(--danger-color)';
    }
}

async function loadCompanyProfileForEditing() {
    const profile = await loadBusinessProfile(); // This uses the cached or fetched profile
    if (!profile) return;

    document.getElementById('companyId').value = profile.id || '';
    document.getElementById('company_name_input').value = profile.company_name || '';
    document.getElementById('company_gstin_input').value = profile.gstin || '';
    document.getElementById('company_address1_input').value = profile.address_line1 || '';
    document.getElementById('company_city_pincode_input').value = profile.city_pincode || '';
    document.getElementById('company_state_input').value = profile.state || '';
    document.getElementById('company_phone_input').value = profile.phone || '';
    document.getElementById('company_email_input').value = profile.email || '';
    document.getElementById('company_bank_name_input').value = profile.bank_name || '';
    document.getElementById('company_bank_account_no_input').value = profile.bank_account_no || '';
    document.getElementById('company_bank_ifsc_input').value = profile.bank_ifsc_code || '';
}