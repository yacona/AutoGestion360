/* =========================================================
   BILLING — facturacion SaaS oficial + Wompi
   Depende de: ui.js, api.js, auth.js
   ========================================================= */

let billingEventsBound = false;

let billingState = {
  empresas: [],
  invoices: [],
  selectedCompanyId: 0,
  selectedInvoiceId: 0,
  currentInvoice: null,
  currentLedger: null,
  merchant: null,
  merchantError: "",
  paymentSources: [],
  checkout: null,
};

function billingCanManage() {
  const user = typeof getCurrentUser === "function" ? getCurrentUser() : {};
  return user?.scope === "platform" && typeof userCan === "function" && userCan("platform:billing:gestionar");
}

function formatBillingDate(value) {
  return value ? formatDisplayDate(value) : "—";
}

function getInvoiceStatusBadge(status) {
  return renderBadge(status || "OPEN");
}

function getProviderBadge(provider) {
  return renderBadge(provider || "MANUAL");
}

function setBillingMessage(elementId, message, isError = false) {
  if (typeof showMessage === "function") {
    showMessage(elementId, message, isError);
  }
}

function populateBillingCompanySelects() {
  const options = billingState.empresas.length
    ? billingState.empresas.map((empresa) => `<option value="${empresa.id}">${escapeHtml(empresa.nombre)}</option>`).join("")
    : '<option value="">Sin empresas</option>';

  ["billing-filter-company", "billing-create-company"].forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = options;
    if (billingState.selectedCompanyId) {
      select.value = String(billingState.selectedCompanyId);
    }
  });
}

function syncBillingCompanySelection(companyId) {
  const nextCompanyId = Number(companyId || 0);
  billingState.selectedCompanyId = nextCompanyId;
  ["billing-filter-company", "billing-create-company"].forEach((id) => {
    const select = document.getElementById(id);
    if (select && nextCompanyId) {
      select.value = String(nextCompanyId);
    }
  });
}

function setBillingInvoiceSummary() {
  const invoices = Array.isArray(billingState.invoices) ? billingState.invoices : [];
  const openInvoices = invoices.filter((invoice) => ["OPEN", "PARTIALLY_PAID"].includes(String(invoice.estado || "").toUpperCase()));
  const overdueInvoices = invoices.filter((invoice) => String(invoice.estado || "").toUpperCase() === "OVERDUE");
  const paidInvoices = invoices.filter((invoice) => String(invoice.estado || "").toUpperCase() === "PAID");
  const balance = invoices.reduce((acc, invoice) => acc + Number(invoice.saldo_pendiente || 0), 0);

  setElementText("billing-summary-open", openInvoices.length);
  setElementText("billing-summary-overdue", overdueInvoices.length);
  setElementText("billing-summary-paid", paidInvoices.length);
  setElementText("billing-summary-balance", formatMoney(balance));
  setElementText("billing-invoices-count", `${invoices.length} registro${invoices.length === 1 ? "" : "s"}`);
}

function renderBillingInvoicesTable() {
  const tbody = document.getElementById("billing-invoices-tbody");
  const empty = document.getElementById("billing-invoices-empty");
  if (!tbody || !empty) return;

  const invoices = Array.isArray(billingState.invoices) ? billingState.invoices : [];
  empty.hidden = invoices.length > 0;

  tbody.innerHTML = invoices.map((invoice) => {
    const isSelected = Number(billingState.selectedInvoiceId) === Number(invoice.id);
    return `
      <tr class="${isSelected ? "billing-row-selected" : ""}">
        <td>
          <strong>${escapeHtml(invoice.numero_factura || `INV-${invoice.id}`)}</strong>
          <span class="table-subtext">${escapeHtml(formatBillingDate(invoice.emitida_en))}</span>
        </td>
        <td>
          <strong>${escapeHtml(invoice.empresa_nombre || "Empresa")}</strong>
          <span class="table-subtext">${escapeHtml(invoice.plan_nombre || invoice.plan_codigo || "Sin plan")}</span>
        </td>
        <td>${escapeHtml(invoice.motivo || "MANUAL_ADJUSTMENT")}</td>
        <td>${formatMoney(Number(invoice.total || 0))}</td>
        <td>${formatMoney(Number(invoice.saldo_pendiente || 0))}</td>
        <td>${getInvoiceStatusBadge(invoice.estado)}</td>
        <td>${getProviderBadge(invoice.pasarela || "MANUAL")}</td>
        <td>
          <div class="table-actions">
            <button type="button" class="btn btn-sm btn-secondary" data-billing-action="select" data-invoice-id="${invoice.id}">Abrir</button>
            <button type="button" class="btn btn-sm btn-outline" data-billing-action="checkout" data-invoice-id="${invoice.id}">Checkout</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderBillingMerchantStatus() {
  const merchant = billingState.merchant;
  const error = billingState.merchantError;
  const statusEl = document.getElementById("billing-merchant-status");
  const keyPreview = merchant?.public_key ? `${String(merchant.public_key).slice(0, 12)}...` : "-";

  setElementText("billing-merchant-env", merchant?.environment || "-");
  setElementText("billing-merchant-key", keyPreview);
  setElementText("billing-merchant-checkout-url", merchant?.checkout_url || "-");
  setElementText("billing-merchant-redirect-url", merchant?.redirect_url || "-");

  const acceptance = document.getElementById("billing-merchant-acceptance-token");
  const personalAuth = document.getElementById("billing-merchant-personal-auth");
  if (acceptance) acceptance.value = merchant?.acceptance?.acceptance_token || "";
  if (personalAuth) personalAuth.value = merchant?.acceptance?.personal_auth_token || "";

  if (statusEl) {
    statusEl.className = `badge ${merchant ? "badge-success" : error ? "badge-danger" : "badge-muted"}`;
    statusEl.textContent = merchant ? "Configurado" : error ? "Pendiente" : "Sin validar";
  }

  if (error) {
    setBillingMessage("billing-merchant-msg", error, true);
  }
}

function renderBillingLedger() {
  const company = billingState.empresas.find((item) => Number(item.id) === Number(billingState.selectedCompanyId));
  const subscription = billingState.currentLedger?.suscripcion || null;

  setElementText("billing-ledger-company", company?.nombre || "Sin seleccion");
  setElementText("billing-ledger-plan", subscription?.plan_nombre || subscription?.plan_codigo || "Sin plan");
  setElementText("billing-ledger-status", subscription?.estado || "Sin suscripcion");
  setElementText("billing-ledger-end", formatBillingDate(subscription?.fecha_fin || subscription?.trial_hasta));

  const sourceContainer = document.getElementById("billing-payment-sources");
  if (!sourceContainer) return;

  if (!billingState.paymentSources.length) {
    sourceContainer.innerHTML = `
      <div class="billing-source-empty">
        <strong>Sin fuentes de pago Wompi registradas.</strong>
        <span>Puedes registrar una cuando tengas tokenizacion activa en sandbox.</span>
      </div>
    `;
    return;
  }

  sourceContainer.innerHTML = billingState.paymentSources.map((source) => `
    <article class="billing-source-item">
      <div>
        <strong>${escapeHtml(source.type || "WOMPI")}</strong>
        <span class="table-subtext">${escapeHtml(source.customer_email || "Sin email")}</span>
      </div>
      <div class="billing-source-meta">
        ${source.is_default ? '<span class="badge badge-success">Predeterminada</span>' : '<span class="badge badge-muted">Secundaria</span>'}
        <span class="badge ${String(source.status || "").toUpperCase() === "ACTIVE" ? "badge-teal" : "badge-warning"}">${escapeHtml(source.status || "INACTIVE")}</span>
      </div>
      <button type="button" class="btn btn-sm btn-outline" data-billing-source-action="default" data-source-id="${source.id}">
        Usar por defecto
      </button>
    </article>
  `).join("");
}

function renderBillingActivityList(elementId, items = [], renderer) {
  const element = document.getElementById(elementId);
  if (!element) return;

  if (!items.length) {
    element.innerHTML = `
      <div class="billing-activity-empty">
        <strong>Sin registros</strong>
        <span>No hay movimientos para esta seccion todavia.</span>
      </div>
    `;
    return;
  }

  element.innerHTML = items.map(renderer).join("");
}

function renderCheckoutLauncher() {
  const container = document.getElementById("billing-checkout-launcher");
  const checkout = billingState.checkout;
  if (!container) return;

  if (!checkout) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  const hiddenInputs = [
    ["public-key", checkout.public_key],
    ["currency", checkout.currency],
    ["amount-in-cents", checkout.amount_in_cents],
    ["reference", checkout.reference],
    ["signature:integrity", checkout.signature?.integrity],
    ["redirect-url", checkout.redirect_url || ""],
    ["expiration-time", checkout.expiration_time || ""],
    ["customer-data:email", checkout.customer_data?.email || ""],
  ].map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value || "")}" />`).join("");

  container.classList.remove("hidden");
  container.innerHTML = `
    <div class="billing-checkout-preview">
      <div>
        <strong>Checkout listo</strong>
        <span class="table-subtext">Referencia ${escapeHtml(checkout.reference)} · ${formatMoney(Number(checkout.amount_in_cents || 0) / 100)}</span>
      </div>
      <form action="${escapeHtml(checkout.checkout_url)}" method="GET" target="_blank" class="billing-checkout-form">
        ${hiddenInputs}
        <button type="submit" class="btn btn-primary">Abrir Web Checkout</button>
      </form>
    </div>
  `;
}

function renderBillingDetail() {
  const invoice = billingState.currentInvoice;
  const checkoutContainer = document.getElementById("billing-checkout-launcher");
  if (!invoice) {
    setElementText("billing-detail-title", "Sin seleccion");
    setElementText("billing-detail-subtitle", "Selecciona una factura para ver intentos, pagos y activar checkout.");
    setElementText("billing-detail-total", formatMoney(0));
    setElementText("billing-detail-balance", formatMoney(0));
    setElementText("billing-detail-paid", formatMoney(0));
    setElementText("billing-detail-due", "—");
    const statusEl = document.getElementById("billing-detail-status");
    if (statusEl) {
      statusEl.className = "badge badge-muted";
      statusEl.textContent = "-";
    }
    renderBillingActivityList("billing-attempts-list", [], () => "");
    renderBillingActivityList("billing-payments-list", [], () => "");
    renderBillingActivityList("billing-credits-list", [], () => "");
    if (checkoutContainer) {
      checkoutContainer.classList.add("hidden");
      checkoutContainer.innerHTML = "";
    }
    return;
  }

  setElementText("billing-detail-title", invoice.numero_factura || `Factura ${invoice.id}`);
  setElementText("billing-detail-subtitle", `${invoice.empresa_nombre || "Empresa"} · ${invoice.plan_nombre || invoice.plan_codigo || "Sin plan"} · ${invoice.motivo || "MANUAL_ADJUSTMENT"}`);
  setElementText("billing-detail-total", formatMoney(Number(invoice.total || 0)));
  setElementText("billing-detail-balance", formatMoney(Number(invoice.saldo_pendiente || 0)));
  setElementText("billing-detail-paid", formatMoney(Number(invoice.total_pagado || 0)));
  setElementText("billing-detail-due", formatBillingDate(invoice.vencimiento_en));

  const statusEl = document.getElementById("billing-detail-status");
  if (statusEl) {
    statusEl.className = getBadgeClass(invoice.estado);
    statusEl.textContent = invoice.estado || "OPEN";
  }

  const paymentAmount = document.getElementById("billing-payment-amount");
  if (paymentAmount) paymentAmount.value = String(Math.round(Number(invoice.saldo_pendiente || 0)));
  const checkoutEmail = document.getElementById("billing-checkout-email");
  if (checkoutEmail && !checkoutEmail.value) {
    checkoutEmail.value = billingState.paymentSources[0]?.customer_email || "";
  }
  const sourceEmail = document.getElementById("billing-source-email");
  if (sourceEmail && !sourceEmail.value) {
    sourceEmail.value = billingState.paymentSources[0]?.customer_email || "";
  }
  const sandboxEmail = document.getElementById("billing-sandbox-email");
  if (sandboxEmail && !sandboxEmail.value) {
    sandboxEmail.value = billingState.paymentSources[0]?.customer_email || "";
  }

  renderBillingActivityList("billing-attempts-list", invoice.payment_attempts || [], (attempt) => `
    <article class="billing-activity-item">
      <div>
        <strong>${escapeHtml(attempt.provider || "MANUAL")} · ${escapeHtml(attempt.estado || "CREATED")}</strong>
        <span class="table-subtext">${escapeHtml(formatDateTime(attempt.created_at))}</span>
      </div>
      <div class="billing-activity-meta">
        <span>${formatMoney(Number(attempt.amount || 0))}</span>
        <span>${escapeHtml(attempt.external_attempt_id || attempt.external_payment_id || "Sin id externo")}</span>
      </div>
    </article>
  `);

  renderBillingActivityList("billing-payments-list", invoice.payments || [], (payment) => `
    <article class="billing-activity-item">
      <div>
        <strong>${escapeHtml(payment.provider || "MANUAL")} · ${escapeHtml(payment.payment_method || "OTRO")}</strong>
        <span class="table-subtext">${escapeHtml(formatDateTime(payment.paid_at))}</span>
      </div>
      <div class="billing-activity-meta">
        <span>${formatMoney(Number(payment.amount || 0))}</span>
        <span>${escapeHtml(payment.estado || "CONFIRMED")}</span>
      </div>
    </article>
  `);

  renderBillingActivityList("billing-credits-list", invoice.credit_notes || [], (credit) => `
    <article class="billing-activity-item">
      <div>
        <strong>${escapeHtml(credit.credit_note_number || `NC-${credit.id}`)}</strong>
        <span class="table-subtext">${escapeHtml(formatDateTime(credit.issued_at || credit.created_at))}</span>
      </div>
      <div class="billing-activity-meta">
        <span>${formatMoney(Number(credit.total_amount || 0))}</span>
        <span>${escapeHtml(credit.estado || "ISSUED")}</span>
      </div>
    </article>
  `);

  renderCheckoutLauncher();
}

async function loadBillingMerchant() {
  try {
    billingState.merchant = await apiFetch("/api/billing/providers/wompi/merchant");
    billingState.merchantError = "";
  } catch (error) {
    billingState.merchant = null;
    billingState.merchantError = error.message || "No fue posible cargar la configuracion de Wompi.";
  }

  renderBillingMerchantStatus();
}

async function loadBillingCompanies() {
  try {
    billingState.empresas = await apiFetch("/api/admin/empresas");
  } catch (error) {
    billingState.empresas = [];
    setBillingMessage("billing-main-msg", error.message || "No fue posible cargar empresas.", true);
  }

  if (!billingState.selectedCompanyId && billingState.empresas.length) {
    billingState.selectedCompanyId = Number(billingState.empresas[0].id);
  }

  populateBillingCompanySelects();
}

async function loadBillingInvoices() {
  const params = new URLSearchParams();
  const selectedCompanyId = Number(document.getElementById("billing-filter-company")?.value || billingState.selectedCompanyId || 0);
  const selectedStatus = document.getElementById("billing-filter-status")?.value || "";
  const limit = document.getElementById("billing-filter-limit")?.value || "50";

  if (selectedCompanyId) params.set("empresa_id", String(selectedCompanyId));
  if (selectedStatus) params.set("estado", selectedStatus);
  params.set("limit", limit);

  billingState.invoices = await apiFetch(`/api/billing/invoices?${params.toString()}`);
  setBillingInvoiceSummary();
  renderBillingInvoicesTable();
}

async function loadBillingLedger(companyId = billingState.selectedCompanyId) {
  if (!companyId) {
    billingState.currentLedger = null;
    billingState.paymentSources = [];
    renderBillingLedger();
    return;
  }

  try {
    const [ledger, sources] = await Promise.all([
      apiFetch(`/api/billing/subscriptions/${companyId}/ledger`),
      apiFetch(`/api/billing/subscriptions/${companyId}/providers/wompi/payment-sources`).catch(() => []),
    ]);
    billingState.currentLedger = ledger;
    billingState.paymentSources = Array.isArray(sources) ? sources : [];
    renderBillingLedger();
  } catch (error) {
    billingState.currentLedger = null;
    billingState.paymentSources = [];
    renderBillingLedger();
    setBillingMessage("billing-ledger-msg", error.message || "No fue posible cargar el ledger.", true);
  }
}

async function loadBillingInvoiceDetail(invoiceId) {
  if (!invoiceId) {
    billingState.selectedInvoiceId = 0;
    billingState.currentInvoice = null;
    billingState.checkout = null;
    renderBillingDetail();
    renderBillingInvoicesTable();
    return;
  }

  try {
    billingState.currentInvoice = await apiFetch(`/api/billing/invoices/${invoiceId}`);
    billingState.selectedInvoiceId = Number(invoiceId);
    billingState.checkout = null;
    syncBillingCompanySelection(billingState.currentInvoice.empresa_id);
    renderBillingDetail();
    renderBillingInvoicesTable();
  } catch (error) {
    setBillingMessage("billing-main-msg", error.message || "No fue posible cargar el detalle de la factura.", true);
  }
}

function fillInvoiceTotalsFromSubtotal() {
  const subtotal = Number(document.getElementById("billing-create-subtotal")?.value || 0);
  const tax = Number(document.getElementById("billing-create-tax")?.value || 0);
  const discount = Number(document.getElementById("billing-create-discount")?.value || 0);
  const totalInput = document.getElementById("billing-create-total");
  if (!totalInput) return;
  totalInput.value = String(Math.max(0, subtotal + tax - discount));
}

function populateBillingFormFromLedger() {
  const companyId = Number(document.getElementById("billing-create-company")?.value || billingState.selectedCompanyId || 0);
  const company = billingState.empresas.find((item) => Number(item.id) === companyId);
  const subscription = billingState.currentLedger?.suscripcion || null;
  const amount = Number(subscription?.precio_pactado || subscription?.precio_mensual || 0);
  const dueInput = document.getElementById("billing-create-due-date");
  const startInput = document.getElementById("billing-create-period-start");
  const endInput = document.getElementById("billing-create-period-end");
  const subtotalInput = document.getElementById("billing-create-subtotal");
  const gatewaySelect = document.getElementById("billing-create-gateway");

  if (subtotalInput && amount > 0) subtotalInput.value = String(Math.round(amount));
  if (startInput && subscription?.fecha_inicio) startInput.value = String(subscription.fecha_inicio).split("T")[0];
  if (endInput && subscription?.fecha_fin) endInput.value = String(subscription.fecha_fin).split("T")[0];
  if (dueInput && !dueInput.value) dueInput.value = formatDateParam(new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)));
  if (gatewaySelect && subscription?.pasarela) gatewaySelect.value = subscription.pasarela;
  if (company) syncBillingCompanySelection(company.id);
  fillInvoiceTotalsFromSubtotal();
}

async function refreshBillingView({ keepSelection = true } = {}) {
  await loadBillingCompanies();
  await Promise.all([
    loadBillingMerchant(),
    loadBillingInvoices(),
    loadBillingLedger(billingState.selectedCompanyId),
  ]);

  if (keepSelection && billingState.selectedInvoiceId) {
    await loadBillingInvoiceDetail(billingState.selectedInvoiceId);
  } else {
    renderBillingDetail();
  }

  populateBillingFormFromLedger();
}

async function handleBillingRefresh() {
  try {
    await refreshBillingView();
    setBillingMessage("billing-main-msg", "Billing actualizado.");
  } catch (error) {
    setBillingMessage("billing-main-msg", error.message || "No fue posible actualizar billing.", true);
  }
}

async function handleBillingCompanyChange(event) {
  const companyId = Number(event.target.value || 0);
  syncBillingCompanySelection(companyId);
  await loadBillingInvoices();
  await loadBillingLedger(companyId);
  populateBillingFormFromLedger();
  await loadBillingInvoiceDetail(null);
}

async function handleCreateInvoice(event) {
  event.preventDefault();

  const companyId = Number(document.getElementById("billing-create-company")?.value || 0);
  if (!companyId) {
    setBillingMessage("billing-create-msg", "Selecciona una empresa.", true);
    return;
  }

  try {
    const invoice = await apiFetch("/api/billing/invoices", {
      method: "POST",
      body: JSON.stringify({
        empresa_id: companyId,
        numero_factura: document.getElementById("billing-create-number")?.value.trim() || null,
        motivo: document.getElementById("billing-create-reason")?.value || "MANUAL_ADJUSTMENT",
        collection_method: document.getElementById("billing-create-method")?.value || "MANUAL",
        subtotal: Number(document.getElementById("billing-create-subtotal")?.value || 0),
        monto_impuestos: Number(document.getElementById("billing-create-tax")?.value || 0),
        monto_descuento: Number(document.getElementById("billing-create-discount")?.value || 0),
        total: Number(document.getElementById("billing-create-total")?.value || 0),
        periodo_inicio: document.getElementById("billing-create-period-start")?.value || null,
        periodo_fin: document.getElementById("billing-create-period-end")?.value || null,
        vencimiento_en: document.getElementById("billing-create-due-date")?.value || null,
        pasarela: document.getElementById("billing-create-gateway")?.value || "MANUAL",
      }),
    });

    setBillingMessage("billing-create-msg", "Factura creada correctamente.");
    billingState.selectedInvoiceId = Number(invoice?.invoice?.id || 0);
    await refreshBillingView();
  } catch (error) {
    setBillingMessage("billing-create-msg", error.message || "No fue posible crear la factura.", true);
  }
}

async function handleCreateRenewalInvoice() {
  const companyId = Number(document.getElementById("billing-filter-company")?.value || billingState.selectedCompanyId || 0);
  if (!companyId) {
    setBillingMessage("billing-main-msg", "Selecciona una empresa para crear la renovacion.", true);
    return;
  }

  try {
    const result = await apiFetch(`/api/billing/subscriptions/${companyId}/invoices/renewal`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setBillingMessage("billing-main-msg", "Factura de renovacion creada.");
    billingState.selectedInvoiceId = Number(result?.invoice?.id || 0);
    await refreshBillingView();
  } catch (error) {
    setBillingMessage("billing-main-msg", error.message || "No fue posible crear la renovacion.", true);
  }
}

async function handleBillingManualPayment(event) {
  event.preventDefault();
  const invoiceId = Number(billingState.selectedInvoiceId || 0);
  if (!invoiceId) {
    setBillingMessage("billing-payment-msg", "Selecciona una factura.", true);
    return;
  }

  try {
    await apiFetch(`/api/billing/invoices/${invoiceId}/payments/manual`, {
      method: "POST",
      body: JSON.stringify({
        amount: Number(document.getElementById("billing-payment-amount")?.value || 0),
        payment_method: document.getElementById("billing-payment-method")?.value || "TRANSFERENCIA",
        provider: "MANUAL",
        referencia_externa: document.getElementById("billing-payment-reference")?.value.trim() || null,
      }),
    });
    setBillingMessage("billing-payment-msg", "Pago manual registrado.");
    await refreshBillingView();
  } catch (error) {
    setBillingMessage("billing-payment-msg", error.message || "No fue posible registrar el pago.", true);
  }
}

async function handlePrepareCheckout(event) {
  event.preventDefault();
  const invoiceId = Number(billingState.selectedInvoiceId || 0);
  if (!invoiceId) {
    setBillingMessage("billing-checkout-msg", "Selecciona una factura.", true);
    return;
  }

  try {
    const result = await apiFetch(`/api/billing/invoices/${invoiceId}/providers/wompi/checkout-session`, {
      method: "POST",
      body: JSON.stringify({
        customer_email: document.getElementById("billing-checkout-email")?.value.trim() || "",
        redirect_url: document.getElementById("billing-checkout-redirect")?.value.trim() || null,
      }),
    });
    billingState.checkout = result.checkout || null;
    renderCheckoutLauncher();
    setBillingMessage("billing-checkout-msg", "Checkout preparado. Ya puedes abrir Wompi.");
  } catch (error) {
    billingState.checkout = null;
    renderCheckoutLauncher();
    setBillingMessage("billing-checkout-msg", error.message || "No fue posible preparar el checkout.", true);
  }
}

async function handleCreatePaymentSource(event) {
  event.preventDefault();
  const companyId = Number(billingState.selectedCompanyId || 0);
  if (!companyId) {
    setBillingMessage("billing-source-msg", "Selecciona una empresa.", true);
    return;
  }

  const acceptanceToken = billingState.merchant?.acceptance?.acceptance_token || "";
  const personalAuthToken = billingState.merchant?.acceptance?.personal_auth_token || "";

  if (!acceptanceToken || !personalAuthToken) {
    setBillingMessage("billing-source-msg", "Primero configura Wompi en backend y valida el merchant.", true);
    return;
  }

  try {
    await apiFetch(`/api/billing/subscriptions/${companyId}/providers/wompi/payment-sources`, {
      method: "POST",
      body: JSON.stringify({
        token: document.getElementById("billing-source-token")?.value.trim() || "",
        type: document.getElementById("billing-source-type")?.value || "CARD",
        customer_email: document.getElementById("billing-source-email")?.value.trim() || "",
        acceptance_token: acceptanceToken,
        accept_personal_auth: personalAuthToken,
        make_default: true,
      }),
    });
    setBillingMessage("billing-source-msg", "Fuente de pago guardada.");
    await loadBillingLedger(companyId);
  } catch (error) {
    setBillingMessage("billing-source-msg", error.message || "No fue posible guardar la fuente de pago.", true);
  }
}

async function handleSyncWompi(event) {
  event.preventDefault();
  const invoiceId = Number(billingState.selectedInvoiceId || 0);
  if (!invoiceId) {
    setBillingMessage("billing-sync-msg", "Selecciona una factura.", true);
    return;
  }

  try {
    await apiFetch(`/api/billing/invoices/${invoiceId}/providers/wompi/sync`, {
      method: "POST",
      body: JSON.stringify({
        transaction_id: document.getElementById("billing-sync-transaction")?.value.trim() || null,
      }),
    });
    setBillingMessage("billing-sync-msg", "Transaccion sincronizada.");
    await refreshBillingView();
  } catch (error) {
    setBillingMessage("billing-sync-msg", error.message || "No fue posible sincronizar Wompi.", true);
  }
}

async function handleSandboxCardTransaction(event) {
  event.preventDefault();
  const invoiceId = Number(billingState.selectedInvoiceId || 0);
  if (!invoiceId) {
    setBillingMessage("billing-sandbox-msg", "Selecciona una factura.", true);
    return;
  }

  try {
    const result = await apiFetch(`/api/billing/invoices/${invoiceId}/providers/wompi/sandbox/card-transaction`, {
      method: "POST",
      body: JSON.stringify({
        customer_email: document.getElementById("billing-sandbox-email")?.value.trim() || "sandbox@autogestion360.test",
      }),
    });
    const status = result?.transaction?.status || "PENDING";
    setBillingMessage("billing-sandbox-msg", `Transaccion sandbox creada: ${status}.`);
    await refreshBillingView();
  } catch (error) {
    setBillingMessage("billing-sandbox-msg", error.message || "No fue posible ejecutar la prueba sandbox.", true);
  }
}

async function handleBillingInvoiceTableClick(event) {
  const button = event.target.closest("[data-billing-action]");
  if (!button) return;

  const invoiceId = Number(button.dataset.invoiceId || 0);
  const action = button.dataset.billingAction;
  if (!invoiceId) return;

  if (action === "select") {
    await loadBillingInvoiceDetail(invoiceId);
    return;
  }

  if (action === "checkout") {
    await loadBillingInvoiceDetail(invoiceId);
    document.getElementById("form-billing-checkout")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function handleBillingSourceListClick(event) {
  const button = event.target.closest("[data-billing-source-action='default']");
  if (!button) return;

  const sourceId = Number(button.dataset.sourceId || 0);
  const companyId = Number(billingState.selectedCompanyId || 0);
  if (!sourceId || !companyId) return;

  try {
    await apiFetch(`/api/billing/subscriptions/${companyId}/providers/wompi/payment-sources/${sourceId}/default`, {
      method: "PATCH",
      body: JSON.stringify({ is_default: true }),
    });
    setBillingMessage("billing-ledger-msg", "Fuente predeterminada actualizada.");
    await loadBillingLedger(companyId);
  } catch (error) {
    setBillingMessage("billing-ledger-msg", error.message || "No fue posible actualizar la fuente predeterminada.", true);
  }
}

function bindBillingEvents() {
  if (billingEventsBound) return;
  billingEventsBound = true;

  document.getElementById("btn-billing-refresh")?.addEventListener("click", handleBillingRefresh);
  document.getElementById("btn-billing-merchant-refresh")?.addEventListener("click", loadBillingMerchant);
  document.getElementById("btn-billing-renewal")?.addEventListener("click", handleCreateRenewalInvoice);
  document.getElementById("billing-filter-company")?.addEventListener("change", handleBillingCompanyChange);
  document.getElementById("billing-create-company")?.addEventListener("change", (event) => {
    syncBillingCompanySelection(event.target.value);
    loadBillingLedger(Number(event.target.value || 0)).catch((error) => {
      setBillingMessage("billing-ledger-msg", error.message || "No fue posible cargar el ledger.", true);
    });
    populateBillingFormFromLedger();
  });
  document.getElementById("billing-filter-status")?.addEventListener("change", loadBillingInvoices);
  document.getElementById("billing-filter-limit")?.addEventListener("change", loadBillingInvoices);
  document.getElementById("billing-create-subtotal")?.addEventListener("input", fillInvoiceTotalsFromSubtotal);
  document.getElementById("billing-create-tax")?.addEventListener("input", fillInvoiceTotalsFromSubtotal);
  document.getElementById("billing-create-discount")?.addEventListener("input", fillInvoiceTotalsFromSubtotal);
  document.getElementById("form-billing-invoice-create")?.addEventListener("submit", handleCreateInvoice);
  document.getElementById("form-billing-manual-payment")?.addEventListener("submit", handleBillingManualPayment);
  document.getElementById("form-billing-checkout")?.addEventListener("submit", handlePrepareCheckout);
  document.getElementById("form-billing-payment-source")?.addEventListener("submit", handleCreatePaymentSource);
  document.getElementById("form-billing-wompi-sync")?.addEventListener("submit", handleSyncWompi);
  document.getElementById("form-billing-wompi-sandbox")?.addEventListener("submit", handleSandboxCardTransaction);
  document.getElementById("billing-invoices-tbody")?.addEventListener("click", handleBillingInvoiceTableClick);
  document.getElementById("billing-payment-sources")?.addEventListener("click", handleBillingSourceListClick);
}

window.AG360.registerModule({
  id: "billing",
  title: "Billing",
  licenseModule: null,
  icon: "💳",
  order: 35,
  isVisible: billingCanManage,
  bindEvents: bindBillingEvents,
  onEnter: refreshBillingView,
});
